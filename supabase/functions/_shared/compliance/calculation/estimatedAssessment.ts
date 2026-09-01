/**
 * Compliance — Estimated Assessment (CR-003, Checkpoint C).
 *
 * When an employer fails to file a C3, the liability is ESTIMATED from a
 * configured number of recent VALID periods multiplied by a configured
 * factor. Invalid/abnormal periods are excluded explicitly and reported —
 * they are never silently averaged in.
 *
 * Every parameter (`history_period_count`, `estimate_multiplier`, the
 * exclusion switches and the minimum usable history) is configuration; this
 * module holds no regulatory constants.
 *
 * Mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/calculation/estimatedAssessment.ts`.
 */

import {
  CeCalculationConfigError,
  CeCalculationTrace,
  round2,
} from "./calculationTrace.ts";

/** One candidate historical C3 period offered to the estimator. */
export interface CeHistoryPeriod {
  /** "YYYY-MM". */
  wage_period: string;
  /** Total declared liability for the period. */
  total_liability: number;
  employee_count?: number | null;
  /** Submission status as recorded on the source C3. */
  status?: string | null;
  is_amended?: boolean | null;
  /** Set false when the source system already marked the period unusable. */
  is_valid?: boolean | null;
}

export interface CeEstimateParameters {
  /** Configured number of recent valid periods forming the basis. */
  history_period_count: number;
  /** Configured factor applied to the historical average. */
  estimate_multiplier: number;
  /** Exclude periods with a zero/negative declared liability. */
  exclude_zero_periods: boolean;
  /** Exclude amended periods from the basis. */
  exclude_amended_periods: boolean;
  /** Source statuses that disqualify a period, e.g. ["DRAFT","REJECTED"]. */
  exclude_statuses: string[];
  /**
   * Exclude a period whose liability deviates from the candidate median by
   * more than this multiple. Null disables outlier screening.
   */
  outlier_deviation_multiple?: number | null;
  /** Fewest usable periods before an estimate may be produced at all. */
  minimum_history_periods: number;
  policy_version: string;
}

export type CeEstimateExclusionReason =
  | "marked_invalid"
  | "excluded_status"
  | "amended_period"
  | "zero_or_negative"
  | "outlier"
  | "outside_history_window";

export interface CeExcludedPeriod {
  wage_period: string;
  reason: CeEstimateExclusionReason;
  detail: string;
}

export interface CeEstimateBasis {
  selected: CeHistoryPeriod[];
  excluded: CeExcludedPeriod[];
  sufficient: boolean;
}

export type CeEstimateOutcome = "estimated" | "exception";

export interface CeEstimateException {
  reason: "insufficient_history";
  detail: string;
  usable_period_count: number;
  required_period_count: number;
}

export interface CeEstimatedAssessment {
  outcome: CeEstimateOutcome;
  employer_id?: string;
  /** Period the estimate is raised for, "YYYY-MM". */
  wage_period: string;
  average_liability: number;
  amount: number;
  basis: CeEstimateBasis;
  exception?: CeEstimateException;
  trace: CeCalculationTrace;
}

