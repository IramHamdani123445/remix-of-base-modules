// Phase 4B3 — comm-hub-dry-run
//
// Hotfix: browser + Edge never mint the authoritative Dry Run correlation.
//
// Flow (browser → this function):
//   1. Browser sends operator JWT and ONLY:
//        module_code, event_code, channel,
//        preview_snapshot_id, preview_approval_id,
//        operator_reason, idempotency_key,
//        (optional) expected_actor_id, expected_recipient_set_hash.
//      Any correlation_id in the payload is IGNORED.
//   2. This function calls `inspect_comm_hub_dry_run_preflight` under the
//      operator JWT. The preflight envelope owns the authoritative
//      correlation_id. If preflight returns BLOCKED, this function returns
//      that envelope verbatim — no begin, no execution, no request, no
//      message, no provider, no simulator.
//   3. On PREFLIGHT_READY, this function calls `begin_comm_hub_dry_run_v1`
//      (never the legacy `begin_comm_hub_dry_run`) with:
//        module_code, event_code, channel,
//        preview_snapshot_id, preview_approval_id,
//        operator_reason, idempotency_key,
//        expected_correlation_id: <preflight.correlation_id>.
//      The correlation is asserted server-side; no correlation_id is sent.
//   4. Accepts BEGIN_OK / BEGIN_REPLAY / BLOCKED. Preserves the full v1
//      envelope on BLOCKED.
//   5. On success, switches to service-role and processes the returned
//      execution using the returned correlation (which must equal the
//      preflight authoritative correlation).
//   6. Accepts processor state PROCESSED (canonical) or COMPLETED
//      (backward-compat only).
//   7. Certifies. Accepts CERTIFIED, plus IDEMPOTENT for the same execution.
//
// Trust boundaries:
//   • Browser-supplied correlation_id is dropped before begin.
//   • Browser-supplied recipients / hashes are IGNORED for authorization.
//   • No external provider is called.
//   • No simulator is called.
//   • No Controlled Live grant is created.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const EDGE_VERSION = "comm-hub-dry-run/v1.6.0-operator-jwt-continuity";
const CONTRACT_VERSION = "comm-hub-dry-run-contract/v1";
const EVALUATOR_VERSION = "comm-hub-dry-run-preflight/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

/**
 * Phase 4B3 — Edge environment validation.
 * Runs before any preflight/begin. Never logs secret values.
 */
function validateEdgeEnvironment(): { ok: true } | { ok: false; reason: string } {
  if (!SUPABASE_URL) return { ok: false, reason: "SUPABASE_URL_MISSING" };
  if (!ANON_KEY) return { ok: false, reason: "SUPABASE_ANON_KEY_MISSING" };
  if (!SERVICE_ROLE) return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY_MISSING" };
  if (SERVICE_ROLE === ANON_KEY) return { ok: false, reason: "SERVICE_ROLE_KEY_EQUALS_ANON_KEY" };
  return { ok: true };
}

/**
 * Build a dedicated service-role client. Never reuses the operator header.
 */
function buildServiceClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE}`,
        apikey: SERVICE_ROLE,
      },
    },
  });
}

const SUCCESS_MESSAGE = "Dry test passed — no real email was sent.";

type Json = Record<string, unknown>;
type Blocker = {
  code: string;
  stage?: string;
  severity?: string;
  message?: string;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function toBlockers(raw: unknown): Blocker[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      if (typeof r === "string") return { code: r };
      const o = r as any;
      return {
        code: String(o.code ?? o.blocker_code ?? "UNKNOWN"),
        stage: o.stage,
        severity: o.severity,
        message: o.message ?? o.description,
      };
    });
  }
  return [{ code: String(raw) }];
}

function preMutationEvidence(): Json {
  return {
    mutation_started: false,
    execution_created: false,
    request_created: false,
    message_created: false,
    created_this_call: false,
    cleanup_proven: true,
    provider_call_attempted: false,
    simulator_call_attempted: false,
    ambiguous_outcome: false,
    retry_safe: true,
  };
}

function decodeJwtPayload(token: string): Json | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

/** Direct PostgREST transport that pins the exact verified operator JWT. */
async function operatorRpc(token: string, functionName: string, body: Json = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let data: unknown = null;
  try { data = await response.json(); } catch { data = null; }
  return { ok: response.ok, status: response.status, data };
}

function blockedResponse(
  base: Json,
  extra: Json = {},
  httpStatus = 200,
): Response {
  return json(httpStatus, {
    contract_version: CONTRACT_VERSION,
    evaluator_version: EVALUATOR_VERSION,
    edge_version: EDGE_VERSION,
    status: "BLOCKED",
    state: "BLOCKED",
    passed: false,
    stage_succeeded: false,
    terminal: true,
    idempotent_replay: false,
    message: "Blocked before processing.",
    validated_at: new Date().toISOString(),
    correlation_id: null,
    preview_snapshot_id: null,
    preview_approval_id: null,
    dry_run_execution_id: null,
    execution_no: null,
    request_id: null,
    message_id: null,
    trace_id: null,
    dry_run_certification_id: null,
    certification_expires_at: null,
    recipient_count: null,
    blockers: [],
    warnings: [],
    transition_log_ids: [],
    failure_stage: "INPUT",
    ...preMutationEvidence(),
    retry_reason: "PRE_MUTATION_VALIDATION_FAILURE",
    ...base,
    ...extra,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  // ---------- Edge environment validation (Section E) ---------------------
  const envCheck = validateEdgeEnvironment();
  if (!envCheck.ok) {
    return json(500, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: "BLOCKED",
      state: "BLOCKED",
      failure_stage: "EDGE_ENVIRONMENT",
      message:
        "The Dry Run processing service is not configured. Platform configuration required.",
      blockers: [
        {
          code: "EDGE_SERVICE_ROLE_CONFIGURATION_INVALID",
          stage: "EDGE_ENVIRONMENT",
          reason: envCheck.reason,
        },
      ],
      mutation_started: false,
      execution_created: false,
      request_created: false,
      message_created: false,
      cleanup_proven: true,
      provider_call_attempted: false,
      simulator_call_attempted: false,
      ambiguous_outcome: false,
      retry_safe: false,
      retry_reason: "EDGE_CONFIGURATION_INVALID",
    });
  }

  // ---------- Auth boundary ------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return blockedResponse(
      {
        failure_stage: "AUTH",
        message: "Sign in as an authorised operator to run a Dry Test.",
        blockers: [{ code: "UNAUTHENTICATED", stage: "AUTH" }],
        retry_reason: "PRE_MUTATION_AUTH_FAILURE",
      },
      {},
      401,
    );
  }
  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return blockedResponse(
      {
        failure_stage: "AUTH",
        message: "Sign in as an authorised operator to run a Dry Test.",
        blockers: [{ code: "UNAUTHENTICATED", stage: "AUTH" }],
        retry_reason: "PRE_MUTATION_AUTH_FAILURE",
      },
      {},
      401,
    );
  }

  const jwt = decodeJwtPayload(accessToken);
  const tokenExp = typeof jwt?.exp === "number" ? jwt.exp : Number(jwt?.exp ?? 0);
  const tokenRemainingSeconds = tokenExp > 0
    ? Math.max(0, Math.floor(tokenExp - Date.now() / 1000))
    : null;
  if (tokenRemainingSeconds !== null && tokenRemainingSeconds <= 0) {
    return blockedResponse({
      failure_stage: "AUTH",
      blockers: [{ code: "OPERATOR_ACCESS_TOKEN_EXPIRED", stage: "AUTH" }],
      retry_reason: "OPERATOR_REFRESH_REQUIRED",
      auth_evidence: {
        auth_stage: "EDGE_TOKEN_EXPIRY",
        token_remaining_seconds: tokenRemainingSeconds,
        auth_server_user_confirmed: false,
        postgrest_actor_confirmed: false,
        actor_match: false,
      },
    }, {}, 401);
  }
  if (tokenRemainingSeconds !== null && tokenRemainingSeconds < 300) {
    return blockedResponse({
      failure_stage: "AUTH",
      blockers: [{ code: "OPERATOR_TOKEN_TOO_CLOSE_TO_EXPIRY", stage: "AUTH" }],
      retry_reason: "OPERATOR_REFRESH_REQUIRED",
      auth_evidence: {
        auth_stage: "EDGE_TOKEN_EXPIRY",
        token_remaining_seconds: tokenRemainingSeconds,
        auth_server_user_confirmed: false,
        postgrest_actor_confirmed: false,
        actor_match: false,
      },
    }, {}, 401);
  }

  let payload: Json = {};
  try {
    payload = ((await req.json()) as Json) ?? {};
  } catch {
    return blockedResponse(
      {
        failure_stage: "INPUT",
        blockers: [{ code: "INVALID_JSON", stage: "INPUT" }],
      },
      {},
      400,
    );
  }

  const moduleCode = String((payload as any).module_code ?? "");
  const eventCode = String((payload as any).event_code ?? "");
  const channel = String((payload as any).channel ?? "email");
  const previewSnapshotId = (payload as any).preview_snapshot_id as
    | string
    | undefined;
  const previewApprovalId = (payload as any).preview_approval_id as
    | string
    | undefined;
  const operatorReason = String((payload as any).operator_reason ?? "").trim();
  const idempotencyKey = (payload as any).idempotency_key as string | undefined;
  const expectedActorId = (payload as any).expected_actor_id as
    | string
    | undefined;
  const expectedRecipientSetHash = (payload as any)
    .expected_recipient_set_hash as string | undefined;

  // Correlation from the browser is explicitly IGNORED. Do NOT read it, do
  // NOT accept it as authoritative. The preflight envelope owns correlation.
  if ((payload as any).correlation_id !== undefined) {
    console.warn(
      "[comm-hub-dry-run] ignoring browser-supplied correlation_id (server-owned).",
    );
  }

  const missing: Blocker[] = [];
  if (!moduleCode) missing.push({ code: "MODULE_CODE_REQUIRED", stage: "INPUT" });
  if (!eventCode) missing.push({ code: "EVENT_CODE_REQUIRED", stage: "INPUT" });
  if (!previewSnapshotId)
    missing.push({ code: "PREVIEW_SNAPSHOT_REQUIRED", stage: "INPUT" });
  if (!previewApprovalId)
    missing.push({ code: "PREVIEW_APPROVAL_REQUIRED", stage: "INPUT" });
  if (!operatorReason)
    missing.push({ code: "OPERATOR_REASON_REQUIRED", stage: "INPUT" });
  if (!idempotencyKey)
    missing.push({ code: "IDEMPOTENCY_KEY_REQUIRED", stage: "INPUT" });
  if (missing.length) {
    return blockedResponse(
      {
        failure_stage: "INPUT",
        blockers: missing,
        preview_snapshot_id: previewSnapshotId ?? null,
        preview_approval_id: previewApprovalId ?? null,
      },
      {},
      400,
    );
  }

  // JWT-scoped client — RPCs derive requested_by from auth.uid().
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Verify caller identity server-side.
  const { data: claimsData, error: claimsError } =
    await userClient.auth.getUser(accessToken);
  if (claimsError || !claimsData?.user?.id) {
    return blockedResponse(
      {
        failure_stage: "AUTH",
        blockers: [{ code: "UNAUTHENTICATED", stage: "AUTH" }],
        retry_reason: "PRE_MUTATION_AUTH_FAILURE",
      },
      {},
      401,
    );
  }
  const actualActorId = claimsData.user.id;
  if (expectedActorId && expectedActorId !== actualActorId) {
    return blockedResponse(
      {
        failure_stage: "AUTH",
        blockers: [{ code: "OPERATOR_IDENTITY_MISMATCH", stage: "AUTH" }],
        retry_reason: "PRE_MUTATION_AUTH_FAILURE",
      },
      {},
      403,
    );
  }


  // Prove the same operator identity reaches PostgREST before preflight.
  const operatorProbeCall = await operatorRpc(accessToken, "probe_comm_hub_operator_identity");
  const operatorProbe = (operatorProbeCall.data ?? {}) as any;
  const postgrestActor = operatorProbe?.actor_id ?? null;
  const authEvidence = {
    auth_stage: "POSTGREST_OPERATOR_PROBE",
    token_remaining_seconds: tokenRemainingSeconds,
    auth_server_user_confirmed: true,
    postgrest_actor_confirmed: Boolean(operatorProbeCall.ok && operatorProbe?.allowed && postgrestActor),
    actor_match: postgrestActor === actualActorId,
    actor_id: postgrestActor,
    actor_source: operatorProbe?.actor_source ?? null,
    resolved_role: operatorProbe?.resolved_role ?? null,
    role_source: operatorProbe?.role_source ?? null,
    claims_present: Boolean(operatorProbe?.claims_present),
    token_expires_at: operatorProbe?.token_expires_at ?? null,
  };
  if (!operatorProbeCall.ok || !operatorProbe?.allowed || !postgrestActor) {
    const code = operatorProbe?.claims_present === false
      ? "OPERATOR_AUTH_CLAIMS_MISSING"
      : "OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST";
    return blockedResponse({
      failure_stage: "AUTH",
      blockers: [{ code, stage: "POSTGREST_OPERATOR_PROBE" }],
      retry_reason: "OPERATOR_JWT_PROPAGATION_FIX_REQUIRED",
      retry_safe: false,
      auth_evidence: authEvidence,
    });
  }
  if (postgrestActor !== actualActorId) {
    return blockedResponse({
      failure_stage: "AUTH",
      blockers: [{ code: "OPERATOR_IDENTITY_MISMATCH", stage: "POSTGREST_OPERATOR_PROBE" }],
      retry_reason: "OPERATOR_REAUTHENTICATION_REQUIRED",
      auth_evidence: authEvidence,
    });
  }

  // ---------- Step 1: pure preflight (owner of correlation) ---------------
  const preflightCall = await operatorRpc(
    accessToken,
    "inspect_comm_hub_dry_run_preflight",
    {
      p_preview_snapshot_id: previewSnapshotId,
      p_preview_approval_id: previewApprovalId,
      p_module_code: moduleCode,
      p_event_code: eventCode,
      p_channel: channel,
    },
  );
  const preflightData = preflightCall.data;
  const preflightErr = preflightCall.ok ? null : preflightData as any;
  if (preflightErr) {
    return blockedResponse(
      {
        failure_stage: "PREFLIGHT",
        preview_snapshot_id: previewSnapshotId ?? null,
        preview_approval_id: previewApprovalId ?? null,
        blockers: [
          {
            code: "PREFLIGHT_CALL_FAILED",
            stage: "PREFLIGHT",
            message: preflightErr.message,
          },
        ],
      },
      {},
      400,
    );
  }
  const preflight = (preflightData ?? {}) as any;
  const preflightStatus = String(preflight?.status ?? "BLOCKED");
  const authoritativeCorrelation: string | null =
    (preflight?.correlation_id as string | null) ?? null;

  if (preflightStatus !== "PREFLIGHT_READY") {
    // Return the exact preflight envelope — no begin, no rows created.
    return json(200, {
      ...preflight,
      edge_version: EDGE_VERSION,
      auth_evidence: authEvidence,
      failure_stage: preflight?.failure_stage ?? "PREFLIGHT",
      // Ensure retry contract is truthful and pre-mutation.
      ...preMutationEvidence(),
      retry_reason:
        preflight?.retry_reason ?? "PRE_MUTATION_VALIDATION_FAILURE",
    });
  }

  if (!authoritativeCorrelation) {
    return blockedResponse(
      {
        failure_stage: "CORRELATION",
        preview_snapshot_id: previewSnapshotId ?? null,
        preview_approval_id: previewApprovalId ?? null,
        blockers: [
          { code: "PREVIEW_CORRELATION_MISSING", stage: "CORRELATION" },
        ],
        message:
          "Preflight succeeded but did not return an authoritative correlation.",
      },
      {},
      200,
    );
  }

  // ---------- Step 1b: positive service-role probe (Section G) ------------
  // Runs BEFORE begin. On failure, no execution/request/message is created.
  const admin = buildServiceClient();
  const { data: probeData, error: probeErr } = await admin.rpc(
    "probe_comm_hub_dry_run_service_identity",
  );
  if (probeErr || !probeData || !(probeData as any).allowed) {
    const probe = (probeData ?? {}) as any;
    const reason = probeErr?.message ?? "SERVICE_ROLE_REQUIRED";
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: "BLOCKED",
      state: "BLOCKED",
      failure_stage: "SERVICE_IDENTITY",
      message:
        "The platform could not authenticate its internal Dry Run processing service. No Dry Run execution or communication records were created. Platform configuration required.",
      correlation_id: authoritativeCorrelation,
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      dry_run_execution_id: null,
      request_id: null,
      message_id: null,
      trace_id: null,
      probe: {
        allowed: Boolean(probe.allowed),
        resolved_role: probe.resolved_role ?? null,
        role_source: probe.role_source ?? null,
        service_role_confirmed: Boolean(probe.service_role_confirmed),
        process_allowlist_match: Boolean(probe.process_allowlist_match),
        certify_allowlist_match: Boolean(probe.certify_allowlist_match),
      },
      auth_evidence: authEvidence,
      blockers: [
        {
          code: "SERVICE_ROLE_REQUIRED",
          stage: "SERVICE_IDENTITY",
          message: reason,
        },
      ],
      mutation_started: false,
      execution_created: false,
      request_created: false,
      message_created: false,
      cleanup_proven: true,
      provider_call_attempted: false,
      simulator_call_attempted: false,
      ambiguous_outcome: false,
      retry_safe: false,
      retry_reason: "SERVICE_IDENTITY_FAILURE",
    });
  }

  // ---------- Step 2: begin_comm_hub_dry_run_v1 (JWT-scoped) --------------
  const beginPayload: Json = {
    module_code: moduleCode,
    event_code: eventCode,
    channel,
    preview_snapshot_id: previewSnapshotId,
    preview_approval_id: previewApprovalId,
    operator_reason: operatorReason,
    idempotency_key: idempotencyKey,
    expected_correlation_id: authoritativeCorrelation,
  };
  if (expectedRecipientSetHash) {
    beginPayload["expected_recipient_set_hash"] = expectedRecipientSetHash;
  }

  const beginCall = await operatorRpc(
    accessToken,
    "begin_comm_hub_dry_run_v1",
    { p_payload: beginPayload },
  );
  const beginData = beginCall.data;
  const beginErr = beginCall.ok ? null : beginData as any;
  if (beginErr) {
    return blockedResponse(
      {
        failure_stage: "BEGIN",
        preview_snapshot_id: previewSnapshotId ?? null,
        preview_approval_id: previewApprovalId ?? null,
        correlation_id: authoritativeCorrelation,
        blockers: [
          {
            code: "BEGIN_DRY_RUN_ERROR",
            stage: "BEGIN",
            message: beginErr.message,
          },
        ],
        message: "Could not start the Dry Run. Refresh readiness and try again.",
      },
      {},
      400,
    );
  }
  const begin = (beginData ?? {}) as any;
  const beginStatus = String(begin?.status ?? "");

  const beginOk = beginStatus === "BEGIN_OK" || beginStatus === "OK" ||
    beginStatus === "STARTED" || beginStatus === "CREATED";
  const beginReplay = beginStatus === "BEGIN_REPLAY";

  if (!beginOk && !beginReplay) {
    // BLOCKED (or any other non-accepted status) — return the FULL v1 envelope.
    return json(200, {
      ...begin,
      edge_version: EDGE_VERSION,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      failure_stage: begin?.failure_stage ?? "BEGIN",
    });
  }

  const executionId: string | null =
    begin?.dry_run_execution_id ?? begin?.execution_id ?? null;
  const beginCorrelation: string | null = begin?.correlation_id ?? null;
  const beginRequestId: string | null = begin?.request_id ?? null;
  const beginMessageId: string | null = begin?.message_id ?? null;
  const beginTraceId: string | null = begin?.trace_id ?? null;
  const beginExecutionNo: string | null = begin?.execution_no ?? null;
  if (!executionId || !beginCorrelation) {
    return blockedResponse(
      {
        failure_stage: "BEGIN",
        preview_snapshot_id: previewSnapshotId ?? null,
        preview_approval_id: previewApprovalId ?? null,
        blockers: [{ code: "BEGIN_DRY_RUN_MISSING_IDS", stage: "BEGIN" }],
        message: "The Dry Run started but did not return an execution id.",
      },
      {},
      500,
    );
  }
  if (beginCorrelation !== authoritativeCorrelation) {
    // Server must never disagree with itself. Refuse to proceed.
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: "BLOCKED",
      state: "BLOCKED",
      failure_stage: "CORRELATION",
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      correlation_id: authoritativeCorrelation,
      dry_run_execution_id: executionId,
      request_id: beginRequestId,
      message_id: beginMessageId,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      blockers: [{
        code: "CORRELATION_ID_MISMATCH",
        stage: "CORRELATION",
        message: "begin_comm_hub_dry_run_v1 returned a correlation that does not match preflight.",
      }],
      mutation_started: true,
      execution_created: true,
      request_created: Boolean(beginRequestId),
      message_created: Boolean(beginMessageId),
      cleanup_proven: false,
      provider_call_attempted: false,
      simulator_call_attempted: false,
      ambiguous_outcome: false,
      retry_safe: false,
      retry_reason: "POST_BEGIN_CORRELATION_MISMATCH",
    });
  }

  // ---------- Step 3: process (service role) ------------------------------


  const { data: procData, error: procErr } = await admin.rpc(
    "process_comm_hub_dry_run_execution",
    { p_execution_id: executionId, p_correlation_id: beginCorrelation },
  );
  if (procErr) {
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: "DRY_RUN_FAILED",
      failure_stage: "PROCESS",
      dry_run_execution_id: executionId,
      execution_no: beginExecutionNo,
      execution_state: null,
      correlation_id: beginCorrelation,
      request_id: beginRequestId,
      message_id: beginMessageId,
      trace_id: beginTraceId,
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      blockers: [
        {
          code: "PROCESS_DRY_RUN_ERROR",
          stage: "PROCESS",
          message: procErr.message,
        },
      ],
      // Section L: begin succeeded, so rows exist. Report truthfully.
      mutation_started: true,
      execution_created: true,
      request_created: Boolean(beginRequestId),
      message_created: Boolean(beginMessageId),
      cleanup_proven: false,
      provider_call_attempted: false,
      simulator_call_attempted: false,
      ambiguous_outcome: false,
      retry_safe: false,
      retry_reason: "POST_BEGIN_PROCESS_FAILURE",
    });
  }
  const proc = (procData ?? {}) as any;
  const procState = String(proc?.state ?? proc?.execution_state ?? proc?.status ?? "");
  const procOk =
    procState === "PROCESSED" ||
    procState === "COMPLETED" ||
    procState === "OK";
  if (!procOk) {
    const procFailureStage = proc?.failure_stage ?? proc?.stage ?? "PROCESS";
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: procState === "FAILED" ? "DRY_RUN_FAILED" : "BLOCKED",
      failure_stage: procFailureStage,
      dry_run_execution_id: executionId,
      execution_no: beginExecutionNo,
      execution_state: procState || null,
      correlation_id: beginCorrelation,
      request_id: proc?.request_id ?? beginRequestId,
      message_id: proc?.message_id ?? beginMessageId,
      trace_id: proc?.trace_id ?? beginTraceId,
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      resolved_role: proc?.resolved_role ?? null,
      role_source: proc?.role_source ?? null,
      blockers: toBlockers(proc?.blockers ?? []),
      warnings: proc?.warnings ?? [],
      mutation_started: true,
      execution_created: true,
      request_created: Boolean(beginRequestId),
      message_created: Boolean(beginMessageId),
      cleanup_proven: false,
      provider_call_attempted: false,
      simulator_call_attempted: false,
      ambiguous_outcome: false,
      retry_safe: false,
      retry_reason:
        procFailureStage === "SERVICE_IDENTITY"
          ? "SERVICE_IDENTITY_FAILURE_AFTER_BEGIN"
          : "POST_BEGIN_PROCESS_BLOCKED",
      message:
        procFailureStage === "SERVICE_IDENTITY"
          ? "The Dry Run execution and internal message records were created, but the platform processing identity was rejected. No provider or simulator call was made. The partial execution is being reconciled and must not be retried."
          : "The Dry Run execution was created but processing was blocked.",
    });
  }

  // ---------- Step 4: certify (service role) ------------------------------
  const { data: certData, error: certErr } = await admin.rpc(
    "certify_comm_hub_dry_run",
    { p_execution_id: executionId },
  );
  if (certErr) {
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: "DRY_RUN_FAILED",
      failure_stage: "CERTIFY",
      dry_run_execution_id: executionId,
      execution_state: procState,
      correlation_id: beginCorrelation,
      request_id: proc?.request_id ?? null,
      message_id: proc?.message_id ?? null,
      trace_id: proc?.trace_id ?? null,
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      blockers: [
        {
          code: "CERTIFY_DRY_RUN_ERROR",
          stage: "CERTIFY",
          message: certErr.message,
        },
      ],
      provider_call_attempted: false,
      simulator_call_attempted: false,
    });
  }
  const cert = (certData ?? {}) as any;
  const certStatus = String(cert?.status ?? "");
  const certExec = cert?.dry_run_execution_id as string | undefined;
  const certAcceptedIdempotent =
    certStatus === "IDEMPOTENT" && (!certExec || certExec === executionId);
  const certAccepted =
    certStatus === "CERTIFIED" ||
    certStatus === "" || // certify returns no status field on plain success
    certAcceptedIdempotent;
  const certId =
    cert?.dry_run_certification_id ?? cert?.certification_id ?? null;

  if (!certAccepted || !certId) {
    return json(200, {
      contract_version: CONTRACT_VERSION,
      edge_version: EDGE_VERSION,
      status: certStatus === "BLOCKED" ? "BLOCKED" : "DRY_RUN_FAILED",
      failure_stage: "CERTIFY",
      dry_run_execution_id: executionId,
      execution_state: procState,
      correlation_id: beginCorrelation,
      request_id: proc?.request_id ?? null,
      message_id: proc?.message_id ?? null,
      trace_id: proc?.trace_id ?? null,
      preview_snapshot_id: previewSnapshotId ?? null,
      preview_approval_id: previewApprovalId ?? null,
      auth_evidence: authEvidence,
      service_role_probe: probeData,
      blockers: toBlockers(
        cert?.blockers ?? [{ code: "CERTIFICATION_NOT_ISSUED" }],
      ),
      provider_call_attempted: false,
      simulator_call_attempted: false,
    });
  }

  return json(200, {
    contract_version: CONTRACT_VERSION,
    edge_version: EDGE_VERSION,
    status: "DRY_RUN_PASSED",
    passed: true,
    message: SUCCESS_MESSAGE,
    dry_run_execution_id: executionId,
    execution_state: procState,
    correlation_id: beginCorrelation,
    dry_run_certification_id: certId,
    certification_expires_at: cert?.expires_at ?? cert?.certification_expires_at ?? null,
    request_id: proc?.request_id ?? null,
    message_id: proc?.message_id ?? null,
    trace_id: proc?.trace_id ?? null,
    preview_snapshot_id: previewSnapshotId ?? null,
    preview_approval_id: previewApprovalId ?? null,
    auth_evidence: {
      ...authEvidence,
      continuity_proof: "PHASE_4B3_OPERATOR_JWT_CONTINUITY_PROVEN",
    },
    service_role_probe: probeData,
    idempotent_replay: Boolean(
      proc?.idempotent_replay ??
        begin?.idempotent_replay ??
        beginReplay ??
        certAcceptedIdempotent,
    ),
    blockers: [],
    warnings: [],
    provider_call_attempted: false,
    simulator_call_attempted: false,
  });
});
