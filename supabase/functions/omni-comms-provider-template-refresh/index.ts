// Omni-Comms — provider template status reconciliation (server-authoritative).
//
// An internal Omni operator may ASK for a refresh. They can never supply the
// answer: the resulting provider status is read from the provider itself, with
// credentials resolved server-side by reference only, and is written through
// the service-only reconciliation RPC. The browser never states an outcome.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CONTENT_SID_RE = /^HX[0-9a-fA-F]{32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/** Resolves a bounded credential by reference only. Never logged or returned. */
async function resolveCredential(
  client: Rpc,
  providerAccountId: string,
  purpose: "account_sid" | "auth_token",
): Promise<string> {
  try {
    const { data, error } = await client.rpc(
      "omni_comms_priv_resolve_provider_credential_source",
      { p_provider_account_id: providerAccountId, p_purpose: purpose },
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

/** Maps a Twilio WhatsApp approval status onto the Omni provider vocabulary. */
export function mapTwilioApprovalStatus(raw: unknown): string | null {
  switch (String(raw ?? "").trim().toLowerCase()) {
    case "received":
    case "pending":
    case "in_review":
      return "pending";
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "paused":
      return "paused";
    case "disabled":
    case "deleted":
      return "disabled";
    default:
      return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "OC405", detail: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "OC401", detail: "authentication_required" }, 401);

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "OC422", detail: "request_body_invalid" }, 400);
  }

  const registrationId = String(raw.registrationId ?? "");
  if (!UUID_RE.test(registrationId)) {
    return json({ error: "OC422", detail: "registration_id_invalid" }, 400);
  }
  const correlationId = typeof raw.correlationId === "string" ? raw.correlationId : null;

  // ── Authorisation: capability only. The caller never supplies an outcome. ──
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const authz = await userClient.rpc("omni_comms_provider_registration_refresh_authorize", {
    p_id: registrationId,
  });
  if (authz.error) return json({ error: "OC403", detail: "authorization_failed" }, 403);
  const info = (authz.data ?? {}) as Record<string, unknown>;
  if (info.allowed !== true) {
    return json({ error: "OC403", detail: String(info.code ?? "permission_denied") }, 403);
  }

  if (String(info.adapter_key ?? "") !== "twilio_whatsapp") {
    return json({ error: "OC422", detail: "adapter_not_reconcilable" }, 400);
  }
  const contentSid = String(info.provider_template_ref ?? "").trim();
  if (!CONTENT_SID_RE.test(contentSid)) {
    return json({ error: "OC422", detail: "provider_template_ref_invalid" }, 400);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const providerAccountId = String(info.provider_account_id ?? "");
  const accountSid = await resolveCredential(service, providerAccountId, "account_sid");
  const authToken = await resolveCredential(service, providerAccountId, "auth_token");
  if (!accountSid || !authToken) {
    return json({ error: "OC412", detail: "provider_credentials_unavailable" }, 412);
  }

  // ── Query the provider. Only bounded evidence is retained. ────────────────
  let providerStatus: string | null = null;
  let rejectionReason = "";
  try {
    const res = await fetch(
      `https://content.twilio.com/v1/Content/${contentSid}/ApprovalRequests`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}` },
      },
    );
    if (res.status === 404) {
      return json({ error: "OC404", detail: "provider_template_not_found" }, 404);
    }
    if (!res.ok) {
      console.error(
        `omni-comms-provider-template-refresh provider_unavailable status=${res.status}`,
      );
      return json({ error: "OC502", detail: "provider_unavailable" }, 502);
    }
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const whatsapp = (payload?.whatsapp ?? {}) as Record<string, unknown>;
    providerStatus = mapTwilioApprovalStatus(whatsapp.status);
    rejectionReason = String(whatsapp.rejection_reason ?? "").slice(0, 200);
  } catch {
    return json({ error: "OC502", detail: "provider_unreachable" }, 502);
  }

  if (!providerStatus) {
    return json({ error: "OC502", detail: "provider_status_unrecognised" }, 502);
  }

  const written = await service.rpc(
    "omni_comms_priv_template_provider_registration_reconcile",
    {
      p_id: registrationId,
      p_provider_status: providerStatus,
      p_provider_template_ref: contentSid,
      p_provider_evidence: { rejection_reason: rejectionReason },
      p_error_code: null,
      p_correlation_id: correlationId,
    },
  );
  if (written.error) {
    console.error("omni-comms-provider-template-refresh reconcile_failed");
    return json({ error: "OC500", detail: "reconcile_failed" }, 500);
  }

  return json({
    registration_id: registrationId,
    provider_status: providerStatus,
    verification_mode: "provider_verified",
  });
});
