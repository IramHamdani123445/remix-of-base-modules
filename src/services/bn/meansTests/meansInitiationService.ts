/**
 * MEANS-TEST EPIC 1 — secured initiation reads.
 *
 * Person search, person context, benefit programmes and the single
 * backend-owned initiation check. Every read goes through a SECURITY
 * DEFINER RPC that re-derives the caller's permission server-side, and a
 * failed read is never represented as an empty successful result.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnMeansInitiationCheck,
  BnMeansPersonContext,
  BnMeansPersonSearchRow,
  BnMeansProgrammeOption,
} from '@/types/bn/meansTests/meansInitiation';
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
    totalCount: (record.total_count as number | undefined) ?? null,
    code: record.code as string | undefined,
  };
}

function failed<T>(detail: string, code = 'QUERY_FAILED'): BnMeansQueryResult<T> {
  return { status: 'FAILED', data: null, code, detail };
}

export const meansInitiationService = {
  /** Governed person search by masked SSN, name, date of birth or claim number. */
  async personSearch(
    term: string,
    limit = 20,
  ): Promise<BnMeansQueryResult<readonly BnMeansPersonSearchRow[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_person_search_v1', {
      p_actor_user_id: uid,
      p_term: term,
      p_limit: limit,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansPersonSearchRow[]>(data);
  },

  /** Claims, awards and existing assessments for one person. */
  async personContext(personId: number): Promise<BnMeansQueryResult<BnMeansPersonContext>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_person_context_v1', {
      p_actor_user_id: uid,
      p_person_id: personId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansPersonContext>(data);
  },

  /** Benefit programmes that have a governed Means-Test policy. */
  async programmes(
    effectiveDate?: string | null,
  ): Promise<BnMeansQueryResult<readonly BnMeansProgrammeOption[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_programmes_v1', {
      p_actor_user_id: uid,
      p_effective_date: effectiveDate ?? null,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansProgrammeOption[]>(data);
  },

  /**
   * The single initiation decision. The wizard NEVER decides for itself
   * whether an assessment may be created — it renders this answer.
   */
  async initiationCheck(
    context: Record<string, unknown>,
  ): Promise<BnMeansQueryResult<BnMeansInitiationCheck>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_initiation_check_v1', {
      p_actor_user_id: uid,
      p_context: context as never,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansInitiationCheck>(data);
  },
};

export type MeansInitiationService = typeof meansInitiationService;
