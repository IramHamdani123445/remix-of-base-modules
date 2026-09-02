/**
 * Product Eligibility — pre-save conflict detection.
 * Pure TS analyzer over a candidate set of rules. Returns conflicts grouped by
 * severity. Use before adding/saving to a product version and inside the
 * publish guard.
 */
import type { EligibilityFact } from '@/services/bn/eligibilityFactService';

export type ConflictSeverity = 'ERROR' | 'WARNING';

export interface CandidateRule {
  id?: string;
  rule_code: string;
  rule_name?: string | null;
  fact_key: string | null;
  /** DATE_DIFFERENCE rules carry no single fact_key by design — they compare
   *  start_fact_key/end_fact_key instead. Needed here so the unlinked-fact
   *  check below doesn't flag a correctly-configured date-difference rule. */
  rule_kind?: string | null;
  start_fact_key?: string | null;
  end_fact_key?: string | null;
  operator: string;
  value_from: string | number | null;
  value_to?: string | number | null;
  values?: any;
  is_active: boolean;
  rule_category?: string | null;
}

export interface EligibilityConflict {
  id: string;
  severity: ConflictSeverity;
  reason: string;
  suggestion: string;
  rule_a: { rule_code: string; rule_name?: string | null };
  rule_b?: { rule_code: string; rule_name?: string | null };
  conflict_type: string;
}

const NUMERIC_OPS = new Set(['GREATER_THAN', 'GREATER_OR_EQUAL', 'LESS_THAN', 'LESS_OR_EQUAL', 'EQUALS', 'NOT_EQUALS', 'BETWEEN']);
const VALUE_REQUIRED_OPS = new Set(['EQUALS', 'NOT_EQUALS', 'GREATER_THAN', 'GREATER_OR_EQUAL', 'LESS_THAN', 'LESS_OR_EQUAL', 'BETWEEN', 'IN', 'NOT_IN', 'BOOLEAN', 'CONTAINS']);

function asNumber(v: any): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bound(rule: CandidateRule): { min?: number; max?: number; eq?: number; neq?: number } {
  const vf = asNumber(rule.value_from);
  const vt = asNumber(rule.value_to);
  switch (rule.operator) {
    case 'GREATER_THAN':     return vf !== null ? { min: vf + 1e-9 } : {};
    case 'GREATER_OR_EQUAL': return vf !== null ? { min: vf } : {};
    case 'LESS_THAN':        return vf !== null ? { max: vf - 1e-9 } : {};
    case 'LESS_OR_EQUAL':    return vf !== null ? { max: vf } : {};
    case 'EQUALS':           return vf !== null ? { eq: vf } : {};
    case 'NOT_EQUALS':       return vf !== null ? { neq: vf } : {};
    case 'BETWEEN':          return { min: vf ?? undefined, max: vt ?? undefined };
    default: return {};
  }
}

function rangesIncompatible(a: ReturnType<typeof bound>, b: ReturnType<typeof bound>): boolean {
  // explicit equals contradictions
  if (a.eq !== undefined && b.eq !== undefined && a.eq !== b.eq) return true;
  if (a.eq !== undefined && b.neq !== undefined && a.eq === b.neq) return true;
  if (b.eq !== undefined && a.neq !== undefined && b.eq === a.neq) return true;
  // range overlap test
  const aMin = a.min ?? -Infinity, aMax = a.max ?? Infinity;
  const bMin = b.min ?? -Infinity, bMax = b.max ?? Infinity;
  const lo = Math.max(aMin, bMin);
  const hi = Math.min(aMax, bMax);
  return lo > hi;
}

