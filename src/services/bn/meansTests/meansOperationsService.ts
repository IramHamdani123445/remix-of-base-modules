/**
 * BN Means-Test — EPIC 13 operational queue, counts, reporting and
 * assignment service.
 *
 * Every call goes through a SECURITY DEFINER RPC that re-derives the
 * caller's permission server-side. A failure is never represented as an
 * empty successful result.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnMeansAssignAction,
  BnMeansAssignResult,
  BnMeansOperationalCounts,
  BnMeansOperationalFilters,
  BnMeansOperationalQueueCode,
  BnMeansOperationalQueuePage,
  BnMeansQueueSort,
  BnMeansReport,
  BnMeansReportCode,
  BnMeansReportFilters,
} from '@/types/bn/meansTests/meansOperations';
import type { BnMeansQueryResult } from '@/services/bn/meansTests/meansQueryService';

async function actorId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id ?? null;
}

function envelope<T>(payload: unknown): BnMeansQueryResult<T> {
  const record = (payload ?? {}) as Record<string, unknown>;
  const status = (record.status as BnMeansQueryResult<T>['status']) ?? 'FAILED';
  return {
    status,
    data: status === 'OK' ? ((record.data ?? null) as T) : null,
    code: record.code as string | undefined,
  };
}

function failed<T>(detail: string, code = 'QUERY_FAILED'): BnMeansQueryResult<T> {
  return { status: 'FAILED', data: null, code, detail };
}

export const meansOperationsService = {
  /** One page of a governed operational queue. */
  async queue(
    queueCode: BnMeansOperationalQueueCode,
    filters: BnMeansOperationalFilters = {},
    limit = 25,
    offset = 0,
    sort: BnMeansQueueSort = 'OLDEST',
  ): Promise<BnMeansQueryResult<BnMeansOperationalQueuePage>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_operational_queue_v1', {
      p_actor_user_id: uid,
      p_queue_code: queueCode,
      p_filters: filters as never,
      p_limit: limit,
      p_offset: offset,
      p_sort: sort,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansOperationalQueuePage>(data);
  },

  /** Per-queue counts plus configuration health for the overview. */
  async counts(
    queueCodes?: readonly string[],
  ): Promise<BnMeansQueryResult<BnMeansOperationalCounts>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_operational_counts_v1', {
      p_actor_user_id: uid,
      p_queue_codes: (queueCodes ? [...queueCodes] : null) as never,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansOperationalCounts>(data);
  },

  /** An operational report. Aggregation is performed entirely server-side. */
  async report(
    reportCode: BnMeansReportCode,
    filters: BnMeansReportFilters = {},
  ): Promise<BnMeansQueryResult<BnMeansReport>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_operational_report_v1', {
      p_actor_user_id: uid,
      p_report_code: reportCode,
      p_filters: filters as never,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansReport>(data);
  },

  /** Claim, release or reassign ownership of an assessment. */
  async assign(
    assessmentId: string,
    action: BnMeansAssignAction,
    targetUserId?: string,
  ): Promise<BnMeansQueryResult<BnMeansAssignResult>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_operational_assign_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
      p_action: action,
      p_target_user_id: targetUserId ?? null,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansAssignResult>(data);
  },
};

export default meansOperationsService;
