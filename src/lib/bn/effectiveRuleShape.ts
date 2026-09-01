/**
 * Effective rule shape — resolves a product eligibility rule's structural
 * fields (WHAT is being checked) from its linked catalogue rule when one
 * exists and the catalogue actually carries a value for that field, falling
 * back to the product rule's own local column otherwise.
 *
 * Field-by-field fallback (not "prefer the whole catalogue row") is what
 * makes this safe to deploy before `bn_rule_catalogue` gains the extra
 * shape columns (rule_kind, start_fact_key, end_fact_key, ...) that GAP-039
 * calls for: until those columns exist, every catalogue lookup comes back
 * null/undefined and every field falls back to the product's own column —
 * today's exact behaviour, unchanged. Once a column is added and populated
 * on the catalogue row, that field starts being read live from there for
 * every product using it, with zero further code changes.
 *
 * Only structural fields are ever taken from the catalogue — never
 * operator/value_from/value_to/values/fail_action/fail_message. Those stay
 * on the product row by design: `bn_rule_catalogue.allow_product_override`
 * exists specifically so one product can set its own threshold on a shared
 * catalogue template (e.g. age >= 60 for one product, >= 62 for another,
 * same rule) — a live-read on those fields would silently erase that.
 *
 * Applies only to rules actually linked via `catalogue_rule_id`. Rules built
 * directly on the product (no catalogue parent — the majority today) are
 * completely unaffected; their local columns are the only copy that has
 * ever existed for them.
 */

export interface CatalogueShapeSource {
  id: string;
  rule_kind?: string | null;
  fact_key?: string | null;
  start_fact_key?: string | null;
  end_fact_key?: string | null;
  fallback_end_fact_key?: string | null;
  compare_fact_key?: string | null;
  document_type_code?: string | null;
  required_status?: string | null;
  existence_check_code?: string | null;
  unit?: string | null;
  reason_code_group?: string | null;
  conditional_when?: unknown;
  message_template?: string | null;
}

export interface ProductRuleShapeSource {
  catalogue_rule_id?: string | null;
  rule_kind?: string | null;
  fact_key?: string | null;
  start_fact_key?: string | null;
  end_fact_key?: string | null;
  fallback_end_fact_key?: string | null;
  compare_fact_key?: string | null;
  document_type_code?: string | null;
  required_status?: string | null;
  existence_check_code?: string | null;
  unit?: string | null;
  reason_code_group?: string | null;
  conditional_when?: unknown;
  message_template?: string | null;
}

export interface EffectiveRuleShape {
  rule_kind: string | null;
  fact_key: string | null;
  start_fact_key: string | null;
  end_fact_key: string | null;
  fallback_end_fact_key: string | null;
  compare_fact_key: string | null;
  document_type_code: string | null;
  required_status: string | null;
  existence_check_code: string | null;
  unit: string | null;
  reason_code_group: string | null;
  conditional_when: unknown;
  message_template: string | null;
}

function pick<T>(catValue: T | null | undefined, localValue: T | null | undefined): T | null {
  return catValue !== undefined && catValue !== null ? catValue : (localValue ?? null);
}

/**
 * `catalogueById` may be a plain lookup map or, more conveniently at most call
 * sites, `undefined`/empty — a rule whose `catalogue_rule_id` has no matching
 * entry (not fetched, or genuinely deleted from the catalogue) simply falls
 * back to its own columns everywhere, the same as an unlinked rule.
 */
export function resolveEffectiveRuleShape(
  rule: ProductRuleShapeSource,
  catalogueById: Map<string, CatalogueShapeSource> | Record<string, CatalogueShapeSource> | undefined,
): EffectiveRuleShape {
  const cat = rule.catalogue_rule_id
    ? catalogueById instanceof Map
      ? catalogueById.get(rule.catalogue_rule_id)
      : catalogueById?.[rule.catalogue_rule_id]
    : undefined;

  return {
    rule_kind: pick(cat?.rule_kind, rule.rule_kind),
    fact_key: pick(cat?.fact_key, rule.fact_key),
    start_fact_key: pick(cat?.start_fact_key, rule.start_fact_key),
    end_fact_key: pick(cat?.end_fact_key, rule.end_fact_key),
    fallback_end_fact_key: pick(cat?.fallback_end_fact_key, rule.fallback_end_fact_key),
    compare_fact_key: pick(cat?.compare_fact_key, rule.compare_fact_key),
    document_type_code: pick(cat?.document_type_code, rule.document_type_code),
    required_status: pick(cat?.required_status, rule.required_status),
    existence_check_code: pick(cat?.existence_check_code, rule.existence_check_code),
    unit: pick(cat?.unit, rule.unit),
    reason_code_group: pick(cat?.reason_code_group, rule.reason_code_group),
    conditional_when: cat?.conditional_when ?? rule.conditional_when ?? null,
    message_template: pick(cat?.message_template, rule.message_template),
  };
}

/** Builds the `catalogue_rule_id -> row` map `resolveEffectiveRuleShape` expects, from a fetched rule set. */
export function collectCatalogueRuleIds(rules: ProductRuleShapeSource[]): string[] {
  return Array.from(new Set(rules.map((r) => r.catalogue_rule_id).filter((id): id is string => Boolean(id))));
}