function assertParams(p: CeEstimateParameters): void {
  if (!p) throw new CeCalculationConfigError("Estimated assessment parameters are not configured");
  if (!Number.isInteger(p.history_period_count) || p.history_period_count < 1) {
    throw new CeCalculationConfigError("CR-003: history_period_count must be a whole number >= 1");
  }
  if (!Number.isFinite(p.estimate_multiplier) || p.estimate_multiplier < 0) {
    throw new CeCalculationConfigError("CR-003: estimate_multiplier must be a non-negative number");
  }
  if (!Number.isInteger(p.minimum_history_periods) || p.minimum_history_periods < 1) {
    throw new CeCalculationConfigError("CR-003: minimum_history_periods must be a whole number >= 1");
  }
  if (!p.policy_version) {
    throw new CeCalculationConfigError("CR-003: policy_version is required for audit");
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Apply the configured exclusion rules, then take the most recent
 * `history_period_count` usable periods (newest first).
 */
export function selectEstimateBasis(
  candidates: CeHistoryPeriod[],
  params: CeEstimateParameters,
): CeEstimateBasis {
  assertParams(params);
  const excluded: CeExcludedPeriod[] = [];
  const ordered = [...(candidates ?? [])].sort((a, b) =>
    b.wage_period.localeCompare(a.wage_period),
  );

  const statuses = (params.exclude_statuses ?? []).map((s) => String(s).toUpperCase());
  const usable: CeHistoryPeriod[] = [];

  for (const period of ordered) {
    const amount = Number(period.total_liability);
    if (period.is_valid === false) {
      excluded.push({
        wage_period: period.wage_period,
        reason: "marked_invalid",
        detail: "Source system marked the period unusable",
      });
      continue;
    }
    if (period.status && statuses.includes(String(period.status).toUpperCase())) {
      excluded.push({
        wage_period: period.wage_period,
        reason: "excluded_status",
        detail: `Status "${period.status}" is excluded by configuration`,
      });
      continue;
    }
    if (params.exclude_amended_periods && period.is_amended) {
      excluded.push({
        wage_period: period.wage_period,
        reason: "amended_period",
        detail: "Amended periods are excluded by configuration",
      });
      continue;
    }
    if (params.exclude_zero_periods && (!Number.isFinite(amount) || amount <= 0)) {
      excluded.push({
        wage_period: period.wage_period,
        reason: "zero_or_negative",
        detail: `Declared liability ${Number.isFinite(amount) ? amount : "n/a"} is not usable`,
      });
      continue;
    }
    if (!Number.isFinite(amount)) {
      excluded.push({
        wage_period: period.wage_period,
        reason: "zero_or_negative",
        detail: "Declared liability is not a number",
      });
      continue;
    }
    usable.push({ ...period, total_liability: amount });
  }

  const deviation = params.outlier_deviation_multiple ?? null;
  let screened = usable;
  if (deviation !== null && deviation !== undefined && usable.length >= 3) {
    const med = median(usable.map((p) => p.total_liability));
    if (med > 0) {
      screened = [];
      for (const period of usable) {
        const ratio = period.total_liability / med;
        if (ratio > deviation || ratio < 1 / deviation) {
          excluded.push({
            wage_period: period.wage_period,
            reason: "outlier",
            detail: `Liability ${period.total_liability.toFixed(2)} deviates from the median ${med.toFixed(
              2,
            )} by more than the configured ${deviation}× tolerance`,
          });
        } else {
          screened.push(period);
        }
      }
    }
  }

  const selected = screened.slice(0, params.history_period_count);
  for (const leftover of screened.slice(params.history_period_count)) {
    excluded.push({
      wage_period: leftover.wage_period,
      reason: "outside_history_window",
      detail: `Only the ${params.history_period_count} most recent usable periods form the basis`,
    });
  }

  return {
    selected,
    excluded,
    sufficient: selected.length >= params.minimum_history_periods,
  };
}

/**
 * Produce an estimated assessment, or a controlled exception when the
 * employer has too little usable history to estimate from.
 */
export function computeEstimatedAssessment(input: {
  employer_id?: string;
  wage_period: string;
  candidates: CeHistoryPeriod[];
  params: CeEstimateParameters;
}): CeEstimatedAssessment {
  const { params } = input;
  assertParams(params);
  const basis = selectEstimateBasis(input.candidates, params);
  const sourcePeriods = basis.selected.map((p) => p.wage_period);

  const steps: string[] = [
    `Configured basis: ${params.history_period_count} most recent valid periods × ${params.estimate_multiplier}`,
    `Candidates offered: ${(input.candidates ?? []).length}; excluded: ${basis.excluded.length}`,
  ];
  for (const ex of basis.excluded) {
    steps.push(`Excluded ${ex.wage_period} — ${ex.reason}: ${ex.detail}`);
  }

  const trace: CeCalculationTrace = {
    rule_code: "CR-003",
    policy_version: params.policy_version,
    component: "ESTIMATED_ASSESSMENT",
    principal: 0,
    rate: null,
    rate_basis: null,
    period_count: basis.selected.length,
    multiplier: params.estimate_multiplier,
    compounding_basis: null,
    source_periods: sourcePeriods,
    allocation_basis: null,
    rounding: "half_up_2",
    raw_amount: 0,
    amount: 0,
    steps,
    inputs: {
      employer_id: input.employer_id ?? null,
      wage_period: input.wage_period,
      history_period_count: params.history_period_count,
      estimate_multiplier: params.estimate_multiplier,
      exclude_zero_periods: params.exclude_zero_periods,
      exclude_amended_periods: params.exclude_amended_periods,
      exclude_statuses: params.exclude_statuses ?? [],
      outlier_deviation_multiple: params.outlier_deviation_multiple ?? null,
      minimum_history_periods: params.minimum_history_periods,
      selected_periods: basis.selected.map((p) => ({
        wage_period: p.wage_period,
        total_liability: p.total_liability,
      })),
      excluded_periods: basis.excluded,
    },
  };

  if (!basis.sufficient) {
    const detail = `Only ${basis.selected.length} usable period(s); configuration requires at least ${params.minimum_history_periods}`;
    steps.push(`Exception raised — ${detail}`);
    return {
      outcome: "exception",
      employer_id: input.employer_id,
      wage_period: input.wage_period,
      average_liability: 0,
      amount: 0,
      basis,
      exception: {
        reason: "insufficient_history",
        detail,
        usable_period_count: basis.selected.length,
        required_period_count: params.minimum_history_periods,
      },
      trace: { ...trace, suppressed_reason: "insufficient_history" },
    };
  }

  const total = basis.selected.reduce((sum, p) => sum + p.total_liability, 0);
  const average = total / basis.selected.length;
  const raw = average * params.estimate_multiplier;
  const amount = round2(raw);

  steps.push(
    `Basis periods: ${sourcePeriods.join(", ")} → total ${total.toFixed(2)} / ${basis.selected.length} = average ${average.toFixed(6)}`,
  );
  steps.push(
    `Estimate = ${average.toFixed(6)} × ${params.estimate_multiplier} = ${raw.toFixed(6)} → rounded ${amount.toFixed(2)}`,
  );

  return {
    outcome: "estimated",
    employer_id: input.employer_id,
    wage_period: input.wage_period,
    average_liability: round2(average),
    amount,
    basis,
    trace: { ...trace, principal: round2(average), raw_amount: raw, amount },
  };
}

/* ───────────────────── estimate ↔ actual reconciliation ───────────────────── */

export type CeReconciliationOutcome =
  | "balanced"
  | "credit_due"
  | "additional_liability";

export interface CeEstimateReconciliation {
  outcome: CeReconciliationOutcome;
  estimated_amount: number;
  actual_amount: number;
  /** actual − estimated. Negative means the employer was over-assessed. */
  difference: number;
  /** Credit created when the actual liability is lower than the estimate. */
  credit_amount: number;
  /** Extra debt raised when the actual liability exceeds the estimate. */
  additional_liability: number;
  trace: CeCalculationTrace;
}

/**
 * Reconcile a previously raised estimate against the C3 the employer has now
 * filed. Both figures and the difference are preserved for audit; nothing is
 * overwritten.
 */
export function reconcileEstimatedAssessment(input: {
  employer_id?: string;
  wage_period: string;
  estimated_amount: number;
  actual_amount: number;
  /** Amount already paid against the estimate, for the audit record. */
  paid_against_estimate?: number;
  policy_version: string;
  tolerance?: number;
}): CeEstimateReconciliation {
  if (!input.policy_version) {
    throw new CeCalculationConfigError("Reconciliation: policy_version is required for audit");
  }
  const estimated = round2(Number(input.estimated_amount) || 0);
  const actual = round2(Number(input.actual_amount) || 0);
  const tolerance = round2(Math.max(Number(input.tolerance) || 0, 0));
  const difference = round2(actual - estimated);

  let outcome: CeReconciliationOutcome = "balanced";
  if (Math.abs(difference) > tolerance) {
    outcome = difference < 0 ? "credit_due" : "additional_liability";
  }
  const credit = outcome === "credit_due" ? round2(Math.abs(difference)) : 0;
  const additional = outcome === "additional_liability" ? round2(difference) : 0;

  const steps = [
    `Estimated assessment raised: ${estimated.toFixed(2)}`,
    `Actual declared liability (filed C3): ${actual.toFixed(2)}`,
    `Difference (actual − estimated) = ${difference.toFixed(2)}; tolerance ${tolerance.toFixed(2)}`,
    outcome === "credit_due"
      ? `Employer was over-assessed → credit of ${credit.toFixed(2)} recorded (no cash refund in this checkpoint)`
      : outcome === "additional_liability"
        ? `Employer was under-assessed → additional liability of ${additional.toFixed(2)} raised`
        : "Estimate and actual agree within tolerance — no adjustment",
  ];

  return {
    outcome,
    estimated_amount: estimated,
    actual_amount: actual,
    difference,
    credit_amount: credit,
    additional_liability: additional,
    trace: {
      rule_code: "CR-003",
      policy_version: input.policy_version,
      component: "ESTIMATED_ASSESSMENT",
      principal: estimated,
      rate: null,
      rate_basis: null,
      period_count: 1,
      multiplier: null,
      compounding_basis: null,
      source_periods: [input.wage_period],
      allocation_basis: "estimate_vs_actual_reconciliation",
      rounding: "half_up_2",
      raw_amount: actual - estimated,
      amount: difference,
      steps,
      inputs: {
        employer_id: input.employer_id ?? null,
        wage_period: input.wage_period,
        estimated_amount: estimated,
        actual_amount: actual,
        paid_against_estimate: round2(Number(input.paid_against_estimate) || 0),
        tolerance,
      },
    },
  };
}
