/**
 * Rule Catalogue Service — reusable eligibility rules shared across products.
 */
import { supabase } from '@/integrations/supabase/client';

export type FailAction = 'REJECT' | 'BLOCK' | 'REFER';

export const RULE_GROUP_TYPES = [
  'AGE','CONTRIBUTION','EMPLOYMENT','MEDICAL','DEPENDENCY',
  'MEANS_TEST','INJURY','FUNERAL','MATERNITY','RESIDENCE','TIMING',
  'DOCUMENT','COMMON',
] as const;

/**
 * Rule Category — broad classification on a catalogue rule.
 * Distinct from Rule Group (which is a reusable master in bn_rule_group).
 */
export const RULE_CATEGORIES = RULE_GROUP_TYPES;

export const RULE_PARAMETERS = [
  'AGE_AT_CLAIM','TOTAL_CONTRIBUTIONS','CONTRIBUTIONS_LAST_13_WEEKS','CONTRIBUTIONS_LAST_12_MONTHS',
  'PAID_CONTRIBUTIONS','HAS_MEDICAL_CERTIFICATE','HAS_EMPLOYER_VERIFICATION','IS_SPOUSE','IS_CHILD',
  'IS_DEPENDENT','CHILD_AGE','CHILD_IN_EDUCATION','INJURY_TYPE','INJURY_WORK_RELATED',
  'DECEASED_CONTRIBUTIONS','MEANS_TEST_INCOME','RESIDENCE_CONFIRMED','DISABILITY_PERCENTAGE',
  'MEDICAL_BOARD_CERTIFIED','EMPLOYMENT_STATUS','SELF_EMPLOYED','CLAIM_SUBMISSION_DAYS',
  'LAST_DAY_WORKED','EXPECTED_DELIVERY_DATE','CONFINEMENT_DATE','DEATH_DATE','FUNERAL_INVOICE_AMOUNT',
] as const;

export const RULE_OPERATORS = [
  'EQUALS','NOT_EQUALS','GREATER_THAN','GREATER_OR_EQUAL','LESS_THAN','LESS_OR_EQUAL',
  'BETWEEN','IN','NOT_IN','BOOLEAN','EXISTS','CONTAINS',
] as const;

export const FAIL_ACTIONS: FailAction[] = ['REJECT','BLOCK','REFER'];

/**
 * effective_from/effective_to were captured on every catalogue rule and shown
 * on screen, but never actually checked anywhere — confirmed by search, zero
 * reads in the live evaluator or any picker. A rule dated to start next year,
 * or one that expired months ago, was exactly as selectable as a current one.
 * Individual product rules (bn_eligibility_rule) don't carry these dates at
 * all, so this can't safely gate live claim evaluation without the larger
 * reference-based redesign — but it can and should gate whether an expired or
 * not-yet-started catalogue rule is offered as a *reusable template* here.
 */
export function isRuleCurrentlyEffective(
  rule: Pick<RuleCatalogueItem, 'effective_from' | 'effective_to'>,
  asOf: Date = new Date(),
): boolean {
  const today = asOf.toISOString().slice(0, 10);
  if (rule.effective_from && rule.effective_from > today) return false;
  if (rule.effective_to && rule.effective_to < today) return false;
  return true;
}

export interface RuleCatalogueItem {
  id: string;
  rule_code: string;
  rule_name: string;
  description: string | null;
  group_type: string;
  category: string | null;
  parameter: string | null;
  fact_key: string | null;
  operator: string;
  value_from: string | null;
  value_to: string | null;
  values: any | null;
  default_fail_action: FailAction;
  failure_message_text: string | null;
  is_active: boolean;
  allow_product_override: boolean;
  tags: string[];
  version: number;
  effective_from: string | null;
  effective_to: string | null;
  rule_group_id: string | null;
  rule_group_code: string | null;
  rule_group_name: string | null;
  default_group_sort_order: number;
  default_rule_sort_order: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  // Governance (Phase 1 — RULE_GOVERNANCE_WORKFLOW)
  governance_status?: 'DRAFT' | 'TECHNICAL_REVIEW' | 'LEGAL_REVIEW' | 'LEGAL_CONFIRMED' | 'READY_FOR_PRODUCT_USE' | 'ACTIVE' | 'RETIRED';
  legal_reference?: string | null;
  legal_notes?: string | null;
  jurisdiction_country?: string | null;
  effective_date?: string | null;
}

