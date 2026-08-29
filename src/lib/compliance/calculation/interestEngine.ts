/**
 * Compliance — Interest engine (CR-002, Checkpoint C).
 *
 * Interest is a SEPARATE financial component. It is never folded into a
 * contribution, a fine or a penalty, and there is no generic "late payment
 * penalty" behind it (CR-001 is retired — see the Checkpoint C migration).
 *
 * Client-confirmed St Kitts & Nevis defaults (all CONFIGURABLE, none
 * hard-coded here): 5% per annum, compounded monthly, accruing only after the
 * applicable statutory grace/deadline, and only on a balance of at least
 * EC$10.
 *
 * The accrual anchor is supplied by the authoritative obligation resolver
 * (`obligationDeadlineResolver`) — this module never recalculates calendar
 * deadlines itself.
 *
 * Mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/calculation/interestEngine.ts`.
 */

import {
  CeCalculationConfigError,
  CeCalculationTrace,
  round2,
  wholeMonthsBetween,
} from "./calculationTrace";

export type CeCompoundingBasis =
  | "monthly_compound"
  | "monthly_simple"
  | "annual_compound";

export const CE_COMPOUNDING_BASES: readonly CeCompoundingBasis[] = [
  "monthly_compound",
  "monthly_simple",
  "annual_compound",
];

/** Which authoritative obligation date interest starts running from. */
export type CeInterestAccrualStart = "grace_end" | "due_date";

/**
 * Governed retroactivity mode for liabilities that predate the approved
 * interest effective date. The client has NOT approved retrospective
 * application, so `not_approved` is the only safe production behaviour until
 * open business decision CR-002-RETROACTIVITY is confirmed.
 */
export type CeInterestRetroactivityMode =
  | "not_approved"
  | "exclude_pre_effective"
  | "apply_retrospectively";

export const CE_INTEREST_RETROACTIVITY_MODES: readonly CeInterestRetroactivityMode[] = [
  "not_approved",
  "exclude_pre_effective",
  "apply_retrospectively",
];

/** Outcome classification recorded on every accrual record. */
export type CeInterestClassification =
  | "ACCRUED"
  | "SUPPRESSED"
  | "INTEREST_POLICY_REVIEW_REQUIRED"
  | "SIMULATED";

export interface CeInterestPolicy {
  /** Annual nominal rate as a percentage, e.g. 5 for 5% p.a. */
  annual_rate_percent: number;
  compounding_basis: CeCompoundingBasis;
  /** Balance below this never attracts interest (St Kitts default: 10). */
  minimum_interest_principal: number;
  /** Anchor taken from the obligation timeline. */
  accrual_start: CeInterestAccrualStart;
  /** Optional cap on accrual months. Nullable — never defaulted. */
  max_accrual_months?: number | null;
  /** Optional ceiling on cumulative interest per balance. Nullable — never defaulted. */
  max_interest_amount?: number | null;
  /** Date the interest policy is in force from, "YYYY-MM-DD". Nullable. */
  interest_effective_from?: string | null;
  /** Governed retroactivity policy. Defaults to `not_approved`. */
  apply_to_pre_existing_liabilities?: CeInterestRetroactivityMode | null;
  /** Stamp of the configuration set used, recorded on every trace. */
  policy_version: string;
}

/** Dates come from `resolveObligationTimeline` — never recomputed here. */
export interface CeInterestAnchor {
  /** Statutory due date, "YYYY-MM-DD". */
  due_date: string;
  /** Last timely day, "YYYY-MM-DD". */
  grace_end_date: string;
  /** Wage period the balance belongs to, "YYYY-MM". */
  wage_period: string;
}

export interface CeInterestInput {
  employer_id?: string;
  fund_code?: string | null;
  /** Outstanding contribution balance interest is charged on. */
  principal: number;
  anchor: CeInterestAnchor;
  /** Valuation date, "YYYY-MM-DD". */
  as_of_date: string;
  policy: CeInterestPolicy;
  /** Interest already posted for this balance — subtracted, never duplicated. */
  already_accrued?: number;
  /**
   * Production runs are guarded: an unapproved retroactive accrual is
   * classified for review instead of being charged.
   */
  is_production?: boolean;
  /**
   * TEST/impact-analysis runs may compute the unapproved amount, clearly
   * labelled as a simulation. A simulation never posts money.
   */
  simulation?: boolean;
}

export interface CeInterestResult {
  component: "INTEREST";
  /** Interest owed in total from the anchor to `as_of_date`. */
  cumulative_amount: number;
  /** Incremental amount to post now (cumulative minus already accrued). */
  amount: number;
  accrual_start_date: string;
  elapsed_months: number;
  monthly_rate: number;
  classification: CeInterestClassification;
  /** True when the figure is illustrative only and must never be posted. */
  is_simulation: boolean;
  /** Set when the amount needs a business decision before it may be charged. */
  review_reason?: string;
  trace: CeCalculationTrace;
}

function assertPolicy(policy: CeInterestPolicy): void {
  if (!policy) throw new CeCalculationConfigError("Interest policy is not configured");
  const n = Number(policy.annual_rate_percent);
  if (!Number.isFinite(n) || n < 0) {
    throw new CeCalculationConfigError(
      "Interest policy: annual_rate_percent must be a non-negative number",
    );
  }
  if (!CE_COMPOUNDING_BASES.includes(policy.compounding_basis)) {
    throw new CeCalculationConfigError(
      `Interest policy: unsupported compounding_basis "${policy.compounding_basis}"`,
    );
  }
  const min = Number(policy.minimum_interest_principal);
  if (!Number.isFinite(min) || min < 0) {
    throw new CeCalculationConfigError(
      "Interest policy: minimum_interest_principal must be a non-negative number",
    );
  }
  if (policy.accrual_start !== "grace_end" && policy.accrual_start !== "due_date") {
    throw new CeCalculationConfigError(
      `Interest policy: unsupported accrual_start "${policy.accrual_start}"`,
    );
  }
  if (!policy.policy_version) {
    throw new CeCalculationConfigError("Interest policy: policy_version is required for audit");
  }
}

