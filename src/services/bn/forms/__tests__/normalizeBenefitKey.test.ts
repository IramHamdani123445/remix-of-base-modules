import { describe, it, expect } from 'vitest';
import { normalizeBenefitKey } from '../sectionCatalogue';

/**
 * BUG-51 — resolution must be general. Every live bn_product code is asserted
 * explicitly: codes that already resolved keep their answer, newly resolving
 * codes are pinned, and junk/service codes must stay null.
 */
describe('normalizeBenefitKey — live product catalogue', () => {
  const RESOLVED_BEFORE: Array<[string, string]> = [
    ['SKN-SICK', 'SICKNESS'],
    ['SKN-MAT', 'MATERNITY'],
    ['SKN-EI-INJ', 'EMPLOYMENT_INJURY'],
    ['SKN-EI-DIS', 'DISABLEMENT'],
    ['SKN-EI-MED', 'MEDICAL_EXPENSE'],
    ['SKN-EI-DTH', 'EMPLOYMENT_INJURY_DEATH'],
    ['SKN-FUN', 'FUNERAL_GRANT'],
    ['SKN-AGE', 'AGE_BENEFIT'],
    ['SKN-INV', 'INVALIDITY'],
    ['SKN-SUR', 'SURVIVORS'],
    ['SKN-NCP', 'NON_CONTRIBUTORY_PENSION'],
    ['AGE_BENEFIT', 'AGE_BENEFIT'],
  ];

  const RESOLVED_NOW: Array<[string, string]> = [
    ['MAT', 'MATERNITY'],
    ['MATERNITY_GRANT_TEST', 'MATERNITY'],
    ['TEST-MAT-GRANT', 'MATERNITY'],
    ['SKN-MAT-GRANT', 'MATERNITY'],
    ['SICK_11', 'SICKNESS'],
    ['SICK_BE_2027', 'SICKNESS'],
    ['SICKNESS_BENEFIT_S1', 'SICKNESS'],
    ['SKN-STB-SICK', 'SICKNESS'],
    ['FUN_GRANT', 'FUNERAL_GRANT'],
    ['SKN-AGEG', 'AGE_BENEFIT'],
    ['SKN-EI-DIS-G', 'DISABLEMENT'],
    ['SKN-SUR-GRANT', 'SURVIVORS'],
  ];

  const UNRESOLVED = [
    'ABCZ',
    'TEST',
    'TESTGOV01',
    'EIB_TEST_001',
    'EXCEPTURI NISI QUI D',
    'SIP',
    'SKN-REFUND',
    'SKN-SRF',
    'SKN-SVC-EFT',
    'SKN-SVC-EIR',
    'SKN-SVC-LIFE',
    'SKN-SVC-SCH',
  ];

  it.each(RESOLVED_BEFORE)('keeps %s → %s', (code, expected) => {
    expect(normalizeBenefitKey(code)).toBe(expected);
  });

  it.each(RESOLVED_NOW)('now resolves %s → %s', (code, expected) => {
    expect(normalizeBenefitKey(code)).toBe(expected);
  });

  it.each(UNRESOLVED)('leaves %s unresolved', (code) => {
    expect(normalizeBenefitKey(code)).toBeNull();
  });

  it('handles empty input', () => {
    expect(normalizeBenefitKey(null)).toBeNull();
    expect(normalizeBenefitKey('')).toBeNull();
  });
});
