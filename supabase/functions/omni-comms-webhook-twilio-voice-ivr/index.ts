// Omni-Comms — Twilio Programmable Voice IVR (keypad) action endpoint.
//
// This is the ONLY endpoint quoted as <Gather action="…">. It is separate from
// the voice status callback on purpose:
//
//   * X-Twilio-Signature is verified server-side before anything is recorded;
//   * the pressed digit is resolved against the immutable voice template
//     version that was played (its `gather_map`), and only the SEMANTIC result
//     is persisted — Basic IVR, one keypad question;
//   * the response is valid continuation TwiML so the call ends cleanly.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyTwilioSignature } from "../_shared/omni-comms/twilioWhatsAppAdapter.ts";
import { escapeTwiml } from "../_shared/omni-comms/twilioVoiceAdapter.ts";

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

function twiml(say: string, status = 200): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="en-US">${
      escapeTwiml(say)
    }</Say><Hangup/></Response>`,
    { status, headers: { ...CORS, "Content-Type": "text/xml" } },
  );
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return new Response(JSON.stringify({ error: "configuration_error" }), {
      status: 503,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE) as unknown as Rpc;
  const url = new URL(req.url);
  const providerAccountId = url.searchParams.get("account")?.trim() ?? "";

  const rawBody = await req.text();
  const form = new URLSearchParams(rawBody);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const authToken = await resolveAuthToken(client, providerAccountId);
  if (!authToken) {
    return new Response(JSON.stringify({ error: "signature_unverifiable" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const verified = await verifyTwilioSignature({
    authToken,
    url: `${url.origin}${url.pathname}${url.search}`,
    params,
    signature: req.headers.get("x-twilio-signature"),
  });
  if (!verified) {
    try {
      await client.rpc("omni_comms_priv_webhook_record_rejection", {
        p_provider_code: "twilio_voice",
        p_provider_event_id: `${(params.CallSid ?? "").trim()}:ivr`,
        p_provider_account_id: providerAccountId || null,
        p_reason: "signature_invalid",
        p_payload_digest: null,
      });
    } catch {
      // best effort only
    }
    return new Response(JSON.stringify({ error: "signature_invalid" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const callSid = (params.CallSid ?? "").trim();
  if (!callSid) return twiml("Thank you. Goodbye.", 400);

  const { data, error } = await client.rpc("omni_comms_priv_voice_ivr_record", {
    p_provider_call_sid: callSid,
    p_digits: (params.Digits ?? "").trim(),
    p_signature_verified: true,
  });
  if (error) {
    console.error(`omni-comms-webhook-twilio-voice-ivr record_failed call=${callSid}`);
    return twiml("Sorry, we could not record your response. Goodbye.", 500);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  const semantic = String(result.semantic_result ?? "");
  const message = semantic === "no_response" || semantic === "unmapped_response"
    ? "We did not recognise that selection. Goodbye."
    : "Thank you. Your response has been recorded. Goodbye.";
  return twiml(message);
});
