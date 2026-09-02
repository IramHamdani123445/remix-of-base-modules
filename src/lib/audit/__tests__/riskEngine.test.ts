/**
 * IA Phase-C — F-14 calculation certification for the audit risk engine.
 * Boundary values are asserted explicitly so band drift is caught immediately.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BANDS,
  textToScore,
  calculateScore,
  getRiskRating,
  calculateRiskLevel,
} from '../riskEngine';

describe('textToScore', () => {
  it('maps the five canonical labels', () => {
    expect(textToScore('Very Low')).toBe(1);
    expect(textToScore('Low')).toBe(2);
    expect(textToScore('Medium')).toBe(3);
    expect(textToScore('High')).toBe(4);
    expect(textToScore('Very High')).toBe(5);
  });

  it('defaults unknown labels to Medium (3) rather than throwing', () => {
    expect(textToScore('')).toBe(3);
    expect(textToScore('catastrophic')).toBe(3);
  });
});

describe('calculateScore', () => {
  it('multiplies by default', () => {
    expect(calculateScore(4, 5)).toBe(20);
    expect(calculateScore(4, 5, 'likelihood_x_impact')).toBe(20);
  });

  it('supports additive and weighted-average formulas', () => {
    expect(calculateScore(4, 5, 'likelihood_plus_impact')).toBe(9);
    expect(calculateScore(4, 5, 'weighted_average')).toBe(5);
    expect(calculateScore(1, 2, 'weighted_average')).toBe(2); // rounds 1.5 up
  });

  it('falls back to multiplication for an unknown formula', () => {
    expect(calculateScore(3, 3, 'not_a_formula')).toBe(9);
  });
});

describe('risk band classification boundaries', () => {
  const cases: Array<[number, string]> = [
    [1, 'Low'],
    [5, 'Low'],
    [6, 'Medium'],
    [10, 'Medium'],
    [11, 'High'],
    [15, 'High'],
    [16, 'Critical'],
    [25, 'Critical'],
  ];

  it.each(cases)('score %i classifies as %s', (score, label) => {
    expect(calculateRiskLevel(score)).toBe(label);
    expect(getRiskRating(score).label).toBe(label);
  });

  it('returns Unknown outside the configured scale instead of guessing', () => {
    expect(calculateRiskLevel(0)).toBe('Unknown');
    expect(calculateRiskLevel(26)).toBe('Unknown');
  });

  it('leaves no gaps or overlaps between the default bands', () => {
    const sorted = [...DEFAULT_BANDS].sort((a, b) => a.min_score - b.min_score);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min_score).toBe(sorted[i - 1].max_score + 1);
    }
  });

  it('honours custom bands supplied by configuration', () => {
    const bands = [
      { label: 'Acceptable', min_score: 1, max_score: 12, color: '#0f0', sort_order: 1 },
      { label: 'Unacceptable', min_score: 13, max_score: 25, color: '#f00', sort_order: 2 },
    ];
    expect(calculateRiskLevel(12, bands)).toBe('Acceptable');
    expect(calculateRiskLevel(13, bands)).toBe('Unacceptable');
  });
});
