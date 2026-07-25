/**
 * CH-SIMPLE-P3D-B.3 — Typed dry-run frontend service.
 *
 * The frontend NEVER calls internal orchestration RPCs directly. Every
 * dry-run execution goes through the `comm-hub-dry-run` edge function
 * (JWT-authenticated). The service preserves the full server envelope
 * verbatim — it does NOT collapse structured errors into a toast.
 *
 * Forbidden call sites (enforced by governance scans): the internal
 * begin / mark-dispatching / finalize / fail lifecycle RPCs, the targeted
 * dispatcher operation, and any direct write to the certification table.
 * The service must only call the public edge function.
 */
import { supabase } from "@/integrations/supabase/client";
import { getActionReadySession, CommHubAuthError } from "./authSession";

export type DryRunFinalStatus = "DRY_RUN_PASSED" | "DRY_RUN_FAILED" | "BLOCKED";

export interface DryRunBlocker {
  code: string;
  stage?: string | null;
  severity?: string | null;
  message?: string | null;
}

export interface DryRunEnvelope {
  status: DryRunFinalStatus;
  passed: boolean;
  message: string;
  idempotent_replay: boolean;
  dry_run_execution_id: string | null;
  execution_no: string | null;
  dry_run_certification_id: string | null;
  request_id: string | null;
  request_number: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  original_decision_id: string | null;
  dispatcher_revalidation_decision_id: string | null;
  preview_snapshot_id: string | null;
  preview_approval_id: string | null;
  blockers: DryRunBlocker[];
  warnings: unknown[];
  failure_stage: string | null;
  started_at: string | null;
  completed_at: string | null;
  certification_expires_at: string | null;
  provider_call_attempted: boolean;
  provider_message_id: string | null;
  final_operating_mode: string | null;
  /**
   * Server-authoritative retry safety contract (Phase 4B3).
   * Missing fields MUST fail closed to UNKNOWN — not to `false`.
   */
  retry_safe: boolean | "UNKNOWN";
  retry_reason:
    | "AUTHENTICATION_REQUIRED"
    | "CONFIGURATION_CORRECTION_REQUIRED"
    | "BEGIN_ROLLED_BACK"
    | "AMBIGUOUS_RUNTIME_OUTCOME"
    | "SAFE_TO_RETRY"
    | "IDEMPOTENT_REPLAY"
    | "UNKNOWN"
    | string;
  mutation_started: boolean;
  execution_created: boolean;
  request_created: boolean;
  message_created: boolean;
  /**
   * Phase 4B3 — server-verified cleanup proof. Only set to `true` when the
   * server has verified terminal runtime state (CERTIFIED with no partial
   * rows). Missing OR `false` on a mutation-started outcome must block
   * "Run Again" until the operator investigates.
   */
  cleanup_proven: boolean | "UNKNOWN";
  simulator_call_attempted: boolean;
  ambiguous_outcome: boolean;
  can_retry_after_reauthentication: boolean;
  transition_log_id: string | null;
  edge_version: string | null;
  auth_evidence: Record<string, unknown> | null;
  service_role_probe: Record<string, unknown> | null;
}


export interface RunDryTestInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  recipients: string[];
  previewSnapshotId?: string | null;
  previewApprovalId?: string | null;
  operatorReason?: string | null;
  idempotencyKey: string;
  contextData?: Record<string, unknown>;
}

/** Normalize any server-shaped body to the full v1 envelope. Missing
 *  retry-safety fields FAIL CLOSED to `"UNKNOWN"` — never silently `false`.
 *  Auth failures are detected and stamped with the canonical retry contract. */
