/**
 * Compliance — Calculation audit trace contract (Checkpoint C).
 *
 * Every financial figure the platform produces (interest, estimated
 * assessment, employee allocation, payment allocation, credit) must be
 * reproducible from its trace alone. A total without a trace is a defect.
 *
 * This module is mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/calculation/calculationTrace.ts`.
 * It contains NO regulatory constants.
 */

export type CeCalculationComponent =
  | "CONTRIBUTION"
  | "FINE"
  | "PENALTY"
  | "INTEREST"
  | "ESTIMATED_ASSESSMENT"
  | "SURCHARGE"
  | "CREDIT";

export type CeRoundingMode = "half_up_2";

/** Reproducible explanation of one calculated amount. */
export interface CeCalculationTrace {
  /** Calculation rule that produced the amount, e.g. "CR-002". */
  rule_code: string;
  /** Version stamp of the policy/parameter set actually used. */
  policy_version: string;
  /** Financial component — never merged with another component. */
  component: CeCalculationComponent;
  /** Amount the calculation started from. */
  principal: number;
  /** Effective rate applied, expressed as a decimal fraction (0.05 = 5%). */
  rate: number | null;
  /** Rate as configured, for human display (e.g. 5 for "5% per annum"). */
  rate_basis: string | null;
  /** Number of accrual/history periods that entered the calculation. */
  period_count: number;
  /** Multiplier applied, where the family uses one. */
  multiplier: number | null;
  /** Compounding / accrual basis, where applicable. */
  compounding_basis: string | null;
  /** Periods, entries or records the calculation consumed. */
  source_periods: string[];
  /** How money was spread across people, where applicable. */
  allocation_basis: string | null;
  rounding: CeRoundingMode;
  /** Unrounded result, before `rounding` was applied. */
  raw_amount: number;
  /** Final, posted amount. */
  amount: number;
  /** Ordered human-readable derivation steps. */
  steps: string[];
  /** Every input value, so the run can be replayed offline. */
  inputs: Record<string, unknown>;
  /** Set when the calculation deliberately produced nothing. */
  suppressed_reason?: string;
}

export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/** Whole months between two ISO dates (floor, never negative). */
export function wholeMonthsBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new CeCalculationConfigError(`Invalid date range ${fromIso} → ${toIso}`);
  }
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return months > 0 ? months : 0;
}

/** Raised when configuration is missing or invalid. No defaults are guessed. */
export class CeCalculationConfigError extends Error {}

/**
 * Stable idempotency key for a calculated financial entry. Re-running the
 * same calculation with the same inputs must produce the same key so the
 * ledger rejects the duplicate.
 */
export function calculationIdempotencyKey(parts: {
  component: CeCalculationComponent;
  rule_code: string;
  employer_id: string;
  period: string;
  fund_code?: string | null;
  as_of?: string | null;
  discriminator?: string | null;
}): string {
  return [
    parts.component,
    parts.rule_code,
    parts.employer_id,
    parts.period,
    parts.fund_code ?? "ALL",
    parts.as_of ?? "NA",
    parts.discriminator ?? "v1",
  ].join(":");
}
