/**
 * BN Uprating — policy catalogue service (Epic 0).
 *
 * The single façade between Uprating surfaces and the governed policy
 * boundary. Every mutation goes through `bn_uprating_policy_command_v1`;
 * every read goes through a governed `_v1` read service.
 *
 * This module never writes to Uprating tables directly, never decides
 * lifecycle availability locally, never approves anything on the client, and
 * never touches runs, populations, simulation, execution or communications.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnUpratingActionsResult,
  BnUpratingApprovalQueueRow,
  BnUpratingCommandResult,
  BnUpratingPolicyCommandName,
  BnUpratingPolicyDetail,
  BnUpratingPolicyListRow,
  BnUpratingQueryResult,
  BnUpratingReadiness,
  BnUpratingReferenceData,
} from '@/types/bn/uprating/upratingPolicy';

export function newUpratingUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const FRIENDLY_ERRORS: Record<string, string> = {
  E_UNAUTHENTICATED: 'You must be signed in to work with uprating policies.',
  E_PERMISSION: 'You do not have permission to perform this action.',
  E_NOT_FOUND: 'That record could not be found.',
  E_VALIDATION: 'Some required information is missing or invalid.',
  E_DUPLICATE_CODE: 'That policy code is already in use.',
  E_OPEN_VERSION_EXISTS: 'This policy already has a version in progress.',
  E_IMMUTABLE_VERSION: 'Only a draft version can be edited.',
  E_INVALID_STATE: 'That action is not available at this stage.',
  E_NOT_VALIDATED: 'This version cannot be submitted until validation passes.',
  E_SELF_APPROVAL: 'The author or submitter of a version cannot approve it.',
  E_JUSTIFICATION_REQUIRED: 'A reason and justification are required.',
  E_STALE_ROW_VERSION: 'This version was changed by someone else. Reload and try again.',
  E_UNKNOWN_COMMAND: 'That action is not available in this module.',
};

export function upratingErrorMessage(code?: string | null, fallback?: string | null): string {
  if (code && FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  return fallback || 'The action could not be completed.';
}

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

async function callQuery<T>(
  rpc: string,
  args: Record<string, unknown>,
): Promise<BnUpratingQueryResult<T>> {
  const { data, error } = await supabase.rpc(rpc as never, args as never);
  if (error) return { status: 'ERROR', code: 'E_PERMISSION', message: error.message, data: null };
  const envelope = (data ?? {}) as {
    status?: string;
    code?: string;
    message?: string;
    data?: unknown;
  };
  const status = envelope.status === 'OK' ? 'OK' : 'ERROR';
  return {
    status,
    code: envelope.code ?? null,
    message: envelope.message ?? null,
    data: status === 'OK' ? ((envelope.data ?? null) as T) : null,
  };
}

export interface ExecuteUpratingCommandRequest {
  readonly command: BnUpratingPolicyCommandName;
  readonly policyId?: string | null;
  readonly policyVersionId?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly expectedRowVersion?: number | null;
  readonly idempotencyKey?: string;
  readonly correlationId?: string;
}

export async function executeUpratingPolicyCommand(
  request: ExecuteUpratingCommandRequest,
): Promise<BnUpratingCommandResult> {
  const uid = await actorId();
  if (!uid) {
    return { status: 'ERROR', code: 'E_UNAUTHENTICATED', message: FRIENDLY_ERRORS.E_UNAUTHENTICATED, data: null };
  }
  const { data, error } = await supabase.rpc('bn_uprating_policy_command_v1' as never, {
    p_command_name: request.command,
    p_actor_user_id: uid,
    p_payload: request.payload ?? {},
    p_policy_id: request.policyId ?? null,
    p_policy_version_id: request.policyVersionId ?? null,
    p_expected_row_version: request.expectedRowVersion ?? null,
    p_idempotency_key: request.idempotencyKey ?? newUpratingUuid(),
    p_correlation_id: request.correlationId ?? newUpratingUuid(),
  } as never);

  if (error) {
    return { status: 'ERROR', code: 'E_PERMISSION', message: upratingErrorMessage('E_PERMISSION'), data: null };
  }
  const envelope = (data ?? {}) as {
    status?: string;
    code?: string;
    message?: string;
    data?: Record<string, unknown> | null;
  };
  const status =
    envelope.status === 'OK' ? 'OK' : envelope.status === 'REPLAYED' ? 'REPLAYED' : 'ERROR';
  return {
    status,
    code: envelope.code ?? null,
    message:
      status === 'ERROR'
        ? upratingErrorMessage(envelope.code, envelope.message)
        : envelope.message ?? null,
    data: envelope.data ?? null,
  };
}

export async function fetchUpratingPolicyList(
  filters: Record<string, unknown> = {},
  limit = 50,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingPolicyListRow[]; total: number }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_list_v1', {
    p_actor_user_id: uid,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingPolicyDetail(
  policyId: string,
): Promise<BnUpratingQueryResult<BnUpratingPolicyDetail>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_detail_v1', {
    p_actor_user_id: uid,
    p_policy_id: policyId,
  });
}

export async function fetchUpratingApprovalQueue(
  limit = 50,
  offset = 0,
): Promise<BnUpratingQueryResult<{ rows: BnUpratingApprovalQueueRow[] }>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_approval_queue_v1', {
    p_actor_user_id: uid,
    p_limit: limit,
    p_offset: offset,
  });
}

export async function fetchUpratingReferenceData(): Promise<
  BnUpratingQueryResult<BnUpratingReferenceData>
> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_reference_data_v1', { p_actor_user_id: uid });
}

export async function fetchUpratingVersionActions(
  policyVersionId: string,
): Promise<BnUpratingQueryResult<BnUpratingActionsResult>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_actions_v1', {
    p_actor_user_id: uid,
    p_policy_version_id: policyVersionId,
  });
}

export async function fetchUpratingValidationReadiness(
  policyVersionId: string,
): Promise<BnUpratingQueryResult<BnUpratingReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_validation_readiness_v1', {
    p_actor_user_id: uid,
    p_policy_version_id: policyVersionId,
  });
}

export async function fetchUpratingApprovalReadiness(
  policyVersionId: string,
): Promise<BnUpratingQueryResult<BnUpratingReadiness>> {
  const uid = await actorId();
  if (!uid) return { status: 'ERROR', code: 'E_UNAUTHENTICATED', data: null };
  return callQuery('bn_uprating_policy_approval_readiness_v1', {
    p_actor_user_id: uid,
    p_policy_version_id: policyVersionId,
  });
}
