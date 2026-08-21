// Omni-Comms — Twilio inbound Voice self-service endpoint.
//
// Twilio points the inbound Voice webhook of the Omni-Comms voice number at
// this function (…/omni-comms-inbound-voice?account=<provider_account_id>).
//
// Boundaries:
//   * X-Twilio-Signature is verified before anything is read or written;
//   * every identification, verification and data decision is taken by the
//     governed SECURITY DEFINER RPC — this function only renders TwiML;
//   * nothing is sent: no outbound message, no provider call, no template.

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

function xml(body: string, status = 200): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { ...CORS, "Content-Type": "text/xml" },
  });
}

function sayHangup(text: string, status = 200): Response {
  return xml(`<Say language="en-US">${escapeTwiml(text)}</Say><Hangup/>`, status);
}

function gather(actionUrl: string, digits: number, text: string): Response {
  return xml(
    `<Gather input="dtmf" numDigits="${digits}" timeout="8" action="${
      escapeTwiml(actionUrl)
    }" method="POST"><Say language="en-US">${escapeTwiml(text)}</Say></Gather>` +
      `<Say language="en-US">We did not receive a response. Goodbye.</Say><Hangup/>`,
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/**
 * Resolve the Twilio auth token used for signature verification.
 *
 * The governed credential RPC is preferred, but it must never be able to hang
 * the call: Twilio waits for TwiML and the caller only hears ringing. The
 * lookup is time-boxed and falls back to the edge secret so inbound Voice keeps
 * answering even when the database is unreachable.
 */
async function resolveAuthToken(client: Rpc, providerAccountId: string): Promise<string> {
  const envToken = (Deno.env.get("OMNI_COMMS_TWILIO_AUTH_TOKEN") ?? "").trim();
  if (!providerAccountId) return envToken;
  try {
    const { data, error } = await withTimeout(
      client.rpc(
        "omni_comms_priv_resolve_provider_credential_source",
        { p_provider_account_id: providerAccountId, p_purpose: "auth_token" },
      ),
      3000,
      { data: null, error: { message: "timeout" } },
    );
    if (error) return envToken;
    const source = (data ?? {}) as Record<string, unknown>;
    if (source.found === true && typeof source.value === "string" && source.value.trim()) {
      return source.value.trim();
    }
    if (source.storageMode === "edge_env" && typeof source.envVar === "string" && source.envVar) {
      return (Deno.env.get(source.envVar) ?? "").trim() || envToken;
    }
    return envToken;
  } catch {
    return envToken;
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
    // No token available at all: the caller must still hear something rather
    // than silence while Twilio waits for TwiML.
    console.error("omni-comms-inbound-voice signature_unverifiable: no auth token available");
    return sayHangup(
      "Sorry, self service is unavailable right now. Please contact the Social Security Board office. Goodbye.",
    );
  }

  const verified = await verifyTwilioSignature({
    authToken,
    url: `${url.origin}${url.pathname}${url.search}`,
    params,
    signature: req.headers.get("x-twilio-signature"),
  });
  if (!verified) {
    return new Response(JSON.stringify({ error: "signature_invalid" }), {
      status: 401,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const callSid = (params.CallSid ?? "").trim();
  if (!callSid) return sayHangup("Sorry, this call cannot be handled. Goodbye.", 400);

  const { data, error } = await withTimeout(
    client.rpc("omni_comms_priv_inbound_voice_step", {
      p_call_sid: callSid,
      p_from: params.From ?? null,
      p_to: params.To ?? null,
      p_digits: params.Digits ?? null,
    }),
    8000,
    { data: null, error: { message: "timeout" } },
  );


  if (error) {
    console.error(`omni-comms-inbound-voice step_failed call=${callSid}`);
    return sayHangup(
      "Sorry, self service is unavailable right now. Please contact the Social Security Board office. Goodbye.",
      500,
    );
  }

  const step = (data ?? {}) as Record<string, unknown>;
  const text = typeof step.text === "string" && step.text.trim() !== ""
    ? step.text
    : "Thank you for calling. Goodbye.";

  if (step.action === "gather") {
    const digits = typeof step.digits === "number" && step.digits > 0 ? Math.trunc(step.digits) : 1;
    return gather(`${url.origin}${url.pathname}${url.search}`, digits, text);
  }
  return sayHangup(text);
});
