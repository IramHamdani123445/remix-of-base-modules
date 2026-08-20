/**
 * Register a rule created inside a product into the Rule Catalogue.
 *
 * GAP-01 / BUG-13 — the product's Eligibility tab let users create a rule, but
 * nothing put it in the Rule Catalogue. The catalogue is where governance
 * happens, so a rule created on the product had no route to approval and no
 * route to publication: it was stranded. 190 of 239 attached rules in the live
 * database are in that state.
 *
 * The intended flow is now:
 *
 *   Product screen → Add Rule → rule created
 *     → registered in the Rule Catalogue automatically
 *     → status DRAFT
 *     → product rule linked to the catalogue rule
 *     → legal / governance review
 *     → APPROVED / CONFIRMED
 *     → product can publish
 *
 * Registering deliberately does NOT approve. The catalogue entry is created at
 * DRAFT and must still pass governance before the product will publish —
 * otherwise creating a rule inside a product would be a way to bypass legal
 * review entirely, which would be a worse defect than the one this fixes.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnEligibilityRule } from '@/types/bn';

const db = supabase as any;

export type RegisterOutcome = 'CREATED' | 'LINKED_EXISTING';

export interface RegisterResult {
  catalogueRuleId: string;
  catalogueRuleCode: string;
  outcome: RegisterOutcome;
}

/** Raised when the rule code is taken by a catalogue entry that says something different. */
export class CatalogueCodeConflictError extends Error {
  readonly code = 'BN_CATALOGUE_CODE_CONFLICT';
  constructor(ruleCode: string, differences: string[]) {
    super(
      `Rule code "${ruleCode}" already exists in the Rule Catalogue with a different definition ` +
      `(${differences.join('; ')}). Other products may rely on the existing entry, so it has not been ` +
      `changed. Either give this rule a different code, or attach the existing catalogue rule as it stands.`,
    );
    this.name = 'CatalogueCodeConflictError';
  }
}

/** The comparable condition of a rule, however it happens to be stored. */
interface RuleCondition {
  operator: string | null;
  valueFrom: string | null;
  valueTo: string | null;
  values: unknown[] | null;
}

const text = (v: unknown): string | null =>
  v === null || v === undefined || v === '' ? null : String(v);

/**
 * A product rule keeps its condition in rule_definition; the catalogue spreads
 * it across operator / value_from / value_to / values.
 */
function conditionOfProductRule(rule: Partial<BnEligibilityRule>): RuleCondition {
  const def = ((rule as any).rule_definition ?? {}) as Record<string, unknown>;
  const values = Array.isArray(def.values)
    ? def.values
    : Array.isArray((def as any).value_list)
      ? (def as any).value_list
      : null;
  return {
    operator: text(def.operator),
    valueFrom: text(def.value ?? def.value_from ?? (def as any).from),
    valueTo: text(def.value_to ?? (def as any).to),
    values,
  };
}

function conditionOfCatalogueRule(row: Record<string, unknown>): RuleCondition {
  return {
    operator: text(row.operator),
    valueFrom: text(row.value_from),
    valueTo: text(row.value_to),
    values: Array.isArray(row.values) ? (row.values as unknown[]) : null,
  };
}

