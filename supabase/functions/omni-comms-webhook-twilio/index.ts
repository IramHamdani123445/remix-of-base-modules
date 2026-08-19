// Omni-Comms — Twilio delivery callback receiver (WhatsApp and SMS).
//
// Receives signed Twilio status callbacks and records them as immutable
// callback evidence, exactly like the Resend receiver:
//   * technical channel-test deliveries are matched FIRST;
//   * only then is business delivery evidence consulted;
//   * the signature is verified server-side against the account's own auth
//     token, resolved by reference only and never logged or returned;
//   * an unsigned, stale or unverifiable request is rejected fail-closed and
//     recorded as bounded rejection evidence.
//
// It never sends anything and never echoes recipient values.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sha256Hex } from "../_shared/omni-comms/resendAdapter.ts";
import {
  normalizeTwilioCallbackEvent,
  verifyTwilioSignature,
} from "../_shared/omni-comms/twilioWhatsAppAdapter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-twilio-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Resolves the account auth token by reference only. Never logged. */
async function resolveAuthToken(client: Rpc, providerAccountId: string): Promise<string> {
  if (!providerAccountId) return "";
  try {
    const { data, error } = await client.rpc(
      "omni_comms_priv_resolve_provider_credential_source",
      { p_provider_account_id: providerAccountId, p_purpose: "auth_token" },
    );
    if (error) return "";
    const source = (data ?? {}) as Record<string, unknown>;
    if (source.found === true && typeof source.value === "string") return source.value.trim();
    if (source.storageMode === "edge_env" && typeof source.envVar === "string" && source.envVar) {
      return (Deno.env.get(source.envVar) ?? "").trim();
    }
    return "";
  } catch {
    return "";
  }
}

async function recordRejection(
  client: Rpc,
  providerCode: string,
  providerAccountId: string,
  providerEventId: string,
  reason: string,
): Promise<void> {
  try {
    await client.rpc("omni_comms_priv_webhook_record_rejection", {
      p_provider_code: providerCode,
      p_provider_event_id: providerEventId || "",
      p_provider_account_id: providerAccountId || null,
      p_reason: reason,
      p_payload_digest: null,
    });
  } catch {
    // evidence recording is best-effort only
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "configuration_error" }, 503);

  const client = createClient(SUPABASE_URL, SERVICE_ROLE) as unknown as Rpc;
  const url = new URL(req.url);
  const providerAccountId = url.searchParams.get("account")?.trim() ?? "";

  const rawBody = await req.text();
  const form = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const providerMessageId = (params.MessageSid ?? params.SmsSid ?? "").trim();
  const rawStatus = (params.MessageStatus ?? params.SmsStatus ?? "").trim();
  const isWhatsApp = (params.To ?? params.From ?? "").startsWith("whatsapp:");
  const providerCode = isWhatsApp ? "twilio_whatsapp" : "twilio_sms";
  const providerEventId = `${providerMessageId}:${rawStatus}`;

  const authToken = await resolveAuthToken(client, providerAccountId);
  if (!authToken) {
    await recordRejection(client, providerCode, providerAccountId, providerEventId, "callback_secret_unavailable");
    return json({ error: "signature_unverifiable" }, 401);
  }

  const verified = await verifyTwilioSignature({
    authToken,
    // Twilio signs the exact public callback URL, query string included.
    url: `${url.origin}${url.pathname}${url.search}`,
    params,
    signature: req.headers.get("x-twilio-signature"),
  });
  if (!verified) {
    await recordRejection(client, providerCode, providerAccountId, providerEventId, "signature_invalid");
    return json({ error: "signature_invalid" }, 401);
  }

  if (!providerMessageId || !rawStatus) {
    await recordRejection(client, providerCode, providerAccountId, providerEventId, "payload_incomplete");
    return json({ error: "payload_incomplete" }, 400);
  }

  const normalized = normalizeTwilioCallbackEvent(rawStatus);
  if (!normalized) {
    return json({ accepted: true, scope: "ignored", code: "event_not_tracked" });
  }

  // Bounded, non-sensitive evidence only — never the recipient value.
  const summary: Record<string, unknown> = {
    channel: isWhatsApp ? "whatsapp" : "sms",
    provider_status: rawStatus,
  };
  if (params.ErrorCode) summary.provider_error_code = params.ErrorCode;
  const payloadDigest = `sha256:${await sha256Hex(rawBody)}`;

  // 1. Technical channel-test delivery is matched first.
  const { data: testData, error: testError } = await client.rpc(
    "omni_comms_priv_channel_test_delivery_record_event",
    {
      p_provider_message_id: providerMessageId,
      p_event_type: normalized.replace(/^callback_/, ""),
      p_provider_event_id: providerEventId,
      p_occurred_at: null,
      p_payload_summary: summary,
      p_signature_verified: true,
    },
  );
  if (testError) {
    console.error(`omni-comms-webhook-twilio channel_test_record_failed provider_event=${providerEventId}`);
    return json({ error: "record_failed" }, 500);
  }
  const testRecord = (testData ?? {}) as Record<string, unknown>;
  const testMatched =
    (testRecord.matched === true || testRecord.recorded === true) &&
    testRecord.code !== "unmatched" &&
    testRecord.code !== "unmatched_ignored";
  if (testMatched) return json({ accepted: true, scope: "channel_test", ...testRecord });

  // 2. Business delivery evidence.
  const business = await client.rpc("omni_comms_priv_dispatch_record_callback", {
    p_provider_code: providerCode,
    p_provider_event_id: providerEventId,
    p_provider_message_id: providerMessageId,
    p_raw_event_type: rawStatus,
    p_normalized_event_type: normalized,
    p_occurred_at: null,
    p_payload_summary: summary,
    p_payload_digest: payloadDigest,
    p_signature_verified: true,
  });
  if (business.error) {
    console.error(`omni-comms-webhook-twilio business_record_failed provider_event=${providerEventId}`);
    return json({ error: "record_failed" }, 500);
  }
  const result = (business.data ?? {}) as Record<string, unknown>;
  return json({
    accepted: true,
    scope: result.code === "callback_recorded" ? "business" : "unmatched",
    ...result,
  });
});
