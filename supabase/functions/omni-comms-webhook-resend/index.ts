// Omni-Comms — Resend delivery callback receiver.
//
// Receives Svix-signed Resend delivery lifecycle events and records them as
// immutable callback evidence:
//   * C7 — normal BUSINESS delivery attempts (`omni_comms_webhook_event`,
//     `omni_comms_delivery_attempt`, message timeline), including automatic
//     controlled-pilot suspension on complaint or hard bounce;
//   * C5B — approved technical channel-test deliveries (unchanged).
//
// It NEVER sends anything, never reads or logs the signing secret, never
// stores raw headers or full payload bodies, and rejects unsigned or stale
// requests.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySvixSignature } from "../_shared/omni-comms/svix.ts";
import {
  RESEND_CALLBACK_EVENTS,
  RESEND_TEST_EVENT_NAMES,
  maskEmail,
  sha256Hex,
} from "../_shared/omni-comms/resendAdapter.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SIGNING_SECRET = Deno.env.get("OMNI_COMMS_RESEND_WEBHOOK_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "configuration_error" }, 503);
  if (!SIGNING_SECRET) return json({ error: "webhook_secret_missing" }, 503);

  const svixId = req.headers.get("svix-id") ?? "";
  const svixTs = req.headers.get("svix-timestamp") ?? "";
  const svixSig = req.headers.get("svix-signature") ?? "";
  const rawBody = await req.text();

  const verified = await verifySvixSignature(
    SIGNING_SECRET,
    svixId,
    svixTs,
    svixSig,
    rawBody,
  );
  if (!verified) return json({ error: "invalid_signature" }, 401);

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const rawType = typeof evt.type === "string" ? evt.type : "";
  const normalized = RESEND_CALLBACK_EVENTS[rawType];
  const testEventName = RESEND_TEST_EVENT_NAMES[rawType];
  if (!normalized) {
    return json({ accepted: true, ignored: true, reason: "unknown_event_type" });
  }

  const data = (evt.data ?? {}) as Record<string, unknown>;
  const providerMessageId = typeof data.email_id === "string" ? data.email_id : "";
  if (!providerMessageId) {
    return json({ accepted: true, ignored: true, reason: "no_provider_message_id" });
  }

  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  const summary: Record<string, unknown> = {
    provider_event: rawType,
    recipient_masked: maskEmail(to),
  };
  if (typeof data.subject === "string") summary.subject_length = data.subject.length;
  const bounce = data.bounce as Record<string, unknown> | undefined;
  if (bounce && typeof bounce === "object") {
    if (typeof bounce.type === "string") summary.bounce_type = bounce.type;
    if (typeof bounce.subType === "string") summary.bounce_subtype = bounce.subType;
  }

  const occurredAt = typeof evt.created_at === "string" ? evt.created_at : null;
  const payloadDigest = `sha256:${await sha256Hex(rawBody)}`;

  const client = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Matching order (C7 Closure Correction) ──────────────────────────────
  // 1. C5B controlled channel-test delivery is matched FIRST. A technical
  //    test callback can never be mistaken for business delivery evidence.
  // 2. Only when no channel-test delivery owns the provider message id is the
  //    C7 business path consulted.
  // 3. A provider message id that matches more than one business attempt is
  //    recorded as ambiguous and NEVER used to mutate delivery evidence.
  const { data: testResult, error: testError } = await client.rpc(
    "omni_comms_priv_channel_test_delivery_record_event",
    {
      p_provider_message_id: providerMessageId,
      p_event_type: testEventName,
      p_provider_event_id: svixId || null,
      p_occurred_at: occurredAt,
      p_payload_summary: summary,
      p_signature_verified: true,
    },
  );
  if (testError) {
    // C5B-FIRST BOUNDARY: if the technical-test matching RPC itself fails we
    // do NOT know whether this provider message id belongs to a channel test.
    // Continuing into C7 business matching could record a technical-test
    // callback as unmatched business evidence, so processing stops here.
    console.error(
      `omni-comms-webhook-resend channel_test_record_failed provider_event=${svixId || "none"}`,
    );
    return json({ error: "record_failed" }, 500);
  }
  const testRecord = (testResult ?? {}) as Record<string, unknown>;
  const testMatched =
    testRecord.recorded === true &&
    testRecord.code !== "unmatched" &&
    testRecord.code !== "unmatched_ignored";
  if (testMatched) {
    return json({ accepted: true, scope: "channel_test", ...testRecord });
  }

  // 2. C7 — business delivery evidence, normalization and automatic
  //    controlled-pilot suspension.
  const business = await client.rpc("omni_comms_priv_dispatch_record_callback", {
    p_provider_code: "resend_email",
    p_provider_event_id: svixId || `${providerMessageId}:${rawType}:${occurredAt ?? ""}`,
    p_provider_message_id: providerMessageId,
    p_raw_event_type: rawType,
    p_normalized_event_type: normalized,
    p_occurred_at: occurredAt,
    p_payload_summary: summary,
    p_payload_digest: payloadDigest,
    p_signature_verified: true,
  });
  if (business.error) {
    // Bounded response and bounded log only — the raw database error may
    // contain recipient, content or account values.
    console.error(
      `omni-comms-webhook-resend business_record_failed provider_event=${svixId || "none"}`,
    );
    return json({ error: "record_failed" }, 500);
  }

  const businessResult = (business.data ?? {}) as Record<string, unknown>;
  if (businessResult.code === "callback_ambiguous") {
    return json({ accepted: true, scope: "unmatched", ...businessResult });
  }
  if (businessResult.code === "callback_recorded") {
    return json({ accepted: true, scope: "business", ...businessResult });
  }

  return json({ accepted: true, scope: "unmatched", ...businessResult });
});
