/**
 * DR-009 Employee count discrepancy / headcount anomaly detection.
 *
 * Client-approved semantics (Compliance Business Review):
 *  - The old flat one-employee-difference trigger is RETIRED. Employers are
 *    now compared using a slab/tiered model keyed on employer size. Each
 *    tier defines its own `allowedAbsoluteChange` (how much of a shortfall is
 *    tolerable before it is worth a human look) and an optional
 *    `percentageThreshold`. Tier boundaries and allowances are NOT fixed by
 *    the client yet, so the entire tier table arrives as configuration data
 *    — nothing is hard-coded here — and each tier separately carries
 *    `requiresClientConfirmation` so Compliance can see which bands are still
 *    provisional.
 *  - Separately (and independently of the tier discrepancy check) a
 *    historical anomaly check compares the current reported headcount
 *    against the mean of the previous `historicalBaselinePeriods`
 *    observations. A substantial INCREASE or a substantial DECREASE is
 *    flagged. Percentage-based comparison only kicks in once the baseline
 *    is at least `minEmployerSizeForPercentage`; below that, only the
 *    absolute-change threshold applies (percentages on tiny headcounts are
 *    meaningless — a 1-person change at a 2-person employer is "100%").
 *  - Seasonal workers are NOT automatically excluded from either check.
 *    Compliance annotates legitimate seasonal reasons at review time, when
 *    disposing of the flag — the detection layer has no seasonal awareness.
 *  - Output is always a REVIEW FLAG (human confirmation required), never a
 *    confirmed violation. No automatic under-declaration surcharge is
 *    applied anywhere in this module — that idea was explicitly rejected.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/headcountAnomaly.ts
 */

import { buildReviewFlag, type CeReviewFlagRecord } from "./reviewFlag";

export interface CeHeadcountTier {
  tierCode: string;
  tierLabel: string;
  minEmployerSize: number;
  maxEmployerSize: number | null;
  allowedAbsoluteChange: number;
  percentageThreshold: number | null;
  isEnabled: boolean;
  requiresClientConfirmation: boolean;
}

export interface CeHeadcountObservation {
  employerId: string;
  employerName?: string;
  periodKey: string;
  reportedEmployees: number;
}

export interface CeHeadcountDiscrepancyInput {
  employerId: string;
  employerName?: string;
  periodKey: string;
  registeredEmployees: number;
  reportedEmployees: number;
}

export interface CeHeadcountDiscrepancyConfig {
  useSizeTiers: boolean;
  fallbackMinEmployeeDelta?: number;
  fallbackMinDiscrepancyPercent?: number;
}

export interface CeHeadcountAnomalyConfig {
  historicalBaselinePeriods: number;
  minEmployerSizeForPercentage: number;
  historicalChangePercent: number;
  historicalChangeAbsolute: number;
}

export interface CeHeadcountFinding {
  employerId: string;
  employerName?: string;
  periodKey: string;
  kind: "DISCREPANCY" | "INCREASE" | "DECREASE";
  registeredEmployees?: number;
  reportedEmployees: number;
  baseline?: number;
  delta: number;
  percentChange?: number;
  tierCode?: string;
  thresholdApplied: string;
  requiresClientConfirmation?: boolean;
  summary: string;
}

/** Find the enabled tier whose [min,max] band contains `employerSize` (max null = open-ended). */
export function resolveHeadcountTier(
  tiers: CeHeadcountTier[],
  employerSize: number,
): CeHeadcountTier | undefined {
  return tiers.find(
    (t) =>
      t.isEnabled &&
      employerSize >= t.minEmployerSize &&
      (t.maxEmployerSize === null || employerSize <= t.maxEmployerSize),
  );
}

/**
 * Evaluate an under-report of registered vs reported employees for a single
 * employer/period pair against the tier table (or the fallback config when
 * tiers are disabled/unmatched). Only under-reports (registered > reported)
 * beyond the resolved allowance are flagged; over-reports are not this
 * rule's concern.
 */
