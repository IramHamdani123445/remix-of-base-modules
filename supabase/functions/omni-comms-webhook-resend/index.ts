// Omni-Comms — Resend delivery callback receiver (channel test evidence).
//
// Receives Svix-signed Resend delivery lifecycle events and records them as
// immutable callback evidence against the matching controlled channel test
// delivery. It NEVER sends anything, never reads or logs the signing secret,
// never stores raw headers or full payload bodies, and rejects unsigned or
// stale requests.
//
// Callbacks that do not match a controlled test delivery are acknowledged and
// ignored: the Omni-Comms sending spine is not wired to this receiver.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SIGNING_SECRET = Deno.env.get("OMNI_COMMS_RESEND_WEBHOOK_SECRET") ?? "";

/** Accepted Resend event types, mapped to bounded evidence event names. */
const EVENT_TYPES: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Svix: HMAC-SHA256(secret, `${id}.${ts}.${body}`), base64, header "v1,<sig>". */
async function verifySvix(
  secret: string,
  svixId: string,
  svixTs: string,
  svixSig: string,
  rawBody: string,
): Promise<boolean> {
  if (!secret || !svixId || !svixTs || !svixSig) return false;
  const secretB64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = b64ToBytes(secretB64);
  } catch {
    return false;
  }
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, enc.encode(`${svixId}.${svixTs}.${rawBody}`)),
  );
  const expected = bytesToB64(sig);
  const tsNum = Number(svixTs);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) return false;
  for (const part of svixSig.split(" ")) {
    const [ver, val] = part.split(",");
    if (ver === "v1" && val && timingSafeEqual(val, expected)) return true;
  }
  return false;
}

function maskEmail(e: unknown): string | null {
  if (typeof e !== "string" || e === "") return null;
  const [local, domain] = e.split("@");
  if (!domain) return "***";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json({ error: "configuration_error" }, 503);
  }
  if (!SIGNING_SECRET) {
    return json({ error: "webhook_secret_missing" }, 503);
  }

  const svixId = req.headers.get("svix-id") ?? "";
  const svixTs = req.headers.get("svix-timestamp") ?? "";
  const svixSig = req.headers.get("svix-signature") ?? "";
  const rawBody = await req.text();

  const verified = await verifySvix(SIGNING_SECRET, svixId, svixTs, svixSig, rawBody);
  if (!verified) return json({ error: "invalid_signature" }, 401);

  let evt: Record<string, unknown>;
  try {
    evt = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const rawType = typeof evt.type === "string" ? evt.type : "";
  const eventType = EVENT_TYPES[rawType];
  if (!eventType) return json({ accepted: true, ignored: true, reason: "unknown_event_type" });

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

  const client = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: result, error } = await client.rpc(
    "omni_comms_priv_channel_test_delivery_record_event",
    {
      p_provider_message_id: providerMessageId,
      p_event_type: eventType,
      p_provider_event_id: svixId || null,
      p_occurred_at: occurredAt,
      p_payload_summary: summary,
      p_signature_verified: true,
    },
  );

  if (error) {
    console.error("omni-comms-webhook-resend record failure:", error.message);
    return json({ error: "record_failed", detail: error.message }, 500);
  }

  return json({ accepted: true, ...(result as Record<string, unknown>) });
});