function normalizeEnvelope(body: any): DryRunEnvelope {
  const b: any = body ?? {};
  const stage = b.failure_stage ?? b.failureStage ?? null;
  const isAuth =
    (typeof stage === "string" && stage.toUpperCase() === "AUTH") ||
    b.retry_reason === "AUTHENTICATION_REQUIRED" ||
    (Array.isArray(b.blockers) &&
      b.blockers.some((x: any) =>
        typeof x?.code === "string" &&
        /^(not_authenticated|UNAUTHENTICATED(_TRANSITION)?|authentication_|session_|invalid_or_expired_jwt)/i
          .test(x.code),
      ));

  const has = (k: string) => Object.prototype.hasOwnProperty.call(b, k);
  const retrySafe: boolean | "UNKNOWN" =
    isAuth ? true : has("retry_safe") ? !!b.retry_safe : "UNKNOWN";
  const retryReason: string =
    isAuth ? "AUTHENTICATION_REQUIRED"
    : b.retry_reason ?? (retrySafe === true ? "SAFE_TO_RETRY" : "UNKNOWN");
  const mutationStarted = has("mutation_started")
    ? !!b.mutation_started
    : !!b.dry_run_execution_id;
  const ambiguous = has("ambiguous_outcome")
    ? !!b.ambiguous_outcome
    : (retrySafe === "UNKNOWN" && mutationStarted);

  return {
    status: b.status,
    passed: !!b.passed,
    message: b.message ?? "",
    idempotent_replay: !!b.idempotent_replay,
    dry_run_execution_id: b.dry_run_execution_id ?? null,
    execution_no: b.execution_no ?? null,
    dry_run_certification_id: b.dry_run_certification_id ?? null,
    request_id: b.request_id ?? null,
    request_number: b.request_number ?? null,
    message_id: b.message_id ?? null,
    delivery_attempt_id: b.delivery_attempt_id ?? null,
    trace_id: b.trace_id ?? null,
    original_decision_id: b.original_decision_id ?? null,
    dispatcher_revalidation_decision_id: b.dispatcher_revalidation_decision_id ?? null,
    preview_snapshot_id: b.preview_snapshot_id ?? null,
    preview_approval_id: b.preview_approval_id ?? null,
    blockers: (b.blockers ?? []) as DryRunBlocker[],
    warnings: (b.warnings ?? []) as unknown[],
    failure_stage: stage,
    started_at: b.started_at ?? null,
    completed_at: b.completed_at ?? null,
    certification_expires_at: b.certification_expires_at ?? null,
    provider_call_attempted: !!b.provider_call_attempted,
    provider_message_id: b.provider_message_id ?? null,
    final_operating_mode: b.final_operating_mode ?? null,
    retry_safe: retrySafe,
    retry_reason: retryReason,
    mutation_started: mutationStarted,
    execution_created: has("execution_created")
      ? !!b.execution_created
      : !!b.dry_run_execution_id,
    request_created: has("request_created") ? !!b.request_created : !!b.request_id,
    message_created: has("message_created") ? !!b.message_created : !!b.message_id,
    simulator_call_attempted: has("simulator_call_attempted")
      ? !!b.simulator_call_attempted
      : false,
    ambiguous_outcome: ambiguous,
    can_retry_after_reauthentication: isAuth
      ? true
      : !!b.can_retry_after_reauthentication,
    transition_log_id: b.transition_log_id ?? null,
    edge_version: b.edge_version ?? null,
    auth_evidence: b.auth_evidence ?? null,
    service_role_probe: b.service_role_probe ?? b.probe ?? null,
  };
}

/**
 * Invoke the canonical dry-run edge function. The server is authoritative;
 * this function only forwards inputs and returns the stable envelope.
 */
export async function runDryTest(input: RunDryTestInput): Promise<DryRunEnvelope> {
  if (!input.idempotencyKey) {
    throw new Error("idempotencyKey is required — never auto-generate on the fly");
  }
  // Guarantee a fresh JWT before invoking the edge function; expired tokens
  // manifest as a generic "Failed to send a request to the Edge Function".
  let authenticatedSession;
  try {
    authenticatedSession = (await getActionReadySession({ minValiditySeconds: 300 })).session;
  } catch (err) {
    if (err instanceof CommHubAuthError) throw err;
    throw new CommHubAuthError("authentication_required", (err as Error)?.message);
  }
  const { data, error } = await (supabase as any).functions.invoke("comm-hub-dry-run", {
    // Pin the exact server-validated JWT to this privileged invocation. Using
    // the Functions client's implicit session lookup allowed an auth event to
    // replace or omit the bearer token between validation and transmission.
    headers: { Authorization: `Bearer ${authenticatedSession.access_token}` },
    body: {
      module_code: input.moduleCode,
      event_code: input.eventCode,
      channel: input.channel ?? "email",
      // Server whitelist accepts to_/cc_/bcc_recipients only. Map the caller's
      // single `recipients` array onto `to_recipients` so it is not stripped
      // by sanitizeBeginInputs (previously caused begin_comm_hub_dry_run to
      // fail with no recipients and surface a non-2xx to the browser).
      to_recipients: input.recipients,
      cc_recipients: [],
      bcc_recipients: [],
      preview_snapshot_id: input.previewSnapshotId ?? null,
      preview_approval_id: input.previewApprovalId ?? null,
      operator_reason: input.operatorReason ?? null,
      idempotency_key: input.idempotencyKey,
      context_data: input.contextData ?? {},
    },
  });
  if (error && !data) {
    const ctx: any = (error as any)?.context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = await ctx.json();
        if (body && typeof body === "object" && "status" in body) {
          return normalizeEnvelope(body);
        }
        // eslint-disable-next-line no-console
        console.error("comm-hub-dry-run non-2xx", { status: ctx.status, body });
        throw new Error(
          (body as any)?.message ??
            `comm-hub-dry-run failed (HTTP ${ctx.status})`,
        );
      } catch (parseErr) {
        // eslint-disable-next-line no-console
        console.error("comm-hub-dry-run parse error", parseErr);
      }
    }
    throw new Error(error.message ?? "comm-hub-dry-run request failed");
  }
  return normalizeEnvelope(data);
}

