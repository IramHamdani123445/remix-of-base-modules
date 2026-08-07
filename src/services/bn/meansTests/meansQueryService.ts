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
import type {
  BnMeansAssetDetail,
  BnMeansAssetReadiness,
  BnMeansAssetReference,
} from '@/types/bn/meansTests/meansAssets';
import type {
  BnMeansDeductionDetail,
  BnMeansDeductionReadiness,
  BnMeansDeductionReference,
} from '@/types/bn/meansTests/meansDeductions';
import type {
  BnMeansReviewSummary,
  BnMeansSubmissionReadiness,
} from '@/types/bn/meansTests/meansSubmission';
import type {
  BnMeansDocumentCandidate,
  BnMeansEvidenceDetail,
  BnMeansEvidenceReadiness,
  BnMeansEvidenceReference,
} from '@/types/bn/meansTests/meansEvidence';
import type {
  BnMeansVerificationQueueRow,
  BnMeansVerificationQueueScope,
  BnMeansVerificationReadiness,
  BnMeansVerificationReference,
  BnMeansVerificationWorkspace,
} from '@/types/bn/meansTests/meansVerification';
import type { BnMeansCalculationWorkspace } from '@/types/bn/meansTests/meansCalculation';
import type {
  BnMeansAdjustmentReference,
  BnMeansDecisionContext,
  BnMeansDecisionQueueCode,
  BnMeansDecisionQueueFilters,
  BnMeansDecisionQueueRow,
} from '@/types/bn/meansTests/meansDecision';

export type {
  BnMeansAdjustmentReference,
  BnMeansAdjustmentQueueRow,
  BnMeansApprovalReadiness,
  BnMeansAssessmentQueueRow,
  BnMeansDecisionAdjustment,
  BnMeansDecisionContext,
  BnMeansDecisionQueueCode,
  BnMeansDecisionQueueFilters,
  BnMeansDecisionQueueRow,
} from '@/types/bn/meansTests/meansDecision';

export type {
  BnMeansCalculationGroup,
  BnMeansCalculationHistoryRow,
  BnMeansCalculationLine,
  BnMeansCalculationReadinessV9,
  BnMeansCalculationRecord,
  BnMeansCalculationWorkspace,
} from '@/types/bn/meansTests/meansCalculation';

export type {
  BnMeansVerificationCommand,
  BnMeansVerificationFactCard,
  BnMeansVerificationOutcomeCode,
  BnMeansVerificationQueueRow,
  BnMeansVerificationQueueScope,
  BnMeansVerificationReadiness,
  BnMeansVerificationReference,
  BnMeansVerificationWorkspace,
  BnMeansVerificationWorkStatus,
} from '@/types/bn/meansTests/meansVerification';

export type {
  BnMeansDeclarationDefinition,
  BnMeansReviewSummary,
  BnMeansSubmissionIssue,
  BnMeansSubmissionReadiness,
} from '@/types/bn/meansTests/meansSubmission';

