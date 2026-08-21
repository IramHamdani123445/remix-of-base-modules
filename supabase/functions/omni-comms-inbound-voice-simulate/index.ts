// Omni-Comms — Inbound Voice/IVR simulator.
//
// Lets an authenticated operator walk the exact same governed inbound IVR state
// machine used by the Twilio webhook, without placing a real phone call.
//
// Boundaries:
//   * requires an authenticated Lovable Cloud session (verify_jwt = true);
//   * the state machine remains the single authority — this function only
//     forwards the simulated call parameters and returns the spoken step;
//   * simulated call SIDs are prefixed so they are never confused with Twilio
//     call evidence.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE || !ANON_KEY) {
    return json({ error: "configuration_error" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized" }, 401);
  }

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await authClient.auth.getUser();
  if (userError || !userData?.user) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  const rawSid = typeof body.callSid === "string" ? body.callSid.trim() : "";
  const callSid = rawSid.startsWith("SIMV") ? rawSid : `SIMV${crypto.randomUUID()}`;
  const from = typeof body.from === "string" ? body.from.trim().slice(0, 32) : "";
  const to = typeof body.to === "string" ? body.to.trim().slice(0, 32) : "";
  const digits = typeof body.digits === "string" ? body.digits.trim().slice(0, 16) : "";

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data, error } = await service.rpc("omni_comms_priv_inbound_voice_step", {
    p_call_sid: callSid,
    p_from: from === "" ? null : from,
    p_to: to === "" ? null : to,
    p_digits: digits === "" ? null : digits,
  });

  if (error) {
    console.error(`omni-comms-inbound-voice-simulate step_failed call=${callSid}`);
    return json({ error: "step_failed", details: error.message }, 500);
  }

  const step = (data ?? {}) as Record<string, unknown>;
  return json({
    callSid,
    action: typeof step.action === "string" ? step.action : "say_hangup",
    text: typeof step.text === "string" ? step.text : "",
    digits: typeof step.digits === "number" ? step.digits : null,
  });
});
