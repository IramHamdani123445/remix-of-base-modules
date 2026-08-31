// ============================================================
// PLAN CANDIDATE V3 — SERVICE-BOUNDARY NORMALISER
//
// The planning UI must never crash on a single malformed candidate.
// This module converts a raw `fn_ce_score_candidates_v3` row into a
// fully-typed PlanCandidateV3, and records every data/configuration
// problem it had to compensate for on `data_issues`.
//
// Contract rules
//  - REQUIRED  : employer_id. A row without it cannot be planned at all
//                and is rejected (returned as `null` candidate).
//  - GOVERNED  : bucket, mandatory_class, derived_priority. These drive
//                planning semantics; unknown values are NOT silently
//                re-classified — they are quarantined into a controlled
//                fallback AND flagged so the record shows a data-quality
//                warning instead of pretending to be routine work.
//  - OPTIONAL  : names, dates, territory, audit programme, risk band.
//                Rendered with an explicit placeholder when absent.
//  - reasons[] : the engine emits a JSONB array. Historically it could
//                contain JSON `null` slots (jsonb_strip_nulls does not
//                strip nulls inside arrays), which crashed the card with
//                "Cannot read properties of null (reading 'label')".
//                Invalid entries are dropped here, at the boundary.
// ============================================================

import type { PlanCandidateV3, RecommendationReason } from '@/types/weeklyPlan';

export const RECOMMENDATION_REASON_LABELS: Record<string, string> = {
  INHERENT_RISK: 'Inherent risk',
  TRIGGER_URGENCY: 'Active triggers',
  AUDIT_DUENESS: 'Audit due / overdue',
  ENFORCEMENT_STAGE: 'Enforcement / cases',
  FOLLOW_UP_AGING: 'Follow-up / carry forward',
  OPERATIONAL_FIT: 'Zone fit',
  MANDATORY: 'Mandatory class',
};

export const PLANNER_BUCKETS = [
  'MUST_SCHEDULE',
  'REACTIVE_ENFORCEMENT',
  'RISK_MONITORING',
  'ROUTINE_COVERAGE',
  'CAMPAIGN_INTEL',
] as const;

export const MANDATORY_CLASSES = ['MANDATORY', 'PRIORITY', 'WATCHLIST'] as const;
export const DERIVED_PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;
export const RISK_BANDS = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const;

export interface CandidateDataIssue {
  field: string;
  code:
    | 'MISSING_REQUIRED'
    | 'UNCONFIGURED_VALUE'
    | 'MALFORMED_VALUE'
    | 'DROPPED_REASON';
  message: string;
}

export interface NormalisedCandidate {
  candidate: PlanCandidateV3 | null;
  issues: CandidateDataIssue[];
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;

/**
 * Normalise the explainability array. Drops JSON nulls, non-objects and
 * entries without a usable code; supplies a configured label when the
 * engine omitted one, and a clearly-marked fallback when the code itself
 * is not in the frontend configuration.
 */
export function normaliseRecommendationReasons(
  raw: unknown,
  issues: CandidateDataIssue[] = [],
): RecommendationReason[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    issues.push({
      field: 'recommendation_reasons',
      code: 'MALFORMED_VALUE',
      message: 'Explainability reasons were not returned as a list.',
    });
    return [];
  }

  const out: RecommendationReason[] = [];
  let dropped = 0;

  raw.forEach((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      dropped += 1;
      return;
    }
    const e = entry as Record<string, unknown>;
    const code = str(e.code);
    if (!code) {
      dropped += 1;
      return;
    }
    const configured = RECOMMENDATION_REASON_LABELS[code];
    const label = str(e.label) ?? configured ?? `Unconfigured reason (${code})`;
    if (!configured && !str(e.label)) {
      issues.push({
        field: 'recommendation_reasons',
        code: 'UNCONFIGURED_VALUE',
        message: `Reason code "${code}" has no configured label.`,
      });
    }
    out.push({
      code,
      label,
      weight: num(e.weight, 0),
      detail: str(e.detail) ?? undefined,
    });
  });

  if (dropped > 0) {
    issues.push({
      field: 'recommendation_reasons',
      code: 'DROPPED_REASON',
      message: `${dropped} empty explainability entr${dropped === 1 ? 'y was' : 'ies were'} returned by the candidate engine.`,
    });
  }
  return out;
}

function governed<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  field: string,
  issues: CandidateDataIssue[],
): T {
  const v = str(value)?.toUpperCase();
  if (!v) {
    issues.push({
      field,
      code: 'MISSING_REQUIRED',
      message: `${field} was not supplied by the candidate engine.`,
    });
    return fallback;
  }
  if (!(allowed as readonly string[]).includes(v)) {
    issues.push({
      field,
      code: 'UNCONFIGURED_VALUE',
      message: `${field} value "${v}" is not a configured planning value.`,
    });
    return fallback;
  }
  return v as T;
}

