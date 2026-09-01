/**
 * Universal Eligibility Evaluator — BUG-29
 *
 * Single evaluation engine shared by claim intake (pre-registration pre-check)
 * and the claim workbench Eligibility tab. Before this module existed the two
 * surfaces behaved differently and neither enforced anything:
 *
 *   * Intake step 6 listed rules with a static tick and never compared a value.
 *   * `runClaimEligibility` read only `rule_definition.field_key`. 225 of the
 *     249 active rules in the catalogue do not carry that property — they use
 *     the `fact_key` column or `rule_definition.fact` — so every one of them
 *     took the "no field_key → treated as INFO" branch and was recorded as
 *     passed.
 *
 * Two defects were involved and both are fixed here.
 *
 * 1. KEY RESOLUTION. A rule's field is read from every convention the
 *    authoring screens have written over time, in precedence order, and a
 *    small explicit alias table maps legacy fact names onto the canonical
 *    registry keys. See `resolveRuleFieldKey`.
 *
 * 2. FAIL-CLOSED. A rule that cannot be evaluated is NEVER recorded as
 *    passed. It is recorded as UNEVALUATED and blocks, so the claim is held
 *    for manual review rather than waved through. A rule is informational
 *    only when that is stated deliberately on the rule itself
 *    (`fail_action = 'INFO'`, or `rule_definition.informational = true`) —
 *    never as the automatic consequence of a missing mapping.
 *
 * The rule is: a check with no input fails. It must not pass.
 */
import { type EligibilityOperator } from './fieldRegistry';
import { resolveField, type FieldResolutionContext } from './fieldResolver';
import { evaluateOperator } from './operatorEvaluator';
import { resolveFact } from './eligibilityFactResolver';
import { convertDays } from './ruleEvaluator';
import {
  renderRuleMessage,
  type MessageContext,
  type MessageRule,
  type RuleMessageOutcome,
} from './ruleMessage';
import {
  LEGACY_FACT_ALIASES,
  dedupeByRequirement,
  isDeferredAtIntake,
  isDocumentEvidenceFact,
  isInformationalRule,
  lookupField,
  requirementKey,
  resolveRuleFieldKey,
  type EvaluableRule,
  type KnownField,
  type ResolvedRuleKey,
  type RuleKeySource,
} from './ruleFieldMapping';

export {
  LEGACY_FACT_ALIASES,
  dedupeByRequirement,
  isDeferredAtIntake,
  isDocumentEvidenceFact,
  isInformationalRule,
  lookupField,
  requirementKey,
  resolveRuleFieldKey,
};
export type { EvaluableRule, KnownField, ResolvedRuleKey, RuleKeySource };

/**
 * PASS         — evaluated, claimant satisfies the rule
 * FAIL         — evaluated, claimant does not satisfy the rule
 * UNEVALUATED  — could not be evaluated; blocking, needs manual review
 * INFO         — deliberately informational; never blocks
 * OVERRIDDEN   — failed but carries an approved supervisor override
 */
export type EligibilityResultState = 'PASS' | 'FAIL' | 'UNEVALUATED' | 'INFO' | 'OVERRIDDEN';

export interface EligibilityRuleTrace {
  rule_code: string;
  rule_name: string;
  rule_group: string | null;
  field_key: string | null;
  operator: string | null;
  expected_value: unknown;
  actual_value: unknown;
  /** True only for PASS, INFO and OVERRIDDEN. UNEVALUATED is never passed. */
  passed: boolean;
  result_state: EligibilityResultState;
  fail_action: string;
  severity?: string | null;
  /** Which convention the field key came from — for diagnosing rule config. */
  key_source: RuleKeySource;
  source: string | null;
  /** requirement + detail on one line, for places that can show only one. */
  message: string;
  /** What the rule demands, in the wording configured on the rule itself. */
  requirement: string;
  /** What the claimant's record showed. Null when there is nothing to show. */
  detail: string | null;
  /** Statutory citation configured on the rule, if any. */
  reference: string | null;
  /**
   * BUG-32 — rules sharing an alternative group are satisfied when ANY ONE of
   * them passes, not all. Read from `rule_definition.alternative_group`.
   */
  alternative_group: string | null;
  /** Set on UNEVALUATED so the cause is actionable from the screen. */
  unevaluated_reason?: string;
}

