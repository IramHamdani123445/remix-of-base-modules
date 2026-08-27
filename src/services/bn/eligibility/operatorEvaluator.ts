/**
 * Generic operator evaluator for eligibility rules.
 *
 * Compares an actual value (resolved from the field registry) against the
 * expected value declared on the rule.
 *
 * BUG-49 — this understood only the symbol spellings. Rules are stored in two
 * vocabularies: 13 of 68 active rules carry `>=`, `=`, `<`; the other 55 carry
 * `GREATER_OR_EQUAL`, `BOOLEAN`, `EQUALS`, `EXISTS`, `LESS_THAN`. A word
 * spelling fell through unchanged, reached the switch below, matched no case,
 * and returned `passed: false` — which the evaluator recorded as FAIL. So 55
 * of 68 active rules failed every claimant regardless of her record:
 * `document.medical_certificate_received` reported actual `true`, required
 * `true`, operator BOOLEAN, and FAILED.
 *
 * No claimant could satisfy those products, which is why no SSN could be found
 * that passed one.
 *
 * This is the mirror of BUG-02, where the technical-review gate accepted only
 * the word spelling and rejected the symbols the authoring form itself wrote.
 * That was fixed in `canonicalOperator`; the runtime was never told. The
 * vocabulary now lives here, in one place, and governance imports it — so the
 * gate and the engine cannot disagree about what an operator means again.
 */
import type { EligibilityOperator, EligibilityValueType } from './fieldRegistry';

export interface OperatorEvalResult {
  passed: boolean;
  reason: string;
  /**
   * False when the engine could not apply the rule at all — an operator it
   * does not implement, or an expected value it cannot read.
   *
   * Callers must record this as unevaluated, never as a failure. A rule the
   * engine cannot apply is not a rule the claimant failed, and reporting it as
   * one states something untrue about a person.
   */
  evaluable: boolean;
}

/** Every operator the engine implements, in canonical spelling. */
export const CANONICAL_OPERATORS = new Set([
  'EQUALS', 'NOT_EQUALS',
  'GREATER_THAN', 'GREATER_OR_EQUAL', 'LESS_THAN', 'LESS_OR_EQUAL',
  'BETWEEN', 'IN', 'NOT_IN',
  'BOOLEAN', 'EXISTS', 'CONTAINS',
]);

/**
 * Both spellings of every operator, mapped onto the canonical one.
 *
 * Symbols are matched before upper-casing. Upper-casing `<>` or `>=` changes
 * nothing, but an unrecognised word must not be upper-cased into something
 * that looks valid.
 */
const OPERATOR_SYNONYMS: Record<string, string> = {
  '=': 'EQUALS', '==': 'EQUALS', EQ: 'EQUALS',
  '!=': 'NOT_EQUALS', '<>': 'NOT_EQUALS', NE: 'NOT_EQUALS',
  '>': 'GREATER_THAN', GT: 'GREATER_THAN',
  '>=': 'GREATER_OR_EQUAL', GTE: 'GREATER_OR_EQUAL',
  '<': 'LESS_THAN', LT: 'LESS_THAN',
  '<=': 'LESS_OR_EQUAL', LTE: 'LESS_OR_EQUAL',
  RANGE: 'BETWEEN',
};

/**
 * The canonical form of an operator, whichever spelling was stored.
 * Returns null when the value is in neither vocabulary.
 */
export function canonicalOperator(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim();
  if (!v) return null;
  const upper = v.toUpperCase();
  if (CANONICAL_OPERATORS.has(upper)) return upper;
  return OPERATOR_SYNONYMS[v] ?? OPERATOR_SYNONYMS[upper] ?? null;
}

function coerce(value: unknown, type: EligibilityValueType): unknown {
  if (value === null || value === undefined || value === '') return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      const s = String(value).trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(s)) return true;
      if (['false', '0', 'no', 'n'].includes(s)) return false;
      return null;
    }
    case 'date': {
      const d = value instanceof Date ? value : new Date(String(value));
      return isNaN(d.getTime()) ? null : d.getTime();
    }
    case 'string':
    default:
      return String(value);
  }
}

function coerceList(value: unknown, type: EligibilityValueType): unknown[] {
  if (Array.isArray(value)) return value.map((v) => coerce(v, type));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((v) => coerce(v, type));
  }
  return [coerce(value, type)];
}