/** Convert one raw engine row into a safe PlanCandidateV3. */
export function normalisePlanCandidateV3(row: unknown): NormalisedCandidate {
  const issues: CandidateDataIssue[] = [];
  if (!row || typeof row !== 'object') {
    return {
      candidate: null,
      issues: [{ field: 'row', code: 'MALFORMED_VALUE', message: 'Candidate record is not an object.' }],
    };
  }
  const r = row as Record<string, unknown>;

  const employerId = str(r.employer_id);
  if (!employerId) {
    return {
      candidate: null,
      issues: [{
        field: 'employer_id',
        code: 'MISSING_REQUIRED',
        message: 'Candidate has no employer reference and cannot be planned.',
      }],
    };
  }

  const reasons = normaliseRecommendationReasons(r.recommendation_reasons, issues);
  const bucket = governed(r.bucket, PLANNER_BUCKETS, 'CAMPAIGN_INTEL', 'bucket', issues);
  const mandatoryClass = governed(r.mandatory_class, MANDATORY_CLASSES, 'WATCHLIST', 'mandatory_class', issues);
  const priority = governed(r.derived_priority, DERIVED_PRIORITIES, 'MEDIUM', 'derived_priority', issues);

  const riskBandRaw = str(r.risk_band)?.toUpperCase() ?? null;
  const riskBand =
    riskBandRaw && !(RISK_BANDS as readonly string[]).includes(riskBandRaw)
      ? (issues.push({
          field: 'risk_band',
          code: 'UNCONFIGURED_VALUE',
          message: `Risk band "${riskBandRaw}" is not a configured band.`,
        }),
        null)
      : riskBandRaw;

  const candidate: PlanCandidateV3 = {
    employer_id: employerId,
    employer_name: str(r.employer_name),
    territory: str(r.territory),
    zone_id: str(r.zone_id),
    audit_program: str(r.audit_program),
    candidate_source: str(r.candidate_source) ?? 'UNKNOWN',
    candidate_reason: str(r.candidate_reason) ?? 'OPEN_VIOLATION',
    derived_priority: priority,
    risk_band: riskBand,
    risk_score: num(r.risk_score),
    inherent_risk_score: num(r.inherent_risk_score, num(r.risk_score)),
    audit_priority_score: num(r.audit_priority_score, num(r.recommendation_score)),
    days_since_last_inspection:
      r.days_since_last_inspection == null ? null : num(r.days_since_last_inspection),
    last_audit_date: str(r.last_audit_date),
    next_due_date: str(r.next_due_date),
    overdue_days: num(r.overdue_days),
    open_violation_count: num(r.open_violation_count),
    escalated_violation_count: num(r.escalated_violation_count),
    overdue_followup_count: num(r.overdue_followup_count),
    violation_count: num(r.violation_count, num(r.open_violation_count)),
    case_count: num(r.case_count),
    financial_exposure: num(r.financial_exposure),
    notice_days_remaining:
      r.notice_days_remaining == null ? null : num(r.notice_days_remaining),
    any_breach_detected: Boolean(r.any_breach_detected),
    carry_forward_count: num(r.carry_forward_count),
    audit_cycle_due_date: str(r.audit_cycle_due_date),
    cycle_overdue_days: num(r.cycle_overdue_days),
    is_cycle_overdue: Boolean(r.is_cycle_overdue),
    recommendation_score: num(r.recommendation_score, num(r.audit_priority_score)),
    recommendation_reasons: reasons,
    why_selected: str(r.why_selected),
    mandatory_class: mandatoryClass,
    bucket,
    estimated_effort: num(r.estimated_effort),
    data_issues: issues.length ? issues : undefined,
  };

  return { candidate, issues };
}

export interface NormalisedCandidateBatch {
  candidates: PlanCandidateV3[];
  /** Rows that could not be planned at all (no employer reference). */
  rejected: CandidateDataIssue[][];
  /** Candidates that loaded but need data/configuration correction. */
  degradedCount: number;
}

export function normalisePlanCandidatesV3(rows: unknown[]): NormalisedCandidateBatch {
  const candidates: PlanCandidateV3[] = [];
  const rejected: CandidateDataIssue[][] = [];
  let degradedCount = 0;

  for (const row of rows ?? []) {
    const { candidate, issues } = normalisePlanCandidateV3(row);
    if (!candidate) {
      rejected.push(issues);
      continue;
    }
    if (issues.length) degradedCount += 1;
    candidates.push(candidate);
  }
  return { candidates, rejected, degradedCount };
}
