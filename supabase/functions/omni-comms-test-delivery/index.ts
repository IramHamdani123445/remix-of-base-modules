// Omni-Comms — Channel Test Delivery (Email / Resend).
//
// This is the ONLY Omni-Comms surface that may contact an email provider, and
// it may do so only for an operator-approved technical test:
//
//   1. The caller must be authenticated; the database RPC re-checks the
//      Omni-Comms operate capability and tenant access server-side.
//   2. `omni_comms_channel_test_delivery_prepare` authorises the attempt:
//      current PASSED configuration preflight, same recipient AND same content
//      as the preflight, genuine active binding / verified account / active
//      identity, C4B effective genuine policy in test_only or pilot_ready with
//      live delivery disabled, a live (non-expired) approval, an approved
//      recipient, and the approved volume / pacing budget. The RPC also claims
//      the delivery atomically and returns a claim token.
//   3. Only then is the provider called, using a secret whose NAME comes from
//      configuration; the secret VALUE is read from Edge Function Secrets and
//      is never returned, logged, or stored. The provider request carries a
//      persistent `Idempotency-Key`, so a bounded retry cannot double-send.
//   4. The outcome is written back to the immutable delivery ledger through a
//      service_role-only RPC, bound to the claim token so a stale worker can
//      never overwrite a newer result. Transport uncertainty is recorded as
//      `outcome_unknown`, never as a definite failure.
//
// No Omni-Comms runtime request, message, dispatch job or delivery attempt is
// created. This path never touches the sending spine.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  OMNI_COMMS_SECRET_REF_PATTERN as SECRET_REF_PATTERN,
  resolveSecret,
  sendResendEmail,
} from "../_shared/omni-comms/resendAdapter.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-correlation-id",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Secret-reference pattern, the provider endpoint, the transport budget, the
// response redaction rules and the uncertainty classification all live in the
// shared server-only Resend adapter, which C7 reuses unchanged.

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
  const rawSubject = typeof body.subject === "string" ? body.subject : "";
  const rawBody = typeof body.bodyText === "string" ? body.bodyText : "";

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

  // 1. Authorise + atomically claim. All policy decisions are made in the
  //    database, including that the content matches the passed preflight.
  const prepared = await userClient.rpc("omni_comms_channel_test_delivery_prepare", {
    p_test_run_id: testRunId,
    p_target: target,
    p_idempotency_key: idempotencyKey,
    p_subject: rawSubject,
    p_body_text: rawBody,
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
  const claimToken = typeof plan.claim_token === "string" ? plan.claim_token : "";

  // 2. Replay of a completed (or unclaimable) delivery — the provider is NOT
  //    contacted again.
  if (!dispatchRequired || !claimToken) {
    return json({ replayed, dispatched: false, delivery: plan.delivery ?? null });
  }

  const secretRef = typeof plan.secret_ref === "string" ? plan.secret_ref : "";
  const fromAddress = typeof plan.from_address === "string" ? plan.from_address : "";
  const fromName = typeof plan.from_name === "string" ? plan.from_name : "";
  const replyTo = typeof plan.reply_to_address === "string" ? plan.reply_to_address : "";
  const providerIdempotencyKey =
    typeof plan.provider_idempotency_key === "string" && plan.provider_idempotency_key
      ? plan.provider_idempotency_key
      : `omni-test/${deliveryId}`;
  const subject =
    typeof plan.provider_subject === "string" && plan.provider_subject
      ? plan.provider_subject
      : "[TEST] Omni-Comms channel test";
  const providerText =
    typeof plan.provider_body_text === "string" && plan.provider_body_text
      ? plan.provider_body_text
      : "This is a technical Omni-Comms channel test message.";

  const complete = async (
    status: "accepted" | "failed" | "outcome_unknown",
    resultCode: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await serviceClient.rpc(
      "omni_comms_priv_channel_test_delivery_complete",
      {
        p_delivery_id: deliveryId,
        p_claim_token: claimToken,
        p_status: status,
        p_result_code: resultCode,
        p_provider_message_id: extra.providerMessageId ?? null,
        p_provider_status_code: extra.providerStatusCode ?? null,
        p_provider_response: extra.providerResponse ?? null,
        p_error_code: extra.errorCode ?? null,
        p_error_detail: extra.errorDetail ?? null,
      },
    );
    if (res.error) {
      // A stale claim must never be treated as a delivery outcome.
      console.error(
        "omni-comms-test-delivery evidence write rejected:",
        res.error.message,
      );
      return null;
    }
    return res.data ?? null;
  };

  if (!SECRET_REF_PATTERN.test(secretRef)) {
    const delivery = await complete("failed", "configuration_invalid", {
      errorCode: "secret_reference_invalid",
      errorDetail: "The configured credential reference name is not permitted.",
    });
    return json({ error: "OC409", detail: "secret_reference_invalid", delivery }, 409);
  }

  const credential = resolveSecret(secretRef);
  if (!credential.ok) {
    const delivery = await complete("failed", "credential_missing", {
      errorCode: credential.errorCode,
      errorDetail: credential.detail,
    });
    return json({ error: "OC409", detail: credential.errorCode, delivery }, 409);
  }
  if (!fromAddress) {
    const delivery = await complete("failed", "configuration_invalid", {
      errorCode: "from_address_missing",
      errorDetail: "The bound sender identity has no from address.",
    });
    return json({ error: "OC409", detail: "from_address_missing", delivery }, 409);
  }

  // Shared server-only adapter — identical transport, idempotency, redaction
  // and uncertainty semantics as the C7 business dispatcher.
  const outcome = await sendResendEmail({
    secretRef,
    fromAddress,
    fromName,
    replyTo,
    to: target,
    subject,
    text: `${providerText}\n\nDelivery reference: ${deliveryId}`,
    // Persistent per-delivery key: a bounded retry of the SAME delivery can
    // never produce a second provider send.
    idempotencyKey: providerIdempotencyKey,
  });

  if (outcome.status === "accepted") {
    const delivery = await complete("accepted", "provider_accepted", {
      providerMessageId: outcome.providerMessageId,
      providerStatusCode: outcome.providerStatusCode,
      providerResponse: { ...outcome.providerResponse, latency_ms: outcome.latencyMs },
    });
    return json({ replayed: false, dispatched: true, delivery });
  }

  if (outcome.status === "outcome_unknown") {
    console.error(
      "omni-comms-test-delivery outcome unknown:",
      outcome.errorCode ?? "provider_outcome_unknown",
    );
    // The request may have reached the provider — never assert failure.
    const delivery = await complete("outcome_unknown", "provider_outcome_unknown", {
      providerStatusCode: outcome.providerStatusCode,
      providerResponse: outcome.providerResponse,
      errorCode: outcome.errorCode ?? "provider_outcome_unknown",
      errorDetail: outcome.errorDetail,
    });
    return json(
      {
        error: "provider_outcome_unknown",
        status: outcome.providerStatusCode,
        detail: outcome.errorDetail
          ?? "The provider outcome is unknown. A safe retry is permitted.",
        delivery,
      },
      outcome.providerStatusCode ?? 502,
    );
  }

  console.error(
    `omni-comms-test-delivery provider rejected [${outcome.providerStatusCode ?? 0}]`,
    JSON.stringify(outcome.providerResponse),
  );
  const delivery = await complete("failed", outcome.resultCode, {
    providerStatusCode: outcome.providerStatusCode,
    providerResponse: outcome.providerResponse,
    errorCode: outcome.errorCode ?? "provider_error",
    errorDetail: outcome.errorDetail,
  });
  return json(
    {
      error: "provider_rejected",
      status: outcome.providerStatusCode,
      detail: outcome.errorDetail ?? "The provider rejected the test message.",
      delivery,
    },
    outcome.providerStatusCode ?? 502,
  );
});