export type {
  BnMeansDocumentCandidate,
  BnMeansEvidenceDetail,
  BnMeansEvidenceLink,
  BnMeansEvidenceReadiness,
  BnMeansEvidenceReference,
  BnMeansEvidenceRequirement,
  BnMeansInformationRequest,
  BnMeansInformationResponse,
} from '@/types/bn/meansTests/meansEvidence';

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
export type {
  BnMeansAssetDetail,
  BnMeansAssetFact,
  BnMeansAssetReadiness,
  BnMeansAssetReference,
} from '@/types/bn/meansTests/meansAssets';
export type {
  BnMeansDeductionClaim,
  BnMeansDeductionDetail,
  BnMeansDeductionReadiness,
  BnMeansDeductionReference,
  BnMeansDisregardCandidate,
} from '@/types/bn/meansTests/meansDeductions';


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

  /**
   * EPIC 9 — the whole calculation surface in one governed read: backend
   * readiness, the current calculation, its explanation and its history.
   */
  async calculationWorkspace(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansCalculationWorkspace>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_calculation_workspace_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansCalculationWorkspace>(data);
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

  /** EPIC 3 — income records, household member refs and no-income declarations. */
  async income(assessmentId: string): Promise<BnMeansQueryResult<BnMeansIncomeDetail>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_income_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansIncomeDetail>(data);
  },

  /** EPIC 3 — backend-owned income readiness. Never recomputed in React. */
  async incomeReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansIncomeReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_income_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansIncomeReadiness>(data);
  },

  /** EPIC 3 — policy-governed income lists (categories, frequencies, basis, sources). */
  async incomeReference(): Promise<BnMeansQueryResult<BnMeansIncomeReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_income_reference_v1', {
      p_actor_user_id: uid,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansIncomeReference>(data);
  },

  /** EPIC 3 — existing contribution information shown as reference context only. */
  async incomeContext(
    assessmentId: string,
    memberId: string,
  ): Promise<BnMeansQueryResult<BnMeansIncomeContext>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_income_context_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
      p_member_id: memberId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansIncomeContext>(data);
  },

  /** EPIC 3 — governed employer lookup. Internal identifiers are never returned. */
  async employerSearch(
    term: string,
    limit = 20,
  ): Promise<BnMeansQueryResult<readonly BnMeansEmployerRecord[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_employer_search_v1', {
      p_actor_user_id: uid,
      p_term: term,
      p_limit: limit,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansEmployerRecord[]>(data);
  },

  /** EPIC 4 — asset records, household owner refs and no-asset declarations. */
  async assets(assessmentId: string): Promise<BnMeansQueryResult<BnMeansAssetDetail>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_assets_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansAssetDetail>(data);
  },

  /** EPIC 4 — backend-owned asset readiness. Never recomputed in React. */
  async assetReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansAssetReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_asset_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansAssetReadiness>(data);
  },

  /** EPIC 4 — policy-governed asset lists (categories, ownership, basis, disregards). */
  async assetReference(): Promise<BnMeansQueryResult<BnMeansAssetReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_asset_reference_v1', {
      p_actor_user_id: uid,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansAssetReference>(data);
  },

  /** EPIC 5 — claims, governed targets, disregard candidates and none declarations. */
  async deductions(assessmentId: string): Promise<BnMeansQueryResult<BnMeansDeductionDetail>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_deductions_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansDeductionDetail>(data);
  },

  /** EPIC 5 — backend-owned deduction readiness. Never recomputed in React. */
  async deductionReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansDeductionReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_deduction_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansDeductionReadiness>(data);
  },

  /** EPIC 5 — policy-governed deduction lists (categories, reasons, sources). */
  async deductionReference(): Promise<BnMeansQueryResult<BnMeansDeductionReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_deduction_reference_v1', {
      p_actor_user_id: uid,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansDeductionReference>(data);
  },

  /** EPIC 6 — requirements, linked documents, information requests and responses. */
  async evidence(assessmentId: string): Promise<BnMeansQueryResult<BnMeansEvidenceDetail>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_evidence_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansEvidenceDetail>(data);
  },

  /** EPIC 6 — backend-owned evidence readiness. Never recomputed in React. */
  async evidenceReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansEvidenceReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_evidence_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansEvidenceReadiness>(data);
  },

  /** EPIC 6 — policy-governed evidence lists (types, sources, usability, requests). */
  async evidenceReference(): Promise<BnMeansQueryResult<BnMeansEvidenceReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_evidence_reference_v1', {
      p_actor_user_id: uid,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansEvidenceReference>(data);
  },

  /**
   * EPIC 6 — governed search over documents that already exist for this
   * assessment's claim. No new document store; file locations are never
   * returned to the browser.
   */
  async documentSearch(
    assessmentId: string,
    term: string,
    limit = 25,
  ): Promise<BnMeansQueryResult<readonly BnMeansDocumentCandidate[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_document_search_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
      p_term: term,
      p_limit: limit,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansDocumentCandidate[]>(data);
  },



  /**
   * EPIC 7 — the single authoritative submission-readiness boundary.
   * React never recomputes final readiness; the same rules are re-run by
   * the governed submission command before anything is frozen.
   */
  async submissionReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansSubmissionReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_submission_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansSubmissionReadiness>(data);
  },

  /** EPIC 7 — backend-owned review aggregation for the Review surface. */
  async reviewSummary(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansReviewSummary>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_review_summary_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansReviewSummary>(data);
  },

  /** EPIC 8 — policy-governed verification lists (outcomes, reasons, responses). */
  async verificationReference(): Promise<BnMeansQueryResult<BnMeansVerificationReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_verification_reference_v1', {
      p_actor_user_id: uid,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansVerificationReference>(data);
  },

  /**
   * EPIC 8 — the verification workspace for one assessment: frozen version
   * header, per-fact cards with supporting evidence, clarification state and
   * the backend-decided allowed actions. React never derives availability.
   */
  async verificationWorkspace(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansVerificationWorkspace>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_verification_workspace_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansVerificationWorkspace>(data);
  },

  /** EPIC 8 — authoritative verification readiness. Never recomputed in React. */
  async verificationReadiness(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansVerificationReadiness>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_verification_readiness_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansVerificationReadiness>(data);
  },

  /** EPIC 8 — verification queue. Scope and counts are decided server-side. */
  async verificationQueue(
    filters: { scope?: BnMeansVerificationQueueScope; benefit_programme?: string; search?: string } = {},
    limit = 50,
    offset = 0,
  ): Promise<BnMeansQueryResult<readonly BnMeansVerificationQueueRow[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_verification_queue_v1', {
      p_actor_user_id: uid,
      p_filters: filters as never,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansVerificationQueueRow[]>(data);
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
      p_filters: {} as never,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return failed(error.message);
    return envelope<readonly Record<string, unknown>[]>(data);
  },

  /**
   * EPIC 10 — the whole post-calculation decision pack in one governed
   * read: journey, approval readiness, current and superseded calculation,
   * adjustment register, decision history and the reason catalogue.
   */
  async decisionContext(
    assessmentId: string,
  ): Promise<BnMeansQueryResult<BnMeansDecisionContext>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_decision_context_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansDecisionContext>(data);
  },

  /** EPIC 10 — governed adjustment targets and reason catalogue. */
  async adjustmentReference(
    assessmentId?: string | null,
  ): Promise<BnMeansQueryResult<BnMeansAdjustmentReference>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_adjustment_reference_v1', {
      p_actor_user_id: uid,
      p_assessment_id: assessmentId ?? null,
    });
    if (error) return failed(error.message);
    return envelope<BnMeansAdjustmentReference>(data);
  },

  /** EPIC 10 — the five governed decision queues with backend filtering. */
  async decisionQueues(
    queueCode: BnMeansDecisionQueueCode,
    filters: BnMeansDecisionQueueFilters = {},
    limit = 50,
    offset = 0,
  ): Promise<BnMeansQueryResult<readonly BnMeansDecisionQueueRow[]>> {
    const uid = await actorId();
    if (!uid) return failed('No authenticated actor', 'UNAUTHENTICATED');
    const { data, error } = await supabase.rpc('bn_means_queues_v1', {
      p_actor_user_id: uid,
      p_queue_code: queueCode,
      p_filters: filters as never,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) return failed(error.message);
    return envelope<readonly BnMeansDecisionQueueRow[]>(data);
  },
};


