/**
 * BN Means-Test — EPIC 9 Calculation and Explanation.
 *
 * Pure contract types and presentation helpers. Every number, treatment and
 * readiness verdict is produced by the governed backend engine; nothing in
 * this file recomputes eligibility, thresholds or money.
 */

export type BnMeansCalculationGroupCode =
  | 'HOUSEHOLD'
  | 'INCOME'
  | 'DEDUCTION'
  | 'ASSET'
  | 'SUMMARY'
  | 'THRESHOLD'
  | 'RESULT';

export type BnMeansCalculationTreatment =
  | 'INCLUDED'
  | 'COUNTED'
  | 'ALLOWED'
  | 'NOT_ALLOWED'
  | 'DISREGARD_APPLIED'
  | 'EXCLUDED_REJECTED'
  | 'EXCLUDED_NOT_APPLICABLE'
  | 'TOTAL'
  | 'THRESHOLD'
  | 'PASS'
  | 'FAIL';

export interface BnMeansCalculationLine {
  readonly line_id: string;
  readonly line_no: number;
  readonly group_code: BnMeansCalculationGroupCode | string | null;
  readonly display_order: number | null;
  readonly business_label: string | null;
  readonly member_label: string | null;
  readonly treatment_code: BnMeansCalculationTreatment | string | null;
  readonly explanation: string | null;
  readonly policy_rule_code: string | null;
  readonly claimed_amount: number | string | null;
  readonly normalised_amount: number | string | null;
  readonly disregard_amount: number | string | null;
  readonly applied_amount: number | string | null;
  readonly included: boolean | null;
  readonly exclusion_reason: string | null;
  readonly narrative: string | null;
  readonly category_code: string | null;
}

export interface BnMeansCalculationRecord {
  readonly calculation_id: string;
  readonly sequence_no: number;
  readonly result: string | null;
  readonly currency_code: string | null;
  readonly gross_income: number | string | null;
  readonly income_disregard_total: number | string | null;
  readonly claimed_deductions: number | string | null;
  readonly approved_deductions: number | string | null;
  readonly assessable_income: number | string | null;
  readonly gross_assets: number | string | null;
  readonly asset_disregard_total: number | string | null;
  readonly assessable_assets: number | string | null;
  readonly asset_threshold_amount: number | string | null;
  readonly household_size: number | null;
  readonly threshold_amount: number | string | null;
  readonly excess_amount: number | string | null;
  readonly shortfall_amount: number | string | null;
  readonly excluded_fact_count: number | null;
  readonly warnings: readonly Record<string, unknown>[] | null;
  readonly input_hash: string | null;
  readonly result_hash: string | null;
  readonly engine_version: string | null;
  readonly policy_version_id: string | null;
  readonly policy_parameters: Record<string, unknown> | null;
  readonly verification_revision_hash: string | null;
  readonly trigger_reason: string | null;
  readonly calculated_at: string | null;
  readonly calculated_by: string | null;
  readonly supersedes_calculation_id: string | null;
  readonly is_current: boolean | null;
}

export interface BnMeansCalculationHistoryRow {
  readonly calculation_id: string;
  readonly sequence_no: number;
  readonly result: string | null;
  readonly assessable_income: number | string | null;
  readonly threshold_amount: number | string | null;
  readonly excess_amount: number | string | null;
  readonly calculated_at: string | null;
  readonly trigger_reason: string | null;
  readonly is_current: boolean | null;
  readonly superseded_at: string | null;
}

export interface BnMeansCalculationBlocker {
  readonly code: string;
  readonly message?: string;
  readonly parameter?: string;
}

export interface BnMeansCalculationReadinessV9 {
  readonly assessment_id: string;
  readonly assessment_version_id: string | null;
  readonly status: string;
  readonly currency_code: string | null;
  readonly ready_for_calculation: boolean;
  readonly blockers: readonly BnMeansCalculationBlocker[];
  readonly reason_codes: readonly string[];
  readonly missing_verifications: readonly { fact_kind: string; fact_id: string }[];
  readonly rejected_facts: readonly { fact_kind: string; fact_id: string }[];
  readonly clarification_required: readonly { fact_kind: string; fact_id: string }[];
  readonly policy_configuration_issues: readonly BnMeansCalculationBlocker[];
  readonly currency_issues: readonly Record<string, unknown>[];
  readonly policy_parameters: Record<string, unknown> | null;
  readonly verification_complete: boolean;
  readonly verification_marked_complete: boolean;
  readonly verification_outcome: string | null;
  readonly verification_revision_hash: string | null;
  readonly has_calculation: boolean;
  readonly current_calculation_id: string | null;
  readonly calculation_current: boolean;
  readonly calculation_stale: boolean;
}

export interface BnMeansCalculationWorkspace {
  readonly assessment_id: string;
  readonly readiness: BnMeansCalculationReadinessV9;
  readonly calculation: BnMeansCalculationRecord | null;
  readonly calculation_current: boolean;
  readonly lines: readonly BnMeansCalculationLine[];
  readonly history: readonly BnMeansCalculationHistoryRow[];
}

