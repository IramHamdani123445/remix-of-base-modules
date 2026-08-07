/**
 * MEANS-TEST EPIC 5 — deductions and disregards contract.
 *
 * This section records WHAT is being claimed, AGAINST WHICH SUBJECT, FOR
 * WHAT REASON and FOR WHAT PERIOD. It never decides how much is allowed,
 * never nets anything off, and never decides whether the household passes
 * the means test: `bn_means_deduction_readiness_v1` owns completeness and
 * `bn_means_execute_command_v1` owns everything that is stored.
 */

import type { BnMeansOption, BnMeansOptionSet, BnMeansLoadState } from '@/types/bn/meansTests/meansFieldContract';

export type BnMeansDeductionSectionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'BLOCKED'
  | 'UNAVAILABLE';

/** A deduction claimed against income/household, or a potential policy disregard. */
export type BnMeansClaimKind = 'DEDUCTION_CLAIM' | 'DISREGARD_CANDIDATE';

export type BnMeansDeductionTargetKind =
  | 'HOUSEHOLD_MEMBER'
  | 'INCOME_FACT'
  | 'ASSET_FACT'
  | 'ASSESSMENT';

/** Category metadata is policy-governed and arrives from the backend. */
export interface BnMeansDeductionCategoryOption extends BnMeansOption {
  readonly claim_kind: BnMeansClaimKind;
  readonly allowed_target_types: readonly BnMeansDeductionTargetKind[];
  readonly requires_amount?: boolean;
  readonly requires_frequency?: boolean;
  readonly requires_period?: boolean;
  readonly requires_evidence?: boolean;
  readonly requires_reason?: boolean;
  readonly allows_partial_claim?: boolean;
  readonly maximum_rule_reference?: string | null;
  readonly verification_required?: boolean;
  readonly calculation_treatment_code?: string;
}

export interface BnMeansDeductionReference {
  readonly DEDUCTION_CATEGORY: readonly BnMeansDeductionCategoryOption[];
  readonly DEDUCTION_FREQUENCY: readonly BnMeansOption[];
  readonly DEDUCTION_REASON: readonly BnMeansOption[];
  readonly DEDUCTION_FACT_SOURCE: readonly BnMeansOption[];
  readonly DEDUCTION_TARGET_KIND: readonly BnMeansOption[];
  readonly NO_DEDUCTION_REASON: readonly BnMeansOption[];
}

