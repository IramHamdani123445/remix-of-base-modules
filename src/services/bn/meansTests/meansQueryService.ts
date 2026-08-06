/**
 * BN Means-Test — secured query service.
 *
 * Reads go through SECURITY DEFINER query RPCs that re-derive the caller's
 * permission server-side. A failed query is NEVER represented as an empty
 * successful result: callers receive an explicit status.
 */
import { supabase } from '@/integrations/supabase/client';

export type BnMeansQueryStatus = 'OK' | 'DENIED' | 'NOT_FOUND' | 'INVALID' | 'FAILED';

export interface BnMeansQueryResult<T> {
  readonly status: BnMeansQueryStatus;
  readonly data: T | null;
  readonly totalCount?: number | null;
  readonly code?: string;
  readonly detail?: string;
}

export interface BnMeansWorkQueueFilters {
  readonly status?: string;
  readonly benefit_programme?: string;
  readonly assessment_reason?: string;
  readonly assigned_to?: string;
  readonly policy_version_id?: string;
  readonly effective_from?: string;
  readonly effective_to?: string;
  readonly reassessment_due_before?: string;
  readonly search?: string;
}

export interface BnMeansWorkQueueRow {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly person_id: number | null;
  readonly claim_id: string | null;
  readonly award_id: string | null;
  readonly benefit_programme: string;
  readonly assessment_reason: string;
  readonly status: string;
  readonly result: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly policy_version_id: string | null;
  readonly currency_code: string;
  readonly assigned_to: string | null;
  readonly reassessment_due: string | null;
  readonly valid_until: string | null;
  readonly row_version: number;
  readonly updated_at: string;
  readonly open_information_requests: number;
  readonly evidence_count: number;
}

export interface BnMeansAvailableAction {
  readonly command: string;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly row_version: number;
}

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

function envelope<T>(payload: unknown): BnMeansQueryResult<T> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const status = (record.status as BnMeansQueryStatus) ?? 'FAILED';
  return {
    status,
    data: status === 'OK' ? ((record.data ?? null) as T) : null,
    totalCount: (record.total_count as number | undefined) ?? null,
    code: record.code as string | undefined,
  };
}

function failed<T>(detail: string, code = 'QUERY_FAILED'): BnMeansQueryResult<T> {
  return { status: 'FAILED', data: null, code, detail };
}

export const meansQueryService = {
  async workQueue(
    filters: BnMeansWorkQueueFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<BnMeansQueryResult<readonly BnMeansWorkQueueRow[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_work_queue_v1', {
      p_actor_user_id: uid,
      p_filters: filters as never,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansWorkQueueRow[]>(data);
  },

  async detail(assessmentId: string): Promise<BnMeansQueryResult<Record<string, unknown>>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_assessment_detail_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<Record<string, unknown>>(data);
  },

  async availableActions(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<readonly BnMeansAvailableAction[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_available_actions_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansAvailableAction[]>(data);
  },

  /**
   * MT6 — canonical calculation readiness. Readiness rules live in the
   * governed backend only; the UI renders whatever the backend reports.
   */
  async calculationReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansCalculationReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_calculation_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansCalculationReadiness>(data);
  },

  /** MT6 — immutable calculation with its explanation lines. */
  async calculationTrace(
    calculationId: string,
  ): Promise<BnMeansQueryResult<Record<string, unknown>>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_calculation_trace_v1', {
      p_actor_user_id: uid,
      p_calculation_id: calculationId,
    });
    if (error) return failed(error.message);
    return envelope<Record<string, unknown>>(data);
  },

  async benefit360Summary(params: {

    awardId?: string | null;
    personId?: number | null;
  }): Promise<BnMeansQueryResult<Record<string, unknown> | null>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_benefit360_summary_v1', {
      p_actor_user_id: uid,
      p_award_id: params.awardId ?? null,
      p_person_id: params.personId ?? null,
    });
    if (error) return failed(error.message);
    return envelope<Record<string, unknown> | null>(data);
  },
};
