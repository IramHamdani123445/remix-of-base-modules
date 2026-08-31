import { describe, it, expect } from 'vitest';
import {
  normalisePlanCandidateV3,
  normalisePlanCandidatesV3,
  normaliseRecommendationReasons,
} from '../planCandidateNormalizer';

const baseRow = {
  employer_id: 'emp-1',
  employer_name: 'Acme Ltd',
  bucket: 'MUST_SCHEDULE',
  mandatory_class: 'MANDATORY',
  derived_priority: 'HIGH',
  recommendation_reasons: [],
};

describe('planCandidateNormalizer', () => {
  it('drops JSON null slots in recommendation_reasons (regression: reading "label" of null)', () => {
    const reasons = normaliseRecommendationReasons([
      { code: 'INHERENT_RISK', label: 'Inherent risk', weight: 10 },
      null,
      { code: 'AUDIT_DUENESS', label: 'Audit due', weight: 5 },
      null,
    ]);
    expect(reasons).toHaveLength(2);
    expect(reasons.every((r) => typeof r.label === 'string')).toBe(true);
  });

  it('flags dropped reasons as a data issue instead of hiding them', () => {
    const { candidate } = normalisePlanCandidateV3({
      ...baseRow,
      recommendation_reasons: [null, { code: 'INHERENT_RISK' }],
    });
    expect(candidate?.recommendation_reasons).toHaveLength(1);
    expect(candidate?.data_issues?.some((i) => i.code === 'DROPPED_REASON')).toBe(true);
  });

  it('labels unconfigured reason codes explicitly', () => {
    const [reason] = normaliseRecommendationReasons([{ code: 'NEW_ENGINE_DIMENSION' }]);
    expect(reason.label).toBe('Unconfigured reason (NEW_ENGINE_DIMENSION)');
  });

  it('quarantines unknown governed values rather than treating them as routine', () => {
    const { candidate } = normalisePlanCandidateV3({
      ...baseRow,
      bucket: 'SOMETHING_NEW',
      mandatory_class: null,
    });
    expect(candidate?.bucket).toBe('CAMPAIGN_INTEL');
    expect(candidate?.mandatory_class).toBe('WATCHLIST');
    expect(candidate?.data_issues?.map((i) => i.field)).toEqual(
      expect.arrayContaining(['bucket', 'mandatory_class']),
    );
  });

  it('rejects candidates without an employer reference', () => {
    const { candidate, issues } = normalisePlanCandidateV3({ ...baseRow, employer_id: null });
    expect(candidate).toBeNull();
    expect(issues[0].code).toBe('MISSING_REQUIRED');
  });

  it('normalises a batch and reports rejected / degraded counts', () => {
    const batch = normalisePlanCandidatesV3([
      baseRow,
      { ...baseRow, employer_id: 'emp-2', recommendation_reasons: [null] },
      { ...baseRow, employer_id: '' },
      null,
      'not-an-object',
    ]);
    expect(batch.candidates).toHaveLength(2);
    expect(batch.rejected).toHaveLength(3);
    expect(batch.degradedCount).toBe(1);
  });

  it('coerces malformed numerics to safe defaults', () => {
    const { candidate } = normalisePlanCandidateV3({
      ...baseRow,
      estimated_effort: 'abc',
      financial_exposure: null,
      audit_priority_score: '42.5',
    });
    expect(candidate?.estimated_effort).toBe(0);
    expect(candidate?.financial_exposure).toBe(0);
    expect(candidate?.audit_priority_score).toBe(42.5);
  });
});