function sameValues(a: unknown[] | null, b: unknown[] | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/**
 * What differs between the rule being registered and an existing catalogue
 * entry of the same code. Empty means they agree and can safely be linked.
 */
function describeDifferences(
  rule: Partial<BnEligibilityRule>,
  catalogueRow: Record<string, unknown>,
): string[] {
  const mine = conditionOfProductRule(rule);
  const theirs = conditionOfCatalogueRule(catalogueRow);
  const out: string[] = [];

  const compare = (label: string, a: string | null, b: string | null) => {
    // A value the product rule does not specify is not a disagreement — the
    // catalogue may simply hold more detail.
    if (a !== null && b !== null && a !== b) {
      out.push(`${label} ${b} in the catalogue, ${a} here`);
    }
  };

  compare('operator is', mine.operator, theirs.operator);
  compare('value is', mine.valueFrom, theirs.valueFrom);
  compare('upper value is', mine.valueTo, theirs.valueTo);

  const myFact = text((rule as any).fact_key);
  const theirFact = text(catalogueRow.fact_key);
  compare('fact is', myFact, theirFact);

  if (mine.values && theirs.values && !sameValues(mine.values, theirs.values)) {
    out.push('the permitted values differ');
  }
  return out;
}

/**
 * Build the catalogue row for a rule that is not yet registered.
 *
 * `parameter` is filled from the fact key: it names the thing being compared,
 * and the newer catalogue rows use the fact key for exactly that.
 */
function catalogueRowFrom(
  rule: Partial<BnEligibilityRule>,
  userCode: string | null,
): Record<string, unknown> {
  const r = rule as any;
  const condition = conditionOfProductRule(rule);
  const now = new Date().toISOString();

  return {
    rule_code: r.rule_code,
    rule_name: r.rule_name || r.rule_code,
    description: r.description ?? null,
    // The product calls this rule_type; the catalogue calls it group_type.
    group_type: r.rule_type || r.group_code || 'GENERAL',
    category: r.rule_category ?? r.rule_type ?? null,
    parameter: r.fact_key ?? null,
    fact_key: r.fact_key ?? null,
    operator: condition.operator ?? '=',
    value_from: condition.valueFrom,
    value_to: condition.valueTo,
    values: condition.values,
    default_fail_action: r.fail_action || 'REJECT',
    failure_message_text: r.fail_message ?? r.message_template ?? null,
    jurisdiction_country: r.jurisdiction_country ?? null,
    legal_reference: r.legal_reference ?? null,
    // Registered, not approved. Governance still has to run.
    governance_status: 'DRAFT',
    rule_status: 'DRAFT',
    confidence_status: 'DRAFT',
    is_active: true,
    created_by: userCode,
    updated_by: userCode,
    governance_updated_by: userCode,
    governance_updated_at: now,
  };
}

/**
 * Ensure the rule exists in the Rule Catalogue, and return the entry to link to.
 *
 * Three cases:
 *   - not in the catalogue        → create it as DRAFT
 *   - present and in agreement    → link to it, do not duplicate
 *   - present but different       → refuse, so a shared entry other products
 *                                   may depend on is never silently rewritten
 */
export async function registerProductRuleInCatalogue(
  rule: Partial<BnEligibilityRule>,
  userCode: string | null,
): Promise<RegisterResult> {
  const ruleCode = (rule as any).rule_code as string | undefined;
  if (!ruleCode || !ruleCode.trim()) {
    throw new Error('Cannot register this rule in the Rule Catalogue: it has no rule code.');
  }

  const { data: existing, error: lookupError } = await db
    .from('bn_rule_catalogue')
    .select('*')
    .eq('rule_code', ruleCode)
    .maybeSingle();
  if (lookupError) {
    throw new Error(`Cannot check the Rule Catalogue: ${lookupError.message}`);
  }

  if (existing) {
    const differences = describeDifferences(rule, existing);
    if (differences.length > 0) {
      throw new CatalogueCodeConflictError(ruleCode, differences);
    }
    return {
      catalogueRuleId: existing.id,
      catalogueRuleCode: existing.rule_code,
      outcome: 'LINKED_EXISTING',
    };
  }

  const { data: created, error: insertError } = await db
    .from('bn_rule_catalogue')
    .insert(catalogueRowFrom(rule, userCode))
    .select('id, rule_code')
    .single();
  if (insertError) {
    throw new Error(`Cannot add this rule to the Rule Catalogue: ${insertError.message}`);
  }

  return {
    catalogueRuleId: created.id,
    catalogueRuleCode: created.rule_code,
    outcome: 'CREATED',
  };
}
