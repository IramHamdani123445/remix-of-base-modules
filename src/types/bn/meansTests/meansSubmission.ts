/**
 * MEANS-TEST EPIC 7 — Review and submission contract.
 *
 * Pure types and presentation helpers. Submission readiness itself is
 * decided ONLY by `bn_means_submission_readiness_v1` and re-decided by the
 * governed submission boundary; nothing here recomputes it.
 */

export type BnMeansReviewSectionCode =
  | 'ASSESSMENT'
  | 'CONTEXT'
  | 'HOUSEHOLD'
  | 'INCOME'
  | 'ASSETS'
  | 'DEDUCTIONS'
  | 'EVIDENCE';

export type BnMeansIssueSeverity = 'BLOCKER' | 'WARNING';

export interface BnMeansSubmissionIssue {
  readonly code: string;
  readonly message: string;
  readonly section?: string;
  readonly severity?: BnMeansIssueSeverity;
}

export interface BnMeansSectionStatus {
  readonly section: BnMeansReviewSectionCode;
  readonly complete: boolean;
  readonly status: 'COMPLETE' | 'BLOCKED';
}

export interface BnMeansDeclarationDefinition {
  readonly declaration_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly statement_text: string;
  readonly statement_version: string;
  readonly required: boolean;
  readonly actor_type: string;
  readonly display_order: number;
  readonly effective_policy_version: string | null;
}

export interface BnMeansSubmissionReadiness {
  readonly assessment_id: string;
  readonly assessment_reference: string;
  readonly status: string;
  readonly can_submit: boolean;
  readonly section_statuses: readonly BnMeansSectionStatus[];
  readonly household_complete: boolean;
  readonly income_complete: boolean;
  readonly assets_complete: boolean;
  readonly deductions_complete: boolean;
  readonly evidence_complete: boolean;
  readonly open_blocking_information_requests: number;
  readonly unresolved_data_conflicts: number;
  readonly policy_status: string;
  readonly policy_version_id: string | null;
  readonly required_declarations: readonly BnMeansDeclarationDefinition[];
  readonly warnings: readonly BnMeansSubmissionIssue[];
  readonly blockers: readonly BnMeansSubmissionIssue[];
  readonly reason_codes: readonly string[];
  readonly expected_row_version: number;
  readonly already_submitted: boolean;
}

export interface BnMeansReviewHouseholdMember {
  readonly display_name: string;
  readonly relationship_code: string;
  readonly member_from: string;
  readonly member_to: string | null;
  readonly is_dependant: boolean;
}

export interface BnMeansReviewSummary {
  readonly context: Record<string, unknown>;
  readonly household: {
    readonly total_members: number;
    readonly current_members: number;
    readonly ended_members: number;
    readonly dependants: number;
    readonly members: readonly BnMeansReviewHouseholdMember[];
  } | null;
  readonly income: {
    readonly fact_count: number;
    readonly members_with_income: number;
    readonly declared_annualised_income: number;
    readonly no_income_declarations: number;
  } | null;
  readonly assets: {
    readonly asset_count: number;
    readonly declared_valuation: number;
    readonly possible_disregards: number;
    readonly no_asset_declarations: number;
  } | null;
  readonly deductions: {
    readonly claim_count: number;
    readonly possible_disregard_count: number;
    readonly claimed_total: number;
    readonly evidence_required_count: number;
  } | null;
  readonly evidence: {
    readonly mandatory_total: number;
    readonly mandatory_satisfied: number;
    readonly mandatory_outstanding: number;
    readonly unusable_document_count: number;
    readonly open_information_requests: number;
    readonly overdue_information_requests: number;
    readonly section_status: string | null;
  } | null;
  readonly submission: {
    readonly submitted_at: string | null;
    readonly submitted_by: string | null;
    readonly frozen_version: Record<string, unknown> | null;
    readonly verification_work_count: number;
    readonly declarations: readonly Record<string, unknown>[];
    readonly acknowledgement: Record<string, unknown> | null;
  } | null;
  readonly timeline: readonly Record<string, unknown>[];
}

/** Officer-readable section names. Never show the raw code as the headline. */
export const BN_MEANS_REVIEW_SECTION_LABEL: Record<string, string> = {
  ASSESSMENT: 'Assessment',
  CONTEXT: 'Assessment context',
  HOUSEHOLD: 'Household',
  INCOME: 'Income',
  ASSETS: 'Assets',
  DEDUCTIONS: 'Deductions',
  EVIDENCE: 'Evidence',
};

/** Workspace tab that can actually resolve an issue raised on a section. */
export const BN_MEANS_SECTION_TAB: Record<string, string> = {
  ASSESSMENT: 'context',
  CONTEXT: 'context',
  HOUSEHOLD: 'household',
  INCOME: 'income',
  ASSETS: 'assets',
  DEDUCTIONS: 'deductions',
  EVIDENCE: 'evidence',
};

