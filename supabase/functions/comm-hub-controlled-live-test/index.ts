/**
 * CH-SIMPLE-P3E-B — Communication Hub Controlled-Live Test Orchestrator.
 *
 * The single browser-facing entry point for a controlled-live email test.
 * Coordinates authorisation, temporary operating-mode transition, grant
 * reservation, request/message creation, targeted dispatch, provider
 * evidence capture and cleanup restoration.
 *
 * NEVER call a provider directly. All provider transport goes through
 * the shared guarded transport, which in P3E-B is routed to the
 * deterministic provider stub (`COMM_HUB_PROVIDER_MODE=stub`).
 *
 * NEVER read the grant table directly from the frontend. This function
 * returns everything the operator needs about the execution.
 */

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const DISPATCH_SECRET =
  Deno.env.get("COMMUNICATION_HUB_DISPATCH_SECRET") ??
  Deno.env.get("COMM_HUB_DISPATCH_SECRET") ??
  "";
const DISPATCH_SECRET_SOURCE = Deno.env.get("COMMUNICATION_HUB_DISPATCH_SECRET")
  ? "canonical"
  : Deno.env.get("COMM_HUB_DISPATCH_SECRET")
    ? "legacy"
    : "missing";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

const CONFIRMATION_PHRASE = "CONFIRM CONTROLLED LIVE";

type Status =
  | "BLOCKED"
  | "ENQUEUE_FAILED"
  | "DISPATCH_FAILED"
  | "PROVIDER_REJECTED"
  | "PROVIDER_ACCEPTED"
  | "DELIVERY_PENDING"
  | "DELIVERED"
  | "FAILED";

interface Envelope {
  status: Status;
  passed: boolean;
  message: string;
  idempotent_replay: boolean;
  controlled_live_execution_id: string | null;
  execution_no: number | null;
  grant_id: string | null;
  grant_status: string | null;
  request_id: string | null;
  request_number: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  original_decision_id: string | null;
  dispatcher_revalidation_decision_id: string | null;
  preview_snapshot_id: string | null;
  preview_approval_id: string | null;
  dry_run_certification_id: string | null;
  provider_call_attempted: boolean;
  provider_name: string | null;
  provider_message_id: string | null;
  provider_status: string | null;
  blockers: Array<{ code: string; stage?: string; message?: string }>;
  warnings: unknown[];
  failure_stage: string | null;
  started_at: string;
  completed_at: string;
  prior_operating_mode: string | null;
  final_operating_mode: string | null;
  cleanup_succeeded: boolean | null;
  certification_id: string | null;
  certification_status: string | null;
  certification_replayed: boolean | null;
  real_email_authorised: boolean;
  provider_mode: string;
  retry_safe: boolean;
  action: "RUN_CONTROLLED_STUB" | "SEND_ONE_REAL_EMAIL" | null;
  certification_kind: "CONTROLLED_STUB" | "ONE_REAL_EMAIL" | null;
}

const EMPTY_ENVELOPE = (started: string): Envelope => ({
  status: "BLOCKED",
  passed: false,
  message: "Controlled Live has not started.",
  idempotent_replay: false,
  controlled_live_execution_id: null,
  execution_no: null,
  grant_id: null,
  grant_status: null,
  request_id: null,
  request_number: null,
  message_id: null,
  delivery_attempt_id: null,
  trace_id: null,
  original_decision_id: null,
  dispatcher_revalidation_decision_id: null,
  preview_snapshot_id: null,
  preview_approval_id: null,
  dry_run_certification_id: null,
  provider_call_attempted: false,
  provider_name: null,
  provider_message_id: null,
  provider_status: null,
  blockers: [],
  warnings: [],
  failure_stage: null,
  started_at: started,
  completed_at: started,
  prior_operating_mode: null,
  final_operating_mode: null,
  cleanup_succeeded: null,
  certification_id: null,
  certification_status: null,
  certification_replayed: null,
  real_email_authorised: false,
  provider_mode: "unknown",
  retry_safe: false,
  action: null,
  certification_kind: null,
});

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "unknown error").slice(0, 300);
  }
  return String(error ?? "unknown error").slice(0, 300);
}

