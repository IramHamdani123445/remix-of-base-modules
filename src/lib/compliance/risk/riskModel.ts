/**
 * Checkpoint E — Compliance Risk Model (pure logic)
 *
 * Canonical five-factor model agreed with the client (17/20/24 August 2026).
 * All scoring at runtime is executed by the database engine
 * `ce_score_employer_risk_v1` so that manual, scheduled and preview runs share
 * identical semantics. The helpers below mirror that engine for validation,
 * preview and unit testing — they never write to the database.
 */

export type CanonicalFactor =
  | 'PAYMENT'
  | 'FILING'
  | 'VIOLATION'
  | 'ARRANGEMENT'
  | 'LEGAL';

export type FactorStatus = 'configured' | 'operational' | 'configuration_error';

export const CANONICAL_FACTORS: { code: CanonicalFactor; label: string; description: string }[] = [
  {
    code: 'PAYMENT',
    label: 'Payment / Contribution Compliance',
    description:
      'Overdue contribution principal from the canonical C-L1 ledger views, plus DR-003 / DR-004 payment events.',
  },
  {
    code: 'FILING',
    label: 'C3 Filing / Reporting Compliance',
    description:
      'Late (DR-001) and unreported (DR-002) C3 periods against the authoritative obligation timeline. Valid NIL returns count as filings.',
  },
  {
    code: 'VIOLATION',
    label: 'Violation / Repeat-Offender History',
    description:
      'Confirmed violations (filing/payment/arrangement rule types excluded to prevent double counting) plus confirmed DR-005 findings.',
  },
  {
    code: 'ARRANGEMENT',
    label: 'Payment Arrangement / Breach History',
    description: 'DR-006 and recorded arrangement breaches. A healthy arrangement scores zero.',
  },
  {
    code: 'LEGAL',
    label: 'Legal / Enforcement History',
    description:
      'Highest enforcement stage reached — demand issued, approved referral, or an active legal case.',
  },
];

export interface ThresholdTier {
  min: number;
  max: number;
  score: number;
  label?: string;
}

export interface RiskFactorDefinition {
  factor_code: string;
  factor_name: string;
  canonical_factor: CanonicalFactor | null;
  measurement_code: string | null;
  scoring_method: string | null;
  thresholds: ThresholdTier[] | null;
  max_score?: number | null;
  weight: number;
  lifecycle_status?: string | null;
  is_active?: boolean;
}

export interface RiskBandDefinition {
  band_name: string;
  score_range_min: number;
  score_range_max: number;
  color?: string | null;
}

export interface PolicyValidationResult {
  valid: boolean;
  weightTotal: number;
  errors: string[];
  factorStatuses: { factor_code: string; status: FactorStatus; reason: string }[];
}

export function normaliseThresholds(raw: unknown): ThresholdTier[] {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'tiers' in (value as object)) {
    value = (value as { tiers: unknown }).tiers;
  }
  return Array.isArray(value) ? (value as ThresholdTier[]) : [];
}

export function factorStatus(factor: RiskFactorDefinition): { status: FactorStatus; reason: string } {
  if (factor.lifecycle_status && factor.lifecycle_status !== 'ACTIVE') {
    return { status: 'configuration_error', reason: 'Factor is retired but still active in the policy' };
  }
  if (!factor.measurement_code) {
    return { status: 'configuration_error', reason: 'No runtime measurement source configured' };
  }
  if (normaliseThresholds(factor.thresholds).length === 0) {
    return {
      status: 'configuration_error',
      reason: 'Weight configured but no scoring thresholds — factor cannot score',
    };
  }
  if (!factor.weight || factor.weight <= 0) {
    return { status: 'configured', reason: 'Factor defined but carries no weight' };
  }
  return { status: 'operational', reason: 'Factor has weight, measurement and scoring thresholds' };
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function validateRiskPolicy(
  factors: RiskFactorDefinition[],
  bands: RiskBandDefinition[],
): PolicyValidationResult {
  const active = factors.filter((f) => f.is_active !== false);
  const errors: string[] = [];
  const weightTotal = roundTo2(active.reduce((sum, f) => sum + Number(f.weight || 0), 0));

  const factorStatuses = active.map((f) => {
    const { status, reason } = factorStatus(f);
    if (status === 'configuration_error') {
      errors.push(`Factor ${f.factor_code}: ${reason}`);
    }
    return { factor_code: f.factor_code, status, reason };
  });

  if (active.length === 0) errors.push('Policy has no active factors');
  if (weightTotal !== 100) {
    errors.push(`Active factor weights total ${weightTotal}% — must equal exactly 100%`);
  }

  const sorted = [...bands].sort((a, b) => a.score_range_min - b.score_range_min);
  if (sorted.length === 0) {
    errors.push('Policy has no risk bands');
  } else {
    if (sorted[0].score_range_min !== 0) {
      errors.push(`Lowest band ${sorted[0].band_name} must start at 0`);
    }
    for (let i = 0; i < sorted.length; i++) {
      const band = sorted[i];
      if (band.score_range_max <= band.score_range_min) {
        errors.push(`Band ${band.band_name} has an invalid range`);
      }
      if (i > 0) {
        const prev = sorted[i - 1];
        if (band.score_range_min > prev.score_range_max) {
          errors.push(`Gap in risk bands between ${prev.score_range_max} and ${band.score_range_min}`);
        } else if (band.score_range_min < prev.score_range_max) {
          errors.push(`Overlapping risk bands at ${band.score_range_min}`);
        }
      }
    }
    const top = sorted[sorted.length - 1];
    if (top.score_range_max < 100) {
      errors.push(`Risk bands stop at ${top.score_range_max} — must cover the full score range to 100`);
    }
  }

  return { valid: errors.length === 0, weightTotal, errors, factorStatuses };
}

/**
 * Deterministic band resolution: bands are half-open [min, max) except the
 * highest band, which is inclusive of its maximum. Cut-offs are never
 * hard-coded — they always come from ce_risk_bands.
 */
export function resolveBand(score: number, bands: RiskBandDefinition[]): RiskBandDefinition | null {
  const sorted = [...bands].sort((a, b) => a.score_range_min - b.score_range_min);
  if (sorted.length === 0) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const band = sorted[i];
    const isTop = i === sorted.length - 1 || band.score_range_max >= 100;
    if (score >= band.score_range_min && (score < band.score_range_max || isTop)) {
      return band;
    }
  }
  return sorted[0];
}