export type RuleCatalogueInput = Omit<
  RuleCatalogueItem,
  'id' | 'created_at' | 'updated_at' | 'version' | 'created_by' | 'updated_by'
> & { id?: string };

export async function listRuleCatalogue(): Promise<RuleCatalogueItem[]> {
  const { data, error } = await (supabase as any)
    .from('bn_rule_catalogue')
    .select('*')
    .order('group_type', { ascending: true })
    .order('rule_code', { ascending: true });
  if (error) throw error;
  return (data || []) as RuleCatalogueItem[];
}

export async function getRuleCatalogueUsage(): Promise<Record<string, number>> {
  const { data, error } = await (supabase as any)
    .from('bn_eligibility_rule')
    .select('catalogue_rule_code')
    .not('catalogue_rule_code', 'is', null);
  if (error) throw error;
  const counts: Record<string, number> = {};
  for (const row of (data as any[]) || []) {
    const code = row.catalogue_rule_code as string;
    counts[code] = (counts[code] || 0) + 1;
  }
  return counts;
}

export async function upsertRuleCatalogue(input: RuleCatalogueInput, userCode: string): Promise<RuleCatalogueItem> {
  const payload: any = { ...input, updated_by: userCode };
  if (!input.id) payload.created_by = userCode;
  // Auto-populate denormalized rule_group_code/name from rule_group_id
  if (input.rule_group_id) {
    const { data: g } = await (supabase as any)
      .from('bn_rule_group')
      .select('group_code, group_name')
      .eq('id', input.rule_group_id)
      .maybeSingle();
    if (g) {
      payload.rule_group_code = g.group_code;
      payload.rule_group_name = g.group_name;
    }
  } else {
    payload.rule_group_code = null;
    payload.rule_group_name = null;
  }
  const { data, error } = await (supabase as any)
    .from('bn_rule_catalogue')
    .upsert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as RuleCatalogueItem;
}

export async function cloneRuleCatalogue(source: RuleCatalogueItem, newCode: string, userCode: string): Promise<RuleCatalogueItem> {
  const {
    id, created_at, updated_at, version, created_by, updated_by,
    // Governance/legal fields were being carried over unchanged — cloning an
    // already-approved rule produced a clone that looked pre-approved without
    // ever going through review itself. A clone is a new proposal; it starts
    // at DRAFT with no legal history, same as any other new rule.
    governance_status, legal_reference, legal_notes, jurisdiction_country, effective_date,
    ...rest
  } = source;
  return upsertRuleCatalogue({
    ...rest,
    rule_code: newCode,
    rule_name: `${source.rule_name} (copy)`,
    governance_status: 'DRAFT',
    legal_reference: null,
    legal_notes: null,
    jurisdiction_country: null,
    effective_date: null,
  }, userCode);
}

export async function deleteRuleCatalogue(id: string, code: string): Promise<void> {
  const { count, error: usageErr } = await (supabase as any)
    .from('bn_eligibility_rule')
    .select('id', { count: 'exact', head: true })
    .eq('catalogue_rule_code', code);
  if (usageErr) throw usageErr;
  if ((count ?? 0) > 0) {
    throw new Error(`Rule is in use by ${count} product rule(s). Deactivate instead.`);
  }
  const { error } = await (supabase as any).from('bn_rule_catalogue').delete().eq('id', id);
  if (error) throw error;
}

export async function setRuleCatalogueActive(id: string, isActive: boolean, userCode: string): Promise<void> {
  const { error } = await (supabase as any)
    .from('bn_rule_catalogue')
    .update({ is_active: isActive, updated_by: userCode })
    .eq('id', id);
  if (error) throw error;
}

export function validateRuleCatalogue(input: Partial<RuleCatalogueInput>): string | null {
  if (!input.rule_code?.trim()) return 'Rule code is required';
  if (!/^[A-Z0-9_]+$/.test(input.rule_code)) return 'Rule code must be uppercase letters, digits, underscores';
  if (!input.rule_name?.trim()) return 'Rule name is required';
  if (!input.group_type) return 'Category is required';
  if (!input.operator) return 'Operator is required';
  const op = input.operator;
  if (op === 'BOOLEAN' && !['true','false'].includes(String(input.value_from))) return 'BOOLEAN requires value true/false';
  if (op === 'BETWEEN' && (!input.value_from || !input.value_to)) return 'BETWEEN requires value from and value to';
  if ((op === 'IN' || op === 'NOT_IN') && (!Array.isArray(input.values) || input.values.length === 0)) return 'IN/NOT_IN requires at least one value';
  return null;
}
