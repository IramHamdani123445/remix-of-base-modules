/**
 * Typed Rule Evaluator — dispatches on `rule_kind` and produces a structured
 * diagnostic for every evaluation.
 *
 * Supports rule kinds:
 *   LITERAL           — resolve one fact, compare via operator to literal
 *   FACT_TO_FACT      — resolve two facts, compare via operator
 *   DATE_DIFFERENCE   — diff(start_fact, end_fact ?? fallback_end_fact) <op> value (in unit)
 *   DOCUMENT_STATUS   — document status fact == required_status
 *   EXISTS            — existence resolver -> bool
 *   CROSS_PRODUCT     — duplicate / cross-product existence check
 *   DERIVED_FACT      — computed via resolver, compared via operator
 *   CONDITIONAL       — short-circuits inner rule when `conditional_when` is false
 */

import type { BnEligibilityRule } from '@/types/bn';
import { getFact } from './eligibilityFactRegistry';
import { resolveFact, type EligibilityContext } from './eligibilityFactResolver';
import { OPERATORS, type EligibilityOperator } from './operators';

export type RuleEvalResult = 'PASS' | 'FAIL' | 'NOT_APPLICABLE' | 'NOT_IMPLEMENTED';

export interface RuleDiagnostic {
  rule_id: string;
  rule_code: string;
  rule_kind: NonNullable<BnEligibilityRule['rule_kind']>;
  source_fact: string | null;
  source_resolver: string | null;
  source_table: string | null;
  operator: string | null;
  unit: BnEligibilityRule['unit'] | null;
  actual_value: unknown;
  expected_value: unknown;
  result: RuleEvalResult;
  severity: BnEligibilityRule['severity'];
  overrideable: boolean;
  override_status: 'NONE' | 'AVAILABLE';
  message: string;
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const ms = Date.parse(b) - Date.parse(a);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/** Exported so `eligibilityEvaluator.ts` converts DATE_DIFFERENCE days using the same factors. */
export function convertDays(days: number, unit: BnEligibilityRule['unit']): number {
  switch (unit) {
    case 'WEEKS': return days / 7;
    case 'MONTHS': return days / 30.4375;
    case 'YEARS': return days / 365.25;
    case 'DAYS':
    default: return days;
  }
}

function apply(operator: string, actual: unknown, expected: unknown): boolean {
  const op = OPERATORS[operator as EligibilityOperator];
  if (!op) return false;
  return op.evaluate(actual, expected);
}

function renderMessage(rule: BnEligibilityRule, actual: unknown, expected: unknown, passed: boolean): string {
  if (rule.message_template) {
    return rule.message_template
      .replace('{{actual}}', String(actual ?? '—'))
      .replace('{{expected}}', String(expected ?? '—'));
  }
  if (passed) return `${rule.rule_name} ✓`;
  return rule.fail_message ?? `${rule.rule_name} failed (actual=${String(actual ?? '—')}, expected=${String(expected ?? '—')})`;
}

export async function evaluateRule(
  rule: BnEligibilityRule,
  ctx: EligibilityContext,
): Promise<RuleDiagnostic> {
  const kind = rule.rule_kind ?? 'LITERAL';
  const base = {
    rule_id: rule.id,
    rule_code: rule.rule_code,
    rule_kind: kind,
    severity: rule.severity,
    overrideable: rule.overrideable,
    override_status: (rule.overrideable ? 'AVAILABLE' : 'NONE') as RuleDiagnostic['override_status'],
    unit: rule.unit ?? null,
  };

  // CONDITIONAL: evaluate guard first; skip when guard is false
  if (kind === 'CONDITIONAL' && rule.conditional_when) {
    const guardFact = rule.conditional_when['fact_key'] as string | undefined;
    const guardOp = (rule.conditional_when['operator'] as string) ?? '=';
    const guardVal = rule.conditional_when['value'];
    if (guardFact) {
      const g = await resolveFact(guardFact, ctx);
      if (!apply(guardOp, g.value, guardVal)) {
        return {
          ...base,
          source_fact: guardFact,
          source_resolver: getFact(guardFact)?.resolver_function ?? null,
          source_table: g.source_table,
          operator: guardOp,
          actual_value: g.value,
          expected_value: guardVal,
          result: 'NOT_APPLICABLE',
          message: `Skipped (precondition ${guardFact} ${guardOp} ${String(guardVal)} not met)`,
        };
      }
    }
  }

  // DATE_DIFFERENCE
  if (kind === 'DATE_DIFFERENCE') {
    const start = rule.start_fact_key, end = rule.end_fact_key, fb = rule.fallback_end_fact_key;
    const def = (rule.rule_definition || {}) as Record<string, unknown>;
    const expected = def['value'];
    const operator = (def['operator'] as string) ?? '<=';
    if (!start || (!end && !fb)) {
      return { ...base, source_fact: start ?? null, source_resolver: null, source_table: null, operator, actual_value: null, expected_value: expected, result: 'NOT_IMPLEMENTED', message: 'DATE_DIFFERENCE rule missing start/end facts' };
    }
    const sR = await resolveFact(start, ctx);
    let endVal: unknown = null, endResolver = end;
    if (end) {
      const eR = await resolveFact(end, ctx);
      endVal = eR.value;
      if (!endVal && fb) { const fR = await resolveFact(fb, ctx); endVal = fR.value; endResolver = fb; }
    } else if (fb) {
      const fR = await resolveFact(fb, ctx); endVal = fR.value; endResolver = fb;
    }
    const days = daysBetween(sR.value as string | null, endVal as string | null);
    if (days === null) {
      return { ...base, source_fact: `${start} → ${endResolver}`, source_resolver: sR.fact_key, source_table: sR.source_table, operator, actual_value: null, expected_value: expected, result: 'FAIL', message: renderMessage(rule, null, expected, false) };
    }
    const actualInUnit = convertDays(days, rule.unit ?? 'DAYS');
    const passed = apply(operator, actualInUnit, expected);
    return { ...base, source_fact: `${start} → ${endResolver}`, source_resolver: sR.fact_key, source_table: sR.source_table, operator, actual_value: actualInUnit, expected_value: expected, result: passed ? 'PASS' : 'FAIL', message: renderMessage(rule, actualInUnit, expected, passed) };
  }

  // DOCUMENT_STATUS
  if (kind === 'DOCUMENT_STATUS') {
    const factKey = rule.fact_key ?? `document.${(rule.document_type_code ?? 'unknown').toLowerCase()}.status`;
    const def = getFact(factKey);
    if (!def) return { ...base, source_fact: factKey, source_resolver: null, source_table: null, operator: '=', actual_value: null, expected_value: rule.required_status, result: 'NOT_IMPLEMENTED', message: `Unknown document status fact ${factKey}` };
    const r = await resolveFact(factKey, ctx);
    const expected = rule.required_status ?? 'VERIFIED';
    const passed = apply('=', r.value, expected);
    return { ...base, source_fact: factKey, source_resolver: def.resolver_function, source_table: def.source_table, operator: '=', actual_value: r.value, expected_value: expected, result: passed ? 'PASS' : 'FAIL', message: renderMessage(rule, r.value, expected, passed) };
  }

  // EXISTS / CROSS_PRODUCT
  if (kind === 'EXISTS' || kind === 'CROSS_PRODUCT') {
    const factKey = rule.fact_key ?? rule.existence_check_code ?? '';
    if (!factKey) return { ...base, source_fact: null, source_resolver: null, source_table: null, operator: 'exists', actual_value: null, expected_value: true, result: 'NOT_IMPLEMENTED', message: 'EXISTS rule missing fact key' };
    const def = getFact(factKey);
    const r = await resolveFact(factKey, ctx);
    const def2 = (rule.rule_definition || {}) as Record<string, unknown>;
    const expected = (def2['value'] as boolean | undefined) ?? true;
    const passed = Boolean(r.value) === Boolean(expected);
    return { ...base, source_fact: factKey, source_resolver: def?.resolver_function ?? null, source_table: def?.source_table ?? null, operator: 'exists', actual_value: r.value, expected_value: expected, result: passed ? 'PASS' : 'FAIL', message: renderMessage(rule, r.value, expected, passed) };
  }

  // FACT_TO_FACT
  if (kind === 'FACT_TO_FACT') {
    const def = (rule.rule_definition || {}) as Record<string, unknown>;
    const operator = (def['operator'] as string) ?? '=';
    const a = rule.fact_key, b = rule.compare_fact_key;
    if (!a || !b) return { ...base, source_fact: a, source_resolver: null, source_table: null, operator, actual_value: null, expected_value: null, result: 'NOT_IMPLEMENTED', message: 'FACT_TO_FACT missing facts' };
    const [ra, rb] = await Promise.all([resolveFact(a, ctx), resolveFact(b, ctx)]);
    const passed = apply(operator, ra.value, rb.value);
    return { ...base, source_fact: `${a} vs ${b}`, source_resolver: ra.fact_key, source_table: ra.source_table, operator, actual_value: ra.value, expected_value: rb.value, result: passed ? 'PASS' : 'FAIL', message: renderMessage(rule, ra.value, rb.value, passed) };
  }

  // LITERAL / DERIVED_FACT — fall through to single-fact + operator + value
  const def = (rule.rule_definition || {}) as Record<string, unknown>;
  const factKey = rule.fact_key ?? (def['field_key'] as string | undefined);
  const operator = (def['operator'] as string) ?? '=';
  const expected = def['value'];
  if (!factKey) {
    return { ...base, source_fact: null, source_resolver: null, source_table: null, operator, actual_value: null, expected_value: expected, result: 'NOT_IMPLEMENTED', message: 'Rule has no fact key' };
  }
  const factDef = getFact(factKey);
  if (!factDef) {
    return { ...base, source_fact: factKey, source_resolver: null, source_table: null, operator, actual_value: null, expected_value: expected, result: 'NOT_IMPLEMENTED', message: `Unknown fact ${factKey}` };
  }
  const r = await resolveFact(factKey, ctx);
  const passed = apply(operator, r.value, expected);
  return { ...base, source_fact: factKey, source_resolver: factDef.resolver_function, source_table: r.source_table, operator, actual_value: r.value, expected_value: expected, result: passed ? 'PASS' : 'FAIL', message: renderMessage(rule, r.value, expected, passed) };
}

export async function evaluateRules(
  rules: BnEligibilityRule[],
  ctx: EligibilityContext,
): Promise<RuleDiagnostic[]> {
  return Promise.all(rules.map((r) => evaluateRule(r, ctx)));
}
