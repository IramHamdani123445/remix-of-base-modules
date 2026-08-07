/**
 * MEANS-TEST EPIC 3 — income assessment contract.
 *
 * The browser never decides whether the income section is complete, and it
 * never annualises money: `bn_means_income_readiness_v1` owns completeness
 * and `bn_means_execute_command_v1` owns the normalised annual amount.
 * The helpers below only stop obviously invalid input from being dispatched
 * and translate backend reason codes into officer-readable wording.
 */

import type { BnMeansOption, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';

export type BnMeansIncomeSectionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETE'
  | 'BLOCKED'
  | 'UNAVAILABLE';

/** Category metadata is policy-governed and arrives from the backend. */
export interface BnMeansIncomeCategoryOption extends BnMeansOption {
  readonly requires_employer?: boolean;
  readonly requires_source_name?: boolean;
  readonly basis_choice?: boolean;
  readonly fixed_basis?: 'GROSS' | 'NET';
  readonly allow_one_off?: boolean;
  readonly evidence_normally_required?: boolean;
  readonly benefit_source_available?: boolean;
}

export interface BnMeansIncomeReference {
  readonly INCOME_CATEGORY: readonly (BnMeansIncomeCategoryOption & { value: string; label: string })[];
  readonly INCOME_FREQUENCY: readonly (BnMeansOption & { periods_per_year: number })[];
  readonly INCOME_BASIS: readonly BnMeansOption[];
  readonly INCOME_FACT_SOURCE: readonly BnMeansOption[];
  readonly NO_INCOME_REASON: readonly BnMeansOption[];
}

export interface BnMeansIncomeFact {
  readonly income_fact_id: string;
  readonly member_id: string | null;
  readonly member_name: string | null;
  readonly member_relationship: string | null;
  readonly member_is_current: boolean | null;
  readonly category_code: string;
  readonly category_label: string;
  readonly income_source: string | null;
  readonly source_name: string | null;
  readonly employer_regno: string | null;
  readonly employer_name: string | null;
  readonly employer_status: string | null;
  readonly basis: string;
  readonly basis_label: string;
  readonly declared_amount: number;
  readonly declared_frequency: string;
  readonly declared_frequency_label: string;
  readonly currency_code: string;
  readonly normalised_annual_amount: number;
  readonly annualisation_method: string;
  readonly is_one_off: boolean;
  readonly occurrence_date: string | null;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly fact_source: string;
  readonly fact_source_label: string;
  readonly evidence_status: string;
  readonly verification_status: string;
  readonly income_notes: string | null;
  readonly fact_version: number;
  readonly supersedes_fact_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BnMeansNoIncomeDeclaration {
  readonly declaration_id: string;
  readonly member_id: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly declaration_source: string;
  readonly declaration_source_label: string;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly confirmation_note: string | null;
  readonly declared_at: string;
}

export interface BnMeansIncomeRules {
  readonly require_declaration_for_every_member?: boolean;
  readonly allow_household_level_income?: boolean;
  readonly allow_negative_income?: boolean;
  readonly allow_foreign_currency?: boolean;
  readonly duplicate_treatment?: 'WARN' | 'BLOCK';
}

export interface BnMeansIncomeMemberRef {
  readonly member_id: string;
  readonly display_name: string;
  readonly relationship_label: string;
  readonly is_current: boolean;
  readonly member_from: string;
  readonly member_to: string | null;
  readonly dependency_decision_label: string;
}

export interface BnMeansIncomeDetail {
  readonly assessment_id: string;
  readonly editable: boolean;
  readonly currency_code: string;
  readonly assessment_from: string;
  readonly assessment_to: string | null;
  readonly income_rules: BnMeansIncomeRules;
  readonly household_members: readonly BnMeansIncomeMemberRef[];
  readonly facts: readonly BnMeansIncomeFact[];
  readonly no_income_declarations: readonly BnMeansNoIncomeDeclaration[];
}

export interface BnMeansIncomeIssue {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansIncomeReadiness {
  readonly assessment_id: string;
  readonly section_complete: boolean;
  readonly section_status: Exclude<BnMeansIncomeSectionStatus, 'UNAVAILABLE'>;
  readonly section_marked_complete: boolean;
  readonly current_income_count: number;
  readonly household_members_total: number;
  readonly members_with_income: number;
  readonly members_with_no_income_declaration: number;
  readonly members_without_declaration: number;
  readonly declared_annualised_total: number;
  readonly currency_code: string;
  readonly missing_requirements: readonly { code: string; label: string }[];
  readonly warnings: readonly BnMeansIncomeIssue[];
  readonly blockers: readonly BnMeansIncomeIssue[];
  readonly reason_codes: readonly string[];
}

export interface BnMeansEmployerRecord {
  readonly employer_regno: string;
  readonly employer_name: string;
  readonly trade_name: string | null;
  readonly employer_status: string;
}

export interface BnMeansContributionRecord {
  readonly employer_regno: string | null;
  readonly employer_name: string;
  readonly employer_status: string;
  readonly period: string | null;
  readonly total_wages: number;
  readonly data_source: string;
  readonly last_loaded_at: string | null;
}

export interface BnMeansIncomeContext {
  readonly assessment_id: string;
  readonly member_id: string;
  readonly has_person_record: boolean;
  readonly contribution_records: readonly BnMeansContributionRecord[];
  readonly contribution_state: 'SUCCESS' | 'EMPTY' | 'NOT_APPLICABLE';
  readonly benefit_sources: readonly Record<string, unknown>[];
  readonly benefit_state: string;
}

/** Officer-readable wording for every backend income reason code. */
export const BN_MEANS_INCOME_REASON_LABEL: Record<string, string> = {
  INCOME_CATEGORY_REQUIRED: 'Select an income category from the governed list.',
  INCOME_MEMBER_REQUIRED: 'Select the household member who receives this income.',
  INCOME_AMOUNT_REQUIRED: 'Enter the declared amount.',
  INCOME_FREQUENCY_REQUIRED: 'Select how often this income is received.',
  INCOME_BASIS_REQUIRED: 'Record whether the amount is gross or net.',
  INCOME_SOURCE_REQUIRED: 'Identify the source of this income.',
  INCOME_FACT_SOURCE_REQUIRED: 'Record where this information came from.',
  INCOME_START_REQUIRED: 'Enter the date this income started.',
  EMPLOYER_REQUIRED: 'Select the employer for employment income.',
  INVALID_INCOME_PERIOD: 'The end date cannot be before the start date.',
  INCOME_OUTSIDE_ASSESSMENT_PERIOD: 'This income period falls outside the assessment period.',
  INCOME_OUTSIDE_HOUSEHOLD_MEMBERSHIP: 'This income period falls outside the member’s household membership.',
  NEGATIVE_INCOME_NOT_PERMITTED: 'A negative income amount is not permitted by the policy.',
  ONE_OFF_NOT_PERMITTED: 'One-off income is not permitted for this category.',
  CURRENCY_MISMATCH: 'The amount must be recorded in the assessment currency.',
  FOREIGN_CURRENCY_NOT_SUPPORTED:
    'Foreign-currency income cannot be recorded — no exchange-rate policy is configured.',
  DUPLICATE_INCOME: 'An identical income record already exists for this member and source.',
  OVERLAPPING_INCOME: 'Another income record for the same member and source overlaps this period.',
  CONFLICTING_INCOME_FACT: 'This record conflicts with information already held for the member.',
  DUPLICATE_NO_INCOME_DECLARATION: 'A no-income declaration already exists for this member.',
  INVALID_NO_INCOME_REASON: 'Select a reason from the governed list.',
  MEMBER_NOT_FOUND: 'That person is not a household member on this assessment.',
  MEMBER_INCOME_DECLARATION_MISSING:
    'Every household member needs either an income record or an explicit no-income declaration.',
  HOUSEHOLD_SECTION_INCOMPLETE: 'Complete the household composition before completing income.',
  NO_HOUSEHOLD_MEMBERS: 'No household members are recorded for this assessment.',
  INCOME_FACT_NOT_FOUND: 'That income record no longer exists.',
  INCOME_VALIDATION_FAILED: 'The income record could not be validated.',
  SECTION_NOT_READY: 'The backend does not yet report this section as complete.',
};

export function incomeReasonLabel(code: string): string {
  return BN_MEANS_INCOME_REASON_LABEL[code] ?? code;
}

/* ------------------------------------------------------------------ */
/* draft                                                               */
/* ------------------------------------------------------------------ */

export interface BnMeansIncomeDraft {
  incomeFactId?: string | null;
  memberId: string;
  categoryCode: string;
  employerRegno: string;
  employerName: string;
  employerStatus: string;
  sourceName: string;
  basis: string;
  amount: string;
  frequency: string;
  occurrenceDate: string;
  effectiveFrom: string;
  effectiveTo: string;
  factSource: string;
  notes: string;
}

export function emptyIncomeDraft(defaultFrom: string): BnMeansIncomeDraft {
  return {
    incomeFactId: null,
    memberId: '',
    categoryCode: '',
    employerRegno: '',
    employerName: '',
    employerStatus: '',
    sourceName: '',
    basis: '',
    amount: '',
    frequency: '',
    occurrenceDate: '',
    effectiveFrom: defaultFrom,
    effectiveTo: '',
    factSource: '',
    notes: '',
  };
}

export function draftFromIncomeFact(fact: BnMeansIncomeFact): BnMeansIncomeDraft {
  return {
    incomeFactId: fact.income_fact_id,
    memberId: fact.member_id ?? '',
    categoryCode: fact.category_code,
    employerRegno: fact.employer_regno ?? '',
    employerName: fact.employer_name ?? '',
    employerStatus: fact.employer_status ?? '',
    sourceName: fact.source_name ?? '',
    basis: fact.basis ?? '',
    amount: fact.declared_amount === null ? '' : String(fact.declared_amount),
    frequency: fact.declared_frequency,
    occurrenceDate: fact.occurrence_date ?? '',
    effectiveFrom: fact.effective_from,
    effectiveTo: fact.effective_to ?? '',
    factSource: fact.fact_source,
    notes: fact.income_notes ?? '',
  };
}

export function findIncomeCategory(
  reference: BnMeansIncomeReference | null,
  code: string,
): BnMeansIncomeCategoryOption | null {
  if (!reference || !code) return null;
  return reference.INCOME_CATEGORY.find((c) => c.value === code) ?? null;
}

/** Basis is derived from policy when the category does not offer a choice. */
export function resolveIncomeBasis(
  category: BnMeansIncomeCategoryOption | null,
  chosen: string,
): { value: string; readOnly: boolean } {
  if (category && category.basis_choice !== true) {
    return { value: category.fixed_basis ?? 'GROSS', readOnly: true };
  }
  return { value: chosen, readOnly: false };
}

export function optionSetFrom(
  options: readonly BnMeansOption[] | undefined,
  state: BnMeansOptionSet['state'],
  reason?: string,
): BnMeansOptionSet {
  return { state, options: options ?? [], reason };
}

/** Field-level errors evaluated before dispatch. Never a substitute for the backend. */
export function validateIncomeDraft(
  draft: BnMeansIncomeDraft,
  context: {
    category: BnMeansIncomeCategoryOption | null;
    rules?: BnMeansIncomeRules;
    assessmentFrom?: string | null;
    assessmentTo?: string | null;
    member?: BnMeansIncomeMemberRef | null;
  },
): Record<string, string> {
  const errors: Record<string, string> = {};
  const rules = context.rules ?? {};

  if (!draft.memberId && rules.allow_household_level_income !== true) {
    errors.memberId = incomeReasonLabel('INCOME_MEMBER_REQUIRED');
  }
  if (!draft.categoryCode) {
    errors.categoryCode = incomeReasonLabel('INCOME_CATEGORY_REQUIRED');
  }
  if (context.category?.requires_employer && !draft.employerRegno) {
    errors.employer = incomeReasonLabel('EMPLOYER_REQUIRED');
  }
  if (context.category?.requires_source_name && !draft.sourceName.trim()) {
    errors.sourceName = incomeReasonLabel('INCOME_SOURCE_REQUIRED');
  }
  const basis = resolveIncomeBasis(context.category, draft.basis);
  if (!basis.value) {
    errors.basis = incomeReasonLabel('INCOME_BASIS_REQUIRED');
  }
  if (!draft.amount.trim()) {
    errors.amount = incomeReasonLabel('INCOME_AMOUNT_REQUIRED');
  } else if (draft.amount.trim().startsWith('-') && rules.allow_negative_income !== true) {
    errors.amount = incomeReasonLabel('NEGATIVE_INCOME_NOT_PERMITTED');
  }
  if (!draft.frequency) {
    errors.frequency = incomeReasonLabel('INCOME_FREQUENCY_REQUIRED');
  } else if (
    draft.frequency === 'ONE_OFF' &&
    context.category &&
    context.category.allow_one_off !== true
  ) {
    errors.frequency = incomeReasonLabel('ONE_OFF_NOT_PERMITTED');
  }
  if (!draft.factSource) {
    errors.factSource = incomeReasonLabel('INCOME_FACT_SOURCE_REQUIRED');
  }
  if (!draft.effectiveFrom) {
    errors.effectiveFrom = incomeReasonLabel('INCOME_START_REQUIRED');
  }
  if (draft.effectiveTo && draft.effectiveFrom && draft.effectiveTo < draft.effectiveFrom) {
    errors.effectiveTo = incomeReasonLabel('INVALID_INCOME_PERIOD');
  }
  if (
    draft.effectiveFrom &&
    context.assessmentTo &&
    draft.effectiveFrom > context.assessmentTo
  ) {
    errors.effectiveFrom = incomeReasonLabel('INCOME_OUTSIDE_ASSESSMENT_PERIOD');
  }
  if (
    draft.effectiveTo &&
    context.assessmentFrom &&
    draft.effectiveTo < context.assessmentFrom
  ) {
    errors.effectiveTo = incomeReasonLabel('INCOME_OUTSIDE_ASSESSMENT_PERIOD');
  }
  const member = context.member;
  if (member && draft.effectiveFrom) {
    if (
      draft.effectiveFrom < member.member_from ||
      (member.member_to && draft.effectiveFrom > member.member_to) ||
      (member.member_to && draft.effectiveTo && draft.effectiveTo > member.member_to)
    ) {
      errors.effectiveFrom = incomeReasonLabel('INCOME_OUTSIDE_HOUSEHOLD_MEMBERSHIP');
    }
  }
  return errors;
}

/** Command payload. Derived values (annualisation) are never posted. */
export function incomePayload(
  draft: BnMeansIncomeDraft,
  context: { category: BnMeansIncomeCategoryOption | null; currency: string },
): Record<string, unknown> {
  const basis = resolveIncomeBasis(context.category, draft.basis);
  const oneOff = draft.frequency === 'ONE_OFF';
  const payload: Record<string, unknown> = {
    member_id: draft.memberId || null,
    category_code: draft.categoryCode,
    source_name: draft.sourceName.trim() || null,
    basis: basis.value,
    declared_amount: draft.amount.trim(),
    declared_frequency: draft.frequency,
    currency_code: context.currency,
    effective_from: draft.effectiveFrom,
    effective_to: oneOff ? null : draft.effectiveTo || null,
    occurrence_date: oneOff ? draft.occurrenceDate || draft.effectiveFrom : null,
    fact_source: draft.factSource,
    income_notes: draft.notes.trim() || null,
  };
  if (context.category?.requires_employer && draft.employerRegno) {
    payload.employer_regno = draft.employerRegno;
    payload.employer_snapshot = {
      employer_name: draft.employerName,
      employer_status: draft.employerStatus,
    };
  }
  if (draft.incomeFactId) payload.income_fact_id = draft.incomeFactId;
  return payload;
}
