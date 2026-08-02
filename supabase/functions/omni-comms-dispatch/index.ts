// Omni-Comms — canonical controlled business Email dispatcher (Phase C7).
//
// This is the ONLY surface that may perform a BUSINESS provider send, and it
// may do so only for an already-persisted, already-rendered `queued` Email job
// that the database claim transaction authorises.
//
// Non-negotiable boundaries:
//   * The BROWSER supplies nothing that can influence WHAT is sent. The only
//     accepted inputs are a bounded batch limit and a non-sensitive
//     correlation identifier. No job id, message id, recipient, provider,
//     credential, event, caller module, release id or rendered content may be
//     supplied by a caller. The SERVER selects eligible jobs.
//   * `omni-comms-runtime` never contacts a provider; dispatch is asynchronous.
//   * Only `email` + `queued` jobs are claimable. `dry_run` and `shadow` can
//     never be dispatched, and SMS / WhatsApp / Push / In-App / Print remain
//     non-dispatchable.
//   * The C6 decision oracle supplies decision EVIDENCE; the claim transaction
//     is the concurrency AUTHORITY. It locks the Release Control row,
//     recalculates hourly / daily / total pilot volume, re-checks recipient,
//     event, caller, mode and certification gates, claims the job with
//     FOR UPDATE SKIP LOCKED, and reserves volume by writing the delivery
//     attempt BEFORE any provider call.
//   * At most three attempts per message, each with the SAME deterministic
//     provider idempotency key, so a safe retry can never double-send.
//   * Transport uncertainty is recorded as `outcome_unknown`, never as failure.
//   * `live_delivery_enabled` remains false and Release Control `live` remains
//     unavailable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  canonicalProviderPayloadHash,
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
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DEPLOYED_REVISION = Deno.env.get("OMNI_COMMS_DEPLOYED_REVISION") ?? "";

/** The dispatcher can only ever drain the Email channel. */
const DISPATCHABLE_CHANNEL = "email";
const MAX_BATCH_LIMIT = 10;

/**
 * Browser-facing details are bounded symbolic codes ONLY. A raw RPC, database
 * or provider message is never returned to a caller and never logged: it can
 * embed recipients, rendered content, credential references or values.
 */