export function evaluateOperator(
  actualRaw: unknown,
  operator: EligibilityOperator,
  expectedRaw: unknown,
  valueType: EligibilityValueType,
  extras?: { rangeFrom?: unknown; rangeTo?: unknown }
): OperatorEvalResult {
  const canon = canonicalOperator(operator as unknown as string);
  if (!canon) {
    return {
      passed: false,
      evaluable: false,
      reason: `Operator "${operator}" is not one the engine implements`,
    };
  }

  // BOOLEAN asserts a true/false fact whatever the field is declared as.
  const effectiveType: EligibilityValueType = canon === 'BOOLEAN' ? 'boolean' : valueType;
  const actual = coerce(actualRaw, effectiveType);

  if (actual === null) {
    // EXISTS is the one operator for which absence is the answer, not a gap.
    if (canon === 'EXISTS') {
      return { passed: false, evaluable: true, reason: 'No value on record' };
    }
    return {
      passed: false,
      evaluable: false,
      reason: 'Actual value could not be resolved',
    };
  }

  switch (canon) {
    case 'EXISTS':
      return { passed: true, evaluable: true, reason: `${actual} is on record` };

    case 'GREATER_OR_EQUAL':
    case 'GREATER_THAN':
    case 'LESS_OR_EQUAL':
    case 'LESS_THAN': {
      const exp = coerce(expectedRaw, effectiveType === 'date' ? 'date' : 'number') as number | null;
      const act = actual as number;
      if (exp === null) {
        return { passed: false, evaluable: false, reason: 'Expected value could not be read' };
      }
      const ok =
        canon === 'GREATER_OR_EQUAL' ? act >= exp :
        canon === 'GREATER_THAN' ? act > exp :
        canon === 'LESS_OR_EQUAL' ? act <= exp :
        act < exp;
      const sym =
        canon === 'GREATER_OR_EQUAL' ? '>=' :
        canon === 'GREATER_THAN' ? '>' :
        canon === 'LESS_OR_EQUAL' ? '<=' : '<';
      return { passed: ok, evaluable: true, reason: `${act} ${sym} ${exp}` };
    }

    case 'BOOLEAN':
    case 'EQUALS': {
      // A BOOLEAN rule may state its expected value as true, "true" or 1, and
      // some carry none at all — which asserts that the fact is true.
      const exp = canon === 'BOOLEAN' && (expectedRaw === undefined || expectedRaw === null)
        ? true
        : coerce(expectedRaw, effectiveType);
      if (exp === null) {
        return { passed: false, evaluable: false, reason: 'Expected value could not be read' };
      }
      return { passed: actual === exp, evaluable: true, reason: `${actual} == ${exp}` };
    }

    case 'NOT_EQUALS': {
      const exp = coerce(expectedRaw, effectiveType);
      if (exp === null) {
        return { passed: false, evaluable: false, reason: 'Expected value could not be read' };
      }
      return { passed: actual !== exp, evaluable: true, reason: `${actual} != ${exp}` };
    }

    case 'IN':
    case 'NOT_IN': {
      const list = coerceList(expectedRaw, effectiveType).filter((v) => v !== null);
      if (list.length === 0) {
        return { passed: false, evaluable: false, reason: 'No values to compare against' };
      }
      const found = list.some((v) => v === actual);
      const ok = canon === 'IN' ? found : !found;
      return { passed: ok, evaluable: true, reason: `${actual} ${canon} [${list.join(', ')}]` };
    }

    case 'CONTAINS': {
      const needle = coerce(expectedRaw, 'string');
      if (needle === null) {
        return { passed: false, evaluable: false, reason: 'Expected value could not be read' };
      }
      const ok = String(actual).toUpperCase().includes(String(needle).toUpperCase());
      return { passed: ok, evaluable: true, reason: `${actual} CONTAINS ${needle}` };
    }

    case 'BETWEEN': {
      const numType = effectiveType === 'date' ? 'date' : 'number';
      const lo = coerce(extras?.rangeFrom ?? (Array.isArray(expectedRaw) ? expectedRaw[0] : null), numType) as number | null;
      const hi = coerce(extras?.rangeTo ?? (Array.isArray(expectedRaw) ? expectedRaw[1] : null), numType) as number | null;
      const act = actual as number;
      if (lo === null || hi === null) {
        return { passed: false, evaluable: false, reason: 'BETWEEN requires both a from and a to value' };
      }
      const ok = act >= lo && act <= hi;
      return { passed: ok, evaluable: true, reason: `${act} BETWEEN [${lo}, ${hi}]` };
    }

    default:
      // CANONICAL_OPERATORS and this switch must stay in step. If one gains a
      // member the other has not, that is a gap in the engine, not a failure
      // of the claimant.
      return {
        passed: false,
        evaluable: false,
        reason: `Operator ${canon} is recognised but not implemented`,
      };
  }
}