export function resolveAccrualStartDate(
  anchor: CeInterestAnchor,
  policy: CeInterestPolicy,
): string {
  return policy.accrual_start === "due_date" ? anchor.due_date : anchor.grace_end_date;
}

/**
 * Compute interest on an outstanding balance. Returns a zero result — with a
 * `suppressed_reason` on the trace — when the balance is under the configured
 * minimum or when the accrual period has not yet started.
 */
export function computeInterest(input: CeInterestInput): CeInterestResult {
  const { policy, anchor } = input;
  assertPolicy(policy);

  const principal = round2(Math.max(Number(input.principal) || 0, 0));
  const alreadyAccrued = round2(Math.max(Number(input.already_accrued) || 0, 0));
  const startDate = resolveAccrualStartDate(anchor, policy);
  const annualRate = Number(policy.annual_rate_percent) / 100;
  const monthlyRate = annualRate / 12;

  let months = wholeMonthsBetween(startDate, input.as_of_date);
  const cap = policy.max_accrual_months ?? null;
  const capped = cap !== null && cap !== undefined && months > Number(cap);
  if (capped) months = Number(cap);

  const steps: string[] = [
    `Accrual anchor = ${policy.accrual_start} → ${startDate} (obligation resolver, wage period ${anchor.wage_period})`,
    `Elapsed whole months from ${startDate} to ${input.as_of_date} = ${months}${capped ? ` (capped at ${cap})` : ""}`,
    `Annual rate ${policy.annual_rate_percent}% → monthly rate ${monthlyRate.toFixed(8)}`,
  ];

  const baseTrace: CeCalculationTrace = {
    rule_code: "CR-002",
    policy_version: policy.policy_version,
    component: "INTEREST",
    principal,
    rate: annualRate,
    rate_basis: `${policy.annual_rate_percent}% per annum`,
    period_count: months,
    multiplier: null,
    compounding_basis: policy.compounding_basis,
    source_periods: [anchor.wage_period],
    allocation_basis: null,
    rounding: "half_up_2",
    raw_amount: 0,
    amount: 0,
    steps,
    inputs: {
      employer_id: input.employer_id ?? null,
      fund_code: input.fund_code ?? null,
      principal,
      as_of_date: input.as_of_date,
      due_date: anchor.due_date,
      grace_end_date: anchor.grace_end_date,
      accrual_start_date: startDate,
      annual_rate_percent: policy.annual_rate_percent,
      compounding_basis: policy.compounding_basis,
      minimum_interest_principal: policy.minimum_interest_principal,
      max_accrual_months: cap,
      already_accrued: alreadyAccrued,
    },
  };

  const zero = (reason: string): CeInterestResult => {
    steps.push(`No interest: ${reason}`);
    return {
      component: "INTEREST",
      cumulative_amount: 0,
      amount: 0,
      accrual_start_date: startDate,
      elapsed_months: months,
      monthly_rate: monthlyRate,
      trace: { ...baseTrace, suppressed_reason: reason },
    };
  };

  if (principal < Number(policy.minimum_interest_principal)) {
    return zero(
      `principal ${principal.toFixed(2)} is below the configured minimum ${Number(
        policy.minimum_interest_principal,
      ).toFixed(2)}`,
    );
  }
  if (months <= 0) return zero("the configured grace/deadline anchor has not been passed by a full month");
  if (annualRate === 0) return zero("the configured annual rate is 0%");

  let raw: number;
  if (policy.compounding_basis === "monthly_compound") {
    raw = principal * (Math.pow(1 + monthlyRate, months) - 1);
    steps.push(
      `Monthly compounding: ${principal.toFixed(2)} × ((1 + ${monthlyRate.toFixed(8)})^${months} − 1) = ${raw.toFixed(6)}`,
    );
  } else if (policy.compounding_basis === "monthly_simple") {
    raw = principal * monthlyRate * months;
    steps.push(
      `Simple monthly: ${principal.toFixed(2)} × ${monthlyRate.toFixed(8)} × ${months} = ${raw.toFixed(6)}`,
    );
  } else {
    raw = principal * (Math.pow(1 + annualRate, months / 12) - 1);
    steps.push(
      `Annual compounding: ${principal.toFixed(2)} × ((1 + ${annualRate.toFixed(8)})^(${months}/12) − 1) = ${raw.toFixed(6)}`,
    );
  }

  const cumulative = round2(raw);
  const increment = round2(Math.max(cumulative - alreadyAccrued, 0));
  steps.push(`Rounded (half-up, 2dp) cumulative interest = ${cumulative.toFixed(2)}`);
  steps.push(
    `Already accrued ${alreadyAccrued.toFixed(2)} → incremental interest to post = ${increment.toFixed(2)}`,
  );

  return {
    component: "INTEREST",
    cumulative_amount: cumulative,
    amount: increment,
    accrual_start_date: startDate,
    elapsed_months: months,
    monthly_rate: monthlyRate,
    trace: { ...baseTrace, raw_amount: raw, amount: increment },
  };
}