export interface DryRunExecutionRow {
  id: string;
  execution_no: string | null;
  state: string;
  requested_by: string | null;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  trace_id: string | null;
  preview_snapshot_id: string | null;
  preview_approval_id: string | null;
  certification_id: string | null;
  blockers: unknown[];
  warnings: unknown[];
  failure_stage: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export async function fetchDryRunExecution(
  executionId: string,
): Promise<DryRunExecutionRow | null> {
  const { data, error } = await (supabase as any)
    .from("communication_dry_run_execution")
    .select(
      "id, execution_no, state, requested_by, request_id, message_id, " +
        "delivery_attempt_id, trace_id, preview_snapshot_id, preview_approval_id, " +
        "certification_id, blockers, warnings, failure_stage, started_at, completed_at",
    )
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as DryRunExecutionRow) ?? null;
}

export interface DryRunCertificationRow {
  id: string;
  module_code: string;
  event_code: string;
  channel: string;
  status: string;
  certified_at: string;
  expires_at: string | null;
  request_id: string | null;
  message_id: string | null;
  delivery_attempt_id: string | null;
  found?: boolean;
}

async function certRpc(payload: Record<string, unknown>): Promise<any> {
  const { data, error } = await (supabase as any).rpc(
    "fetch_comm_hub_dry_run_certification",
    { p_payload: payload },
  );
  if (error) throw new Error(error.message);
  return data;
}

export async function fetchDryRunCertification(
  certificationId: string,
): Promise<DryRunCertificationRow | null> {
  const row = await certRpc({ certification_id: certificationId });
  if (!row || row.found === false) return null;
  return row as DryRunCertificationRow;
}

export async function fetchLatestValidDryRunCertification(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<DryRunCertificationRow | null> {
  const row = await certRpc({
    module_code: input.moduleCode,
    event_code: input.eventCode,
    channel: input.channel ?? "email",
  });
  if (!row || row.found === false) return null;
  return row as DryRunCertificationRow;
}

export interface DryRunCertificationValidation {
  valid: boolean;
  status: "VALID" | "EXPIRED" | "REVOKED" | "SUPERSEDED" | "INVALIDATED" | "MISSING";
  blockers: DryRunBlocker[];
  warnings: DryRunBlocker[];
  certification_id: string | null;
  module_code: string | null;
  event_code: string | null;
  channel: string | null;
  certified_at: string | null;
  expires_at: string | null;
  reason: string | null;
}

export async function validateDryRunCertification(input: {
  certificationId: string;
  moduleCode: string;
  eventCode: string;
  channel?: string;
}): Promise<DryRunCertificationValidation> {
  const { data, error } = await (supabase as any).rpc(
    "validate_comm_hub_dry_run_certification",
    {
      p_payload: {
        certification_id: input.certificationId,
        module_code: input.moduleCode,
        event_code: input.eventCode,
        channel: input.channel ?? "email",
      },
    },
  );
  if (error) throw new Error(error.message);
  const r: any = data ?? {};
  const status: DryRunCertificationValidation["status"] =
    r.status ?? (r.valid ? "VALID" : r.reason ? String(r.reason).toUpperCase() : "MISSING");
  return {
    valid: r.valid === true,
    status,
    blockers: (r.blockers ?? []) as DryRunBlocker[],
    warnings: (r.warnings ?? []) as DryRunBlocker[],
    certification_id: r.certification_id ?? input.certificationId,
    module_code: r.module_code ?? input.moduleCode,
    event_code: r.event_code ?? input.eventCode,
    channel: r.channel ?? (input.channel ?? "email"),
    certified_at: r.certified_at ?? null,
    expires_at: r.expires_at ?? null,
    reason: r.reason ?? null,
  };
}

export async function revokeDryRunCertification(input: {
  certificationId: string;
  revocationReason: string;
}): Promise<{ certification_id: string; status: "REVOKED" }> {
  const { data, error } = await (supabase as any).rpc(
    "revoke_comm_hub_dry_run_certification",
    {
      p_payload: {
        certification_id: input.certificationId,
        revocation_reason: input.revocationReason,
      },
    },
  );
  if (error) throw new Error(error.message);
  return data as { certification_id: string; status: "REVOKED" };
}

/** UI-facing progress labels — display only; the server remains authoritative. */
export const DRY_RUN_PROGRESS_STEPS = [
  "Checking configuration",
  "Creating simulation",
  "Processing locked dry-run message",
  "Verifying provider was not called",
  "Recording evidence",
  "Certification complete",
] as const;

export function generateIdempotencyKey(): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `dry-${g.crypto.randomUUID()}`;
  return `dry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