/** Normalises the operator spellings found across authored rules. */
function normaliseOperator(raw: unknown, fallback: string): EligibilityOperator {
  const op = String(raw ?? fallback).trim();
  const map: Record<string, EligibilityOperator> = {
    '=': '==', '==': '==', 'eq': '==',
    '!=': '!=', '<>': '!=', 'ne': '!=',
    '>=': '>=', 'gte': '>=', '>': '>', 'gt': '>',
    '<=': '<=', 'lte': '<=', '<': '<', 'lt': '<',
    'in': 'IN', 'between': 'BETWEEN', 'range': 'BETWEEN',
  };
  return map[op.toLowerCase()] ?? (op as EligibilityOperator);
}

/**
 * Pulls the expected value off a rule definition. Understands the direct
 * `value` form, the `min`/`max` range form, and the per-field legacy property
 * names (`min_age`, `min_weeks`, ...). Returns `value: undefined` when the
 * rule carries no comparable value — which is an UNEVALUATED condition, not a
 * pass.
 */
function extractExpected(
  fieldKey: string,
  def: Record<string, any>,
): { value: unknown; operator: EligibilityOperator; rangeFrom?: unknown; rangeTo?: unknown } {
  const declaredOp = def.operator;

  // The Rule Catalogue writes a different shape from the custom-rule dialog:
  // `{ parameter, operator, value_from, value_to, values }` rather than
  // `{ field_key, operator, value }`. Reading only the latter meant every rule
  // attached from the catalogue carried "no comparable value" and blocked the
  // claim — the same class of miss as the three field-key conventions.
  if (Array.isArray(def.values) && def.values.length > 0) {
    return { value: def.values, operator: 'IN' };
  }

  // Range form: { min, max }, { range_from, range_to } or { value_from, value_to }
  const lo = def.min ?? def.range_from ?? def.min_value ?? def.value_from;
  const hi = def.max ?? def.range_to ?? def.max_value ?? def.value_to;
  if (lo != null && hi != null) {
    return { value: [lo, hi], operator: 'BETWEEN', rangeFrom: lo, rangeTo: hi };
  }

  const direct = def.value ?? def.required_value ?? def.expected_value;
  if (direct !== undefined && direct !== null) {
    return { value: direct, operator: normaliseOperator(declaredOp, '==') };
  }

  // Per-field legacy property names.
  switch (fieldKey) {
    case 'person.age_at_claim_date':
      if (def.min_age != null) return { value: def.min_age, operator: '>=' };
      if (def.max_age != null) return { value: def.max_age, operator: '<=' };
      break;
    case 'contribution.total_weeks':
    case 'contribution.total_wages':
    case 'contribution.avg_weekly_wage': {
      const v = def.min_weeks ?? def.min_contributions_weeks ?? def.recent_contributions_weeks
        ?? def.min_wages ?? def.threshold;
      if (v != null) return { value: v, operator: normaliseOperator(declaredOp, '>=') };
      break;
    }
    case 'person.status':
    case 'employer.status': {
      const v = def.person_status ?? def.employer_status ?? def.status ?? def.required_status;
      if (v != null) return { value: v, operator: normaliseOperator(declaredOp, '==') };
      break;
    }
    // These fields state the requirement in the field itself — the only
    // meaningful comparison is "must be true" / "must not exist".
    case 'evidence.required_docs_complete':
    case 'evidence.document_verified':
      return { value: true, operator: '==' };
    case 'claim.has_duplicate_active_claim':
    case 'person.deceased':
      return { value: false, operator: '==' };
  }

  if (lo != null) return { value: lo, operator: normaliseOperator(declaredOp, '>=') };
  if (hi != null) return { value: hi, operator: normaliseOperator(declaredOp, '<=') };
  return { value: undefined, operator: normaliseOperator(declaredOp, '==') };
}

