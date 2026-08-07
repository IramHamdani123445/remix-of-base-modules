/**
 * BN Means-Test — secured query service.
 *
 * Reads go through SECURITY DEFINER query RPCs that re-derive the caller's
 * permission server-side. A failed query is NEVER represented as an empty
 * successful result: callers receive an explicit status.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  BnMeansAdjustmentRow,
  BnMeansApprovalContext,
  BnMeansQueueCode,
} from '@/types/bn/meansTests/meansAdjustments';
import type {
  BnMeansHouseholdCandidate,
  BnMeansHouseholdDetail,
  BnMeansHouseholdReadiness,
} from '@/types/bn/meansTests/meansHousehold';
import type {
  BnMeansEmployerRecord,
  BnMeansIncomeContext,
  BnMeansIncomeDetail,
  BnMeansIncomeReadiness,
  BnMeansIncomeReference,
} from '@/types/bn/meansTests/meansIncome';

export type {
  BnMeansAdjustmentRow,
  BnMeansApprovalContext,
  BnMeansQueueCode,
} from '@/types/bn/meansTests/meansAdjustments';
export type {
  BnMeansHouseholdCandidate,
  BnMeansHouseholdDetail,
  BnMeansHouseholdMember,
  BnMeansHouseholdReadiness,
} from '@/types/bn/meansTests/meansHousehold';
export type {
  BnMeansEmployerRecord,
  BnMeansIncomeContext,
  BnMeansIncomeDetail,
  BnMeansIncomeFact,
  BnMeansIncomeReadiness,
  BnMeansIncomeReference,
} from '@/types/bn/meansTests/meansIncome';


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

export interface BnMeansReadinessFactRef {
  readonly fact_kind: string;
  readonly fact_id: string;
}

/** Backend-owned calculation readiness. Never recomputed in React. */
export interface BnMeansCalculationReadiness {
  readonly assessment_id: string;
  readonly assessment_version_id: string | null;
  readonly status: string;
  readonly ready_for_calculation: boolean;
  readonly missing_verifications: readonly BnMeansReadinessFactRef[];
  readonly rejected_facts: readonly BnMeansReadinessFactRef[];
  readonly clarification_required: readonly BnMeansReadinessFactRef[];
  readonly policy_configuration_issues: readonly Record<string, unknown>[];
  readonly currency_issues: readonly Record<string, unknown>[];
  readonly reason_codes: readonly string[];
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

  /** MT7 — adjustment register for one assessment. */
  async adjustments(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<readonly BnMeansAdjustmentRow[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_adjustments_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansAdjustmentRow[]>(data);
  },

  /** MT7 — canonical approval context. Never recomputed in React. */
  async approvalContext(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansApprovalContext>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_approval_context_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansApprovalContext>(data);
  },

  /** EPIC 2 — household composition for one assessment. */
  async household(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansHouseholdDetail>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_household_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansHouseholdDetail>(data);
  },

  /** EPIC 2 — backend-owned household readiness. Never recomputed in React. */
  async householdReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansHouseholdReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_household_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansHouseholdReadiness>(data);
  },

  /** EPIC 2 — known household / dependant candidates for this claimant. */
  async householdCandidates(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<readonly BnMeansHouseholdCandidate[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_household_candidates_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansHouseholdCandidate[]>(data);
  },

  /** MT7 — secured work queues. Never derived from direct table reads. */
  async queue(
    queueCode: BnMeansQueueCode,
    limit = 50,
    offset = 0,
  ): Promise<BnMeansQueryResult<readonly Record<string, unknown>[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_queues_v1', {
      p_actor_user_id: uid,
      p_queue_code: queueCode,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return failed(error.message);
    return envelope<readonly Record<string, unknown>[]>(data);
  },
};

