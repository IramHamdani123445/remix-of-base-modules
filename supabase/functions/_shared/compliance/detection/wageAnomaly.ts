/**
 * DR-010 Wage under-declaration / wage anomaly detection.
 *
 * Client-approved semantics (Compliance Business Review):
 *  - Two complementary, independent checks:
 *      (a) Sector / minimum-wage benchmarking — is the reported average
 *          weekly wage suspiciously below the sector's minimum benchmark?
 *      (b) Sudden historical wage movement — has the reported wage jumped
 *          or dropped abruptly against its own recent history (e.g. an
 *          accidental extra zero, or an unexplained payroll change)?
 *  - Sector benchmarks are recalculated on a monthly cadence
 *    (`benchmarkRecalcMonths`, currently 1 per client decision) but that
 *    cadence itself is configuration, not a hard-coded constant.
 *  - Administrators may override a benchmark's calculated minimum/average.
 *    An override always takes precedence over the calculated value and the
 *    resulting effective benchmark records `source: 'OVERRIDE'` together
 *    with the reason/user/timestamp captured on the benchmark row itself.
 *  - Output is always a REVIEW FLAG (human confirmation required) — even an
 *    apparently legitimate low wage is routed to a human for confirmation,
 *    never auto-converted into a violation by this module.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/wageAnomaly.ts
 */

import { buildReviewFlag, type CeReviewFlagRecord } from "./reviewFlag";

export interface CeSectorBenchmark {
  id: string;
  sectorCode: string;
  sectorLabel?: string;
  calculatedMinimum: number | null;
  calculatedAverage: number | null;
  sampleCount: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  recalculatedAt?: string | null;
  overrideMinimum?: number | null;
  overrideAverage?: number | null;
  overrideReason?: string | null;
  overriddenBy?: string | null;
  overriddenAt?: string | null;
  isEnabled: boolean;
}

export interface CeEffectiveBenchmark {
  sectorCode: string;
  minimum: number | null;
  average: number | null;
  source: "CALCULATED" | "OVERRIDE";
  benchmarkId: string;
  sampleCount: number;
}

export interface CeWageObservation {
  employerId: string;
  employerName?: string;
  sectorCode?: string;
  periodKey: string;
  averageWeeklyWage: number;
  employeeCount?: number;
}

export interface CeWageAnomalyConfig {
  enableSectorBenchmark: boolean;
  enableHistoricalVariance: boolean;
  benchmarkVariancePercent: number;
  historicalVariancePercent: number;
  lookbackPeriods: number;
  benchmarkRecalcMonths: number;
}

/**
 * Resolve the enabled benchmark row for `sectorCode` whose effective period
 * (`effectiveFrom` .. `effectiveTo`, `effectiveTo` null = still open)
 * contains `periodKey`, applying any admin override in preference to the
 * calculated values.
 */
export function resolveEffectiveBenchmark(
  benchmarks: CeSectorBenchmark[],
  sectorCode: string,
  periodKey: string,
): CeEffectiveBenchmark | undefined {
  const row = benchmarks.find(
    (b) =>
      b.isEnabled &&
      b.sectorCode === sectorCode &&
      b.effectiveFrom <= periodKey &&
      (b.effectiveTo == null || b.effectiveTo >= periodKey),
  );
  if (!row) return undefined;

  const hasOverride = row.overrideMinimum != null || row.overrideAverage != null;
  return {
    sectorCode: row.sectorCode,
    minimum: hasOverride ? row.overrideMinimum ?? row.calculatedMinimum : row.calculatedMinimum,
    average: hasOverride ? row.overrideAverage ?? row.calculatedAverage : row.calculatedAverage,
    source: hasOverride ? "OVERRIDE" : "CALCULATED",
    benchmarkId: row.id,
    sampleCount: row.sampleCount,
  };
}

/** True when a benchmark is missing a recalculation timestamp, or it is older than `recalcMonths` before `asOf`. */
export function isBenchmarkStale(
  b: CeSectorBenchmark,
  recalcMonths: number,
  asOf: string,
): boolean {
  if (!b.recalculatedAt) return true;
  const asOfDate = new Date(`${asOf}T00:00:00Z`);
  const cutoff = new Date(asOfDate);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - recalcMonths);
  const recalculatedAt = new Date(b.recalculatedAt);
  return recalculatedAt.getTime() < cutoff.getTime();
}

