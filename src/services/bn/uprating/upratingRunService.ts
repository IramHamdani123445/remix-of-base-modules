/**
 * BN Uprating — run, population, exception and simulation service (Epic 1).
 *
 * The single façade between Uprating run surfaces and the governed run
 * boundary. Every mutation goes through `bn_uprating_run_command_v1`; every
 * read goes through a governed `_v1` read service.
 *
 * This module never writes to Uprating tables directly, never derives
 * lifecycle availability locally, and never touches awards, entitlements,
 * payment schedules or communications — Epic 1 is pre-execution only.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnUpratingCommandResult, BnUpratingQueryResult } from '@/types/bn/uprating/upratingPolicy';
import type {
  BnUpratingApprovalQueueRow,
  BnUpratingApprovalReadiness,
  BnUpratingExceptionRow,
  BnUpratingExecutionItemRow,
  BnUpratingExecutionQueueRow,
  BnUpratingExecutionReadiness,
  BnUpratingOperationalQueueView,
  BnUpratingPopulationRow,
  BnUpratingPostExecutionReadiness,
  BnUpratingReconciliationView,
  BnUpratingRollbackReadiness,
  BnUpratingRunActionsResult,
  BnUpratingRunApprovalView,
  BnUpratingRunCommandName,
  BnUpratingRunDetail,
  BnUpratingRunExecutionView,
  BnUpratingRunListRow,
  BnUpratingScheduleReadiness,
  BnUpratingScheduledRunRow,
  BnUpratingSimulationItemRow,
  BnUpratingSimulationSummary,
} from '@/types/bn/uprating/upratingRun';
import { newUpratingUuid, upratingErrorMessage } from './upratingPolicyService';

const RUN_ERRORS: Record<string, string> = {
  E_UNAUTHENTICATED: 'You must be signed in to work with uprating runs.',
  E_PERMISSION: 'You do not have permission to perform this action.',
  E_NOT_FOUND: 'That uprating run could not be found.',
  E_VALIDATION: 'Some required information is missing or invalid.',
  E_POLICY_NOT_ACTIVE: 'A run can only be created from an active, approved policy version.',
  E_EFFECTIVE_DATE_OUTSIDE_POLICY:
    'The target effective date is outside the effective period of that policy version.',
  E_INDEX_OBSERVATION_UNAVAILABLE:
    'The published index observations required by this policy version are not available.',
  E_INVALID_STATE: 'That action is not available at this stage of the run.',
  E_NO_POPULATION: 'Build the population snapshot before simulating.',
  E_BLOCKING_EXCEPTIONS: 'Resolve all blocking exceptions before simulating.',
  E_NOT_SIMULATABLE: 'This policy method cannot be simulated automatically in this release.',
  E_RESOLUTION_NOT_PERMITTED: 'That resolution is not permitted for this exception type.',
  E_SNAPSHOT_SUPERSEDED:
    'That exception belongs to a superseded snapshot. Rebuild the population and review again.',
  E_JUSTIFICATION_REQUIRED: 'A resolution and a justification are required.',
  E_STALE_ROW_VERSION: 'This run was changed by someone else. Reload and try again.',
  E_UNKNOWN_COMMAND: 'That action is not available in this module.',
  // Epic 2 — approval and execution scheduling
  E_ALREADY_SUBMITTED: 'This run already has an approval cycle awaiting a decision.',
  E_NO_SIMULATION: 'Run a simulation before submitting this run for approval.',
  E_SIMULATION_STALE: 'The simulation is stale. Run it again before submitting for approval.',
  E_FINGERPRINT_MISMATCH: 'The simulation no longer matches the current run inputs.',
  E_CALCULATION_FAILURES: 'Some awards failed calculation in the current simulation.',
  E_POLICY_PROVENANCE: 'The policy version behind this run is no longer valid for approval.',
  E_NOT_READY: 'This run is not ready for approval.',
  E_NO_PENDING_APPROVAL: 'There is no approval cycle awaiting a decision.',
  E_MAKER_CHECKER:
    'You prepared or submitted this run, so an independent officer must record the decision.',
  E_APPROVAL_STALE:
    'The submitted package no longer matches the run. Resubmit a fresh package for approval.',
  E_NO_APPROVAL: 'There is no current approved package for this run.',
  E_SCHEDULE_EXISTS: 'This run already has an active execution schedule.',
  E_NO_SCHEDULE: 'There is no active execution schedule for this run.',
  E_SCHEDULE_IN_PAST: 'The planned execution time must be in the future.',
  E_INVALID_TIME_ZONE: 'That time zone is not recognised.',
  E_INVALID_WINDOW: 'The execution window is not valid.',
  E_INVALID_BATCH_SIZE: 'The batch size is outside the permitted range.',
  E_INVALID_CONCURRENCY: 'The batch concurrency is outside the permitted range.',
  E_INVALID_PAYLOAD: 'Some required information is missing or invalid.',
  E_IDEMPOTENCY_MISMATCH:
    'This request key has already been used with different details. Start a new request.',
  // Epic 3 — batch execution and failed-item retry
  E_NOT_DUE: 'The planned execution time has not been reached yet.',
  E_WINDOW_CLOSED:
    'The approved execution window has closed. Reschedule the run before executing it.',
  E_NO_PENDING_BATCH: 'Every prepared batch has already been executed.',
  E_NOTHING_TO_EXECUTE: 'The approved package contains no award changes to apply.',
  E_NO_SESSION: 'This run has not been executed yet, so there is nothing to retry.',
  E_BATCHES_PENDING: 'Finish executing the prepared batches before retrying failed items.',
  E_NO_RETRYABLE_ITEMS:
    'There are no eligible items to retry. The remaining failures must be corrected at source.',
  // Epic 4 — post-execution completion, reconciliation and controlled rollback
  E_EXECUTION_INCOMPLETE:
    'Finish executing and retrying the outstanding items before post-execution processing.',
  E_INVALID_TRANSITION: 'That operation is not available at this stage of the run.',
  E_RECONCILIATION_BLOCKED:
    'Reconciliation found material differences that must be resolved before this run can be reconciled.',
  E_ROLLBACK_IN_PROGRESS:
    'A rollback assessment is already awaiting authorisation for this run.',
  E_ROLLBACK_NOT_ASSESSED:
    'Assess rollback eligibility before authorising a rollback.',
  E_ROLLBACK_BLOCKED: 'No award change on this run is eligible to be reversed.',
};



export function upratingRunErrorMessage(code?: string | null, fallback?: string | null): string {
  if (code && RUN_ERRORS[code]) return RUN_ERRORS[code];
  return upratingErrorMessage(code, fallback);
}

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function callQuery<T>(rpc: string, args: Record<string, unknown>): Promise<BnUpratingQueryResult<T>> {
  const { data, error } = await supabase.rpc(rpc as never, args as never);
  if (error) return { status: 'ERROR', code: 'E_PERMISSION', message: error.message, data: null };
  const envelope = (data ?? {}) as { status?: string; code?: string; message?: string; data?: unknown };
  const status = envelope.status === 'OK' ? 'OK' : 'ERROR';
  return {
    status,
    code: envelope.code ?? null,
    message: envelope.message ?? null,
    data: status === 'OK' ? ((envelope.data ?? null) as T) : null,
  };
}

export interface ExecuteUpratingRunCommandRequest {
  readonly command: BnUpratingRunCommandName;
  readonly runId?: string | null;
  readonly exceptionId?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly expectedRowVersion?: number | null;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

export async function executeUpratingRunCommand(
  request: ExecuteUpratingRunCommandRequest,
): Promise<BnUpratingCommandResult> {
  const uid = await actorId();
  if (!uid) {
    return {
      status: 'ERROR',
      code: 'E_UNAUTHENTICATED',
      message: RUN_ERRORS.E_UNAUTHENTICATED,
      data: null,
    };
  }
  const { data, error } = await supabase.rpc('bn_uprating_run_command_v1' as never, {
    p_command_name: request.command,
    p_actor_user_id: uid,
    p_payload: request.payload ?? {},
    p_run_id: request.runId ?? null,
    p_exception_id: request.exceptionId ?? null,
    p_expected_row_version: request.expectedRowVersion ?? null,
    p_idempotency_key: request.idempotencyKey ?? newUpratingUuid(),
    p_correlation_id: request.correlationId ?? newUpratingUuid(),
  } as never);

  if (error) {
    return { status: 'ERROR', code: 'E_PERMISSION', message: RUN_ERRORS.E_PERMISSION, data: null };
  }
  const envelope = (data ?? {}) as {
    status?: string;
    code?: string;
    message?: string;
    data?: Record<string, unknown> | null;
  };
  const status = envelope.status === 'OK' ? 'OK' : envelope.status === 'REPLAYED' ? 'REPLAYED' : 'ERROR';
  return {
    status,
    code: envelope.code ?? null,
    message:
      status === 'ERROR' ? upratingRunErrorMessage(envelope.code, envelope.message) : envelope.message ?? null,
    data: envelope.data ?? null,
  };
}

export async function fetchUpratingRunList(
  filters: Record<string, unknown> = {},
  limit = 25,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingRunListRow[]; total: number }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_list_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingRunDetail(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingRunDetail>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_detail_v1', { p_actor_user_id: uid, p_run_id: runId });
}

export async function fetchUpratingRunPopulation(
  runId: string,
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<
  BnUpratingQueryResult<{ rows: BnUpratingPopulationRow[]; total: number; snapshot_id: string | null }>
> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_population_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingRunExceptions(
  runId: string,
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<
  BnUpratingQueryResult<{
    rows: BnUpratingExceptionRow[];
    total: number;
    open: number;
    blocking: number;
    snapshot_id: string | null;
  }>
> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_exceptions_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingSimulationResult(
  runId: string,
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<
  BnUpratingQueryResult<{
    simulation: BnUpratingSimulationSummary | null;
    rows: BnUpratingSimulationItemRow[];
    total: number;
    simulation_state: string;
  }>
> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_simulation_result_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingRunActions(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingRunActionsResult>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_actions_v1', { p_actor_user_id: uid, p_run_id: runId });
}

// ---------------------------------------------------------------------------
// Epic 2 — approval and execution scheduling reads.
// Availability, readiness and validation are decided by the backend only.
// ---------------------------------------------------------------------------

export async function fetchUpratingApprovalReadiness(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingApprovalReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_approval_readiness_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingRunApproval(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingRunApprovalView>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_approval_v1', { p_actor_user_id: uid, p_run_id: runId });
}

export async function fetchUpratingScheduleReadiness(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingScheduleReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_execution_schedule_readiness_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingApprovalQueue(
  filters: Record<string, unknown> = {},
  limit = 25,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingApprovalQueueRow[]; total: number }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_approval_queue_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingScheduledRunQueue(
  filters: Record<string, unknown> = {},
  limit = 25,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingScheduledRunRow[]; total: number }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_scheduled_run_queue_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

// ---------------------------------------------------------------------------
// Epic 3 — batch execution and failed-item retry reads.
// Execution applies the approved package verbatim; this module never
// recalculates an amount and never writes to an award directly.
// ---------------------------------------------------------------------------

export async function fetchUpratingExecutionReadiness(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingExecutionReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_execution_readiness_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingRunExecution(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingRunExecutionView>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_run_execution_v1', { p_actor_user_id: uid, p_run_id: runId });
}

export async function fetchUpratingExecutionItems(
  runId: string,
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<
  BnUpratingQueryResult<{
    rows: BnUpratingExecutionItemRow[];
    total: number;
    session_id: string | null;
  }>
> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_execution_items_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingExecutionQueue(
  filters: Record<string, unknown> = {},
  limit = 25,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingExecutionQueueRow[]; total: number }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_execution_queue_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}


// ---------------------------------------------------------------------------
// Epic 4 — post-execution completion, reconciliation and controlled rollback
//
// All reads use the governed `_v1` read services; all mutations go through
// `bn_uprating_run_command_v1`. Nothing here writes to a table directly and
// nothing here closes a run — closure is Epic 5.
// ---------------------------------------------------------------------------

export async function fetchUpratingPostExecutionReadiness(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingPostExecutionReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_post_execution_readiness_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingReconciliation(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingReconciliationView>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_reconciliation_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingRollbackReadiness(
  runId: string,
): Promise<BnUpratingQueryResult<BnUpratingRollbackReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_rollback_readiness_v1', {
    p_actor_user_id: uid,
    p_run_id: runId,
  });
}

export async function fetchUpratingOperationalQueue(
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<BnUpratingQueryResult<BnUpratingOperationalQueueView>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_operational_queue_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

interface Epic4CommandArgs {
  readonly runId: string;
  readonly expectedRowVersion?: number | null;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

/** Supporting operation — rebuild the payment-schedule consequences of an executed run. */
export async function rebuildUpratingSchedules(
  args: Epic4CommandArgs,
): Promise<BnUpratingCommandResult> {
  return executeUpratingRunCommand({ command: 'BN_UPRATING_REBUILD_SCHEDULES', ...args });
}

