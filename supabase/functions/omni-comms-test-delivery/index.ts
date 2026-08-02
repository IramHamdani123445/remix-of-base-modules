// Omni-Comms — Channel Test Delivery (Email / Resend).
//
// This is the ONLY Omni-Comms surface that may contact an email provider, and
// it may do so only for an operator-approved technical test:
//
//   1. The caller must be authenticated; the database RPC re-checks the
//      Omni-Comms configure capability and tenant access server-side.
//   2. `omni_comms_channel_test_delivery_prepare` authorises the attempt:
//      current PASSED configuration preflight, same recipient as the
//      preflight, genuine active binding / verified account / active identity,
//      effective genuine policy in test_only or pilot_ready, test delivery
//      explicitly approved, recipient on the approved list. Live delivery
//      remains disabled and is never consulted here.
//   3. Only then is the provider called, using a secret whose NAME comes from
//      configuration; the secret VALUE is read from Edge Function Secrets and
//      is never returned, logged, or stored.
//   4. The outcome is written back to the immutable delivery ledger through a
//      service_role-only RPC.
//
// No Omni-Comms runtime request, message, dispatch job or delivery attempt is
// created. This path never touches the sending spine.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/** Secret-reference names are bounded by configuration policy. */
const SECRET_REF_PATTERN = /^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$/;

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Every controlled test message carries an unmistakable subject prefix. */
const TEST_SUBJECT_PREFIX = "[TEST]";

const MAX_SUBJECT = 180;
const MAX_BODY = 4000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(code: string, detail: string, status: number): Response {
  return json({ error: code, detail }, status);
}

/** Extracts the "OC### slug" convention from a database error. */
function mapRpcError(error: { message?: string; details?: string } | null) {
  const message = error?.message ?? "";
  const match = message.match(/\bOC(\d{3})\b/);
  const code = match ? `OC${match[1]}` : "OC500";
  const detail = error?.details ?? message.replace(/^OC\d{3}\s*/, "").trim();
  const status = match ? Number(match[1]) : 500;
  return { code, detail, status: status >= 400 && status < 600 ? status : 500 };
}