export interface CeWageFinding {
  employerId: string;
  employerName?: string;
  periodKey: string;
  kind: "BELOW_BENCHMARK" | "SUDDEN_INFLATION" | "SUDDEN_DEFLATION";
  observedWage: number;
  comparisonValue: number;
  percentVariance: number;
  benchmarkSource?: "CALCULATED" | "OVERRIDE";
  sectorCode?: string;
  summary: string;
}

/** Flag an average weekly wage that falls below the sector minimum by more than `benchmarkVariancePercent`. */
export function evaluateSectorBenchmark(
  o: CeWageObservation,
  benchmarks: CeSectorBenchmark[],
  config: CeWageAnomalyConfig,
): CeWageFinding | undefined {
  if (!config.enableSectorBenchmark) return undefined;
  if (!o.sectorCode) return undefined;

  const effective = resolveEffectiveBenchmark(benchmarks, o.sectorCode, o.periodKey);
  if (!effective || effective.minimum == null) return undefined;

  const threshold = effective.minimum * (1 - config.benchmarkVariancePercent / 100);
  if (o.averageWeeklyWage >= threshold) return undefined;

  const percentVariance =
    effective.minimum !== 0
      ? ((o.averageWeeklyWage - effective.minimum) / effective.minimum) * 100
      : 0;

  return {
    employerId: o.employerId,
    employerName: o.employerName,
    periodKey: o.periodKey,
    kind: "BELOW_BENCHMARK",
    observedWage: o.averageWeeklyWage,
    comparisonValue: effective.minimum,
    percentVariance,
    benchmarkSource: effective.source,
    sectorCode: o.sectorCode,
    summary: `Average weekly wage (${o.averageWeeklyWage}) is more than ${config.benchmarkVariancePercent}% below the ${o.sectorCode} sector minimum benchmark (${effective.minimum}, ${effective.source.toLowerCase()}).`,
  };
}

/**
 * Compare the current average weekly wage against the mean of the previous
 * `lookbackPeriods` observations for the same employer, flagging a sudden
 * inflation (up) or deflation (down) beyond `historicalVariancePercent`.
 */
export function evaluateHistoricalWageVariance(
  history: CeWageObservation[],
  current: CeWageObservation,
  config: CeWageAnomalyConfig,
): CeWageFinding | undefined {
  if (!config.enableHistoricalVariance) return undefined;

  const priorObservations = history
    .filter((h) => h.employerId === current.employerId && h.periodKey < current.periodKey)
    .sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1))
    .slice(-config.lookbackPeriods);

  if (priorObservations.length === 0) return undefined;

  const baseline =
    priorObservations.reduce((sum, o) => sum + o.averageWeeklyWage, 0) / priorObservations.length;
  if (baseline === 0) return undefined;

  const percentVariance = ((current.averageWeeklyWage - baseline) / baseline) * 100;
  if (Math.abs(percentVariance) <= config.historicalVariancePercent) return undefined;

  const kind: "SUDDEN_INFLATION" | "SUDDEN_DEFLATION" =
    percentVariance > 0 ? "SUDDEN_INFLATION" : "SUDDEN_DEFLATION";

  return {
    employerId: current.employerId,
    employerName: current.employerName,
    periodKey: current.periodKey,
    kind,
    observedWage: current.averageWeeklyWage,
    comparisonValue: baseline,
    percentVariance,
    sectorCode: current.sectorCode,
    summary: `Average weekly wage (${current.averageWeeklyWage}) is a ${kind === "SUDDEN_INFLATION" ? "sudden increase" : "sudden decrease"} of ${percentVariance.toFixed(1)}% from the ${config.lookbackPeriods}-period baseline (${baseline.toFixed(2)}).`,
  };
}

/** Build the persisted review-flag record for one wage finding. */
export function buildWageFlag(
  f: CeWageFinding,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  return buildReviewFlag({
    flag_type: f.kind === "BELOW_BENCHMARK" ? "WAGE_BELOW_BENCHMARK" : "WAGE_ANOMALY",
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
      observed_wage: f.observedWage,
      comparison_value: f.comparisonValue,
      percent_variance: f.percentVariance,
      benchmark_source: f.benchmarkSource,
      sector_code: f.sectorCode,
      dedupe_discriminator: f.kind,
    },
  });
}
