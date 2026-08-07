/**
 * MEANS-TEST — Policy Configuration service.
 *
 * The only browser boundary for Means-Test policy administration. Reads go
 * through governed SECURITY DEFINER queries; every mutation goes through
 * `bn_means_policy_command_v1`, which enforces the configuration
 * permission, draft-only editing, the activation validation gate,
 * optimistic concurrency, replay safety and audit.
 *
 * No component may write to `bn_means_policy*` tables directly.
 */
import { supabase } from '@/integrations/supabase/client';
import { computePayloadHash } from '@/services/bn/meansTests/meansCommandService';
import type {
  BnMeansPolicyCommand,
  BnMeansPolicyDetail,
  BnMeansPolicyList,
  BnMeansPolicyValidationReport,
} from '@/types/bn/meansTests/meansPolicyAdmin';

export type BnMeansPolicyReadStatus = 'OK' | 'DENIED' | 'NOT_FOUND' | 'FAILED';

export interface BnMeansPolicyReadResult<T> {
  readonly status: BnMeansPolicyReadStatus;
  readonly code: string | null;
  readonly message: string | null;
  readonly data: T | null;
}

export interface BnMeansPolicyCommandResult {
  readonly status: 'EXECUTED' | 'REPLAYED' | 'FAILED';
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly data: Record<string, unknown> | null;
}

function fail<T>(message: string, code = 'FAILED'): BnMeansPolicyReadResult<T> {
  return { status: 'FAILED', code, message, data: null };
}

function envelope<T>(raw: unknown): BnMeansPolicyReadResult<T> {
  const body = (raw ?? {}) as { status?: string; code?: string; data?: unknown };
  const status = (body.status ?? 'FAILED') as BnMeansPolicyReadStatus;
  return {
    status,
    code: body.code ?? null,
    message: null,
    data: status === 'OK' ? ((body.data ?? null) as T | null) : null,
  };
}

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/** Split `E_CODE:detail` into a structured, human-readable failure. */
export function parsePolicyError(message: string | null | undefined): {
  code: string;
  detail: string;
} {
  const raw = (message ?? '').trim();
  const match = /^E_([A-Z_]+):?\s*([\s\S]*)$/.exec(raw);
  if (!match) return { code: 'UNKNOWN', detail: raw || 'The change could not be completed.' };
  return { code: match[1], detail: match[2] || raw };
}

export const meansPolicyAdminService = {
  async list(filters: { search?: string; benefit_programme?: string } = {}):
    Promise<BnMeansPolicyReadResult<BnMeansPolicyList>> {
    const uid = await actorId();
    if (!uid) return fail('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_policy_admin_list_v1', {
      p_actor_user_id: uid,
      p_filters: filters as never,
    });
    if (error) return fail(error.message);
    return envelope<BnMeansPolicyList>(data);
  },

  async detail(policyId: string): Promise<BnMeansPolicyReadResult<BnMeansPolicyDetail>> {
    const uid = await actorId();
    if (!uid) return fail('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_policy_admin_detail_v1', {
      p_actor_user_id: uid,
      p_policy_id: policyId,
    });
    if (error) return fail(error.message);
    return envelope<BnMeansPolicyDetail>(data);
  },

  async validation(policyVersionId: string):
    Promise<BnMeansPolicyReadResult<BnMeansPolicyValidationReport>> {
    const uid = await actorId();
    if (!uid) return fail('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_policy_validation_v1', {
      p_actor_user_id: uid,
      p_policy_version_id: policyVersionId,
    });
    if (error) return fail(error.message);
    return envelope<BnMeansPolicyValidationReport>(data);
  },

  async execute(request: {
    command: BnMeansPolicyCommand;
    policyId?: string | null;
    policyVersionId?: string | null;
    expectedRowVersion?: number | null;
    payload?: Record<string, unknown>;
    idempotencyKey?: string;
  }): Promise<BnMeansPolicyCommandResult> {
    const uid = await actorId();
    if (!uid) {
      return {
        status: 'FAILED',
        errorCode: 'UNAUTHENTICATED',
        errorDetail: 'Your session has expired. Sign in again to continue.',
        data: null,
      };
    }
    const payload = request.payload ?? {};
    const { data, error } = await supabase.rpc('bn_means_policy_command_v1', {
      p_command_name: request.command,
      p_payload: payload as never,
      p_policy_id: request.policyId ?? null,
      p_policy_version_id: request.policyVersionId ?? null,
      p_expected_row_version: request.expectedRowVersion ?? null,
      p_actor_user_id: uid,
      p_idempotency_key: request.idempotencyKey ?? null,
      p_payload_hash: request.idempotencyKey ? await computePayloadHash(payload) : null,
    });
    if (error) {
      const parsed = parsePolicyError(error.message);
      return { status: 'FAILED', errorCode: parsed.code, errorDetail: parsed.detail, data: null };
    }
    const body = (data ?? {}) as Record<string, unknown>;
    const status = (body.status as string) === 'REPLAYED' ? 'REPLAYED' : 'EXECUTED';
    return { status, errorCode: null, errorDetail: null, data: body };
  },
};