/**
 * The alternative-satisfaction group a rule belongs to, if any.
 *
 * A statutory requirement can have more than one way of being met. The
 * Maternity Grant is the case that surfaced it: SSB pays it on the claimant's
 * own contributions OR on those of her insured husband. Expressed as two plain
 * rules the engine would require BOTH, which is wrong — so rules that are
 * alternative routes to the same requirement declare a shared group.
 */
function alternativeGroup(rule: EvaluableRule): string | null {
  const def = (rule.rule_definition || {}) as Record<string, unknown>;
  const g = def.alternative_group ?? def.satisfied_by_any_of;
  const s = g == null ? '' : String(g).trim();
  return s.length > 0 ? s : null;
}

function unevaluated(
  rule: EvaluableRule,
  fieldKey: string | null,
  keySource: RuleKeySource,
  reason: string,
  ctx: MessageContext,
  extra?: Partial<EligibilityRuleTrace>,
): EligibilityRuleTrace {
  // The requirement still comes from the rule's own wording — an officer needs
  // to see WHAT was not checked, not just that something was not checked.
  const msg = renderRuleMessage(rule as MessageRule, 'UNEVALUATED', {
    ...ctx,
    unevaluatedReason: reason,
  });
  return {
    rule_code: rule.rule_code,
    rule_name: rule.rule_name,
    rule_group: rule.rule_group ?? null,
    field_key: fieldKey,
    operator: null,
    expected_value: null,
    actual_value: null,
    passed: false,
    result_state: 'UNEVALUATED',
    fail_action: rule.fail_action ?? 'REJECT',
    severity: rule.severity ?? null,
    key_source: keySource,
    source: null,
    message: msg.text,
    requirement: msg.requirement,
    detail: msg.detail,
    reference: msg.reference,
    alternative_group: alternativeGroup(rule),
    unevaluated_reason: reason,
    ...extra,
  };
}

function factCtxFor(ctx: FieldResolutionContext) {
  return {
    ssn: ctx.ssn,
    claimId: ctx.claimId ?? null,
    claimDate: ctx.claimDate,
    productCode: ctx.benefitType ?? null,
    employerRegno: ctx.employerRegNo ?? null,
  };
}

/**
 * DATE_DIFFERENCE rules assert diff(start_fact, end_fact ?? fallback) <op>
 * value(unit) — two facts, not one, so they cannot go through the generic
 * single field_key/value path below. Only reached when the rule declares no
 * plain `fact_key` (see the guard at the call site); rules that model the
 * same requirement via one precomputed derived fact (e.g.
 * CLAIM_SUBMITTED_WITHIN_DAYS -> claim.days_since_event) already work through
 * the generic path and must keep doing so unchanged.
 */