export function evaluateHeadcountDiscrepancy(
  input: CeHeadcountDiscrepancyInput,
  tiers: CeHeadcountTier[],
  config: CeHeadcountDiscrepancyConfig,
): CeHeadcountFinding | undefined {
  const delta = input.registeredEmployees - input.reportedEmployees;
  if (delta <= 0) return undefined;

  const tier = config.useSizeTiers
    ? resolveHeadcountTier(tiers, input.registeredEmployees)
    : undefined;

  let allowedAbsolute: number | undefined;
  let percentageThreshold: number | null | undefined;
  let tierCode: string | undefined;
  let requiresClientConfirmation: boolean | undefined;
  let thresholdApplied: string;

  if (tier) {
    allowedAbsolute = tier.allowedAbsoluteChange;
    percentageThreshold = tier.percentageThreshold;
    tierCode = tier.tierCode;
    requiresClientConfirmation = tier.requiresClientConfirmation;
    thresholdApplied = `tier:${tier.tierCode}`;
  } else {
    allowedAbsolute = config.fallbackMinEmployeeDelta;
    percentageThreshold = config.fallbackMinDiscrepancyPercent ?? null;
    thresholdApplied = "fallback";
  }

  if (allowedAbsolute === undefined && percentageThreshold == null) {
    // No threshold at all can be resolved — never invent a default.
    return undefined;
  }

  const percentChange =
    input.registeredEmployees > 0 ? (delta / input.registeredEmployees) * 100 : undefined;

  const failsAbsolute = allowedAbsolute !== undefined && delta > allowedAbsolute;
  const failsPercentage =
    percentageThreshold != null && percentChange !== undefined && percentChange > percentageThreshold;

  if (!failsAbsolute && !failsPercentage) return undefined;

  return {
    employerId: input.employerId,
    employerName: input.employerName,
    periodKey: input.periodKey,
    kind: "DISCREPANCY",
    registeredEmployees: input.registeredEmployees,
    reportedEmployees: input.reportedEmployees,
    delta,
    percentChange,
    tierCode,
    thresholdApplied,
    requiresClientConfirmation,
    summary: `Registered headcount (${input.registeredEmployees}) exceeds reported headcount (${input.reportedEmployees}) by ${delta}, beyond the ${thresholdApplied} allowance.`,
  };
}

/**
 * Compare the current reported headcount against the mean of the previous
 * `historicalBaselinePeriods` observations, flagging a substantial increase
 * or decrease.
 */
export function evaluateHistoricalHeadcountAnomaly(
  history: CeHeadcountObservation[],
  current: CeHeadcountObservation,
  config: CeHeadcountAnomalyConfig,
): CeHeadcountFinding | undefined {
  const priorObservations = history
    .filter((h) => h.employerId === current.employerId && h.periodKey < current.periodKey)
    .sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1))
    .slice(-config.historicalBaselinePeriods);

  if (priorObservations.length === 0) return undefined;

  const baseline =
    priorObservations.reduce((sum, o) => sum + o.reportedEmployees, 0) / priorObservations.length;

  const delta = current.reportedEmployees - baseline;
  const usePercentage = baseline >= config.minEmployerSizeForPercentage;
  const percentChange = baseline !== 0 ? (delta / baseline) * 100 : undefined;

  const absoluteBreach = Math.abs(delta) > config.historicalChangeAbsolute;
  const percentageBreach =
    usePercentage && percentChange !== undefined && Math.abs(percentChange) > config.historicalChangePercent;

  if (!absoluteBreach && !percentageBreach) return undefined;

  const kind: "INCREASE" | "DECREASE" = delta > 0 ? "INCREASE" : "DECREASE";
  const thresholdApplied = usePercentage ? "percentage+absolute" : "absolute-only";

  return {
    employerId: current.employerId,
    employerName: current.employerName,
    periodKey: current.periodKey,
    kind,
    reportedEmployees: current.reportedEmployees,
    baseline,
    delta,
    percentChange,
    thresholdApplied,
    summary: `Reported headcount (${current.reportedEmployees}) is a substantial ${kind.toLowerCase()} from the ${config.historicalBaselinePeriods}-period baseline (${baseline.toFixed(2)}).`,
  };
}

/** Build the persisted review-flag record for one headcount finding. */
export function buildHeadcountFlag(
  f: CeHeadcountFinding,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  return buildReviewFlag({
    flag_type: f.kind === "DISCREPANCY" ? "HEADCOUNT_DISCREPANCY" : "HEADCOUNT_ANOMALY",
    rule_code: ruleCode,
    rule_id: ruleId,
    subject_type: "EMPLOYER",
    subject_id: f.employerId,
    subject_name: f.employerName,
    employer_id: f.employerId,
    period_key: f.periodKey,
    summary: f.summary,
    evidence: {
      kind: f.kind,
      registered_employees: f.registeredEmployees,
      reported_employees: f.reportedEmployees,
      baseline: f.baseline,
      delta: f.delta,
      percent_change: f.percentChange,
      tier_code: f.tierCode,
      threshold_applied: f.thresholdApplied,
      requires_client_confirmation: f.requiresClientConfirmation ?? false,
      dedupe_discriminator: f.kind,
    },
  });
}