const BOUNDED_CODE = /^[a-z][a-z0-9_]{0,63}$/;


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SERVICE_ROLE) {
    return json({ error: "configuration_error" }, 503);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "OC401", detail: "authentication_required" }, 401);
  }

  // ── Bounded, non-sensitive input ONLY ───────────────────────────────────
  // Strict ALLOW-LIST: exactly two optional keys are accepted. Anything else
  // — including unknown keys — is refused. A caller can never influence WHAT
  // is sent, only how many already-authorised jobs may be drained.
  let raw: Record<string, unknown> = {};
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    raw = {};
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return json({ error: "OC422", detail: "dispatch_input_invalid" }, 400);
  }
  const ALLOWED_INPUT_KEYS = new Set(["batchLimit", "correlationId"]);
  const rejected = Object.keys(raw).filter((k) => !ALLOWED_INPUT_KEYS.has(k));
  if (rejected.length > 0) {
    return json(
      { error: "OC422", detail: "caller_supplied_dispatch_input_forbidden", fields: rejected },
      400,
    );
  }
  if ("batchLimit" in raw && !Number.isInteger(raw.batchLimit)) {
    return json({ error: "OC422", detail: "batch_limit_invalid" }, 400);
  }
  if (
    "correlationId" in raw &&
    raw.correlationId !== null &&
    (typeof raw.correlationId !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,120}$/.test(raw.correlationId))
  ) {
    return json({ error: "OC422", detail: "correlation_id_invalid" }, 400);
  }

  const batchLimit = Math.min(
    Math.max(Number.isInteger(raw.batchLimit) ? Number(raw.batchLimit) : 1, 1),
    MAX_BATCH_LIMIT,
  );
  const correlationId = typeof raw.correlationId === "string" ? raw.correlationId : null;

  // ── Operator authorisation ──────────────────────────────────────────────
  // Returns the capability decision AND the tenant scopes the actor may
  // operate. The scope set is derived server-side from the actor's own
  // assignments; it is never supplied by the caller.
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const auth = await userClient.rpc("omni_comms_dispatch_tick_authorize");
  if (auth.error) {
    // Bounded browser-facing detail only. The raw database error may embed
    // identifiers or values and is never returned or logged.
    console.error(
      `omni-comms-dispatch authorization_failed correlation=${correlationId ?? "none"}`,
    );
    return json({ error: "OC403", detail: "authorization_failed" }, 403);
  }

  const authz = (auth.data ?? {}) as Record<string, unknown>;
  if (authz.allowed !== true) {
    const denied = BOUNDED_CODE.test(String(authz.code ?? ""))
      ? String(authz.code)
      : "permission_denied";
    return json({ error: "OC403", detail: denied }, 403);

  }
  const scopes = Array.isArray(authz.scopes) ? authz.scopes : [];
  if (scopes.length === 0) {
    return json({ error: "OC403", detail: "no_operable_scope" }, 403);
  }

  const service = createClient(SUPABASE_URL, SERVICE_ROLE);

  // ── Reclaim any expired lease before claiming new work ──────────────────
  await service.rpc("omni_comms_priv_dispatch_reclaim_expired_leases");

  // ── The claim transaction is the concurrency authority ──────────────────
  const claimed = await service.rpc("omni_comms_priv_dispatch_claim_email", {
    p_worker: "omni-comms-dispatch",
    p_batch_limit: batchLimit,
    p_correlation_id: correlationId,
    p_deployed_revision: DEPLOYED_REVISION,
    p_scopes: scopes,
    p_execution_context: "operator",
  });
  if (claimed.error) {
    console.error(
      `omni-comms-dispatch dispatch_claim_failed correlation=${correlationId ?? "none"}`,
    );
    return json({ error: "OC500", detail: "dispatch_claim_failed" }, 500);
  }


  const plan = (claimed.data ?? {}) as Record<string, unknown>;
  const claims = Array.isArray(plan.claims) ? (plan.claims as Record<string, unknown>[]) : [];

  const results: Record<string, unknown>[] = [];
  for (const claim of claims) {
    const attemptId = String(claim.attempt_id ?? "");
    const claimToken = String(claim.claim_token ?? "");
    if (!attemptId || !claimToken) continue;

    const providerPayload = {
      fromAddress: String(claim.from_address ?? ""),
      fromName: (claim.from_name as string | null) ?? null,
      replyTo: (claim.reply_to_address as string | null) ?? null,
      to: String(claim.recipient ?? ""),
      subject: String(claim.subject ?? ""),
      text: String(claim.text_body ?? ""),
      html: (claim.html_body as string | null) ?? null,
    };

    // ── Payload fingerprint gate — MUST succeed before the provider is
    //    contacted. A retry that carries different content under the same
    //    deterministic idempotency key is refused, not sent.
    const payloadHash = await canonicalProviderPayloadHash(providerPayload);
    const hashGate = await service.rpc("omni_comms_priv_dispatch_record_payload_hash", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
      p_payload_hash: payloadHash,
    });
    const gate = (hashGate.data ?? {}) as Record<string, unknown>;
    if (hashGate.error || gate.ok !== true) {
      // Bounded code only — a raw RPC message is never surfaced or stored.
      const gateCode = BOUNDED_CODE.test(String(gate.code ?? ""))
        ? String(gate.code)
        : "payload_hash_rejected";

      const gateFailure = await service.rpc("omni_comms_priv_dispatch_attempt_complete", {
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_status: "rejected",
        p_provider_message_id: null,
        p_provider_status_code: null,
        p_provider_response: { category: "pre_dispatch_guard" },
        p_error_code: gateCode,
        p_error_detail: "Refused before contacting the provider by the payload fingerprint gate.",
      });
      results.push({
        attempt_id: attemptId,
        attempt_number: claim.attempt_number ?? null,
        outcome: "blocked",
        result_code: gateCode,
        provider_contacted: false,
        recorded: !gateFailure.error,
      });
      continue;
    }

    const outcome = await sendResendEmail({
      secretRef: String(claim.secret_ref ?? ""),
      ...providerPayload,
      // Deterministic: identical on every safe retry of this message.
      idempotencyKey: String(claim.provider_idempotency_key ?? ""),
    });

    const completion = await service.rpc("omni_comms_priv_dispatch_attempt_complete", {
      p_attempt_id: attemptId,
      p_claim_token: claimToken,
      p_status: outcome.status === "accepted"
        ? "accepted"
        : outcome.status === "outcome_unknown"
          ? "outcome_unknown"
          : "rejected",
      p_provider_message_id: outcome.providerMessageId,
      p_provider_status_code: outcome.providerStatusCode,
      p_provider_response: outcome.providerResponse,
      p_error_code: outcome.errorCode,
      p_error_detail: outcome.errorDetail,
    });
    if (completion.error) {
      // A stale claim must never be treated as a delivery outcome. Only a
      // bounded internal code and correlation reference are logged.
      console.error(
        `omni-comms-dispatch evidence_record_failed correlation=${correlationId ?? "none"} attempt=${attemptId}`,
      );
    }


    results.push({
      attempt_id: attemptId,
      attempt_number: claim.attempt_number ?? null,
      outcome: outcome.status,
      result_code: outcome.resultCode,
      provider_contacted: true,
      recorded: !completion.error,
    });
  }

  return json({
    channel: DISPATCHABLE_CHANNEL,
    mode: "queued",
    batch_limit: batchLimit,
    correlation_id: correlationId,
    scanned_jobs: plan.scanned_jobs ?? 0,
    claimed_jobs: plan.claimed_jobs ?? 0,
    blocker: plan.blocker ?? null,
    blockers: plan.blockers ?? [],
    results,
    live_delivery_enabled: false,
    release_live_state_available: false,
  });
});
