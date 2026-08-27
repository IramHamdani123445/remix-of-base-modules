/**
 * The technical review gate rejected valid rules.
 *
 * `bn_eligibility_fact.allowed_operators` stores symbols — ["=", "!=", ">",
 * ">=", "<", "<=", "between"] — and the Rule Catalogue form sets a rule's
 * operator from that list when a fact is chosen. The gate accepted only the
 * word spelling, so it refused the value the form itself had written.
 *
 * Live data at the time: 55 rules on the word spelling (allowed) and 13 on the
 * symbol spelling (blocked), including MIN_TOTAL_CONTRIBUTIONS_02 with a
 * perfectly valid `contribution.total_weeks` + `=`.
 */
import { describe, it, expect } from 'vitest';
import { canonicalOperator } from '../ruleGovernanceService';

describe('the symbol spelling is accepted', () => {
  it('accepts every operator bn_eligibility_fact actually offers', () => {
    // Exactly the array stored against contribution.total_weeks.
    const offered = ['=', '!=', '>', '>=', '<', '<=', 'between'];
    for (const op of offered) {
      expect(canonicalOperator(op), op).not.toBeNull();
    }
  });

  it('maps each symbol to the right canonical operator', () => {
    expect(canonicalOperator('=')).toBe('EQUALS');
    expect(canonicalOperator('==')).toBe('EQUALS');
    expect(canonicalOperator('!=')).toBe('NOT_EQUALS');
    expect(canonicalOperator('<>')).toBe('NOT_EQUALS');
    expect(canonicalOperator('>')).toBe('GREATER_THAN');
    expect(canonicalOperator('>=')).toBe('GREATER_OR_EQUAL');
    expect(canonicalOperator('<')).toBe('LESS_THAN');
    expect(canonicalOperator('<=')).toBe('LESS_OR_EQUAL');
  });

  it('is the case that broke MIN_TOTAL_CONTRIBUTIONS_02', () => {
    // fact_key contribution.total_weeks, operator '=' — a valid rule that
    // could not pass technical review.
    expect(canonicalOperator('=')).toBe('EQUALS');
  });
});

describe('the word spelling still works', () => {
  it('accepts every canonical operator unchanged', () => {
    const words = [
      'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_OR_EQUAL',
      'LESS_THAN', 'LESS_OR_EQUAL', 'BETWEEN', 'IN', 'NOT_IN',
      'BOOLEAN', 'EXISTS', 'CONTAINS',
    ];
    for (const op of words) {
      expect(canonicalOperator(op), op).toBe(op);
    }
  });

  it('tolerates lower case and surrounding whitespace', () => {
    expect(canonicalOperator('between')).toBe('BETWEEN');
    expect(canonicalOperator(' greater_or_equal ')).toBe('GREATER_OR_EQUAL');
    expect(canonicalOperator('exists')).toBe('EXISTS');
  });
});

describe('the check is widened, not removed', () => {
  it('still rejects an operator in neither vocabulary', () => {
    for (const bad of ['APPROX', 'LIKE', '=~', 'GREATER', '>>', 'BOOLEANISH']) {
      expect(canonicalOperator(bad), bad).toBeNull();
    }
  });

  it('rejects an empty or missing operator', () => {
    expect(canonicalOperator('')).toBeNull();
    expect(canonicalOperator('   ')).toBeNull();
    expect(canonicalOperator(null)).toBeNull();
    expect(canonicalOperator(undefined)).toBeNull();
  });

  it('does not upper-case a symbol into a false match', () => {
    // A guard against normalising by upper-casing alone, which would turn
    // unrelated input into a valid-looking operator.
    expect(canonicalOperator('in')).toBe('IN');
    expect(canonicalOperator('&')).toBeNull();
  });
});

describe('the fact registry offers three different shapes — all must work', () => {
  /**
   * Live bn_eligibility_fact data across 75 facts:
   *   53 store symbols       ["=", "!=", ">", ">=", "<", "<=", "between"]
   *    2 store words         ["EQUALS", ...]
   *   20 store an empty list []
   *
   * The Rule Catalogue form set a rule's operator from whichever shape the
   * chosen fact used, so the same field produced values in two vocabularies —
   * and the gate accepted only one of them.
   */
  const RULE_OPERATORS = [
    'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_OR_EQUAL',
    'LESS_THAN', 'LESS_OR_EQUAL', 'BETWEEN', 'IN', 'NOT_IN',
    'BOOLEAN', 'EXISTS', 'CONTAINS',
  ];

  /** Mirrors the dropdown's option builder. */
  const optionsFor = (allowed: string[] | null | undefined): string[] => {
    if (!Array.isArray(allowed) || allowed.length === 0) return [...RULE_OPERATORS];
    const canon = new Set(allowed.map(o => canonicalOperator(o)).filter((o): o is string => !!o));
    const restricted = RULE_OPERATORS.filter(o => canon.has(o));
    return restricted.length > 0 ? restricted : [...RULE_OPERATORS];
  };

  it('a symbol-form fact yields canonical options the gate accepts', () => {
    // contribution.total_weeks
    const opts = optionsFor(['=', '!=', '>', '>=', '<', '<=', 'between']);
    expect(opts).toEqual([
      'EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_OR_EQUAL',
      'LESS_THAN', 'LESS_OR_EQUAL', 'BETWEEN',
    ]);
    for (const o of opts) expect(canonicalOperator(o), o).toBe(o);
  });

  it('a fact with an empty list permits every operator, never an empty dropdown', () => {
    // approved_days and 19 others
    expect(optionsFor([])).toEqual(RULE_OPERATORS);
    expect(optionsFor(null)).toEqual(RULE_OPERATORS);
    expect(optionsFor(undefined)).toEqual(RULE_OPERATORS);
  });

  it('a word-form fact is unchanged', () => {
    expect(optionsFor(['EQUALS', 'GREATER_THAN'])).toEqual(['EQUALS', 'GREATER_THAN']);
  });

  it('the fact still restricts the choice — normalising is not widening', () => {
    const opts = optionsFor(['>=', '<=']);
    expect(opts).toEqual(['GREATER_OR_EQUAL', 'LESS_OR_EQUAL']);
    expect(opts).not.toContain('EQUALS');
    expect(opts).not.toContain('BETWEEN');
  });

  it('a fact listing only unrecognised operators still offers a usable choice', () => {
    // Rather than an empty dropdown with nothing selectable.
    expect(optionsFor(['APPROX', 'LIKE'])).toEqual(RULE_OPERATORS);
  });

  it('every shape produces a value the gate accepts', () => {
    const shapes = [
      ['=', '!=', '>', '>=', '<', '<=', 'between'],
      ['EQUALS', 'GREATER_THAN'],
      [],
      ['APPROX'],
    ];
    for (const shape of shapes) {
      for (const o of optionsFor(shape)) {
        expect(canonicalOperator(o), `${JSON.stringify(shape)} → ${o}`).not.toBeNull();
      }
    }
  });
});