/** Officer-readable milestone wording for the assessment timeline. */
export const BN_MEANS_TIMELINE_LABEL: Record<string, string> = {
  CREATED: 'Assessment created',
  CONTEXT_CORRECTED: 'Assessment context corrected',
  FACT_RECORDED: 'Assessment information recorded',
  SECTION_COMPLETED: 'Section marked complete',
  HOUSEHOLD_COMPLETED: 'Household completed',
  INCOME_COMPLETED: 'Income completed',
  ASSETS_COMPLETED: 'Assets completed',
  DEDUCTIONS_COMPLETED: 'Deductions completed',
  EVIDENCE_COMPLETED: 'Evidence completed',
  EVIDENCE_ATTACHED: 'Evidence linked',
  INFORMATION_REQUESTED: 'Information requested',
  INFORMATION_RECEIVED: 'Information received',
  SUBMITTED: 'Assessment submitted',
  VERSION_FROZEN: 'Version frozen',
  VERIFICATION_WORK_CREATED: 'Verification work created',
};

export function timelineLabel(eventCode: string): string {
  return (
    BN_MEANS_TIMELINE_LABEL[eventCode] ??
    eventCode
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^./, (c) => c.toUpperCase())
  );
}

export function reviewSectionLabel(section: string | undefined): string {
  if (!section) return BN_MEANS_REVIEW_SECTION_LABEL.ASSESSMENT;
  return BN_MEANS_REVIEW_SECTION_LABEL[section] ?? BN_MEANS_REVIEW_SECTION_LABEL.ASSESSMENT;
}

export function sectionTabFor(section: string | undefined): string {
  if (!section) return 'context';
  return BN_MEANS_SECTION_TAB[section] ?? 'context';
}

export interface BnMeansIssueGroup {
  readonly section: string;
  readonly label: string;
  readonly tab: string;
  readonly issues: readonly BnMeansSubmissionIssue[];
}

/** Groups blockers (or warnings) by the section that can resolve them. */
export function groupIssuesBySection(
  issues: readonly BnMeansSubmissionIssue[],
): readonly BnMeansIssueGroup[] {
  const order = ['HOUSEHOLD', 'INCOME', 'ASSETS', 'DEDUCTIONS', 'EVIDENCE', 'ASSESSMENT'];
  const map = new Map<string, BnMeansSubmissionIssue[]>();
  for (const issue of issues) {
    const key = issue.section ?? 'ASSESSMENT';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(issue);
  }
  return [...map.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([section, list]) => ({
      section,
      label: reviewSectionLabel(section),
      tab: sectionTabFor(section),
      issues: list,
    }));
}

/** Declarations the officer must tick before Submit may be enabled. */
export function requiredDeclarationCodes(
  declarations: readonly BnMeansDeclarationDefinition[],
): readonly string[] {
  return declarations.filter((d) => d.required).map((d) => d.declaration_code);
}

export function missingRequiredDeclarations(
  declarations: readonly BnMeansDeclarationDefinition[],
  confirmed: Readonly<Record<string, boolean>>,
): readonly string[] {
  return requiredDeclarationCodes(declarations).filter((code) => !confirmed[code]);
}

/**
 * Builds the declaration payload. The legally significant statement text and
 * its version travel with the confirmation — never only the display label.
 */
export function declarationPayload(
  declarations: readonly BnMeansDeclarationDefinition[],
  confirmed: Readonly<Record<string, boolean>>,
): readonly Record<string, unknown>[] {
  return declarations
    .filter((d) => confirmed[d.declaration_code])
    .map((d) => ({
      declaration_code: d.declaration_code,
      confirmed: true,
      statement_version: d.statement_version,
      statement_text: d.statement_text,
      actor_type: d.actor_type,
    }));
}

export type BnMeansSubmissionUiState =
  | 'LOADING'
  | 'READY'
  | 'BLOCKED'
  | 'DENIED'
  | 'FAILED'
  | 'STALE'
  | 'ALREADY_SUBMITTED';

/**
 * Single decision point for the Review surface state. A failed or denied
 * readiness read can never present as "Ready to submit".
 */
export function resolveSubmissionUiState(input: {
  readonly loading: boolean;
  readonly queryStatus?: string;
  readonly readiness: BnMeansSubmissionReadiness | null;
  readonly stale?: boolean;
}): BnMeansSubmissionUiState {
  if (input.loading) return 'LOADING';
  if (input.queryStatus === 'DENIED') return 'DENIED';
  if (!input.readiness || (input.queryStatus && input.queryStatus !== 'OK')) return 'FAILED';
  if (input.readiness.already_submitted) return 'ALREADY_SUBMITTED';
  if (input.stale) return 'STALE';
  return input.readiness.can_submit ? 'READY' : 'BLOCKED';
}