export interface EvaluatedFactor {
  factor_code: string;
  factor_name: string;
  canonical_factor: CanonicalFactor | null;
  status: FactorStatus;
  raw_measurement: number;
  factor_score: number;
  weight_pct: number;
  weighted_contribution: number;
  threshold_used: ThresholdTier | null;
  explanation: string;
}

export function evaluateThreshold(
  raw: number,
  method: string | null,
  thresholds: ThresholdTier[],
  maxScore = 100,
): { score: number; tier: ThresholdTier | null; ok: boolean; explanation: string } {
  const tiers = normaliseThresholds(thresholds);
  if (tiers.length === 0) {
    return { score: 0, tier: null, ok: false, explanation: 'No thresholds configured' };
  }
  const sorted = [...tiers].sort((a, b) => Number(a.min ?? 0) - Number(b.min ?? 0));

  if (method === 'linear') {
    const highest = Math.max(...sorted.map((t) => Number(t.max ?? 0)));
    const score = highest > 0 ? Math.min((raw / highest) * maxScore, maxScore) : 0;
    return {
      score: roundTo2(score),
      tier: null,
      ok: true,
      explanation: `linear: ${raw} / ${highest} x ${maxScore} = ${roundTo2(score)}`,
    };
  }

  let matched = sorted.find((t) => raw >= Number(t.min ?? 0) && raw <= Number(t.max ?? Infinity)) ?? null;
  if (!matched) {
    const candidates = sorted.filter((t) => raw >= Number(t.min ?? 0));
    matched = candidates.length > 0 ? candidates[candidates.length - 1] : null;
  }
  return {
    score: Number(matched?.score ?? 0),
    tier: matched,
    ok: true,
    explanation: `${method || 'tiered'}: measurement ${raw} matched tier ${
      matched?.label ?? `${matched?.min}-${matched?.max}`
    } (points ${matched?.score ?? 0})`,
  };
}

/**
 * Preview scoring used by the configuration simulator. Mirrors
 * ce_score_employer_risk_v1: factors in configuration_error never silently
 * contribute zero — they are reported and excluded from the total, and the
 * overall calculation is flagged as a configuration error.
 */
export function previewScore(
  factors: RiskFactorDefinition[],
  measurements: Record<string, number>,
  bands: RiskBandDefinition[],
): {
  total_score: number;
  risk_band: string | null;
  calculation_status: 'OPERATIONAL' | 'CONFIGURATION_ERROR';
  factors: EvaluatedFactor[];
} {
  const active = factors.filter((f) => f.is_active !== false);
  const results: EvaluatedFactor[] = [];
  let total = 0;
  let status: 'OPERATIONAL' | 'CONFIGURATION_ERROR' = 'OPERATIONAL';

  for (const factor of active) {
    const { status: fStatus, reason } = factorStatus(factor);
    const raw = Number(measurements[factor.canonical_factor ?? factor.factor_code] ?? 0);
    const evaluation = evaluateThreshold(
      raw,
      factor.scoring_method,
      normaliseThresholds(factor.thresholds),
      Number(factor.max_score ?? 100),
    );
    const contribution =
      fStatus === 'configuration_error' ? 0 : roundTo2((evaluation.score * Number(factor.weight || 0)) / 100);
    if (fStatus === 'configuration_error') status = 'CONFIGURATION_ERROR';
    else total += contribution;

    results.push({
      factor_code: factor.factor_code,
      factor_name: factor.factor_name,
      canonical_factor: factor.canonical_factor,
      status: fStatus,
      raw_measurement: raw,
      factor_score: fStatus === 'configuration_error' ? 0 : evaluation.score,
      weight_pct: Number(factor.weight || 0),
      weighted_contribution: contribution,
      threshold_used: evaluation.tier,
      explanation:
        fStatus === 'configuration_error'
          ? `CONFIGURATION ERROR — ${reason}`
          : evaluation.explanation,
    });
  }

  total = roundTo2(total);
  return {
    total_score: total,
    risk_band: resolveBand(total, bands)?.band_name ?? null,
    calculation_status: status,
    factors: results,
  };
}
