import { describe, it, expect } from 'vitest';
import {
  CANONICAL_FACTORS,
  evaluateThreshold,
  factorStatus,
  previewScore,
  resolveBand,
  validateRiskPolicy,
  type RiskBandDefinition,
  type RiskFactorDefinition,
} from '@/lib/compliance/risk/riskModel';

const BANDS: RiskBandDefinition[] = [
  { band_name: 'LOW', score_range_min: 0, score_range_max: 25 },
  { band_name: 'MEDIUM', score_range_min: 25, score_range_max: 50 },
  { band_name: 'HIGH', score_range_min: 50, score_range_max: 75 },
  { band_name: 'CRITICAL', score_range_min: 75, score_range_max: 100 },
];

const tiers = [
  { min: 0, max: 0, score: 0, label: 'None' },
  { min: 1, max: 2, score: 40, label: 'Low' },
  { min: 3, max: 5, score: 70, label: 'Elevated' },
  { min: 6, max: 999, score: 100, label: 'Severe' },
];

function factor(overrides: Partial<RiskFactorDefinition> = {}): RiskFactorDefinition {
  return {
    factor_code: 'payment_compliance',
    factor_name: 'Payment / Contribution Compliance',
    canonical_factor: 'PAYMENT',
    measurement_code: 'PAYMENT_OVERDUE_RATIO',
    scoring_method: 'tiered',
    thresholds: tiers,
    max_score: 100,
    weight: 30,
    lifecycle_status: 'ACTIVE',
    is_active: true,
    ...overrides,
  };
}

function fiveFactorModel(): RiskFactorDefinition[] {
  const weights: Record<string, number> = {
    PAYMENT: 30,
    FILING: 20,
    VIOLATION: 20,
    ARRANGEMENT: 10,
    LEGAL: 20,
  };
  return CANONICAL_FACTORS.map((c) =>
    factor({
      factor_code: c.code.toLowerCase(),
      factor_name: c.label,
      canonical_factor: c.code,
      measurement_code: `${c.code}_MEASURE`,
      weight: weights[c.code],
    }),
  );
}

describe('Checkpoint E — five-factor risk model', () => {
  it('defines exactly the five approved factors', () => {
    expect(CANONICAL_FACTORS.map((f) => f.code)).toEqual([
      'PAYMENT',
      'FILING',
      'VIOLATION',
      'ARRANGEMENT',
      'LEGAL',
    ]);
  });

  it('accepts the approved model with weights totalling exactly 100%', () => {
    const result = validateRiskPolicy(fiveFactorModel(), BANDS);
    expect(result.weightTotal).toBe(100);
    expect(result.valid).toBe(true);
    expect(result.factorStatuses.every((f) => f.status === 'operational')).toBe(true);
  });

  it('rejects a policy whose weights do not total 100%', () => {
    const model = fiveFactorModel();
    model[0].weight = 20; // 90% total
    const result = validateRiskPolicy(model, BANDS);
    expect(result.weightTotal).toBe(90);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('must equal exactly 100%');
  });

  it('flags a weighted factor with no scoring logic as a configuration error', () => {
    const model = fiveFactorModel();
    model[1].thresholds = [];
    const result = validateRiskPolicy(model, BANDS);
    expect(result.valid).toBe(false);
    expect(result.factorStatuses[1].status).toBe('configuration_error');
    expect(result.errors.join(' ')).toContain('no scoring thresholds');
  });

  it('flags a weighted factor with no runtime measurement source', () => {
    const status = factorStatus(factor({ measurement_code: null }));
    expect(status.status).toBe('configuration_error');
  });

  it('reports a retired factor left active in the policy', () => {
    const status = factorStatus(factor({ lifecycle_status: 'RETIRED' }));
    expect(status.status).toBe('configuration_error');
  });

  it('rejects gaps and overlaps in risk bands', () => {
    const gap = validateRiskPolicy(fiveFactorModel(), [
      { band_name: 'LOW', score_range_min: 0, score_range_max: 25 },
      { band_name: 'HIGH', score_range_min: 40, score_range_max: 100 },
    ]);
    expect(gap.valid).toBe(false);
    expect(gap.errors.join(' ')).toContain('Gap in risk bands');

    const overlap = validateRiskPolicy(fiveFactorModel(), [
      { band_name: 'LOW', score_range_min: 0, score_range_max: 40 },
      { band_name: 'HIGH', score_range_min: 30, score_range_max: 100 },
    ]);
    expect(overlap.valid).toBe(false);
    expect(overlap.errors.join(' ')).toContain('Overlapping');
  });

  it('rejects bands that do not cover the full range to 100', () => {
    const result = validateRiskPolicy(fiveFactorModel(), [
      { band_name: 'LOW', score_range_min: 0, score_range_max: 25 },
      { band_name: 'HIGH', score_range_min: 25, score_range_max: 80 },
    ]);
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toContain('must cover the full score range');
  });
});

