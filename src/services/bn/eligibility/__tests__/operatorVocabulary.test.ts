/**
 * BUG-49 — 55 of 68 active rules failed every claimant, whatever her record.
 *
 * Reported from the screen: claim BN-20260826-62159, Eligibility tab.
 *
 *   Medical certificate not provided   MEDICAL_CERT_REQUIRED
 *   document.medical_certificate_received
 *   Actual: true    Op: BOOLEAN    Required: true    →   FAILED
 *
 * `true == true` reported as a failure. The document had been uploaded and was
 * being found — the Source column read `bn_claim_evidence`, so BUG-47's fix was
 * working — but the comparison never happened.
 *
 * `evaluateOperator` implemented only the symbol spellings. Rules are stored in
 * two vocabularies, and the live split was:
 *
 *   BOOLEAN            18      GREATER_OR_EQUAL   15      EQUALS    9
 *   LESS_THAN           4      LESS_OR_EQUAL       4      EXISTS    4
 *   GREATER_THAN        1      —  55 rules the engine could not apply
 *   =  8   >=  2   <=  1   <  1   >  1              —  13 it could
 *
 * A word spelling matched no case in the switch and fell to `default`, which
 * returned `passed: false`. The evaluator recorded that as FAIL. So the answer
 * to "find an SSN that passes eligibility" was that none exists: 81% of active
 * rules were unpassable by arithmetic, not by any claimant's circumstances.
 *
 * The mirror of BUG-02, where the technical-review gate accepted only the word
 * spelling and rejected the symbols the authoring form wrote. That was fixed in
 * `canonicalOperator`; the runtime was never told. One vocabulary now serves
 * both, so the gate and the engine cannot disagree again.
 */
import { describe, it, expect } from 'vitest';
import {
  CANONICAL_OPERATORS,
  canonicalOperator,
  evaluateOperator,
} from '../operatorEvaluator';
import { RULE_OPERATORS } from '@/services/bn/ruleCatalogueService';

describe('the reported case', () => {
  it('true == true with operator BOOLEAN passes', () => {
    const r = evaluateOperator(true, 'BOOLEAN' as any, true, 'boolean');
    expect(r.passed).toBe(true);
    expect(r.evaluable).toBe(true);
  });

  it('a BOOLEAN rule whose stored value is the string "true" passes', () => {
    // rule_definition: { operator: 'BOOLEAN', value_from: 'true' }
    const r = evaluateOperator(true, 'BOOLEAN' as any, 'true', 'boolean');
    expect(r.passed).toBe(true);
  });

  it('a BOOLEAN rule carrying no value asserts the fact is true', () => {
    expect(evaluateOperator(true, 'BOOLEAN' as any, undefined, 'boolean').passed).toBe(true);
    expect(evaluateOperator(false, 'BOOLEAN' as any, undefined, 'boolean').passed).toBe(false);
  });

  it('still fails when the document genuinely is not there', () => {
    const r = evaluateOperator(false, 'BOOLEAN' as any, true, 'boolean');
    expect(r.passed).toBe(false);
    expect(r.evaluable).toBe(true);
  });
});