export interface BnMeansDeductionClaim {
  readonly deduction_fact_id: string;
  readonly claim_kind: BnMeansClaimKind;
  readonly claim_kind_label: string;
  readonly target_kind: BnMeansDeductionTargetKind;
  readonly target_kind_label: string;
  readonly target_ref_id: string | null;
  readonly target_label: string;
  readonly target_detail: string | null;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly category_code: string;
  readonly category_label: string;
  readonly claimed_amount: number | null;
  readonly claimed_percentage: number | null;
  readonly declared_frequency: string | null;
  readonly declared_frequency_label: string | null;
  readonly claimed_normalised_annual_amount: number | null;
  readonly currency_code: string;
  readonly claim_reason_code: string | null;
  readonly claim_reason_label: string | null;
  readonly claim_basis: string | null;
  readonly fact_source: string;
  readonly fact_source_label: string;
  readonly effective_from: string | null;
  readonly effective_to: string | null;
  readonly evidence_requirement: 'REQUIRED' | 'OPTIONAL' | 'NOT_REQUIRED';
  readonly evidence_status: string;
  readonly linked_evidence_count: number;
  readonly verification_status: string;
  readonly treatment_status: string;
  readonly treatment_status_label: string;
  readonly officer_notes: string | null;
  readonly fact_version: number;
  readonly supersedes_fact_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BnMeansNoDeductionDeclaration {
  readonly declaration_id: string;
  readonly declaration_scope: 'ASSESSMENT' | 'MEMBER';
  readonly member_id: string | null;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly confirmation_note: string | null;
  readonly declaration_source: string;
  readonly declaration_source_label: string;
  readonly declared_at: string;
}

export interface BnMeansDeductionRules {
  readonly none_declaration_scope?: 'ASSESSMENT' | 'MEMBER';
  readonly require_none_declaration_when_no_claims?: boolean;
  readonly duplicate_treatment?: 'WARN' | 'BLOCK';
  readonly allow_assessment_level_claims?: boolean;
  readonly block_when_required_evidence_missing?: boolean;
  readonly disregard_decided_at_calculation?: boolean;
}

export interface BnMeansDeductionMemberRef {
  readonly member_id: string;
  readonly display_name: string;
  readonly relationship_label: string;
  readonly is_current: boolean;
  readonly member_from: string;
  readonly member_to: string | null;
}

export interface BnMeansDeductionIncomeTarget {
  readonly income_fact_id: string;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly category_label: string;
  readonly source_name: string | null;
  readonly declared_amount: number;
  readonly currency_code: string;
  readonly declared_frequency_label: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
}

export interface BnMeansDeductionAssetTarget {
  readonly asset_fact_id: string;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly category_label: string;
  readonly description: string | null;
  readonly valuation_amount: number;
  readonly currency_code: string;
  readonly ownership_share: number;
  readonly valuation_date: string;
}

/** A signal raised in Income/Assets that still needs an officer decision. */
export interface BnMeansDisregardCandidate {
  readonly source_type: 'INCOME' | 'ASSET';
  readonly source_fact_id: string;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly category_code: string;
  readonly category_label: string;
  readonly candidate_label: string;
  readonly declared_amount: number | null;
  readonly currency_code: string;
  readonly candidate_reason_code: string | null;
  readonly candidate_reason_label: string | null;
  readonly claim_recorded: boolean;
  readonly status_label: string;
}

export interface BnMeansDeductionDetail {
  readonly assessment_id: string;
  readonly editable: boolean;
  readonly currency_code: string;
  readonly assessment_from: string;
  readonly assessment_to: string | null;
  readonly deduction_rules: BnMeansDeductionRules;
  readonly household_members: readonly BnMeansDeductionMemberRef[];
  readonly income_targets: readonly BnMeansDeductionIncomeTarget[];
  readonly asset_targets: readonly BnMeansDeductionAssetTarget[];
  readonly claims: readonly BnMeansDeductionClaim[];
  readonly disregard_candidates: readonly BnMeansDisregardCandidate[];
  readonly none_declarations: readonly BnMeansNoDeductionDeclaration[];
}

export interface BnMeansDeductionIssue {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansDeductionReadiness {
  readonly assessment_id: string;
  readonly section_complete: boolean;
  readonly section_status: Exclude<BnMeansDeductionSectionStatus, 'UNAVAILABLE'>;
  readonly section_marked_complete: boolean;
  readonly claim_count: number;
  readonly deduction_claim_count: number;
  readonly disregard_candidate_count: number;
  readonly household_members_total: number;
  readonly household_members_covered: number;
  readonly explicit_none_declaration: boolean;
  readonly none_declaration_scope: 'ASSESSMENT' | 'MEMBER';
  readonly claims_requiring_evidence: number;
  readonly claims_missing_required_information: number;
  readonly gross_claimed_deduction_total: number;
  readonly currency_code: string;
  readonly warnings: readonly BnMeansDeductionIssue[];
  readonly blockers: readonly BnMeansDeductionIssue[];
  readonly reason_codes: readonly string[];
}

/** Officer-readable wording for every backend deduction reason code. */
export const BN_MEANS_DEDUCTION_REASON_LABEL: Record<string, string> = {
  DEDUCTION_CATEGORY_REQUIRED: 'Select a policy category from the governed list.',
  DEDUCTION_TARGET_REQUIRED: 'Select what this deduction is claimed against.',
  DISREGARD_TARGET_REQUIRED: 'Select the record this potential disregard applies to.',
  DEDUCTION_TARGET_NOT_FOUND: 'That record no longer exists on this assessment.',
  DISREGARD_NOT_ALLOWED_FOR_TARGET: 'This category cannot be claimed against that subject.',
  DEDUCTION_AMOUNT_REQUIRED: 'Enter the amount being claimed for this category.',
  INVALID_DEDUCTION_AMOUNT: 'The claimed amount cannot be negative.',
  DEDUCTION_FREQUENCY_REQUIRED: 'Record how often the claimed amount arises.',
  DEDUCTION_REASON_REQUIRED: 'Record why this deduction is being claimed.',
  DISREGARD_REASON_REQUIRED: 'Record the policy basis for this potential disregard.',
  INVALID_DEDUCTION_PERCENTAGE:
    'The claimed proportion must be greater than 0% and no more than 100%, and the category must permit a partial claim.',
  DEDUCTION_START_REQUIRED: 'Enter the date this claim starts from.',
  INVALID_DEDUCTION_PERIOD: 'The end date cannot be before the start date.',
  DEDUCTION_OUTSIDE_ASSESSMENT_PERIOD: 'This claim period falls outside the assessment period.',
  DEDUCTION_OUTSIDE_MEMBER_PERIOD:
    'This claim period falls outside the member’s household membership.',
  DEDUCTION_OUTSIDE_TARGET_PERIOD:
    'This claim period falls outside the period of the record it is claimed against.',
  CURRENCY_MISMATCH: 'The claim must be recorded in the assessment currency.',
  DUPLICATE_DEDUCTION: 'A matching claim already exists for this subject and category.',
  POSSIBLE_DUPLICATE_DEDUCTION:
    'A potentially overlapping claim already exists for this subject and category.',
  CONFLICTING_DEDUCTION:
    'A different disregard basis is already claimed against this record. Withdraw it first.',
  NO_DEDUCTION_DECLARATION_CONFLICT:
    'A “nothing claimed” confirmation is held. Withdraw it before recording a claim.',
  DUPLICATE_NO_DEDUCTION_DECLARATION: 'That “nothing claimed” confirmation already exists.',
  INVALID_NO_DEDUCTION_REASON: 'Select a reason from the governed list.',
  NONE_DECLARATION_REQUIRED:
    'Record either a claim or an explicit confirmation that nothing is claimed. A missing claim is not the same as none.',
  MEMBER_DECLARATION_MISSING:
    'Every household member needs either a claim or an explicit “nothing claimed” confirmation.',
  MEMBER_NOT_FOUND: 'That person is not a household member on this assessment.',
  DEDUCTION_MISSING_INFORMATION: 'Some claims are missing required information.',
  DEDUCTION_EVIDENCE_REQUIRED:
    'Evidence is required for some claims. Evidence is attached in the evidence stage.',
  ASSET_SECTION_INCOMPLETE:
    'Complete the asset assessment before completing deductions and disregards.',
  DEDUCTION_FACT_NOT_FOUND: 'That claim no longer exists.',
  DEDUCTION_VALIDATION_FAILED: 'The claim could not be validated.',
  SECTION_NOT_READY: 'The backend does not yet report this section as complete.',
  MISSING_REQUIRED_INFORMATION: 'Some required information is missing.',
};

export function deductionReasonLabel(code: string): string {
  return BN_MEANS_DEDUCTION_REASON_LABEL[code] ?? code;
}

/* ------------------------------------------------------------------ */
/* draft                                                               */
/* ------------------------------------------------------------------ */

export interface BnMeansDeductionDraft {
  deductionFactId?: string | null;
  claimKind: BnMeansClaimKind;
  categoryCode: string;
  targetKind: BnMeansDeductionTargetKind | '';
  targetRefId: string;
  memberId: string;
  claimedAmount: string;
  claimedPercentage: string;
  declaredFrequency: string;
  claimReasonCode: string;
  claimBasis: string;
  factSource: string;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
}

export function emptyDeductionDraft(
  defaultFrom: string,
  claimKind: BnMeansClaimKind = 'DEDUCTION_CLAIM',
): BnMeansDeductionDraft {
  return {
    deductionFactId: null,
    claimKind,
    categoryCode: '',
    targetKind: '',
    targetRefId: '',
    memberId: '',
    claimedAmount: '',
    claimedPercentage: '',
    declaredFrequency: '',
    claimReasonCode: '',
    claimBasis: '',
    factSource: '',
    effectiveFrom: defaultFrom,
    effectiveTo: '',
    notes: '',
  };
}

export function draftFromDeductionClaim(claim: BnMeansDeductionClaim): BnMeansDeductionDraft {
  return {
    deductionFactId: claim.deduction_fact_id,
    claimKind: claim.claim_kind,
    categoryCode: claim.category_code,
    targetKind: claim.target_kind,
    targetRefId: claim.target_ref_id ?? '',
    memberId: claim.member_id ?? '',
    claimedAmount: claim.claimed_amount === null ? '' : String(claim.claimed_amount),
    claimedPercentage:
      claim.claimed_percentage === null ? '' : String(claim.claimed_percentage),
    declaredFrequency: claim.declared_frequency ?? '',
    claimReasonCode: claim.claim_reason_code ?? '',
    claimBasis: claim.claim_basis ?? '',
    factSource: claim.fact_source,
    effectiveFrom: claim.effective_from ?? '',
    effectiveTo: claim.effective_to ?? '',
    notes: claim.officer_notes ?? '',
  };
}

export function findDeductionCategory(
  reference: BnMeansDeductionReference | null,
  code: string,
): BnMeansDeductionCategoryOption | null {
  if (!reference || !code) return null;
  return reference.DEDUCTION_CATEGORY.find((c) => c.value === code) ?? null;
}

/** Categories offered for the claim type the officer is recording. */
export function categoriesForKind(
  reference: BnMeansDeductionReference | null,
  kind: BnMeansClaimKind,
): readonly BnMeansDeductionCategoryOption[] {
  return (reference?.DEDUCTION_CATEGORY ?? []).filter((c) => c.claim_kind === kind);
}

export function optionSetFrom(
  options: readonly BnMeansOption[] | undefined,
  state: BnMeansLoadState,
  reason?: string,
): BnMeansOptionSet {
  return { state, options: options ?? [], reason };
}

/** Officer-facing preview only. The stored annualised claim is backend-owned. */
export function previewClaimedAnnualAmount(draft: BnMeansDeductionDraft): number | null {
  const amount = Number(draft.claimedAmount);
  if (!draft.claimedAmount.trim() || Number.isNaN(amount)) return null;
  const multipliers: Record<string, number> = {
    WEEKLY: 52,
    FORTNIGHTLY: 26,
    MONTHLY: 12,
    QUARTERLY: 4,
    ANNUAL: 1,
    ANNUALLY: 1,
    ONE_OFF: 1,
    IRREGULAR: 1,
  };
  const multiplier = multipliers[draft.declaredFrequency] ?? 1;
  return Math.round(amount * multiplier * 100) / 100;
}

/** Field-level errors evaluated before dispatch. Never a substitute for the backend. */
export function validateDeductionDraft(
  draft: BnMeansDeductionDraft,
  context: {
    category: BnMeansDeductionCategoryOption | null;
    rules?: BnMeansDeductionRules;
    assessmentFrom?: string | null;
    assessmentTo?: string | null;
    member?: BnMeansDeductionMemberRef | null;
  },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const category = context.category;
  const rules = context.rules ?? {};

  if (!draft.categoryCode || !category) {
    errors.categoryCode = deductionReasonLabel('DEDUCTION_CATEGORY_REQUIRED');
  }

  if (!draft.targetKind) {
    errors.targetKind = deductionReasonLabel(
      draft.claimKind === 'DISREGARD_CANDIDATE'
        ? 'DISREGARD_TARGET_REQUIRED'
        : 'DEDUCTION_TARGET_REQUIRED',
    );
  } else if (category && !category.allowed_target_types.includes(draft.targetKind)) {
    errors.targetKind = deductionReasonLabel('DISREGARD_NOT_ALLOWED_FOR_TARGET');
  } else if (draft.targetKind === 'ASSESSMENT') {
    if (rules.allow_assessment_level_claims === false) {
      errors.targetKind = deductionReasonLabel('DISREGARD_NOT_ALLOWED_FOR_TARGET');
    }
  } else if (!draft.targetRefId) {
    errors.targetRefId = deductionReasonLabel(
      draft.claimKind === 'DISREGARD_CANDIDATE'
        ? 'DISREGARD_TARGET_REQUIRED'
        : 'DEDUCTION_TARGET_REQUIRED',
    );
  }

  if (category?.requires_amount && !draft.claimedAmount.trim()) {
    errors.claimedAmount = deductionReasonLabel('DEDUCTION_AMOUNT_REQUIRED');
  } else if (draft.claimedAmount.trim() && Number(draft.claimedAmount) < 0) {
    errors.claimedAmount = deductionReasonLabel('INVALID_DEDUCTION_AMOUNT');
  }

  if (category?.requires_frequency && !draft.declaredFrequency) {
    errors.declaredFrequency = deductionReasonLabel('DEDUCTION_FREQUENCY_REQUIRED');
  }

  if (category?.requires_reason && !draft.claimReasonCode) {
    errors.claimReasonCode = deductionReasonLabel(
      draft.claimKind === 'DISREGARD_CANDIDATE'
        ? 'DISREGARD_REASON_REQUIRED'
        : 'DEDUCTION_REASON_REQUIRED',
    );
  }

  if (draft.claimedPercentage.trim()) {
    const pct = Number(draft.claimedPercentage);
    if (
      category?.allows_partial_claim !== true ||
      Number.isNaN(pct) ||
      pct <= 0 ||
      pct > 100
    ) {
      errors.claimedPercentage = deductionReasonLabel('INVALID_DEDUCTION_PERCENTAGE');
    }
  }

  if (category?.requires_period && !draft.effectiveFrom) {
    errors.effectiveFrom = deductionReasonLabel('DEDUCTION_START_REQUIRED');
  }
  if (draft.effectiveTo && draft.effectiveFrom && draft.effectiveTo < draft.effectiveFrom) {
    errors.effectiveTo = deductionReasonLabel('INVALID_DEDUCTION_PERIOD');
  }
  if (draft.effectiveFrom && context.assessmentTo && draft.effectiveFrom > context.assessmentTo) {
    errors.effectiveFrom = deductionReasonLabel('DEDUCTION_OUTSIDE_ASSESSMENT_PERIOD');
  }
  if (draft.effectiveTo && context.assessmentFrom && draft.effectiveTo < context.assessmentFrom) {
    errors.effectiveTo = deductionReasonLabel('DEDUCTION_OUTSIDE_ASSESSMENT_PERIOD');
  }

  if (!draft.factSource) {
    errors.factSource = deductionReasonLabel('MISSING_REQUIRED_INFORMATION');
  }

  return errors;
}

/** Command payload. Derived values (annualised claim) are never posted. */
export function deductionPayload(
  draft: BnMeansDeductionDraft,
  context: { currency: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    claim_kind: draft.claimKind,
    category_code: draft.categoryCode,
    target_kind: draft.targetKind,
    target_ref_id: draft.targetKind === 'ASSESSMENT' ? null : draft.targetRefId || null,
    member_id: draft.memberId || null,
    claimed_amount: draft.claimedAmount.trim() || null,
    claimed_percentage: draft.claimedPercentage.trim() || null,
    declared_frequency: draft.declaredFrequency || null,
    currency_code: context.currency,
    claim_reason_code: draft.claimReasonCode || null,
    claim_basis: draft.claimBasis.trim() || null,
    fact_source: draft.factSource,
    effective_from: draft.effectiveFrom || null,
    effective_to: draft.effectiveTo || null,
    officer_notes: draft.notes.trim() || null,
  };
  if (draft.deductionFactId) payload.deduction_fact_id = draft.deductionFactId;
  return payload;
}
