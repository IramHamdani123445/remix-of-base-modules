/**
 * IA Phase-C — F-14/F-16 certification for annual plan capacity arithmetic.
 */
import { describe, it, expect } from 'vitest';
import {
  calculateCapacity,
  extractQuarterLoads,
  getEngagementHours,
  analyzeDistribution,
  getDefaultCapacityConfig,
} from '../capacityPlanner';

const CONFIG = { auditorCount: 5, monthlyWorkingHours: 160, utilizationPct: 85, bufferPct: 10 };

describe('calculateCapacity', () => {
  it('derives gross, effective, buffer and net hours deterministically', () => {
    const s = calculateCapacity(CONFIG);
    expect(s.annualGrossHours).toBe(9600); // 5 × 160 × 12
    expect(s.annualEffectiveHours).toBe(8160); // 85%
    expect(s.bufferHours).toBe(816); // 10% of effective
    expect(s.annualNetHours).toBe(7344);
    expect(s.quarterlyNetHours).toBe(1836);
    expect(s.perAuditorAnnualHours).toBe(1468.8);
  });

  it('does not divide by zero when there are no auditors', () => {
    const s = calculateCapacity({ ...CONFIG, auditorCount: 0 });
    expect(s.annualNetHours).toBe(0);
    expect(s.perAuditorAnnualHours).toBe(0);
    expect(Number.isNaN(s.perAuditorQuarterlyHours)).toBe(false);
  });

  it('exposes a sane default configuration', () => {
    const d = getDefaultCapacityConfig(3);
    expect(d.auditorCount).toBe(3);
    expect(d.monthlyWorkingHours).toBeGreaterThan(0);
    expect(d.utilizationPct).toBeGreaterThan(0);
    expect(d.utilizationPct).toBeLessThanOrEqual(100);
  });
});

describe('getEngagementHours', () => {
  it('prefers estimated_hours over derived day hours', () => {
    expect(getEngagementHours({ estimated_hours: 120, estimated_days: 5 })).toBe(120);
  });

  it('falls back to days × 8', () => {
    expect(getEngagementHours({ estimated_days: 5 })).toBe(40);
  });

  it('returns 0 when neither is present', () => {
    expect(getEngagementHours({})).toBe(0);
    expect(getEngagementHours({ estimated_hours: 0, estimated_days: 0 })).toBe(0);
  });
});

describe('extractQuarterLoads', () => {
  const engagements = [
    { quarter: 'Q1', estimated_hours: 120, engagement_risk_rating: 'Critical' },
    { quarter: 'Q1', estimated_hours: 100, engagement_risk_rating: 'High' },
    { quarter: 'Q2', estimated_hours: 80, engagement_risk_rating: 'High' },
    { quarter: 'Q3', estimated_hours: 60, engagement_risk_rating: 'Medium' },
    { quarter: 'Q4', estimated_hours: 40, engagement_risk_rating: 'Low' },
    { quarter: 'Q4', estimated_hours: 999, engagement_risk_rating: 'Low', is_active: false },
  ];

  it('always returns four quarters, excluding inactive engagements', () => {
    const loads = extractQuarterLoads(engagements);
    expect(loads.map((l) => l.quarter)).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(loads[0].engagementCount).toBe(2);
    expect(loads[0].totalHours).toBe(220);
    expect(loads[0].highRiskCount).toBe(2); // High + Critical
    expect(loads[3].totalHours).toBe(40); // inactive row ignored
  });

  it('returns zeroed quarters for an empty plan', () => {
    const loads = extractQuarterLoads([]);
    expect(loads).toHaveLength(4);
    expect(loads.every((l) => l.engagementCount === 0 && l.totalHours === 0)).toBe(true);
  });
});

describe('analyzeDistribution', () => {
  it('flags an overloaded quarter and keeps utilization finite', () => {
    const result = analyzeDistribution(CONFIG, [
      { quarter: 'Q1', estimated_hours: 100000, engagement_risk_rating: 'High' },
    ]);
    const q1 = result.quarters.find((q) => q.quarter === 'Q1')!;
    expect(q1.status).toBe('overloaded');
    expect(Number.isFinite(q1.utilizationPct)).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('suggests a quarter for the next engagement when capacity remains', () => {
    const result = analyzeDistribution(CONFIG, [
      { quarter: 'Q1', estimated_hours: 1500, engagement_risk_rating: 'High' },
    ]);
    expect(['Q1', 'Q2', 'Q3', 'Q4']).toContain(result.suggestedQuarter);
    expect(result.suggestedQuarter).not.toBe('Q1');
  });
});