describe('every operator in live data is applicable', () => {
  /** Exactly the operators the 68 active rules carry, with their counts. */
  const LIVE = [
    ['BOOLEAN', 18], ['GREATER_OR_EQUAL', 15], ['EQUALS', 9], ['=', 8],
    ['LESS_THAN', 4], ['LESS_OR_EQUAL', 4], ['EXISTS', 4], ['>=', 2],
    ['<=', 1], ['<', 1], ['GREATER_THAN', 1], ['>', 1],
  ] as const;

  it('recognises all twelve spellings found in the database', () => {
    for (const [op] of LIVE) {
      expect(canonicalOperator(op), op).not.toBeNull();
    }
  });

  it('applies all twelve — none falls through to "not implemented"', () => {
    for (const [op] of LIVE) {
      // BOOLEAN asks a true/false question, so it is probed with one. Handing
      // it 5 is correctly unevaluable -- 5 is not a boolean.
      const r = op === 'BOOLEAN'
        ? evaluateOperator(true, op as any, true, 'boolean')
        : op === 'EXISTS'
          ? evaluateOperator('X', op as any, null, 'string')
          : evaluateOperator(5, op as any, 3, 'number');
      expect(r.evaluable, `${op}: ${r.reason}`).toBe(true);
    }
  });

  it('BOOLEAN refuses a value that is not a boolean, rather than guessing', () => {
    const r = evaluateOperator(5, 'BOOLEAN' as any, true, 'number');
    expect(r.evaluable).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('accounts for all 68 active rules', () => {
    expect(LIVE.reduce((sum, [, n]) => sum + n, 0)).toBe(68);
  });
});

describe('word and symbol spellings agree', () => {
  const pairs = [
    ['>=', 'GREATER_OR_EQUAL'],
    ['>', 'GREATER_THAN'],
    ['<=', 'LESS_OR_EQUAL'],
    ['<', 'LESS_THAN'],
    ['=', 'EQUALS'],
    ['==', 'EQUALS'],
    ['!=', 'NOT_EQUALS'],
    ['<>', 'NOT_EQUALS'],
  ] as const;

  it('canonicalise to the same operator', () => {
    for (const [sym, word] of pairs) {
      expect(canonicalOperator(sym), sym).toBe(word);
    }
  });

  it('produce the same verdict on the same values', () => {
    for (const [sym, word] of pairs) {
      for (const [actual, expected] of [[5, 3], [3, 5], [4, 4]] as const) {
        const a = evaluateOperator(actual, sym as any, expected, 'number');
        const b = evaluateOperator(actual, word as any, expected, 'number');
        expect(b.passed, `${actual} ${sym}/${word} ${expected}`).toBe(a.passed);
      }
    }
  });
});

describe('the comparisons themselves', () => {
  it('GREATER_OR_EQUAL — the contribution-weeks case', () => {
    expect(evaluateOperator(26, 'GREATER_OR_EQUAL' as any, 26, 'number').passed).toBe(true);
    expect(evaluateOperator(27, 'GREATER_OR_EQUAL' as any, 26, 'number').passed).toBe(true);
    expect(evaluateOperator(25, 'GREATER_OR_EQUAL' as any, 26, 'number').passed).toBe(false);
  });

  it('EQUALS on an enumerated status', () => {
    expect(evaluateOperator('VERIFIED', 'EQUALS' as any, 'VERIFIED', 'string').passed).toBe(true);
    expect(evaluateOperator('RECEIVED', 'EQUALS' as any, 'VERIFIED', 'string').passed).toBe(false);
  });

  it('NOT_EQUALS', () => {
    expect(evaluateOperator('REJECTED', 'NOT_EQUALS' as any, 'VERIFIED', 'string').passed).toBe(true);
    expect(evaluateOperator('VERIFIED', 'NOT_EQUALS' as any, 'VERIFIED', 'string').passed).toBe(false);
  });

  it('EXISTS answers absence rather than reporting a gap', () => {
    const present = evaluateOperator('APPROVED', 'EXISTS' as any, null, 'string');
    expect(present.passed).toBe(true);
    expect(present.evaluable).toBe(true);

    const absent = evaluateOperator(null, 'EXISTS' as any, null, 'string');
    expect(absent.passed).toBe(false);
    // Absence IS the answer for EXISTS, so this is evaluated, not a gap.
    expect(absent.evaluable).toBe(true);
  });

  it('IN and NOT_IN', () => {
    expect(evaluateOperator('B', 'IN' as any, ['A', 'B'], 'string').passed).toBe(true);
    expect(evaluateOperator('C', 'IN' as any, ['A', 'B'], 'string').passed).toBe(false);
    expect(evaluateOperator('C', 'NOT_IN' as any, ['A', 'B'], 'string').passed).toBe(true);
    expect(evaluateOperator('A', 'NOT_IN' as any, ['A', 'B'], 'string').passed).toBe(false);
  });

  it('IN accepts a comma-separated list, as rules store it', () => {
    expect(evaluateOperator('B', 'IN' as any, 'A, B, C', 'string').passed).toBe(true);
    expect(evaluateOperator('D', 'IN' as any, 'A, B, C', 'string').passed).toBe(false);
  });

  it('CONTAINS is case-insensitive', () => {
    expect(evaluateOperator('WORK RELATED INJURY', 'CONTAINS' as any, 'injury', 'string').passed).toBe(true);
    expect(evaluateOperator('ILLNESS', 'CONTAINS' as any, 'injury', 'string').passed).toBe(false);
  });

  it('BETWEEN — the age range case', () => {
    const r = (n: number) => evaluateOperator(n, 'BETWEEN' as any, null, 'number', { rangeFrom: 16, rangeTo: 65 });
    expect(r(38).passed).toBe(true);
    expect(r(16).passed).toBe(true);
    expect(r(65).passed).toBe(true);
    expect(r(15).passed).toBe(false);
    expect(r(66).passed).toBe(false);
  });
});

describe('an inapplicable rule is not a claimant’s failure', () => {
  it('an operator the engine does not implement is unevaluable', () => {
    const r = evaluateOperator(5, 'APPROXIMATELY' as any, 3, 'number');
    expect(r.evaluable).toBe(false);
    // Not `passed: true` either -- unevaluable is blocking, never a free pass.
    expect(r.passed).toBe(false);
  });

  it('says which operator it could not apply', () => {
    const r = evaluateOperator(5, 'APPROXIMATELY' as any, 3, 'number');
    expect(r.reason).toContain('APPROXIMATELY');
  });

  it('an empty operator is unevaluable', () => {
    for (const op of ['', '   ', null, undefined]) {
      expect(evaluateOperator(5, op as any, 3, 'number').evaluable, String(op)).toBe(false);
    }
  });

  it('an unreadable expected value is unevaluable, not a failure', () => {
    const r = evaluateOperator(26, 'GREATER_OR_EQUAL' as any, 'not-a-number', 'number');
    expect(r.evaluable).toBe(false);
    expect(r.passed).toBe(false);
  });

  it('a BETWEEN missing one bound is unevaluable', () => {
    const r = evaluateOperator(38, 'BETWEEN' as any, null, 'number', { rangeFrom: 16 });
    expect(r.evaluable).toBe(false);
  });

  it('an unresolved actual value is unevaluable', () => {
    const r = evaluateOperator(null, 'GREATER_OR_EQUAL' as any, 26, 'number');
    expect(r.evaluable).toBe(false);
  });

  it('does not upper-case an unrelated word into a valid operator', () => {
    expect(canonicalOperator('greater')).toBeNull();
    expect(canonicalOperator('&')).toBeNull();
    expect(canonicalOperator('=~')).toBeNull();
  });
});

describe('there is one vocabulary, and it cannot drift', () => {
  it('every canonical operator is applicable by the engine', () => {
    // If CANONICAL_OPERATORS gains a member the switch does not implement, the
    // gate would accept a rule the engine then cannot apply -- exactly the
    // split that caused this bug.
    for (const op of CANONICAL_OPERATORS) {
      const probe =
        op === 'BETWEEN'
          ? evaluateOperator(5, op as any, null, 'number', { rangeFrom: 1, rangeTo: 9 })
          : op === 'IN' || op === 'NOT_IN'
            ? evaluateOperator('A', op as any, ['A'], 'string')
            : op === 'EXISTS'
              ? evaluateOperator('X', op as any, null, 'string')
              : op === 'CONTAINS'
                ? evaluateOperator('ABC', op as any, 'B', 'string')
                : op === 'BOOLEAN'
                  ? evaluateOperator(true, op as any, true, 'boolean')
                  : evaluateOperator(5, op as any, 3, 'number');
      expect(probe.evaluable, `${op}: ${probe.reason}`).toBe(true);
    }
  });

  it('the authoring dropdown offers exactly what the engine implements', () => {
    // RULE_OPERATORS drives the Rule Catalogue form. An operator offered there
    // but not implemented here would produce rules that can never pass.
    expect([...RULE_OPERATORS].sort()).toEqual([...CANONICAL_OPERATORS].sort());
  });

  it('governance and the engine share one canonicalOperator', async () => {
    const gov = await import('@/services/bn/governance/ruleGovernanceService');
    expect(gov.canonicalOperator).toBe(canonicalOperator);
  });
});