/** Keeps only bounded, non-sensitive fields from the provider response. */
function redactProviderResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["id", "name", "message", "statusCode", "error"]) {
    const v = r[key];
    if (typeof v === "string") out[key] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return fail("method_not_allowed", "Use POST.", 405);

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return fail("configuration_error", "Backend is not configured.", 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return fail("OC401", "authentication_required", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("OC422", "invalid_json", 400);
  }

  const testRunId = typeof body.testRunId === "string" ? body.testRunId.trim() : "";
  const target = typeof body.target === "string" ? body.target.trim() : "";
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const correlationId =
    typeof body.correlationId === "string" && body.correlationId.trim() !== ""
      ? body.correlationId.trim()
      : null;
  const rawSubject = typeof body.subject === "string" ? body.subject.trim() : "";
  const rawBody = typeof body.bodyText === "string" ? body.bodyText.trim() : "";

  if (!testRunId || !target || !idempotencyKey) {
    return fail("OC422", "invalid_input", 400);
  }
  if (rawSubject.length > MAX_SUBJECT || rawBody.length > MAX_BODY) {
    return fail("OC422", "content_too_long", 400);
  }

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // 1. Authorise + reserve. All policy decisions are made in the database.
  const prepared = await userClient.rpc("omni_comms_channel_test_delivery_prepare", {
    p_test_run_id: testRunId,
    p_target: target,
    p_idempotency_key: idempotencyKey,
    p_correlation_id: correlationId,
  });
  if (prepared.error) {
    const mapped = mapRpcError(prepared.error);
    return json({ error: mapped.code, detail: mapped.detail }, mapped.status);
  }

  const plan = (prepared.data ?? {}) as Record<string, unknown>;
  const deliveryId = String(plan.delivery_id ?? "");
  const dispatchRequired = plan.dispatch_required === true;
  const replayed = plan.replayed === true;

  // 2. Replay of a completed attempt — the provider is NOT contacted again.
  if (!dispatchRequired) {
    return json({ replayed, dispatched: false, delivery: plan.delivery ?? null });
  }

  const secretRef = typeof plan.secret_ref === "string" ? plan.secret_ref : "";
  const fromAddress = typeof plan.from_address === "string" ? plan.from_address : "";
  const fromName = typeof plan.from_name === "string" ? plan.from_name : "";
  const replyTo = typeof plan.reply_to_address === "string" ? plan.reply_to_address : "";

  const complete = async (
    status: "accepted" | "failed",
    resultCode: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await serviceClient.rpc(
      "omni_comms_priv_channel_test_delivery_complete",
      {
        p_delivery_id: deliveryId,
        p_status: status,
        p_result_code: resultCode,
        p_provider_message_id: extra.providerMessageId ?? null,
        p_provider_status_code: extra.providerStatusCode ?? null,
        p_provider_response: extra.providerResponse ?? null,
        p_error_code: extra.errorCode ?? null,
        p_error_detail: extra.errorDetail ?? null,
      },
    );
    return res.data ?? null;
  };

  if (!SECRET_REF_PATTERN.test(secretRef)) {
    const delivery = await complete("failed", "configuration_invalid", {
      errorCode: "secret_reference_invalid",
      errorDetail: "The configured credential reference name is not permitted.",
    });
    return json({ error: "OC409", detail: "secret_reference_invalid", delivery }, 409);
  }

  const apiKey = Deno.env.get(secretRef) ?? "";
  if (apiKey.trim() === "") {
    const delivery = await complete("failed", "credential_missing", {
      errorCode: "credential_missing",
      errorDetail: `No stored value for credential reference ${secretRef}.`,
    });
    return json({ error: "OC409", detail: "credential_missing", delivery }, 409);
  }
  if (!fromAddress) {
    const delivery = await complete("failed", "configuration_invalid", {
      errorCode: "from_address_missing",
      errorDetail: "The bound sender identity has no from address.",
    });
    return json({ error: "OC409", detail: "from_address_missing", delivery }, 409);
  }

  const subject = `${TEST_SUBJECT_PREFIX} ${
    rawSubject || "Omni-Comms channel test"
  }`.slice(0, MAX_SUBJECT + TEST_SUBJECT_PREFIX.length + 1);

  const text = [
    "This is a technical channel test message from the Omni-Comms Test Centre.",
    "It contains no personal or case information and requires no action.",
    "",
    rawBody || "(no additional test content)",
    "",
    `Delivery reference: ${deliveryId}`,
  ].join("\n");

  const started = Date.now();
  let providerStatus: number | null = null;
  let providerBody: unknown = null;

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${fromAddress}>` : fromAddress,
        to: [target],
        subject,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    providerStatus = res.status;
    providerBody = await res.json().catch(() => null);

    if (!res.ok) {
      const redacted = redactProviderResponse(providerBody);
      console.error(
        `omni-comms-test-delivery provider rejected [${res.status}]`,
        JSON.stringify(redacted),
      );
      const delivery = await complete("failed", "provider_rejected", {
        providerStatusCode: providerStatus,
        providerResponse: redacted,
        errorCode: typeof redacted.name === "string" ? redacted.name : "provider_error",
        errorDetail: typeof redacted.message === "string" ? redacted.message : null,
      });
      return json(
        {
          error: "provider_rejected",
          status: providerStatus,
          detail: redacted.message ?? "The provider rejected the test message.",
          delivery,
        },
        res.status,
      );
    }

    const redacted = redactProviderResponse(providerBody);
    const messageId = typeof redacted.id === "string" ? redacted.id : null;
    const delivery = await complete("accepted", "provider_accepted", {
      providerMessageId: messageId,
      providerStatusCode: providerStatus,
      providerResponse: { ...redacted, latency_ms: Date.now() - started },
    });
    return json({ replayed: false, dispatched: true, delivery });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "provider request failed";
    console.error("omni-comms-test-delivery transport failure:", detail);
    const delivery = await complete("failed", "provider_unreachable", {
      providerStatusCode: providerStatus,
      errorCode: "provider_unreachable",
      errorDetail: detail,
    });
    return json({ error: "provider_unreachable", detail, delivery }, 502);
  }
});