/** Supporting operation — request claimant notices through the Communication Hub. */
export async function issueUpratingCommunications(
  args: Epic4CommandArgs,
): Promise<BnUpratingCommandResult> {
  return executeUpratingRunCommand({ command: 'BN_UPRATING_ISSUE_COMMUNICATIONS', ...args });
}

/** Supporting operation — record a run as failed (admin, justified). */
export async function markUpratingRunFailed(
  args: Epic4CommandArgs & { readonly justification: string; readonly reasonCode?: string | null },
): Promise<BnUpratingCommandResult> {
  const { justification, reasonCode, ...rest } = args;
  return executeUpratingRunCommand({
    command: 'BN_UPRATING_MARK_FAILED',
    payload: { justification, reason_code: reasonCode ?? null },
    ...rest,
  });
}

/** Supporting operation — (re)assess which applied award changes may be reversed. */
export async function assessUpratingRollback(
  args: Epic4CommandArgs & {
    readonly justification?: string | null;
    readonly reasonCode?: string | null;
  },
): Promise<BnUpratingCommandResult> {
  const { justification, reasonCode, ...rest } = args;
  return executeUpratingRunCommand({
    command: 'BN_UPRATING_ASSESS_ROLLBACK',
    payload: { justification: justification ?? null, reason_code: reasonCode ?? null },
    ...rest,
  });
}

/** Canonical `BN_UPRATING_RECONCILE_RUN`. */
export async function reconcileUpratingRun(
  args: Epic4CommandArgs,
): Promise<BnUpratingCommandResult> {
  return executeUpratingRunCommand({ command: 'BN_UPRATING_RECONCILE_RUN', ...args });
}

/** Canonical `BN_UPRATING_ROLLBACK_ELIGIBLE`. */
export async function rollbackEligibleUpratingItems(
  args: Epic4CommandArgs & { readonly justification: string; readonly reasonCode?: string | null },
): Promise<BnUpratingCommandResult> {
  const { justification, reasonCode, ...rest } = args;
  return executeUpratingRunCommand({
    command: 'BN_UPRATING_ROLLBACK_ELIGIBLE',
    payload: { justification, reason_code: reasonCode ?? null },
    ...rest,
  });
}
