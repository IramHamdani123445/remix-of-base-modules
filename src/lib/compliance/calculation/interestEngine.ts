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
 * Compute interest on an outstanding balance.
 *
 * Returns a zero result — with a `suppressed_reason` on the trace — when the
 * balance is under the configured minimum or when the accrual period has not
 * yet started.
 *
 * Retroactivity guard (open decision CR-002-RETROACTIVITY): the client has
 * confirmed 5% p.a., monthly compounding, accrual after the grace period and
 * an EC$10 minimum. It has NOT confirmed an interest effective date, an
 * accrual cap or whether the policy applies to liabilities that pre-date
 * implementation. Until it does, a production run must classify such
 * balances `INTEREST_POLICY_REVIEW_REQUIRED` instead of silently charging
 * compound interest back to the original period. Non-production runs may
 * compute the figure for impact analysis, labelled as a simulation.
 */
export function computeInterest(input: CeInterestInput): CeInterestResult {
  const { policy, anchor } = input;
  assertPolicy(policy);

  const principal = round2(Math.max(Number(input.principal) || 0, 0));
  const alreadyAccrued = round2(Math.max(Number(input.already_accrued) || 0, 0));
  const anchorStartDate = resolveAccrualStartDate(anchor, policy);
  const annualRate = Number(policy.annual_rate_percent) / 100;
  const monthlyRate = annualRate / 12;

  const effectiveFrom = policy.interest_effective_from ?? null;
  const mode: CeInterestRetroactivityMode =
    policy.apply_to_pre_existing_liabilities ?? "not_approved";
  const isProduction = input.is_production === true;
  const requestedSimulation = input.simulation === true;

  const predatesEffectiveDate = effectiveFrom !== null && anchorStartDate < effectiveFrom;
  const noApprovedEffectiveDate = effectiveFrom === null;
  const unapprovedRetroactivity =
    mode === "not_approved" && (predatesEffectiveDate || noApprovedEffectiveDate);

  let startDate = anchorStartDate;
  const steps: string[] = [];

  if (effectiveFrom) {
    steps.push(`Configured interest effective from ${effectiveFrom}; retroactivity mode = ${mode}`);
  } else {
    steps.push(`No interest effective date is configured; retroactivity mode = ${mode}`);
  }

  if (predatesEffectiveDate && mode === "exclude_pre_effective") {
    startDate = effectiveFrom as string;
    steps.push(
      `Balance predates the effective date — accrual runs from ${startDate} instead of ${anchorStartDate} (exclude_pre_effective)`,
    );
  } else if (predatesEffectiveDate && mode === "apply_retrospectively") {
    steps.push(
      `Retrospective application approved — accrual runs from the statutory anchor ${anchorStartDate}`,
    );
  }

  let months = wholeMonthsBetween(startDate, input.as_of_date);
  const cap = policy.max_accrual_months ?? null;
  const capped = cap !== null && cap !== undefined && months > Number(cap);
  if (capped) months = Number(cap);

  steps.push(
    `Accrual anchor = ${policy.accrual_start} → ${anchorStartDate} (obligation resolver, wage period ${anchor.wage_period})`,
    `Elapsed whole months from ${startDate} to ${input.as_of_date} = ${months}${capped ? ` (capped at ${cap})` : ""}`,
    `Annual rate ${policy.annual_rate_percent}% → monthly rate ${monthlyRate.toFixed(8)}`,
  );

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
      statutory_anchor_date: anchorStartDate,
      annual_rate_percent: policy.annual_rate_percent,
      compounding_basis: policy.compounding_basis,
      minimum_interest_principal: policy.minimum_interest_principal,
      max_accrual_months: cap,
      max_interest_amount: policy.max_interest_amount ?? null,
      interest_effective_from: effectiveFrom,
      apply_to_pre_existing_liabilities: mode,
      is_production: isProduction,
      simulation: requestedSimulation,
      already_accrued: alreadyAccrued,
    },
  };

  const zero = (
    reason: string,
    classification: CeInterestClassification = "SUPPRESSED",
    reviewReason?: string,
  ): CeInterestResult => {
    steps.push(`No interest posted: ${reason}`);
    return {
      component: "INTEREST",
      cumulative_amount: 0,
      amount: 0,
      accrual_start_date: startDate,
      elapsed_months: months,
      monthly_rate: monthlyRate,
      classification,
      is_simulation: false,
      review_reason: reviewReason,
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

  // Production guard — an unapproved retroactive charge is never posted.
  if (unapprovedRetroactivity && isProduction && !requestedSimulation) {
    const reviewReason = predatesEffectiveDate
      ? `balance anchor ${anchorStartDate} predates the configured interest effective date ${effectiveFrom} and no retroactivity policy is approved (CR-002-RETROACTIVITY)`
      : "no approved interest effective date is configured and retroactivity is not approved (CR-002-RETROACTIVITY)";
    return zero(reviewReason, "INTEREST_POLICY_REVIEW_REQUIRED", reviewReason);
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

  let cumulative = round2(raw);
  const amountCap = policy.max_interest_amount ?? null;
  if (amountCap !== null && amountCap !== undefined && cumulative > Number(amountCap)) {
    cumulative = round2(Number(amountCap));
    steps.push(`Cumulative interest capped at the configured maximum ${cumulative.toFixed(2)}`);
  }

  const increment = round2(Math.max(cumulative - alreadyAccrued, 0));
  steps.push(`Rounded (half-up, 2dp) cumulative interest = ${cumulative.toFixed(2)}`);
  steps.push(
    `Already accrued ${alreadyAccrued.toFixed(2)} → incremental interest = ${increment.toFixed(2)}`,
  );

  const isSimulation = requestedSimulation || (unapprovedRetroactivity && !isProduction && requestedSimulation);
  if (isSimulation) {
    steps.push("SIMULATION — illustrative only, this amount is not posted to the ledger");
  }

  return {
    component: "INTEREST",
    cumulative_amount: cumulative,
    amount: increment,
    accrual_start_date: startDate,
    elapsed_months: months,
    monthly_rate: monthlyRate,
    classification: isSimulation ? "SIMULATED" : "ACCRUED",
    is_simulation: isSimulation,
    review_reason: unapprovedRetroactivity
      ? "Computed under an unapproved retroactivity basis (CR-002-RETROACTIVITY)"
      : undefined,
    trace: { ...baseTrace, raw_amount: raw, amount: increment },
  };
}
