/**
 * MEANS-TEST EPIC 10 — adjustments and independent approval contract.
 *
 * These types mirror the live output of the governed backend boundary:
 *   • `bn_means_decision_context_v1`      — the whole decision pack
 *   • `bn_means_adjustment_reference_v1`  — governed target/reason catalogue
 *   • `bn_means_queues_v1`                — the five decision queues
 *
 * Nothing here re-derives readiness, independence, arithmetic or lifecycle.
 * React reads what the backend decided and renders it in business language.
 */

import type { BnMeansOption, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';

/* ------------------------------------------------------------------ */
/* reference catalogue                                                 */
/* ------------------------------------------------------------------ */

export type BnMeansAdjustmentControl = 'MONEY' | 'MONEY_OR_EXCLUDE' | 'PERCENTAGE' | 'DATE' | 'OPTION';

export interface BnMeansAdjustmentTargetKindOption {
  readonly target_kind: string;
  readonly label: string;
  readonly control: BnMeansAdjustmentControl;
  readonly evidence_required: boolean;
  readonly group_code: string | null;
}

export interface BnMeansAdjustmentReasonOption {
  readonly reason_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly target_kinds: readonly string[] | null;
  readonly requires_justification: boolean;
  readonly requires_evidence: boolean;
}

export interface BnMeansDecisionReasonOption {
  readonly decision: 'APPROVE' | 'REJECT';
  readonly reason_code: string;
  readonly label: string;
  readonly description: string | null;
  readonly requires_justification: boolean;
}

export interface BnMeansAdjustmentReference {
  readonly target_kinds: readonly BnMeansAdjustmentTargetKindOption[];
  readonly adjustment_reasons: readonly BnMeansAdjustmentReasonOption[];
  readonly adjustment_decision_reasons: readonly BnMeansDecisionReasonOption[];
  readonly assessment_decision_reasons: readonly BnMeansDecisionReasonOption[];
}

/* ------------------------------------------------------------------ */
/* readiness                                                           */
/* ------------------------------------------------------------------ */

export type BnMeansApprovalState =
  | 'READY'
  | 'BLOCKED'
  | 'DENIED'
  | 'STALE'
  | 'RECALCULATION_PENDING'
  | 'ALREADY_DECIDED'
  | 'FAILED';

export interface BnMeansDecisionBlocker {
  readonly code: string;
  readonly message: string;
}

export interface BnMeansApprovalReadiness {
  readonly ready: boolean;
  readonly state: BnMeansApprovalState;
  readonly blockers: readonly BnMeansDecisionBlocker[];
  readonly reason_codes: readonly string[];
  readonly assessment_status?: string;
  readonly row_version?: number;
  readonly calculation_id?: string | null;
  readonly calculation_hash?: string | null;
  readonly calculation_current?: boolean;
  readonly calculation_stale?: boolean;
  readonly verification_complete?: boolean;
  readonly open_adjustments?: number;
  readonly adjustments_pending_application?: number;
  readonly maker_user_id?: string | null;
  readonly actor_is_maker?: boolean;
  readonly actor_requested_adjustment?: boolean;
  readonly decision_rules?: Readonly<Record<string, unknown>>;
}

/* ------------------------------------------------------------------ */
/* calculation                                                         */
/* ------------------------------------------------------------------ */

/** A `bn_means_calculation` row as serialised by `to_jsonb`. */
export interface BnMeansDecisionCalculation {
  readonly calculation_id: string;
  readonly assessment_id: string;
  readonly assessment_version_id: string | null;
  readonly policy_version_id: string | null;
  readonly sequence_no: number | null;
  readonly is_current: boolean | null;
  readonly currency_code: string | null;
  readonly household_size: number | null;
  readonly assessable_income: number | string | null;
  readonly assessable_assets: number | string | null;
  readonly approved_deductions: number | string | null;
  readonly threshold_amount: number | string | null;
  readonly excess_amount: number | string | null;
  readonly result: string | null;
  readonly warnings: readonly unknown[] | null;
  readonly calculation_hash?: string | null;
  readonly result_hash?: string | null;
  readonly input_hash: string | null;
  readonly effective_date: string | null;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly calculated_at: string | null;
  readonly calculated_by: string | null;
  readonly supersedes_calculation_id: string | null;
  readonly triggering_adjustment_id: string | null;
  readonly trigger_reason: string | null;
}

/** A `bn_means_calculation_line` row, used only for governed target labels. */
export interface BnMeansDecisionLine {
  readonly line_id: string;
  readonly line_no: number | null;
  readonly line_kind: string | null;
  readonly group_code: string | null;
  readonly business_label: string | null;
  readonly member_label: string | null;
  readonly category_code: string | null;
  readonly treatment_code: string | null;
  readonly included: boolean | null;
  readonly applied_amount: number | string | null;
  readonly explanation: string | null;
  readonly fact_kind: string | null;
  readonly fact_id: string | null;
}

export interface BnMeansDecisionHistoryRow {
  readonly calculation_id: string;
  readonly sequence_no: number | null;
  readonly result: string | null;
  readonly assessable_income: number | string | null;
  readonly threshold_amount: number | string | null;
  readonly excess_amount: number | string | null;
  readonly calculated_at: string | null;
  readonly calculated_by_label: string | null;
  readonly trigger_reason: string | null;
  readonly is_current: boolean | null;
  readonly superseded_at: string | null;
  readonly triggering_adjustment_id: string | null;
}

/* ------------------------------------------------------------------ */
/* adjustments and decisions                                           */
/* ------------------------------------------------------------------ */

export type BnMeansAdjustmentState =
  | 'REQUESTED'
  | 'APPROVED_PENDING_APPLICATION'
  | 'APPROVED'
  | 'REJECTED';

export interface BnMeansDecisionAdjustment {
  readonly adjustment_id: string;
  readonly adjustment_reference: string | null;
  readonly target_kind: string | null;
  readonly target_id: string | null;
  readonly field_or_line_code: string | null;
  readonly target_label: string | null;
  readonly original_value: unknown;
  readonly proposed_value: unknown;
  readonly currency_code: string | null;
  readonly financial_effect: number | string | null;
  readonly reason_code: string | null;
  readonly reason_label: string | null;
  readonly justification: string | null;
  readonly evidence_id: string | null;
  readonly evidence_reference: string | null;
  readonly status: BnMeansAdjustmentState | string;
  readonly requested_by: string | null;
  readonly requested_by_label: string | null;
  readonly requested_at: string | null;
  readonly decided_by: string | null;
  readonly decided_by_label: string | null;
  readonly decided_at: string | null;
  readonly decision_reason_code: string | null;
  readonly decision_reason_label: string | null;
  readonly decision_note: string | null;
  readonly applied_calculation_id: string | null;
  readonly applied_at: string | null;
  readonly application_error: string | null;
  readonly row_version: number;
  readonly resulting_result: string | null;
  readonly resulting_sequence_no: number | null;
  readonly is_requester: boolean;
}

export interface BnMeansDecisionRecord {
  readonly approval_id: string;
  readonly decision: string;
  readonly decision_reason: string | null;
  readonly justification: string | null;
  readonly calculation_id: string | null;
  readonly decided_by: string | null;
  readonly decided_by_label: string | null;
  readonly decided_at: string | null;
}

/* ------------------------------------------------------------------ */
/* journey                                                             */
/* ------------------------------------------------------------------ */

export type BnMeansJourneyState =
  | 'COMPLETE'
  | 'CURRENT'
  | 'BLOCKED'
  | 'PENDING'
  | 'NOT_REQUIRED'
  | 'RECALCULATION_REQUIRED';

export interface BnMeansJourneyStep {
  readonly code: string;
  readonly label: string;
  readonly state: BnMeansJourneyState | string;
}

/* ------------------------------------------------------------------ */
/* decision context                                                    */
/* ------------------------------------------------------------------ */

export interface BnMeansDecisionContext {
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly benefit_programme: string | null;
  readonly status: string;
  readonly row_version: number;
  readonly currency_code: string;
  readonly journey: readonly BnMeansJourneyStep[];
  readonly approval_readiness: BnMeansApprovalReadiness;
  readonly calculation_readiness: Readonly<Record<string, unknown>>;
  readonly calculation: BnMeansDecisionCalculation | null;
  readonly previous_calculation: BnMeansDecisionCalculation | null;
  readonly lines: readonly BnMeansDecisionLine[];
  readonly history: readonly BnMeansDecisionHistoryRow[];
  readonly adjustments: readonly BnMeansDecisionAdjustment[];
  readonly decisions: readonly BnMeansDecisionRecord[];
  readonly maker_label: string | null;
  readonly checker_label: string | null;
  readonly actor_label: string | null;
  readonly valid_from: string | null;
  readonly valid_until: string | null;
  readonly reassessment_due: string | null;
  readonly decided_at: string | null;
  readonly decision_reason_code: string | null;
  readonly decision_justification: string | null;
  readonly reference: BnMeansAdjustmentReference;
}

/* ------------------------------------------------------------------ */
/* queues                                                              */
/* ------------------------------------------------------------------ */

export type BnMeansDecisionQueueCode =
  | 'ADJUSTMENTS_AWAITING_DECISION'
  | 'ADJUSTMENTS_AWAITING_RECALCULATION'
  | 'ASSESSMENTS_AWAITING_APPROVAL'
  | 'ASSESSMENTS_RETURNED_TO_REVIEW'
  | 'ASSESSMENTS_REJECTED';

export interface BnMeansDecisionQueueFilters {
  readonly my_work?: boolean;
  readonly benefit_programme?: string;
  readonly target_kind?: string;
  readonly status?: string;
  readonly requested_from?: string;
  readonly requested_to?: string;
  readonly search?: string;
}

/** Adjustment-shaped queue row. */
export interface BnMeansAdjustmentQueueRow {
  readonly queue_code: 'ADJUSTMENTS_AWAITING_DECISION' | 'ADJUSTMENTS_AWAITING_RECALCULATION';
  readonly adjustment_id: string;
  readonly adjustment_reference: string | null;
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly assessment_status: string | null;
  readonly benefit_programme: string | null;
  readonly target_kind: string | null;
  readonly field_or_line_code: string | null;
  readonly status: string;
  readonly requested_by_label: string | null;
  readonly requested_at: string | null;
  readonly age_days: number | null;
  readonly is_requester: boolean;
  readonly application_error: string | null;
  readonly row_version: number;
}

/** Assessment-shaped queue row. */
export interface BnMeansAssessmentQueueRow {
  readonly queue_code:
    | 'ASSESSMENTS_AWAITING_APPROVAL'
    | 'ASSESSMENTS_RETURNED_TO_REVIEW'
    | 'ASSESSMENTS_REJECTED';
  readonly assessment_id: string;
  readonly assessment_reference: string | null;
  readonly assessment_status: string | null;
  readonly benefit_programme: string | null;
  readonly assessment_reason: string | null;
  readonly person_id: number | null;
  readonly person_label: string | null;
  readonly result: string | null;
  readonly updated_at: string | null;
  readonly age_days: number | null;
  readonly calculated_at: string | null;
  readonly calculation_result: string | null;
  readonly submitted_by_label: string | null;
  readonly verification_complete: boolean | null;
  readonly open_adjustments: number | null;
}

export type BnMeansDecisionQueueRow = BnMeansAdjustmentQueueRow | BnMeansAssessmentQueueRow;

export function isAdjustmentQueueRow(row: BnMeansDecisionQueueRow): row is BnMeansAdjustmentQueueRow {
  return (
    row.queue_code === 'ADJUSTMENTS_AWAITING_DECISION' ||
    row.queue_code === 'ADJUSTMENTS_AWAITING_RECALCULATION'
  );
}

export const BN_MEANS_DECISION_QUEUES: readonly {
  code: BnMeansDecisionQueueCode;
  label: string;
  description: string;
  workType: string;
}[] = [
  {
    code: 'ADJUSTMENTS_AWAITING_DECISION',
    label: 'Adjustments awaiting decision',
    description: 'Requested corrections waiting for an independent checker.',
    workType: 'Adjustment decision',
  },
  {
    code: 'ADJUSTMENTS_AWAITING_RECALCULATION',
    label: 'Approved adjustments awaiting recalculation',
    description: 'Approved corrections whose recalculation has not yet produced a calculation.',
    workType: 'Recalculation',
  },
  {
    code: 'ASSESSMENTS_AWAITING_APPROVAL',
    label: 'Assessments awaiting approval',
    description: 'Calculated assessments pending an independent approval decision.',
    workType: 'Final decision',
  },
  {
    code: 'ASSESSMENTS_RETURNED_TO_REVIEW',
    label: 'Assessments returned to review',
    description: 'Assessments held in review while an adjustment is outstanding.',
    workType: 'Review',
  },
  {
    code: 'ASSESSMENTS_REJECTED',
    label: 'Rejected assessments',
    description: 'Rejected assessments retained with their full decision history.',
    workType: 'Closed',
  },
];

/* ------------------------------------------------------------------ */
/* presentation helpers (formatting only — no business decisions)      */
/* ------------------------------------------------------------------ */

export const BN_MEANS_ADJUSTMENT_STATE_LABEL: Record<string, string> = {
  REQUESTED: 'Requested — awaiting independent decision',
  APPROVED_PENDING_APPLICATION: 'Approved — recalculation pending',
  APPROVED: 'Approved and applied',
  REJECTED: 'Rejected — original calculation stands',
};

export function adjustmentStateLabel(status: string | null | undefined): string {
  if (!status) return 'Unknown';
  return BN_MEANS_ADJUSTMENT_STATE_LABEL[status] ?? status;
}

export const BN_MEANS_APPROVAL_STATE_LABEL: Record<BnMeansApprovalState, string> = {
  READY: 'Ready for decision',
  BLOCKED: 'Decision blocked',
  DENIED: 'Independent checker required',
  STALE: 'Recalculation required',
  RECALCULATION_PENDING: 'Recalculation required',
  ALREADY_DECIDED: 'Already decided',
  FAILED: 'Unavailable',
};

export function approvalStateLabel(state: string | null | undefined): string {
  if (!state) return 'Unavailable';
  return BN_MEANS_APPROVAL_STATE_LABEL[state as BnMeansApprovalState] ?? 'Unavailable';
}

/** Wording required by Epic 10 while a calculation awaits a final decision. */
export function decisionResultLabel(
  assessmentStatus: string | null | undefined,
  hasCalculation: boolean,
): string {
  if (assessmentStatus === 'APPROVED') return 'Approved — not yet active';
  if (assessmentStatus === 'REJECTED') return 'Means-Test assessment rejected';
  if (hasCalculation) return 'Calculated — pending independent approval';
  return 'No current calculation';
}

export function toDecisionAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Presentation-only difference between two backend figures. */
export function presentationDifference(
  after: number | string | null | undefined,
  before: number | string | null | undefined,
): number | null {
  const a = toDecisionAmount(after);
  const b = toDecisionAmount(before);
  if (a === null || b === null) return null;
  return Math.round((a - b) * 100) / 100;
}

/** Adjustment reasons permitted for a target kind, per the backend catalogue. */
export function adjustmentReasonOptions(
  reference: BnMeansAdjustmentReference | null,
  targetKind: string | null,
): BnMeansOptionSet {
  if (!reference) return { state: 'FAILED', options: [], reason: 'The reason catalogue could not be loaded' };
  const options: BnMeansOption[] = reference.adjustment_reasons
    .filter((r) => !targetKind || !r.target_kinds || r.target_kinds.includes(targetKind))
    .map((r) => ({ value: r.reason_code, label: r.label, description: r.description ?? undefined }));
  return { state: options.length > 0 ? 'SUCCESS' : 'EMPTY', options };
}

export function decisionReasonOptions(
  reasons: readonly BnMeansDecisionReasonOption[] | undefined,
  decision: 'APPROVE' | 'REJECT',
): BnMeansOptionSet {
  if (!reasons) return { state: 'FAILED', options: [], reason: 'The reason catalogue could not be loaded' };
  const options: BnMeansOption[] = reasons
    .filter((r) => r.decision === decision)
    .map((r) => ({ value: r.reason_code, label: r.label, description: r.description ?? undefined }));
  return { state: options.length > 0 ? 'SUCCESS' : 'EMPTY', options };
}

/** Governed target choices, built from the backend calculation lines. */
export interface BnMeansAdjustmentTargetChoice {
  readonly value: string;
  readonly label: string;
  readonly originalValue: string | null;
  readonly lineId: string | null;
  readonly fieldOrLineCode: string | null;
}

export function adjustmentTargetChoices(
  context: BnMeansDecisionContext | null,
  targetKind: BnMeansAdjustmentTargetKindOption | null,
): readonly BnMeansAdjustmentTargetChoice[] {
  if (!context || !targetKind) return [];
  if (targetKind.control === 'DATE') {
    const current =
      targetKind.target_kind === 'VALIDITY_PERIOD'
        ? context.calculation?.valid_until ?? context.valid_until
        : context.calculation?.reassessment_due ?? context.reassessment_due;
    return [
      {
        value: targetKind.target_kind,
        label: targetKind.label,
        originalValue: current ?? null,
        lineId: null,
        fieldOrLineCode: targetKind.target_kind,
      },
    ];
  }
  return context.lines
    .filter((line) => !targetKind.group_code || line.group_code === targetKind.group_code)
    .map((line) => ({
      value: line.line_id,
      label: [line.business_label ?? line.category_code ?? 'Calculation item', line.member_label]
        .filter(Boolean)
        .join(' — '),
      originalValue:
        line.applied_amount === null || line.applied_amount === undefined
          ? null
          : String(line.applied_amount),
      lineId: line.line_id,
      fieldOrLineCode: line.category_code ?? line.business_label ?? null,
    }));
}

/* ------------------------------------------------------------------ */
/* decision timeline                                                   */
/* ------------------------------------------------------------------ */

export interface BnMeansDecisionTimelineEvent {
  readonly id: string;
  readonly event: string;
  readonly actor: string | null;
  readonly at: string | null;
  readonly reason: string | null;
  readonly result: string | null;
}

/** Presentation-only assembly of backend records into one business timeline. */
export function buildDecisionTimeline(
  context: BnMeansDecisionContext | null,
): readonly BnMeansDecisionTimelineEvent[] {
  if (!context) return [];
  const events: BnMeansDecisionTimelineEvent[] = [];

  context.history.forEach((h) => {
    events.push({
      id: `calc-${h.calculation_id}`,
      event:
        h.trigger_reason === 'ADJUSTMENT'
          ? `Recalculation completed (version ${h.sequence_no ?? '—'})`
          : `Calculation completed (version ${h.sequence_no ?? '—'})`,
      actor: h.calculated_by_label,
      at: h.calculated_at,
      reason: null,
      result: h.result,
    });
  });

  context.adjustments.forEach((a) => {
    events.push({
      id: `adj-req-${a.adjustment_id}`,
      event: `Adjustment requested (${a.adjustment_reference ?? 'reference pending'})`,
      actor: a.requested_by_label,
      at: a.requested_at,
      reason: a.reason_label ?? a.reason_code,
      result: adjustmentStateLabel('REQUESTED'),
    });
    if (a.decided_at) {
      events.push({
        id: `adj-dec-${a.adjustment_id}`,
        event: `Adjustment ${a.status === 'REJECTED' ? 'rejected' : 'approved'} (${
          a.adjustment_reference ?? 'reference pending'
        })`,
        actor: a.decided_by_label,
        at: a.decided_at,
        reason: a.decision_reason_label ?? a.decision_reason_code,
        result: adjustmentStateLabel(a.status),
      });
    }
  });

  context.decisions.forEach((d) => {
    events.push({
      id: `decision-${d.approval_id}`,
      event: d.decision === 'APPROVE' ? 'Assessment approved' : 'Assessment rejected',
      actor: d.decided_by_label,
      at: d.decided_at,
      reason: d.decision_reason,
      result: d.decision === 'APPROVE' ? 'Approved — not yet active' : 'Means-Test assessment rejected',
    });
  });

  return events.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