function isTerminalExecutionState(state: unknown): boolean {
  return ["PROVIDER_ACCEPTED", "DELIVERY_PENDING", "DELIVERED", "BLOCKED", "FAILED"]
    .includes(String(state ?? ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const authFailEnvelope = (code: string, message: string) => {
    const startedAt = new Date().toISOString();
    const env = EMPTY_ENVELOPE(startedAt);
    env.status = "BLOCKED";
    env.passed = false;
    env.message = message;
    env.failure_stage = "auth";
    env.provider_call_attempted = false;
    env.retry_safe = true;
    env.provider_mode = Deno.env.get("COMM_HUB_PROVIDER_MODE") ?? "inactive";
    env.blockers = [{ code, stage: "auth", message }];
    env.completed_at = new Date().toISOString();
    return json(env, 401);
  };
  if (!authHeader) {
    return authFailEnvelope("authentication_header_missing",
      "Your login session was not included with the request.");
  }
  if (!authHeader.startsWith("Bearer ")) {
    return authFailEnvelope("authentication_header_missing",
      "Authorization header is not a Bearer token.");
  }
  const bearer = authHeader.slice("Bearer ".length).trim();
  if (!bearer) {
    return authFailEnvelope("authentication_header_missing",
      "Bearer token is empty.");
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  let userData: { user: { id: string } | null } | null = null;
  let claimsErr: { message?: string } | null = null;
  try {
    const res = await userClient.auth.getUser(bearer);
    userData = res.data as any;
    claimsErr = res.error as any;
  } catch (e) {
    return authFailEnvelope("authentication_service_unavailable",
      `Authentication service error: ${errorMessage(e)}`);
  }
  if (claimsErr) {
    const msg = (claimsErr.message ?? "").toLowerCase();
    if (msg.includes("expired")) {
      return authFailEnvelope("authentication_token_expired",
        "Your login session has expired. Please sign in again.");
    }
    return authFailEnvelope("authentication_token_invalid",
      claimsErr.message ?? "Login session could not be verified.");
  }
  if (!userData?.user?.id) {
    return authFailEnvelope("authentication_user_missing",
      "Authenticated user could not be resolved.");
  }
  const operatorId = userData.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const startedAt = new Date().toISOString();
  const body = await req.json().catch(() => ({} as any));

  const env: Envelope = EMPTY_ENVELOPE(startedAt);
  env.provider_mode = Deno.env.get("COMM_HUB_PROVIDER_MODE") ?? "inactive";
  const addBlocker = (code: string, stage: string, message?: string) => {
    if (!env.blockers.some((b) => b.code === code && b.stage === stage)) {
      env.blockers.push({ code, stage, ...(message ? { message } : {}) });
    }
  };
  // Central retry-safety classifier. Failures BEFORE durable execution
  // creation are almost always safe to retry once the operator corrects
  // the input, mode, dispatch credential or evidence. Only failures that
  // may have caused a provider network call or an ambiguous durable row
  // are unsafe to auto-retry.
  const RETRY_SAFE_STAGES = new Set<string>([
    "auth",
    "input_validation",
    "real_email_gate",
    "preflight",
    "authorisation",
    "pre_transition_evidence",
    "grant_validation",
    "request_creation",
    "canonical_send_decision",
    "idempotency",
  ]);
  const classifyRetrySafe = (stage: string, code: string): boolean => {
    if (RETRY_SAFE_STAGES.has(stage)) return true;
    if (code === "controlled_live_provider_mode_inactive") return true;
    if (code === "legacy_stub_mode_required") return true;
    // Dispatcher stage: safe only if provider was not attempted.
    if (stage === "dispatcher" && !env.provider_call_attempted) return true;
    return false;
  };
  const fail = (
    status: Status,
    stage: string,
    code: string,
    message: string,
    partial: Partial<Envelope> = {},
    http = 200,
  ) => {
    env.status = status;
    env.passed = false;
    env.message = message;
    env.failure_stage = stage;
    env.completed_at = new Date().toISOString();
    addBlocker(code, stage, message);
    env.retry_safe = classifyRetrySafe(stage, code);
    Object.assign(env, partial);
    return json(env, http);
  };

  // 0. Input validation.
  const required = ["moduleCode", "eventCode", "recipient", "previewApprovalId",
    "dryRunCertificationId", "idempotencyKey", "reason", "confirmation", "action"];
  for (const k of required) {
    if (typeof body?.[k] !== "string" || body[k].length === 0) {
      return fail("BLOCKED", "input_validation", "missing_" + k,
        `${k} required`, {}, 400);
    }
  }
  if (body.confirmation !== CONFIRMATION_PHRASE) {
    return fail("BLOCKED", "input_validation", "confirmation_mismatch",
      "confirmation phrase does not match", {}, 400);
  }

  // 0.a Explicit action gate. Controlled Stub and One Real Email are two
  // separate, first-class actions with different safety envelopes.
  const action = body.action as string;
  if (action !== "RUN_CONTROLLED_STUB" && action !== "SEND_ONE_REAL_EMAIL") {
    return fail("BLOCKED", "input_validation", "action_invalid",
      "action must be RUN_CONTROLLED_STUB or SEND_ONE_REAL_EMAIL", {}, 400);
  }
  env.action = action as Envelope["action"];
  env.certification_kind = action === "RUN_CONTROLLED_STUB"
    ? "CONTROLLED_STUB"
    : "ONE_REAL_EMAIL";

  // 0.b Real-email gate applies ONLY to SEND_ONE_REAL_EMAIL. Controlled Stub
  // always runs against the deterministic provider stub and NEVER touches a
  // real provider, regardless of environment configuration.
  const PANEL_PHRASE = "SEND ONE CONTROLLED LIVE EMAIL";
  if (action === "SEND_ONE_REAL_EMAIL") {
    if (Deno.env.get("COMM_HUB_REAL_EMAIL_TEST") !== "true") {
      return fail("BLOCKED", "real_email_gate", "real_email_disabled",
        "COMM_HUB_REAL_EMAIL_TEST is not enabled on this environment", {}, 400);
    }
    if (typeof body.panelConfirmation !== "string"
        || body.panelConfirmation !== PANEL_PHRASE) {
      return fail("BLOCKED", "real_email_gate", "panel_confirmation_mismatch",
        "panel confirmation phrase does not match", {}, 400);
    }
    env.real_email_authorised = true;
  } else {
    env.real_email_authorised = false;
  }

  if (!DISPATCH_SECRET) {
    return fail("BLOCKED", "preflight", "dispatch_secret_not_configured",
      "Controlled-live dispatch is unavailable because the server dispatch credential is not configured.",
      { dispatch_secret_source: DISPATCH_SECRET_SOURCE }, 503);
  }
  if (DISPATCH_SECRET_SOURCE === "legacy") {
    env.warnings = [...(env.warnings ?? []), {
      code: "legacy_dispatch_secret_name_used",
      message: "Migrate to COMMUNICATION_HUB_DISPATCH_SECRET.",
    }];
  }
  env.dispatch_secret_source = DISPATCH_SECRET_SOURCE;

  // Provider-adapter selection.
  //
  // RUN_CONTROLLED_STUB is the Go Live Controlled Stub stage and is
  // ALWAYS routed to the deterministic simulator via the explicit
  // `action` parameter — it never reads COMM_HUB_PROVIDER_MODE and
  // never requires an environment switch. This is the root-cause fix
  // for `controlled_live_provider_mode_inactive` — the blocker is
  // no longer emitted for RUN_CONTROLLED_STUB.
  //
  // SEND_ONE_REAL_EMAIL keeps its real-email gate above and uses the
  // real provider transport.
  if (action === "RUN_CONTROLLED_STUB") {
    env.provider_mode = "stub";
  } else {
    const rawMode = (Deno.env.get("COMM_HUB_PROVIDER_MODE") ?? "").trim().toLowerCase();
    const resolvedMode = env.real_email_authorised ? "real" : rawMode;
    env.provider_mode = resolvedMode || "inactive";
    // For SEND_ONE_REAL_EMAIL we already required the real-email gate.
    // Legacy callers may still set stub via env; anything else is blocked.
    if (!env.real_email_authorised && resolvedMode !== "stub") {
      env.retry_safe = true;
      return fail(
        "BLOCKED",
        "preflight",
        "controlled_live_provider_mode_inactive",
        "Legacy Controlled Stub configuration detected. This older path still expects an environment provider mode. Use the current Go Live Controlled Stub action.",
        { retry_safe: true },
        503,
      );
    }
  }

  // 1. Preflight — global operating mode
  const { data: settings, error: settingsError } = await admin
    .from("communication_hub_control_settings")
    .select("operating_mode, dispatch_enabled")
    .eq("singleton_guard", "primary")
    .maybeSingle();
  if (settingsError) {
    return fail("BLOCKED", "preflight", "settings_read_failed",
      errorMessage(settingsError));
  }
  const priorMode = (settings as any)?.operating_mode as string | undefined;
  env.prior_operating_mode = priorMode ?? null;

  if (!priorMode) {
    return fail("BLOCKED", "preflight", "settings_missing",
      "communication hub settings singleton not initialised");
  }
  if (priorMode === "EMERGENCY_STOP") {
    return fail("BLOCKED", "preflight", "emergency_stop_active",
      "Emergency Stop is engaged; controlled-live test is blocked");
  }
  if (priorMode === "AUTOMATED_PRODUCTION") {
    return fail("BLOCKED", "preflight", "automated_production_active",
      "Automated Production is not permitted for controlled-live testing");
  }
  if (priorMode !== "CONTROLLED_LIVE") {
    return fail("BLOCKED", "preflight", "operating_mode_not_controlled_live",
      `Operating mode must be CONTROLLED_LIVE before starting ${action}. Current mode: ${priorMode}.`);
  }

  // 2. Begin controlled-live authorisation (idempotent).
  const beginPayload: any = {
    module_code: body.moduleCode,
    event_code: body.eventCode,
    channel: body.channel ?? "email",
    recipient: body.recipient,
    preview_approval_id: body.previewApprovalId,
    dry_run_certification_id: body.dryRunCertificationId,
    idempotency_key: body.idempotencyKey,
    reason: body.reason,
    confirmation: body.confirmation,
  };
  if (body.previewSnapshotId) beginPayload.preview_snapshot_id = body.previewSnapshotId;

  // Call as the operator so auth.uid() resolves inside the SECURITY DEFINER RPC.
  const { data: beginRaw, error: beginErr } = await userClient.rpc(
    "begin_comm_hub_controlled_live",
    { p_payload: beginPayload },
  );
  if (beginErr) {
    return fail("BLOCKED", "authorisation", "begin_rpc_error",
      String(beginErr.message ?? beginErr).slice(0, 300));
  }
  const begin: any = beginRaw ?? {};
  env.controlled_live_execution_id = begin.execution_id ?? null;
  env.grant_id = begin.grant_id ?? null;
  env.execution_no = begin.execution_no ?? null;
  env.preview_snapshot_id = body.previewSnapshotId ?? null;
  env.preview_approval_id = body.previewApprovalId;
  env.dry_run_certification_id = body.dryRunCertificationId;
  env.idempotent_replay = begin.status === "BEGIN_REPLAY";

  if (!begin.ok) {
    const beginBlockers = Array.isArray(begin.blockers) && begin.blockers.length
      ? begin.blockers
      : [{ code: "begin_blocked_without_reason", stage: "authorisation" }];
    return fail("BLOCKED", "authorisation", "begin_blocked",
      "controlled-live authorisation refused",
      { blockers: beginBlockers });
  }
  if (!env.controlled_live_execution_id || !env.grant_id) {
    return fail("BLOCKED", "authorisation", "begin_contract_invalid",
      "Controlled-live authorisation returned no execution or grant identifier.");
  }
  if (env.idempotent_replay && isTerminalExecutionState(begin.state)) {
    return fail("BLOCKED", "idempotency", "terminal_execution_replay_blocked",
      `Execution ${env.controlled_live_execution_id} is already ${String(begin.state)}; start a new run with a fresh idempotency key.`,
      { grant_status: null });
  }

  // 3. Confirm operator identity matches (RPC uses auth.uid()).
  const executionId = env.controlled_live_execution_id!;
  const grantId = env.grant_id!;

  // Persist prior_operating_mode on the execution.
  const { error: priorModeWriteError } = await admin
    .from("communication_controlled_live_execution")
    .update({ prior_operating_mode: priorMode })
    .eq("id", executionId)
    .is("prior_operating_mode", null);
  if (priorModeWriteError) {
    await admin.rpc("revoke_comm_hub_controlled_live_grant", {
      p_grant_id: grantId, p_execution_id: executionId,
      p_reason: "prior_mode_persistence_failed",
      p_service_operation: "REVOKE_GRANT",
    });
    return fail("BLOCKED", "pre_transition_evidence", "prior_mode_persistence_failed",
      errorMessage(priorModeWriteError));
  }

  // Backfill execution_no from the row when the RPC did not include it.
  if (env.execution_no == null) {
    const { data: execRow, error: execRowError } = await admin
      .from("communication_controlled_live_execution")
      .select("execution_no")
      .eq("id", executionId)
      .maybeSingle();
    if (execRowError) {
      addBlocker("execution_evidence_read_failed", "pre_transition_evidence", errorMessage(execRowError));
    } else {
      env.execution_no = (execRow as any)?.execution_no ?? null;
    }
  }

  // 4. Operating mode is already CONTROLLED_LIVE (validated in preflight).
  // Controlled Stub and One Real Email never mutate the operating mode; the
  // operator drives mode transitions explicitly from the Go Live screen.
  const transitioned = false;

  // Cleanup is a read-only mode confirmation: this orchestrator never
  // mutates the operating mode. It only re-reads the current mode as
  // evidence for the execution record.
  const cleanup = async (): Promise<{ succeeded: boolean; finalMode: string | null; error: string | null }> => {
    try {
      const { data: settingsAfter, error: settingsAfterError } = await admin
        .from("communication_hub_control_settings")
        .select("operating_mode")
        .eq("singleton_guard", "primary")
        .maybeSingle();
      if (settingsAfterError) {
        return { succeeded: false, finalMode: null, error: errorMessage(settingsAfterError) };
      }
      return {
        succeeded: true,
        finalMode: (settingsAfter as any)?.operating_mode ?? null,
        error: null,
      };
    } catch (error) {
      return { succeeded: false, finalMode: null, error: errorMessage(error) };
    }
  };


  // Server-only grant metadata read. The operator-facing RPC
  // `admin_get_comm_hub_controlled_live_grant` requires an authenticated
  // Admin (auth.uid()), which is unavailable on the service-role client.
  // The grant table is already off-limits to `authenticated`, so a direct
  // service-role SELECT is the correct server-only path.
  const readGrantMeta = async () => {
    return await admin
      .from("communication_controlled_live_grant")
      .select(
        "id, execution_id, status, recipient_set_hash, scope_hash, preview_approval_id, dry_run_certification_id, expires_at",
      )
      .eq("id", grantId)
      .maybeSingle();
  };

  let preRequestFailureCode: string | null = null;

  try {
    // 5. Read + validate grant metadata via service-role (never via
    // operator-authenticated RPC from this context).
    const { data: grantMeta, error: grantMetaError } = await readGrantMeta();
    if (grantMetaError) {
      env.status = "BLOCKED";
      env.failure_stage = "grant_validation";
      addBlocker(
        "controlled_live_grant_read_failed",
        "grant_validation",
        errorMessage(grantMetaError),
      );
      preRequestFailureCode = "controlled_live_grant_read_failed";
      throw new Error("grant_read_failed");
    }
    if (!grantMeta) {
      env.status = "BLOCKED";
      env.failure_stage = "grant_validation";
      addBlocker("controlled_live_grant_not_found", "grant_validation");
      preRequestFailureCode = "controlled_live_grant_not_found";
      throw new Error("grant_not_found");
    }
    const gm: any = grantMeta;
    const now = Date.now();
    const grantChecks: Array<{ cond: boolean; code: string }> = [
      { cond: gm.execution_id !== executionId, code: "controlled_live_grant_execution_mismatch" },
      { cond: gm.status !== "ISSUED" && gm.status !== "RESERVED", code: "controlled_live_grant_terminal" },
      { cond: !gm.recipient_set_hash, code: "controlled_live_grant_recipient_hash_missing" },
      { cond: gm.preview_approval_id !== body.previewApprovalId, code: "controlled_live_grant_preview_mismatch" },
      { cond: gm.dry_run_certification_id !== body.dryRunCertificationId, code: "controlled_live_grant_dry_run_mismatch" },
      { cond: !gm.expires_at || new Date(gm.expires_at).getTime() <= now, code: "controlled_live_grant_expired" },
    ];
    const failedCheck = grantChecks.find((c) => c.cond);
    if (failedCheck) {
      env.status = "BLOCKED";
      env.failure_stage = "grant_validation";
      addBlocker(failedCheck.code, "grant_validation");
      preRequestFailureCode = failedCheck.code;
      env.grant_status = gm.status ?? null;
      throw new Error(failedCheck.code);
    }
    env.grant_status = gm.status;
    const recipientSetHash = gm.recipient_set_hash as string;
    void recipientSetHash;

    // 5.a Slice 2: Server-owned Controlled Stub message creation.
    //
    // The dedicated RPC `create_comm_hub_controlled_stub_message` loads
    // approval, snapshot, dry-run certification, governance evidence and
    // sender profile server-side and creates ONE authoritative
    // targeted-dispatch-only request+recipient+message row set in a single
    // transaction. Browser-supplied content is NEVER accepted here.
    //
    // We no longer call `send_communication_v1` for Controlled Stub
    // (Slice 2 Part 8). Generic sends now reject reserved targeted fields
    // at the SQL layer (Slice 2 Part 9).
    const { data: createRaw, error: createErr } = await admin.rpc(
      "create_comm_hub_controlled_stub_message",
      { p_execution_id: executionId, p_grant_id: grantId },
    );
    if (createErr) {
      env.status = "ENQUEUE_FAILED";
      env.failure_stage = "request_creation";
      addBlocker("controlled_stub_creation_rpc_error", "request_creation",
        errorMessage(createErr));
      preRequestFailureCode = "controlled_stub_creation_rpc_error";
      throw new Error("stub_rpc_error");
    }
    const create: any = createRaw ?? {};
    if (create.ok !== true) {
      env.status = "BLOCKED";
      env.failure_stage = "request_creation";
      addBlocker(
        String(create.code ?? "controlled_stub_creation_blocked"),
        "request_creation",
        String(create.message ?? "Controlled Stub creation refused"),
      );
      preRequestFailureCode = String(create.code ?? "controlled_stub_creation_blocked");
      throw new Error("stub_creation_blocked");
    }
    env.request_id = create.request_id ?? null;
    env.request_number = create.request_no ?? null;
    env.message_id = create.message_id ?? null;
    env.preview_snapshot_id = create.preview_snapshot_id ?? env.preview_snapshot_id;
    env.preview_approval_id = create.preview_approval_id ?? env.preview_approval_id;
    env.dry_run_certification_id = create.dry_run_certification_id ?? env.dry_run_certification_id;
    env.original_decision_id = env.original_decision_id ?? begin.decision?.decision_id ?? null;
    if (create.idempotent_replay) {
      env.warnings.push({
        code: "controlled_stub_creation_replay",
        message: "Authoritative Controlled Stub message replayed via idempotency.",
      });
    }
    if (!env.request_id || !env.message_id) {
      env.status = "ENQUEUE_FAILED";
      env.failure_stage = "request_creation";
      addBlocker("controlled_stub_creation_contract_invalid", "request_creation",
        "creation function returned without request_id or message_id");
      preRequestFailureCode = "controlled_stub_creation_contract_invalid";
      throw new Error("stub_creation_contract_invalid");
    }

    // 7. Targeted controlled-live dispatch.
    const dispatchController = new AbortController();
    const dispatchTimeout = setTimeout(() => dispatchController.abort(), 30_000);
    let dispatchRes: Response;
    try {
      dispatchRes = await fetch(
        `${SUPABASE_URL}/functions/v1/comm-hub-dispatch`,
        {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-comm-hub-dispatch-secret": DISPATCH_SECRET,
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
        },
        body: JSON.stringify({
          operation: "targeted_controlled_live",
          action: action,
          messageId: env.message_id,
          requestId: env.request_id,
          executionId,
          grantId,
        }),
          signal: dispatchController.signal,
        },
      );
    } catch (dispatchError) {
      env.status = "DISPATCH_FAILED";
      env.failure_stage = "dispatcher";
      const timeout = dispatchError instanceof DOMException && dispatchError.name === "AbortError";
      addBlocker(timeout ? "dispatcher_timeout" : "dispatcher_unreachable", "dispatcher",
        timeout ? "Dispatcher did not respond within 30 seconds; durable provider evidence must be checked before retrying."
          : errorMessage(dispatchError));
      throw dispatchError;
    } finally {
      clearTimeout(dispatchTimeout);
    }
    const dispatchText = await dispatchRes.text();
    const dispatchStatus = dispatchRes.status;
    if (!dispatchText || dispatchText.length === 0) {
      addBlocker("dispatcher_response_empty", "dispatcher",
        `Dispatcher returned HTTP ${dispatchStatus} with an empty response body.`);
      env.status = "DISPATCH_FAILED";
      env.failure_stage = "dispatcher";
      throw new Error("dispatcher_response_empty");
    }
    let dispatchBody: any = null;
    try {
      dispatchBody = JSON.parse(dispatchText);
    } catch {
      addBlocker("dispatcher_response_not_json", "dispatcher",
        `Dispatcher returned HTTP ${dispatchStatus} with a non-JSON response (${dispatchText.length} bytes).`);
      env.status = "DISPATCH_FAILED";
      env.failure_stage = "dispatcher";
      throw new Error("dispatcher_response_not_json");
    }

    // Structured envelope detection — a valid dispatcher response carries
    // the canonical schema tag and blockers/warnings arrays. When the
    // envelope is valid we always adopt its fields BEFORE inspecting the
    // HTTP status, so structured 4xx/5xx business blockers survive
    // intact (this is the fix for HTTP-status-first collapse into
    // `dispatcher_http_error`).
    const looksLikeEnvelope =
      dispatchBody &&
      typeof dispatchBody === "object" &&
      dispatchBody.schema_version === "controlled-dispatch.v1" &&
      dispatchBody.operation === "targeted_controlled_live" &&
      Array.isArray(dispatchBody.blockers) &&
      Array.isArray(dispatchBody.warnings);

    if (!looksLikeEnvelope) {
      addBlocker("dispatcher_response_contract_invalid", "dispatcher",
        `Dispatcher returned HTTP ${dispatchStatus} with a response that did not satisfy the controlled-dispatch.v1 contract.`);
      env.status = "DISPATCH_FAILED";
      env.failure_stage = "dispatcher";
      throw new Error("dispatcher_response_contract_invalid");
    }

    // Adopt structured envelope fields verbatim.
    env.delivery_attempt_id = dispatchBody?.delivery_attempt_id ?? null;
    env.dispatcher_revalidation_decision_id =
      dispatchBody?.revalidation_decision_id ?? null;
    env.provider_call_attempted = !!dispatchBody?.provider_call_attempted;
    env.provider_name = dispatchBody?.provider_name ?? null;
    env.provider_message_id = dispatchBody?.provider_message_id ?? null;
    env.provider_status = dispatchBody?.provider_status ?? null;
    env.trace_id = dispatchBody?.trace_id ?? env.trace_id;
    if (typeof dispatchBody?.grant_status === "string") {
      env.grant_status = dispatchBody.grant_status;
    }
    if (Array.isArray(dispatchBody?.warnings)) env.warnings.push(...dispatchBody.warnings);
    if (Array.isArray(dispatchBody?.blockers)) {
      for (const b of dispatchBody.blockers) {
        if (b && typeof b === "object" && typeof (b as any).code === "string") {
          addBlocker((b as any).code, (b as any).stage ?? "dispatcher", (b as any).message);
        }
      }
    }
    if (typeof dispatchBody?.retry_safe === "boolean") env.retry_safe = dispatchBody.retry_safe;

    const allowedDispatchStatuses = [
      "BLOCKED", "DISPATCH_FAILED", "PROVIDER_REJECTED",
      "PROVIDER_ACCEPTED", "DELIVERY_PENDING", "DELIVERED",
    ];
    const ds: string = allowedDispatchStatuses.includes(dispatchBody?.status)
      ? dispatchBody.status
      : "DISPATCH_FAILED";
    if (ds === "DISPATCH_FAILED" && dispatchBody?.status !== "DISPATCH_FAILED") {
      addBlocker("dispatcher_status_invalid", "dispatcher",
        `Dispatcher returned unsupported status ${String(dispatchBody?.status ?? "missing")}.`);
    }
    // Retain HTTP status as safe transport metadata only.
    if (dispatchStatus >= 400) {
      env.warnings.push({
        code: "dispatcher_http_status",
        http_status: dispatchStatus,
        message: "Structured dispatcher blocker preserved; HTTP status is transport-level metadata.",
      });
    }
    env.status = ds as Status;
    const positiveStatus = ds === "PROVIDER_ACCEPTED" || ds === "DELIVERY_PENDING" || ds === "DELIVERED";
    const evidenceComplete = !!env.delivery_attempt_id
      && !!env.dispatcher_revalidation_decision_id
      && env.provider_call_attempted;
    env.passed = positiveStatus && evidenceComplete;
    if (positiveStatus && !evidenceComplete) {
      env.status = env.provider_call_attempted ? "DELIVERY_PENDING" : "DISPATCH_FAILED";
      addBlocker("dispatcher_evidence_incomplete", "dispatcher",
        "Dispatcher reported a provider outcome without complete attempt and revalidation evidence.");
    }
    // Only append a generic "dispatcher failed without blocker" marker
    // when the dispatcher genuinely returned zero blockers AND we did
    // not pass. If ANY precise blocker exists (business or transport)
    // do NOT append the generic one — the operator would see duplicates.
    if (!env.passed && env.blockers.length === 0) {
      addBlocker("dispatcher_failed_without_blocker", dispatchBody?.failure_stage ?? "dispatcher");
    }
    env.message =
      ds === "PROVIDER_ACCEPTED" ? "provider accepted controlled-live message"
      : ds === "DELIVERY_PENDING" ? "provider outcome pending; no automatic retry"
      : ds === "DELIVERED" ? "provider confirmed delivery"
      : ds === "PROVIDER_REJECTED" ? "provider rejected controlled-live message"
      : ds === "BLOCKED" ? "dispatch blocked by canonical revalidation"
      : "dispatch failed";
    env.failure_stage = env.passed ? null : (dispatchBody?.failure_stage ?? "dispatcher");

  } catch (error) {
    // Never allow a BLOCKED envelope with an empty blocker list or null stage.
    if (env.status !== "BLOCKED"
        && env.status !== "ENQUEUE_FAILED"
        && env.status !== "DISPATCH_FAILED"
        && env.status !== "PROVIDER_REJECTED") {
      env.status = "BLOCKED";
    }
    env.failure_stage = env.failure_stage ?? "grant_validation";
    if (env.blockers.length === 0) {
      addBlocker("controlled_live_orchestration_exception", env.failure_stage,
        errorMessage(error));
    }
    // Prefer specific blocker context when an execution exists.
    const primaryBlockerCode = env.blockers[0]?.code ?? null;
    const primaryBlockerMsg = env.blockers[0]?.message ?? null;
    env.message = env.message
      || (executionId && primaryBlockerCode
            ? `Controlled Live blocked at ${env.failure_stage ?? "orchestration"}: ${primaryBlockerCode}${primaryBlockerMsg ? ` — ${primaryBlockerMsg}` : ""}`
            : "Controlled Live could not proceed before request creation.");

    // Classify retry-safety for any orchestration failure caught here.
    // Pre-provider failures with successful cleanup remain retry-safe.
    if (!env.provider_call_attempted) {
      const primary = env.blockers[0]?.code ?? "";
      env.retry_safe = env.retry_safe
        || classifyRetrySafe(env.failure_stage ?? "", primary);
    }

    // Revoke the grant when the failure occurred BEFORE the request was
    // created. Never revoke after a request/message row exists — the grant
    // lifecycle transitions via consume in the dispatcher.
    if (!env.provider_call_attempted) {
      try {
        const { data: revokeResult, error: revokeError } = await admin.rpc("revoke_comm_hub_controlled_live_grant", {
          p_grant_id: grantId,
          p_execution_id: executionId,
          p_reason: ("pre_provider_" + (preRequestFailureCode ?? env.failure_stage ?? "orchestration_failure")).slice(0, 120),
          p_service_operation: "REVOKE_GRANT",
        });
        const rr: any = revokeResult ?? {};
        if (revokeError || rr.allowed !== true) {
          const revokeBlockers = Array.isArray(rr.blockers) ? rr.blockers : [];
          const detail = revokeError
            ? errorMessage(revokeError)
            : (revokeBlockers[0]?.code
                ? `${revokeBlockers[0].code}${revokeBlockers[0].message ? ": " + revokeBlockers[0].message : ""}`
                : "revoke_rpc_denied");
          addBlocker("grant_reconciliation_failed", "grant_reconciliation", detail);
        } else {
          env.grant_status = rr.status ?? "REVOKED";
        }
      } catch (revokeException) {
        addBlocker("grant_reconciliation_exception", "grant_reconciliation",
          errorMessage(revokeException));
      }
    }
  } finally {
    // 8. Cleanup: restore prior operating mode.
    void transitioned;
    const { succeeded, finalMode, error: cleanupError } = await cleanup();
    env.cleanup_succeeded = succeeded;
    env.final_operating_mode = finalMode;
    env.completed_at = new Date().toISOString();
    if (!succeeded) {
      addBlocker("operating_mode_restore_failed", "cleanup", cleanupError ?? undefined);
      env.failure_stage = "cleanup";
      env.passed = false;
      env.status = env.provider_call_attempted ? "DELIVERY_PENDING" : "BLOCKED";
      env.message = env.provider_call_attempted
        ? "Provider invocation occurred, but operating-mode restoration failed. Do not retry."
        : "Controlled Live was blocked and operating-mode restoration failed.";
    }

    // 9. Finalize execution record.
    let finalStateForRecord: string;
    if (env.passed) {
      finalStateForRecord = env.status === "DELIVERED" ? "DELIVERED"
        : env.status === "DELIVERY_PENDING" ? "DELIVERY_PENDING"
        : "PROVIDER_ACCEPTED";
    } else if (env.status === "BLOCKED") {
      finalStateForRecord = "BLOCKED";
    } else {
      finalStateForRecord = "FAILED";
    }
    try {
      const { data: finalizeResult, error: finalizeError } = await admin.rpc("finalize_comm_hub_controlled_live", {
        p_execution_id: executionId,
        p_state: finalStateForRecord,
        p_final_operating_mode: finalMode,
        p_cleanup_succeeded: succeeded,
        p_cleanup_state: succeeded ? "restored" : "restore_failed",
        p_cleanup_error: null,
        p_warnings: env.warnings.length ? env.warnings : [],
        p_failure_stage: env.failure_stage,
      });
      if (finalizeError || !(finalizeResult as any)?.ok) {
        throw finalizeError ?? new Error(String((finalizeResult as any)?.code ?? "finalize_refused"));
      }
      const { error: evidenceWriteError } = await admin
        .from("communication_controlled_live_execution")
        .update({
          blockers: env.blockers,
          warnings: env.warnings,
          request_id: env.request_id,
          message_id: env.message_id,
          delivery_attempt_id: env.delivery_attempt_id,
          dispatcher_revalidation_decision_id: env.dispatcher_revalidation_decision_id,
          trace_id: env.trace_id,
        })
        .eq("id", executionId);
      if (evidenceWriteError) throw evidenceWriteError;
    } catch (finalizeException) {
      addBlocker("execution_finalization_failed", "finalization", errorMessage(finalizeException));
      env.failure_stage = "finalization";
      env.passed = false;
      env.status = env.provider_call_attempted ? "DELIVERY_PENDING" : "BLOCKED";
      env.message = env.provider_call_attempted
        ? "Provider invocation occurred, but execution evidence could not be finalized. Do not retry."
        : "Controlled Live could not finalize its execution evidence.";
    }
  }

  // 10. Refresh grant status via direct service-role read.
  try {
    const { data: g, error: grantRefreshError } = await admin
      .from("communication_controlled_live_grant")
      .select("status")
      .eq("id", grantId)
      .maybeSingle();
    if (grantRefreshError) throw grantRefreshError;
    if (g && (g as any).status) env.grant_status = (g as any).status;
  } catch (grantRefreshException) {
    env.warnings.push({ code: "grant_status_refresh_failed", message: errorMessage(grantRefreshException) });
  }

  // 11. Record controlled-live certification (P3E-C step 5).
  if (
    env.passed && env.provider_call_attempted && env.cleanup_succeeded === true && (
      env.status === "PROVIDER_ACCEPTED" ||
      env.status === "DELIVERY_PENDING" ||
      env.status === "DELIVERED"
    )
  ) {
    try {
      const { data: gm } = await admin
        .from("communication_controlled_live_grant")
        .select("recipient_set_hash")
        .eq("id", grantId)
        .maybeSingle();
      const recipientSetHash = (gm as any)?.recipient_set_hash ?? null;
      if (!recipientSetHash) {
        env.warnings.push({
          code: "certification_skipped_missing_recipient_hash",
          message: "Provider evidence exists, but certification could not be recorded without the bound recipient hash.",
        });
      } else {
        const providerOutcome =
          env.status === "DELIVERED" ? "DELIVERED"
          : env.status === "DELIVERY_PENDING" ? "DELIVERY_PENDING"
          : "PROVIDER_ACCEPTED";
        const { data: certRaw, error: certError } = await admin.rpc(
          "record_controlled_live_certification",
          {
            p_payload: {
              execution_id: env.controlled_live_execution_id,
              certification_kind: env.certification_kind,
              module_code: body.moduleCode,
              event_code: body.eventCode,
              channel: body.channel ?? "email",
              recipient_set_hash: recipientSetHash,
              preview_snapshot_id: env.preview_snapshot_id,
              preview_approval_id: env.preview_approval_id,
              dry_run_certification_id: env.dry_run_certification_id,
              request_id: env.request_id,
              message_id: env.message_id,
              delivery_attempt_id: env.delivery_attempt_id,
              trace_id: env.trace_id,
              provider_name: env.provider_name,
              provider_message_id: env.provider_message_id,
              provider_outcome: providerOutcome,
              provider_status: env.provider_status,
              operating_mode_prior: env.prior_operating_mode,
              operating_mode_final: env.final_operating_mode,
              cleanup_succeeded: env.cleanup_succeeded,
              certified_by: operatorId,
            },
          },
        );
        if (certError) throw certError;
        const cert: any = certRaw ?? {};
        if (!cert.certification_id) throw new Error("certification_id_missing");
        env.certification_id = cert.certification_id ?? null;
        env.certification_status = cert.status ?? null;
        env.certification_replayed = cert.replayed ?? null;
      }
    } catch (e) {
      env.warnings.push({
        code: "certification_record_failed",
        message: String((e as any)?.message ?? e).slice(0, 300),
      });
    }
  }

  if (!env.message.trim()) {
    env.message = env.passed
      ? "Controlled Live completed with durable provider evidence."
      : "Controlled Live did not complete.";
  }
  if (!env.passed && env.blockers.length === 0) {
    addBlocker("controlled_live_failed_without_blocker", env.failure_stage ?? "orchestration");
  }
  if (!env.passed && !env.failure_stage) env.failure_stage = "orchestration";

  return json(env, 200);
});

