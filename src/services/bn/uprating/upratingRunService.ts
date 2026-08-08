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
  BnUpratingExceptionRow,
  BnUpratingPopulationRow,
  BnUpratingRunActionsResult,
  BnUpratingRunCommandName,
  BnUpratingRunDetail,
  BnUpratingRunListRow,
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
