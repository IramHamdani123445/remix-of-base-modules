/**
 * Rule field mapping — the pure half of the eligibility evaluator (BUG-29/31).
 *
 * Deliberately free of any Supabase or resolver import so that lint scripts,
 * the publish gate and CI can reason about whether a rule CAN be evaluated
 * without opening a database connection. Runtime evaluation lives in
 * `eligibilityEvaluator.ts`, which re-exports everything here.
 */
import { getFieldDef, type EligibilityValueType } from './fieldRegistry';
import { getFact } from './eligibilityFactRegistry';

/**
 * Kept here rather than imported from `eligibilityFactResolver` so this module
 * stays free of any Supabase import. The resolver exports the same pattern.
 */
export const DOCUMENT_STATUS_FACT_PATTERN = /^document\.[a-z0-9_]+\.status$/;

function documentStatusLabel(key: string): string {
  const base = key.slice('document.'.length, -'.status'.length).replace(/_/g, ' ');
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} status`;
}

/** Minimal shape needed from a `bn_eligibility_rule` row. */
export interface EvaluableRule {
  rule_code: string;
  rule_name: string;
  rule_group?: string | null;
  fact_key?: string | null;
  fail_action?: string | null;
  fail_message?: string | null;
  severity?: string | null;
  rule_definition?: Record<string, unknown> | null;
}

export type RuleKeySource = 'field_key' | 'fact_key' | 'definition_fact' | 'alias' | 'none';

/**
 * Legacy fact names that authoring screens wrote before the field registry
 * was introduced, mapped onto their canonical registry key. Deliberately
 * explicit and narrow — an unrecognised name is NOT guessed at, it becomes
 * UNEVALUATED so somebody fixes the rule configuration.
 */
export const LEGACY_FACT_ALIASES: Record<string, string> = {
  age_years: 'person.age_at_claim_date',
  age: 'person.age_at_claim_date',
  claimant_age: 'person.age_at_claim_date',
  person_age: 'person.age_at_claim_date',
  contribution_weeks_total: 'contribution.total_weeks',
  total_contribution_weeks: 'contribution.total_weeks',
  contribution_weeks: 'contribution.total_weeks',
  total_wages: 'contribution.total_wages',
  average_weekly_wage: 'contribution.avg_weekly_wage',
  avg_weekly_wage: 'contribution.avg_weekly_wage',
  person_status: 'person.status',
  employer_status: 'employer.status',
  claimant_deceased: 'person.deceased',
  duplicate_claim_exists: 'claim.has_duplicate_active_claim',
  benefit_type: 'claim.benefit_type',
  claim_date: 'claim.claim_date',
  // BUG-31 — legacy names found on live ACTIVE versions whose canonical fact is
  // unambiguous. Names whose meaning is merely *similar* are deliberately left
  // out: silently equating two different requirements is the mismatched-rule
  // defect BUG-31 reported, and a wrong mapping is worse than an honest block.
  total_weeks: 'contribution.total_weeks',
  has_active_age_pension: 'existing.contributory_pension_exists',
  // "Loss of faculty" is the statutory term for the disablement percentage.
  loss_of_faculty_pct: 'medical.disablement_percentage',
  // Names the rules already use for criteria that now have a fact behind them.
  age_at_first_registration: 'person.age_at_first_registration',
  death_confirmed: 'person.death_confirmed',
  medical_board_decision_present: 'medical_board.decision_present',
  is_qualifying_survivor: 'beneficiary.is_qualifying_survivor',
};

/**
 * The module grew two parallel catalogues: `fieldRegistry` (13 keys, resolved
 * by `resolveField`) and `eligibilityFactRegistry` (51 keys, resolved by
 * `resolveFact`). Authored rules reference both. Looking in only one of them
 * was a large part of why so many rules never evaluated, so every lookup here
 * consults both.
 */
export interface KnownField {
  key: string;
  label: string;
  valueType: EligibilityValueType;
  registry: 'field' | 'fact';
}

const FACT_TYPE_TO_VALUE_TYPE: Record<string, EligibilityValueType> = {
  number: 'number', date: 'date', string: 'string', bool: 'boolean', enum: 'string',
};

export function lookupField(key: string | null | undefined): KnownField | undefined {
  if (!key) return undefined;
  const fieldDef = getFieldDef(key);
  if (fieldDef) {
    return { key, label: fieldDef.label, valueType: fieldDef.valueType, registry: 'field' };
  }
  // BUG-31 — `document.<code>.status` is resolvable from the key itself, so it
  // counts as known even without a registry entry. Products attach document
  // rules faster than the registry gains named entries.
  if (DOCUMENT_STATUS_FACT_PATTERN.test(key)) {
    return { key, label: documentStatusLabel(key), valueType: 'string', registry: 'fact' };
  }
  const factDef = getFact(key);
  if (factDef) {
    return {
      key,
      label: factDef.label,
      valueType: FACT_TYPE_TO_VALUE_TYPE[factDef.data_type] ?? 'string',
      registry: 'fact',
    };
  }
  return undefined;
}

export interface ResolvedRuleKey {
  key: string | null;
  source: RuleKeySource;
  /** The raw name found, when it could not be mapped to a registry key. */
  rawKey: string | null;
}

/**
 * Reads a rule's field key from every convention in use, in precedence order:
 *   1. `rule_definition.field_key` — written by the current rule builder
 *   2. `fact_key` column           — written by the typed rule editor
 *   3. `rule_definition.fact`      — written by the original/seeded rules
 * A name that is not in the field registry is put through the alias table.
 * Anything still unrecognised returns `key: null` with `rawKey` preserved so
 * the caller can report exactly which name failed.
 */
export function resolveRuleFieldKey(rule: EvaluableRule): ResolvedRuleKey {
  const def = (rule.rule_definition || {}) as Record<string, unknown>;
  const candidates: [string | null, RuleKeySource][] = [
    [(def.field_key as string) ?? null, 'field_key'],
    [rule.fact_key ?? null, 'fact_key'],
    [(def.fact as string) ?? null, 'definition_fact'],
  ];

  let firstRaw: string | null = null;
  for (const [raw, source] of candidates) {
    if (!raw) continue;
    firstRaw = firstRaw ?? raw;
    if (lookupField(raw)) return { key: raw, source, rawKey: raw };
    const aliased = LEGACY_FACT_ALIASES[raw];
    if (aliased && lookupField(aliased)) return { key: aliased, source: 'alias', rawKey: raw };
  }
  return { key: null, source: 'none', rawKey: firstRaw };
}

/**
 * A rule is informational only when it says so. `fail_action = 'INFO'` is the
 * deliberate marker; `rule_definition.informational` is honoured for rules
 * imported with that flag. A missing field mapping does NOT make a rule
 * informational — that was the defect.
 */
export function isInformationalRule(rule: EvaluableRule): boolean {
  const def = (rule.rule_definition || {}) as Record<string, unknown>;
  return String(rule.fail_action ?? '').toUpperCase() === 'INFO' || def.informational === true;
}

/**
 * The requirement a rule asserts, reduced to a comparable key: resolved field,
 * operator and expected value. Two rules with the same key demand exactly the
 * same thing, so only one of them needs evaluating.
 *
 * Returns null when the rule has no resolvable field — those are reported as
 * unevaluated individually and must never be collapsed together.
 */
export function requirementKey(rule: EvaluableRule): string | null {
  const { key } = resolveRuleFieldKey(rule);
  if (!key) return null;
  const def = (rule.rule_definition || {}) as Record<string, unknown>;
  const hasRange = def.min != null && def.max != null;
  const op = String(def.operator ?? (hasRange ? 'between' : '=')).trim().toLowerCase();
  const val = hasRange
    ? `${String(def.min)}..${String(def.max)}`
    : JSON.stringify(def.value ?? def.required_value ?? def.expected_value ?? null);
  return `${key}|${op}|${val}`;
}

export interface DedupedRules<T extends EvaluableRule> {
  /** One rule per distinct requirement, plus every unmappable rule. */
  rules: T[];
  /** Rules dropped as redundant, each naming the rule it duplicates. */
  duplicates: { rule: T; duplicateOf: string }[];
}

/**
 * Drops rules that assert a requirement an earlier rule already asserts.
 *
 * BUG-31 found 11 such pairs across 9 products — "Age at claim date >= 62" and
 * "Age >= 62", for instance. Because the requirement is identical, dropping one
 * cannot change any claim outcome; it only stops one statutory requirement
 * being evaluated twice and reported to the caseworker twice.
 *
 * Done here rather than by deactivating rows so that a duplicate introduced
 * later is handled the same way, with no further data migration.
 */
export function dedupeByRequirement<T extends EvaluableRule>(rules: T[]): DedupedRules<T> {
  const seen = new Map<string, T>();
  const kept: T[] = [];
  const duplicates: { rule: T; duplicateOf: string }[] = [];

  for (const rule of rules) {
    const rk = requirementKey(rule);
    if (rk === null) {
      kept.push(rule);
      continue;
    }
    const first = seen.get(rk);
    if (first) {
      duplicates.push({ rule, duplicateOf: first.rule_code });
      continue;
    }
    seen.set(rk, rule);
    kept.push(rule);
  }
  return { rules: kept, duplicates };
}