export const BN_MEANS_CALC_GROUP_LABEL: Readonly<Record<string, string>> = {
  HOUSEHOLD: 'Household counted',
  INCOME: 'Income considered',
  DEDUCTION: 'Deductions claimed',
  ASSET: 'Assets considered',
  SUMMARY: 'How the assessed means was reached',
  THRESHOLD: 'Threshold applied',
  RESULT: 'Outcome',
};

export const BN_MEANS_CALC_GROUP_ORDER: readonly string[] = [
  'HOUSEHOLD',
  'INCOME',
  'DEDUCTION',
  'ASSET',
  'SUMMARY',
  'THRESHOLD',
  'RESULT',
];

export const BN_MEANS_TREATMENT_LABEL: Readonly<Record<string, string>> = {
  INCLUDED: 'Counted in full',
  COUNTED: 'Counted',
  ALLOWED: 'Allowed',
  NOT_ALLOWED: 'Not allowed',
  DISREGARD_APPLIED: 'Disregarded',
  EXCLUDED_REJECTED: 'Excluded — rejected at verification',
  EXCLUDED_NOT_APPLICABLE: 'Excluded — not applicable',
  TOTAL: 'Total',
  THRESHOLD: 'Threshold',
  PASS: 'Within threshold',
  FAIL: 'Above threshold',
};

/** Plain-language wording for every readiness blocker the engine can raise. */
export const BN_MEANS_CALC_BLOCKER_LABEL: Readonly<Record<string, string>> = {
  ASSESSMENT_NOT_FOUND: 'This assessment could not be found.',
  FROZEN_VERSION_MISSING: 'The assessment has not been submitted, so there is nothing to calculate.',
  FROZEN_VERSION_TAMPERED: 'The submitted declaration no longer matches its recorded fingerprint.',
  NO_VERIFICATION_WORK: 'No verification work exists for the submitted declaration.',
  OUTSTANDING_VERIFICATION: 'Some declared facts are still awaiting a verification decision.',
  CLARIFICATION_OUTSTANDING: 'Some facts are waiting on a clarification response.',
  OPEN_CLARIFICATION_REQUEST: 'Blocking clarification requests remain open.',
  VERIFICATION_NOT_COMPLETED: 'Verification has not been marked complete.',
  POLICY_VERSION_MISSING: 'No policy version is bound to this assessment.',
  POLICY_PARAMETER_MISSING: 'The policy version is missing a required threshold setting.',
  POLICY_NOT_EFFECTIVE: 'The bound policy version is not effective on the assessment date.',
  CURRENCY_MISMATCH: 'Some declared items are recorded in a different currency to the assessment.',
  NO_ASSESSABLE_FACTS: 'The submitted declaration contains nothing to assess.',
};

export function meansCalcBlockerText(blocker: BnMeansCalculationBlocker): string {
  return (
    blocker.message ??
    BN_MEANS_CALC_BLOCKER_LABEL[blocker.code] ??
    blocker.code.replace(/_/g, ' ').toLowerCase()
  );
}

export function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface BnMeansCalculationGroup {
  readonly code: string;
  readonly label: string;
  readonly lines: readonly BnMeansCalculationLine[];
}

/** Groups explanation lines for display. Ordering is stable and business-led. */
export function groupCalculationLines(
  lines: readonly BnMeansCalculationLine[],
): readonly BnMeansCalculationGroup[] {
  const buckets = new Map<string, BnMeansCalculationLine[]>();
  for (const line of lines) {
    const code = String(line.group_code ?? 'SUMMARY');
    const bucket = buckets.get(code) ?? [];
    bucket.push(line);
    buckets.set(code, bucket);
  }
  const ordered: BnMeansCalculationGroup[] = [];
  const seen = new Set<string>();
  for (const code of BN_MEANS_CALC_GROUP_ORDER) {
    const bucket = buckets.get(code);
    if (!bucket) continue;
    seen.add(code);
    ordered.push({
      code,
      label: BN_MEANS_CALC_GROUP_LABEL[code] ?? code,
      lines: [...bucket].sort(
        (a, b) => (a.display_order ?? a.line_no) - (b.display_order ?? b.line_no),
      ),
    });
  }
  for (const [code, bucket] of buckets) {
    if (seen.has(code)) continue;
    ordered.push({ code, label: BN_MEANS_CALC_GROUP_LABEL[code] ?? code, lines: bucket });
  }
  return ordered;
}

/**
 * A calculation is only trustworthy while the verification revision it was
 * produced from is still the live one. Staleness is reported by the backend;
 * this helper only chooses the wording.
 */
export function calculationStalenessNotice(
  readiness: BnMeansCalculationReadinessV9 | null,
): string | null {
  if (!readiness || !readiness.has_calculation) return null;
  if (readiness.calculation_current) return null;
  return 'Verification has changed since this calculation was produced. Recalculate before approval.';
}

/** Headline outcome wording. Approval is never implied by a calculation. */
export function calculationOutcomeLabel(result: string | null | undefined): string {
  switch (result) {
    case 'PASS':
      return 'Within threshold — pending independent approval';
    case 'FAIL':
      return 'Above threshold — pending independent approval';
    case 'REFER':
      return 'Referred for review — pending independent approval';
    case 'PROVISIONAL':
      return 'Provisional — pending independent approval';
    default:
      return 'Not yet calculated';
  }
}