async function evaluateDateDifferenceRule(
  rule: EvaluableRule,
  ctx: FieldResolutionContext,
  def: Record<string, unknown>,
  informational: boolean,
  msgCtx: MessageContext,
): Promise<EligibilityRuleTrace> {
  const start = rule.start_fact_key!;
  const end = rule.end_fact_key ?? null;
  const fallback = rule.fallback_end_fact_key ?? null;
  const operator = normaliseOperator(def.operator, '<=');
  const expected = def.value;
  const fieldKey = `${start} → ${end ?? fallback ?? '?'}`;
  msgCtx = { ...msgCtx, operator, expected };

  if (expected === undefined || expected === null) {
    return unevaluated(rule, fieldKey, 'fact_key', `no comparable value declared for ${rule.rule_name}`, msgCtx, { operator });
  }

  try {
    const factCtx = factCtxFor(ctx);
    const sR = await resolveFact(start, factCtx);
    const source = `${sR.source_table}.${sR.source_column}`;
    if (sR.value === null || sR.value === undefined) {
      return unevaluated(rule, fieldKey, 'fact_key', sR.reason ?? `${start} is not available for this claimant`, msgCtx, { operator, expected_value: expected, source });
    }

    let endVal: unknown = null;
    let endResolverKey = end;
    if (end) {
      const eR = await resolveFact(end, factCtx);
      endVal = eR.value;
      if ((endVal === null || endVal === undefined) && fallback) {
        const fR = await resolveFact(fallback, factCtx);
        endVal = fR.value;
        endResolverKey = fallback;
      }
    } else if (fallback) {
      const fR = await resolveFact(fallback, factCtx);
      endVal = fR.value;
      endResolverKey = fallback;
    }
    if (endVal === null || endVal === undefined) {
      return unevaluated(rule, fieldKey, 'fact_key', `${endResolverKey ?? 'end date'} is not available for this claimant`, msgCtx, { operator, expected_value: expected, source });
    }

    const ms = Date.parse(String(endVal)) - Date.parse(String(sR.value));
    if (!Number.isFinite(ms)) {
      return unevaluated(rule, fieldKey, 'fact_key', 'could not compute date difference — one of the dates is invalid', msgCtx, { operator, expected_value: expected, source });
    }
    const unit = (rule.unit ?? 'DAYS') as 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';
    const actual = convertDays(Math.floor(ms / 86_400_000), unit);

    const evalRes = evaluateOperator(actual, operator, expected, 'number');
    if (evalRes.evaluable === false) {
      return unevaluated(rule, fieldKey, 'fact_key', evalRes.reason, msgCtx, { operator, expected_value: expected, source, actual_value: actual });
    }

    const outcome: RuleMessageOutcome = informational ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL';
    const msg = renderRuleMessage(rule as MessageRule, outcome, { ...msgCtx, actual });
    return {
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      rule_group: rule.rule_group ?? null,
      field_key: fieldKey,
      operator,
      expected_value: expected,
      actual_value: actual,
      passed: informational ? true : evalRes.passed,
      result_state: outcome === 'INFO' ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL',
      fail_action: informational ? 'INFO' : (rule.fail_action ?? 'REJECT'),
      severity: rule.severity ?? null,
      key_source: 'fact_key',
      source,
      message: msg.text,
      requirement: msg.requirement,
      detail: msg.detail,
      reference: msg.reference,
      alternative_group: alternativeGroup(rule),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return unevaluated(rule, fieldKey, 'fact_key', `could not compute date difference (${message})`, msgCtx, { operator, expected_value: expected });
  }
}

/**
 * FACT_TO_FACT rules compare two resolved facts to each other rather than one
 * fact to a literal — e.g. "spouse's income <= claimant's income". Reached
 * only when both `fact_key` and `compare_fact_key` are set (see call site).
 */
async function evaluateFactToFactRule(
  rule: EvaluableRule,
  ctx: FieldResolutionContext,
  def: Record<string, unknown>,
  informational: boolean,
  msgCtx: MessageContext,
): Promise<EligibilityRuleTrace> {
  const a = rule.fact_key!;
  const b = rule.compare_fact_key!;
  const operator = normaliseOperator(def.operator, '==');
  const fieldKey = `${a} vs ${b}`;
  const fieldDef = lookupField(a);
  const valueType = fieldDef?.valueType ?? 'string';
  msgCtx = { ...msgCtx, operator, fieldLabel: fieldDef?.label };

  try {
    const factCtx = factCtxFor(ctx);
    const [ra, rb] = await Promise.all([resolveFact(a, factCtx), resolveFact(b, factCtx)]);
    const source = `${ra.source_table}.${ra.source_column} vs ${rb.source_table}.${rb.source_column}`;
    if (ra.value === null || ra.value === undefined || rb.value === null || rb.value === undefined) {
      const reason = ra.reason ?? rb.reason ?? `${(ra.value == null ? a : b)} is not available for this claimant`;
      return unevaluated(rule, fieldKey, 'fact_key', reason, msgCtx, { operator, source });
    }

    let actualForEval = ra.value;
    let expectedForEval = rb.value;
    if (valueType === 'string' && (operator === '==' || operator === '!=')) {
      if (typeof actualForEval === 'string') actualForEval = actualForEval.trim().toUpperCase();
      if (typeof expectedForEval === 'string') expectedForEval = expectedForEval.trim().toUpperCase();
    }

    const evalRes = evaluateOperator(actualForEval, operator, expectedForEval, valueType);
    if (evalRes.evaluable === false) {
      return unevaluated(rule, fieldKey, 'fact_key', evalRes.reason, msgCtx, { operator, actual_value: ra.value, expected_value: rb.value, source });
    }

    const outcome: RuleMessageOutcome = informational ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL';
    const msg = renderRuleMessage(rule as MessageRule, outcome, { ...msgCtx, expected: rb.value, actual: ra.value });
    return {
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      rule_group: rule.rule_group ?? null,
      field_key: fieldKey,
      operator,
      expected_value: rb.value,
      actual_value: ra.value,
      passed: informational ? true : evalRes.passed,
      result_state: outcome === 'INFO' ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL',
      fail_action: informational ? 'INFO' : (rule.fail_action ?? 'REJECT'),
      severity: rule.severity ?? null,
      key_source: 'fact_key',
      source,
      message: msg.text,
      requirement: msg.requirement,
      detail: msg.detail,
      reference: msg.reference,
      alternative_group: alternativeGroup(rule),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return unevaluated(rule, fieldKey, 'fact_key', `could not compare facts (${message})`, msgCtx, { operator });
  }
}

/** Evaluates one rule. Never returns `passed: true` without a real comparison. */
export async function evaluateEligibilityRule(
  rule: EvaluableRule,
  ctx: FieldResolutionContext,
): Promise<EligibilityRuleTrace> {
  const def = (rule.rule_definition || {}) as Record<string, any>;
  const informational = isInformationalRule(rule);

  // Base message context, enriched as the field and values become known.
  let msgCtx: MessageContext = { claimDate: ctx.claimDate, ssn: ctx.ssn };

  // Two-fact rule kinds can't be represented as a single field_key/value
  // comparison, so they're resolved before the generic path below even
  // starts looking for one. Guarded narrowly: a DATE_DIFFERENCE rule that
  // already carries its own plain `fact_key` (a precomputed derived fact,
  // e.g. claim.days_since_event) is deliberately left on the generic path —
  // only rules with no fact_key of their own need this branch to see
  // anything at all.
  if (rule.rule_kind === 'DATE_DIFFERENCE' && !rule.fact_key && rule.start_fact_key) {
    return evaluateDateDifferenceRule(rule, ctx, def, informational, msgCtx);
  }
  if (rule.rule_kind === 'FACT_TO_FACT' && rule.fact_key && rule.compare_fact_key) {
    return evaluateFactToFactRule(rule, ctx, def, informational, msgCtx);
  }

  const { key: fieldKey, source: keySource, rawKey } = resolveRuleFieldKey(rule);

  const asInfo = (note: string, fieldKeyOut: string | null): EligibilityRuleTrace => {
    const msg = renderRuleMessage(rule as MessageRule, 'INFO', msgCtx);
    return {
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      rule_group: rule.rule_group ?? null,
      field_key: fieldKeyOut,
      operator: null,
      expected_value: null,
      actual_value: null,
      passed: true,
      result_state: 'INFO',
      fail_action: 'INFO',
      severity: rule.severity ?? null,
      key_source: keySource,
      source: null,
      message: `${msg.requirement} — informational (${note}).`,
      requirement: msg.requirement,
      detail: `Informational — ${note}.`,
      reference: msg.reference,
      alternative_group: alternativeGroup(rule),
    };
  };

  if (!fieldKey) {
    const reason = rawKey
      ? `field "${rawKey}" is not in the eligibility field registry`
      : 'rule has no field mapping';
    if (informational) return asInfo(`Informational — ${reason}.`, rawKey);
    return unevaluated(rule, rawKey, keySource, reason, msgCtx);
  }

  const fieldDef = lookupField(fieldKey)!;
  const ex = extractExpected(fieldKey, def);
  msgCtx = {
    ...msgCtx,
    fieldLabel: fieldDef.label,
    operator: ex.operator,
    expected: ex.value,
    min: ex.rangeFrom ?? def.min ?? def.range_from,
    max: ex.rangeTo ?? def.max ?? def.range_to,
  };

  if (ex.value === undefined) {
    const reason = `no comparable value declared for ${fieldDef.label}`;
    if (informational) return asInfo(reason, fieldKey);
    return unevaluated(rule, fieldKey, keySource, reason, msgCtx, { operator: ex.operator });
  }

  let actual: unknown = null;
  let source: string | null = null;
  try {
    if (fieldDef.registry === 'field') {
      const resolved = await resolveField(fieldKey, ctx, {
        windowType: def.window_type,
        windowFrom: def.window_from,
        windowTo: def.window_to,
        documentTypeCode: def.document_type_code,
      });
      actual = resolved.value;
      source = resolved.sourceLabel;
    } else {
      const resolved = await resolveFact(fieldKey, {
        ssn: ctx.ssn,
        claimId: ctx.claimId ?? null,
        claimDate: ctx.claimDate,
        productCode: ctx.benefitType ?? null,
        employerRegno: ctx.employerRegNo ?? null,
      });
      actual = resolved.value;
      source = `${resolved.source_table}.${resolved.source_column}`;
      // A resolver that could not run states why — that is unevaluated, not a pass.
      if (resolved.reason && (actual === null || actual === undefined)) {
        return unevaluated(rule, fieldKey, keySource, resolved.reason, msgCtx, {
          operator: ex.operator, expected_value: ex.value, source,
        });
      }
    }
  } catch (err: any) {
    return unevaluated(
      rule,
      fieldKey,
      keySource,
      `could not read ${fieldDef.label} (${err?.message || err})`,
      msgCtx,
      { operator: ex.operator, expected_value: ex.value },
    );
  }

  // `exists` facts legitimately resolve to false/null meaning "does not exist".
  if ((actual === null || actual === undefined) && fieldDef.valueType === 'boolean') {
    actual = false;
  }

  if (actual === null || actual === undefined) {
    const reason = `${fieldDef.label} is not available for this claimant`;
    if (informational) return asInfo(reason, fieldKey);
    return unevaluated(rule, fieldKey, keySource, reason, msgCtx, {
      operator: ex.operator,
      expected_value: ex.value,
      source,
    });
  }

  // Case-insensitive comparison for enumerated string codes.
  let actualForEval = actual;
  let expectedForEval = ex.value;
  if (fieldDef.valueType === 'string' && (ex.operator === '==' || ex.operator === '!=' || ex.operator === 'IN')) {
    if (typeof actual === 'string') actualForEval = actual.trim().toUpperCase();
    if (typeof ex.value === 'string') expectedForEval = ex.value.trim().toUpperCase();
  }

  const evalRes = evaluateOperator(actualForEval, ex.operator, expectedForEval, fieldDef.valueType, {
    rangeFrom: ex.rangeFrom ?? def.range_from,
    rangeTo: ex.rangeTo ?? def.range_to,
  });

  // BUG-49 — a rule the engine cannot apply is not a rule the claimant failed.
  // An unimplemented operator used to return passed:false and be recorded as
  // FAIL, so 55 of 68 active rules stated something untrue about every
  // claimant. Unevaluated is blocking and visible; FAIL is a finding.
  if (!informational && evalRes.evaluable === false) {
    return unevaluated(rule, fieldKey, keySource, evalRes.reason, msgCtx, {
      operator: ex.operator,
      expected_value: ex.value,
      source,
      actual_value: actual,
    });
  }

  const outcome: RuleMessageOutcome = informational ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL';
  // The wording comes from the rule's own message_template / fail_message, with
  // its unit applied to both values, and its statutory citation attached.
  const msg = renderRuleMessage(rule as MessageRule, outcome, { ...msgCtx, actual });

  return {
    rule_code: rule.rule_code,
    rule_name: rule.rule_name,
    rule_group: rule.rule_group ?? null,
    field_key: fieldKey,
    operator: ex.operator,
    expected_value: ex.value,
    actual_value: actual,
    passed: informational ? true : evalRes.passed,
    result_state: outcome === 'INFO' ? 'INFO' : evalRes.passed ? 'PASS' : 'FAIL',
    fail_action: informational ? 'INFO' : (rule.fail_action ?? 'REJECT'),
    severity: rule.severity ?? null,
    key_source: keySource,
    source,
    message: msg.text,
    requirement: msg.requirement,
    detail: msg.detail,
    reference: msg.reference,
    alternative_group: alternativeGroup(rule),
  };
}

export async function evaluateEligibilityRules(
  rules: EvaluableRule[],
  ctx: FieldResolutionContext,
): Promise<EligibilityRuleTrace[]> {
  // BUG-31 — a requirement asserted by two rules is evaluated once. The
  // duplicate is dropped here rather than deactivated in the data, so a
  // duplicate added later needs no migration to be handled.
  const { rules: distinct } = dedupeByRequirement(rules);
  const out: EligibilityRuleTrace[] = [];
  for (const rule of distinct) out.push(await evaluateEligibilityRule(rule, ctx));
  return out;
}

/**
 * As `evaluateEligibilityRules`, but also reports which rules were dropped as
 * redundant — used by the configuration screens and the catalogue audit.
 */
export async function evaluateEligibilityRulesWithDuplicates(
  rules: EvaluableRule[],
  ctx: FieldResolutionContext,
): Promise<{ traces: EligibilityRuleTrace[]; duplicates: { rule_code: string; duplicateOf: string }[] }> {
  const { rules: distinct, duplicates } = dedupeByRequirement(rules);
  const traces: EligibilityRuleTrace[] = [];
  for (const rule of distinct) traces.push(await evaluateEligibilityRule(rule, ctx));
  return {
    traces,
    duplicates: duplicates.map((d) => ({ rule_code: d.rule.rule_code, duplicateOf: d.duplicateOf })),
  };
}

/**
 * BUG-30 — an eligibility outcome has three states, not two.
 *
 * "Nothing failed" is not the same as "everything passed". A claim where no
 * rule could be evaluated used to produce the same green PASSED verdict as a
 * claim that genuinely satisfied every requirement, and an officer at the
 * counter could not tell them apart.
 */
export type EligibilityVerdict = 'PASSED' | 'FAILED' | 'NOT_DETERMINED';

export interface EligibilitySummary {
  verdict: EligibilityVerdict;
  /**
   * True only for a PASSED verdict. Persisted as `bn_claim_eligibility.overall_result`
   * and read by the calculation precondition, so NOT_DETERMINED blocks exactly
   * as a failure does.
   */
  overall: boolean;
  /** Rules actually compared against the claimant's record. */
  evaluatedCount: number;
  /** Every rule attached to the product version. */
  totalCount: number;
  /** e.g. "3 of 8 rules evaluated" — shown next to the verdict. */
  coverageLabel: string;
  failed: EligibilityRuleTrace[];
  unevaluated: EligibilityRuleTrace[];
  passed: EligibilityRuleTrace[];
  informational: EligibilityRuleTrace[];
  overridden: EligibilityRuleTrace[];
  /** Alternative-route requirements met by one of their routes (BUG-32). */
  satisfiedGroups: string[];
  /** Alternative-route requirements where no route succeeded. */
  unsatisfiedGroups: string[];
  /**
   * BUG-46 — rules whose evidence cannot exist yet, held back rather than
   * failed. Only ever populated for `phase: 'INTAKE'`; empty at adjudication,
   * where a missing document IS a reason to stop.
   */
  deferred: EligibilityRuleTrace[];
}

export interface SummariseOptions {
  /**
   * 'ADJUDICATION' (the default) judges every rule, documents included — the
   * behaviour every existing caller relies on.
   *
   * 'INTAKE' is for the registration wizard, where the claim does not exist
   * yet, so no document can be attached to it. Document rules move to
   * `deferred` and take no part in the verdict.
   */
  phase?: 'INTAKE' | 'ADJUDICATION';
}

export function summariseEligibility(
  traces: EligibilityRuleTrace[],
  options: SummariseOptions = {},
): EligibilitySummary {
  // BUG-46 — at intake the claim has no id yet, so a document rule is not
  // answerable, let alone failed. Held back here and judged at approval
  // instead, where checkApprovalPreconditions refuses on DOCUMENTS_OUTSTANDING.
  const deferred: EligibilityRuleTrace[] = [];
  if (options.phase === 'INTAKE') {
    const held: EligibilityRuleTrace[] = [];
    for (const t of traces) {
      if (isDeferredAtIntake({
        rule_code: t.rule_code,
        rule_name: t.rule_name,
        rule_group: t.rule_group,
        fact_key: t.field_key,
        fail_action: t.fail_action,
      })) {
        deferred.push(t);
      } else {
        held.push(t);
      }
    }
    traces = held;
  }

  // BUG-32 — collapse each alternative group before judging anything.
  // A requirement with two lawful routes to satisfaction (the Maternity Grant's
  // "her contributions OR her insured husband's") is met when either route is
  // met. Judged rule-by-rule the engine would demand both.
  const groups = new Map<string, EligibilityRuleTrace[]>();
  const standalone: EligibilityRuleTrace[] = [];
  for (const t of traces) {
    if (t.alternative_group) {
      groups.set(t.alternative_group, [...(groups.get(t.alternative_group) ?? []), t]);
    } else {
      standalone.push(t);
    }
  }

  const failed: EligibilityRuleTrace[] = [];
  const unevaluated: EligibilityRuleTrace[] = [];
  const passed: EligibilityRuleTrace[] = [];
  const informational: EligibilityRuleTrace[] = [];
  const overridden: EligibilityRuleTrace[] = [];

  const bucket = (t: EligibilityRuleTrace) => {
    switch (t.result_state) {
      case 'FAIL': failed.push(t); break;
      case 'UNEVALUATED': unevaluated.push(t); break;
      case 'PASS': passed.push(t); break;
      case 'INFO': informational.push(t); break;
      case 'OVERRIDDEN': overridden.push(t); break;
    }
  };
  standalone.forEach(bucket);

  // Alternative groups satisfied by any one member.
  const satisfiedGroups: string[] = [];
  const unsatisfiedGroups: string[] = [];
  for (const [group, members] of groups) {
    const winner = members.find((m) => m.result_state === 'PASS' || m.result_state === 'OVERRIDDEN');
    if (winner) {
      satisfiedGroups.push(group);
      // The satisfied route counts once; the routes not taken are neither
      // failures nor gaps, so they must not drag the verdict down.
      bucket(winner);
      continue;
    }
    unsatisfiedGroups.push(group);
    // No route succeeded. If any route could not be evaluated the requirement
    // is undetermined, not failed — we cannot say the claimant does not qualify
    // when one of the ways they might have qualified was never checked.
    const anyUnevaluated = members.some((m) => m.result_state === 'UNEVALUATED');
    if (anyUnevaluated) {
      // Only the unchecked routes are reported. A route that failed is not a
      // failure of the requirement while another route remains unknown — the
      // claimant may still qualify by it, so the requirement is undetermined.
      members
        .filter((m) => m.result_state === 'UNEVALUATED')
        .forEach((m) => unevaluated.push(m));
    } else {
      // Every route was checked and none succeeded — the requirement genuinely
      // fails, and each route is shown so the officer sees both were tried.
      members.forEach(bucket);
    }
  }

  // Only a real comparison counts as evaluated. An informational note is not
  // evidence that the claimant qualifies, so it does not count either.
  const evaluatedCount = passed.length + failed.length + overridden.length;
  const totalCount = standalone.length + groups.size;

  const verdict: EligibilityVerdict =
    failed.length > 0
      ? 'FAILED'
      // Anything left unevaluated, or nothing evaluated at all (no rules
      // attached, or every rule informational), is undetermined — never a pass.
      : unevaluated.length > 0 || evaluatedCount === 0
        ? 'NOT_DETERMINED'
        : 'PASSED';

  return {
    verdict,
    overall: verdict === 'PASSED',
    evaluatedCount,
    totalCount,
    // BUG-30 asked for this wording. "rules" is accurate whenever each rule is
    // its own requirement; once alternative routes are collapsed the unit is a
    // requirement, not a rule, and saying "rules" would misstate the count.
    coverageLabel: groups.size > 0
      ? `${evaluatedCount} of ${totalCount} requirement${totalCount === 1 ? '' : 's'} evaluated`
      : `${evaluatedCount} of ${totalCount} rule${totalCount === 1 ? '' : 's'} evaluated`,
    failed,
    unevaluated,
    passed,
    informational,
    overridden,
    satisfiedGroups,
    unsatisfiedGroups,
    deferred,
  };
}