export function detectEligibilityConflicts(
  rules: CandidateRule[],
  facts: EligibilityFact[] = [],
): EligibilityConflict[] {
  const conflicts: EligibilityConflict[] = [];
  const factByKey = new Map<string, EligibilityFact>();
  facts.forEach(f => factByKey.set(f.fact_key, f));

  const active = rules.filter(r => r.is_active);

  // 1. Unlinked / NOT_IMPLEMENTED fact + missing thresholds
  active.forEach(r => {
    if (r.rule_kind === 'DATE_DIFFERENCE') {
      if (!r.start_fact_key || !r.end_fact_key) {
        conflicts.push({
          id: `unlinked-${r.rule_code}`, severity: 'ERROR', conflict_type: 'UNLINKED_FACT',
          reason: `Rule ${r.rule_code} (date difference) is missing its start or end date fact`,
          suggestion: 'Set both the start date and end date facts on this rule.',
          rule_a: { rule_code: r.rule_code, rule_name: r.rule_name },
        });
      }
      // A date-difference rule has no single fact_key by design — the checks
      // below (which key off r.fact_key) don't apply to it.
    } else if (!r.fact_key) {
      conflicts.push({
        id: `unlinked-${r.rule_code}`, severity: 'ERROR', conflict_type: 'UNLINKED_FACT',
        reason: `Rule ${r.rule_code} has no fact_key`,
        suggestion: 'Link the rule to a fact in the Rule Catalogue or remove it.',
        rule_a: { rule_code: r.rule_code, rule_name: r.rule_name },
      });
    } else {
      const f = factByKey.get(r.fact_key);
      if (!f) {
        conflicts.push({
          id: `missing-fact-${r.rule_code}`, severity: 'ERROR', conflict_type: 'MISSING_FACT',
          reason: `Fact ${r.fact_key} not found in Fact Catalogue`,
          suggestion: 'Register the fact or change the rule to use an existing one.',
          rule_a: { rule_code: r.rule_code, rule_name: r.rule_name },
        });
      } else if (f.implementation_status === 'NOT_IMPLEMENTED') {
        conflicts.push({
          id: `not-impl-${r.rule_code}`, severity: 'ERROR', conflict_type: 'NOT_IMPLEMENTED_FACT',
          reason: `Fact ${r.fact_key} is NOT_IMPLEMENTED`,
          suggestion: 'Implement the resolver, or deactivate this rule until ready.',
          rule_a: { rule_code: r.rule_code, rule_name: r.rule_name },
        });
      }
    }
    // threshold missing
    if (VALUE_REQUIRED_OPS.has(r.operator)) {
      const needsList = r.operator === 'IN' || r.operator === 'NOT_IN';
      const hasList = Array.isArray(r.values) && r.values.length > 0;
      const hasFrom = r.value_from !== null && r.value_from !== undefined && r.value_from !== '';
      const hasTo   = r.value_to   !== null && r.value_to   !== undefined && r.value_to   !== '';
      const ok = needsList ? hasList : r.operator === 'BETWEEN' ? (hasFrom && hasTo) : hasFrom;
      if (!ok) {
        conflicts.push({
          id: `no-threshold-${r.rule_code}`, severity: 'ERROR', conflict_type: 'MISSING_THRESHOLD',
          reason: `Rule ${r.rule_code} (operator ${r.operator}) has no product threshold`,
          suggestion: 'Set a value (or values) on the product rule.',
          rule_a: { rule_code: r.rule_code, rule_name: r.rule_name },
        });
      }
    }
  });

  // 2. Same fact_key, incompatible bounds
  const byFact = new Map<string, CandidateRule[]>();
  active.forEach(r => { if (r.fact_key) { const arr = byFact.get(r.fact_key) ?? []; arr.push(r); byFact.set(r.fact_key, arr); } });

  byFact.forEach((rs, fact) => {
    if (rs.length < 2) return;
    const numericRules = rs.filter(r => NUMERIC_OPS.has(r.operator));
    for (let i = 0; i < numericRules.length; i++) {
      for (let j = i + 1; j < numericRules.length; j++) {
        const a = numericRules[i], b = numericRules[j];
        if (rangesIncompatible(bound(a), bound(b))) {
          conflicts.push({
            id: `conflict-${fact}-${a.rule_code}-${b.rule_code}`,
            severity: 'ERROR', conflict_type: 'INCOMPATIBLE_BOUNDS',
            reason: `Rules ${a.rule_code} and ${b.rule_code} place incompatible bounds on fact ${fact}`,
            suggestion: 'Remove one of the rules or relax the thresholds so both can be satisfied.',
            rule_a: { rule_code: a.rule_code, rule_name: a.rule_name },
            rule_b: { rule_code: b.rule_code, rule_name: b.rule_name },
          });
        }
      }
    }
    // Duplicate operator on same fact (warning)
    const seen = new Map<string, CandidateRule>();
    rs.forEach(r => {
      const k = `${r.operator}|${r.value_from ?? ''}|${r.value_to ?? ''}|${JSON.stringify(r.values ?? null)}`;
      if (seen.has(k)) {
        const prev = seen.get(k)!;
        conflicts.push({
          id: `dup-${fact}-${prev.rule_code}-${r.rule_code}`,
          severity: 'WARNING', conflict_type: 'DUPLICATE_RULE',
          reason: `Duplicate rule on fact ${fact} (${r.operator})`,
          suggestion: 'Remove one of the duplicates.',
          rule_a: { rule_code: prev.rule_code, rule_name: prev.rule_name },
          rule_b: { rule_code: r.rule_code, rule_name: r.rule_name },
        });
      } else seen.set(k, r);
    });

    // Same fact, EQUALS with different values (document status / boolean expectation)
    const eqRules = rs.filter(r => r.operator === 'EQUALS' || r.operator === 'BOOLEAN');
    for (let i = 0; i < eqRules.length; i++) {
      for (let j = i + 1; j < eqRules.length; j++) {
        const a = eqRules[i], b = eqRules[j];
        if (String(a.value_from) !== String(b.value_from)) {
          conflicts.push({
            id: `eq-conflict-${fact}-${a.rule_code}-${b.rule_code}`,
            severity: 'ERROR', conflict_type: 'CONFLICTING_EXPECTED_VALUES',
            reason: `Rules ${a.rule_code} and ${b.rule_code} expect different values for ${fact}`,
            suggestion: 'Align both rules on the same expected value or remove one.',
            rule_a: { rule_code: a.rule_code, rule_name: a.rule_name },
            rule_b: { rule_code: b.rule_code, rule_name: b.rule_name },
          });
        }
      }
    }
  });

  return conflicts;
}

export function summarizeConflicts(c: EligibilityConflict[]) {
  return {
    errors: c.filter(x => x.severity === 'ERROR').length,
    warnings: c.filter(x => x.severity === 'WARNING').length,
    total: c.length,
  };
}