describe('Checkpoint E — band boundaries are configuration-driven', () => {
  it.each([
    [0, 'LOW'],
    [24.99, 'LOW'],
    [25, 'MEDIUM'],
    [49.99, 'MEDIUM'],
    [50, 'HIGH'],
    [74.99, 'HIGH'],
    [75, 'CRITICAL'],
    [100, 'CRITICAL'],
  ])('score %s resolves to band %s', (score, band) => {
    expect(resolveBand(score as number, BANDS)?.band_name).toBe(band);
  });

  it('follows edited band cut-offs without code changes', () => {
    const edited: RiskBandDefinition[] = [
      { band_name: 'LOW', score_range_min: 0, score_range_max: 60 },
      { band_name: 'HIGH', score_range_min: 60, score_range_max: 100 },
    ];
    expect(resolveBand(55, edited)?.band_name).toBe('LOW');
    expect(resolveBand(55, BANDS)?.band_name).toBe('HIGH');
  });
});

describe('Checkpoint E — deterministic scoring', () => {
  it('produces identical results for identical inputs', () => {
    const model = fiveFactorModel();
    const measurements = { PAYMENT: 4, FILING: 2, VIOLATION: 1, ARRANGEMENT: 0, LEGAL: 6 };
    const a = previewScore(model, measurements, BANDS);
    const b = previewScore(model, measurements, BANDS);
    expect(a.total_score).toBe(b.total_score);
    expect(a.risk_band).toBe(b.risk_band);
  });

  it('weights each factor contribution correctly', () => {
    const model = fiveFactorModel();
    // PAYMENT raw 4 -> 70 pts x 30% = 21 ; LEGAL raw 6 -> 100 x 20% = 20
    const result = previewScore(model, { PAYMENT: 4, LEGAL: 6 }, BANDS);
    const payment = result.factors.find((f) => f.canonical_factor === 'PAYMENT')!;
    const legal = result.factors.find((f) => f.canonical_factor === 'LEGAL')!;
    expect(payment.weighted_contribution).toBe(21);
    expect(legal.weighted_contribution).toBe(20);
    expect(result.total_score).toBe(41);
    expect(result.risk_band).toBe('MEDIUM');
  });

  it('a clean employer scores zero and lands in the lowest band', () => {
    const result = previewScore(fiveFactorModel(), {}, BANDS);
    expect(result.total_score).toBe(0);
    expect(result.risk_band).toBe('LOW');
  });

  it('never silently scores a broken factor as zero — it reports a configuration error', () => {
    const model = fiveFactorModel();
    model[2].thresholds = null;
    const result = previewScore(model, { VIOLATION: 9 }, BANDS);
    expect(result.calculation_status).toBe('CONFIGURATION_ERROR');
    const broken = result.factors.find((f) => f.canonical_factor === 'VIOLATION')!;
    expect(broken.status).toBe('configuration_error');
    expect(broken.explanation).toContain('CONFIGURATION ERROR');
  });

  it('linear scoring scales proportionally', () => {
    const evaluation = evaluateThreshold(5, 'linear', [{ min: 0, max: 10, score: 100 }], 100);
    expect(evaluation.score).toBe(50);
  });

  it('scores above the highest tier use the highest tier', () => {
    const evaluation = evaluateThreshold(5000, 'tiered', tiers);
    expect(evaluation.score).toBe(100);
  });
});
