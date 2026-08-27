/**
 * BN Rule Governance Service
 *
 * Drives lifecycle transitions for catalogue rules
 * (bn_rule_catalogue.governance_status) using the seeded
 * RULE_GOVERNANCE_WORKFLOW. Centralises:
 *   - allowed transitions per current state
 *   - role gating
 *   - technical / legal validation gates
 *   - audit (system_audit_trail + workflow_logs)
 *
 * Catalogue rules are the unit of governance; per-product
 * bn_eligibility_rule rows inherit governance state via their
 * catalogue_rule_id when attached.
 */
import { supabase } from '@/integrations/supabase/client';
import { writeBnAudit } from '@/services/bn/audit/bnAuditService';
import { lookupField } from '@/services/bn/eligibility/ruleFieldMapping';

const db = supabase as any;

export type GovernanceStatus =
  | 'DRAFT'
  | 'TECHNICAL_REVIEW'
  | 'LEGAL_REVIEW'
  | 'LEGAL_CONFIRMED'
  | 'READY_FOR_PRODUCT_USE'
  | 'ACTIVE'
  | 'RETIRED';

export type GovernanceAction =
  | 'SUBMIT_FOR_TECHNICAL_REVIEW'
  | 'PASS_TECHNICAL_REVIEW'
  | 'RETURN_FOR_CORRECTION'
  | 'APPROVE_LEGAL'
  | 'REJECT_LEGAL'
  | 'MARK_READY'
  | 'ACTIVATE_WHEN_USED'
  | 'RETIRE'
  | 'RESTORE';

export interface GovernanceTransition {
  action: GovernanceAction;
  label: string;
  from: GovernanceStatus[];
  to: GovernanceStatus;
  roles: string[];        // any of
  buttonVariant: 'default' | 'secondary' | 'destructive' | 'outline';
  requiresComment?: boolean;
  destructive?: boolean;
}

export const GOVERNANCE_TRANSITIONS: GovernanceTransition[] = [
  { action: 'SUBMIT_FOR_TECHNICAL_REVIEW', label: 'Submit for Technical Review',
    from: ['DRAFT'], to: 'TECHNICAL_REVIEW',
    roles: ['BN_RULE_AUTHOR','BN_CONFIG_ADMIN'], buttonVariant: 'default' },

  { action: 'PASS_TECHNICAL_REVIEW', label: 'Pass Technical Review',
    from: ['TECHNICAL_REVIEW'], to: 'LEGAL_REVIEW',
    roles: ['BN_RULE_TECHNICAL_REVIEWER','BN_CONFIG_ADMIN'], buttonVariant: 'default' },

  { action: 'RETURN_FOR_CORRECTION', label: 'Return for Correction',
    from: ['TECHNICAL_REVIEW'], to: 'DRAFT',
    roles: ['BN_RULE_TECHNICAL_REVIEWER','BN_CONFIG_ADMIN'],
    buttonVariant: 'outline', requiresComment: true },

  { action: 'APPROVE_LEGAL', label: 'Approve Legal',
    from: ['LEGAL_REVIEW'], to: 'LEGAL_CONFIRMED',
    roles: ['BN_RULE_LEGAL_APPROVER'], buttonVariant: 'default', requiresComment: true },

  { action: 'REJECT_LEGAL', label: 'Reject Legal',
    from: ['LEGAL_REVIEW'], to: 'DRAFT',
    roles: ['BN_RULE_LEGAL_APPROVER'], buttonVariant: 'destructive', requiresComment: true },

  { action: 'MARK_READY', label: 'Mark Ready for Product Use',
    from: ['LEGAL_CONFIRMED'], to: 'READY_FOR_PRODUCT_USE',
    roles: ['BN_PRODUCT_MANAGER','BN_CONFIG_ADMIN'], buttonVariant: 'default' },

  { action: 'RETIRE', label: 'Retire',
    from: ['READY_FOR_PRODUCT_USE','ACTIVE','LEGAL_CONFIRMED'], to: 'RETIRED',
    roles: ['BN_PRODUCT_MANAGER','BN_CONFIG_ADMIN'],
    buttonVariant: 'destructive', requiresComment: true, destructive: true },

  { action: 'RESTORE', label: 'Restore',
    from: ['RETIRED'], to: 'READY_FOR_PRODUCT_USE',
    roles: ['BN_CONFIG_ADMIN'], buttonVariant: 'outline' },
];

export interface GovernanceContext {
  userCode: string;
  userRoles: string[];
  isAdmin?: boolean;
  comment?: string;
  // Legal payload (only required for APPROVE_LEGAL)
  legalReference?: string;
  legalNotes?: string;
  jurisdictionCountry?: string;
  effectiveDate?: string;
}

export interface ValidationIssue {
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface RuleSnapshot {
  id: string;
  rule_code: string;
  rule_name: string;
  fact_key: string | null;
  operator: string;
  value_from: string | null;
  value_to: string | null;
  values: any;
  effective_from: string | null;
  effective_to: string | null;
  governance_status: GovernanceStatus;
  legal_reference: string | null;
  legal_notes: string | null;
  jurisdiction_country: string | null;
  effective_date: string | null;
  legal_approver_comment: string | null;
}

// ─────────────── Helpers ───────────────

function userHasRole(roles: string[], allowed: string[], isAdmin?: boolean): boolean {
  if (isAdmin) return true;
  return allowed.some(r => roles.includes(r));
}

export function availableTransitions(
  currentStatus: GovernanceStatus,
  userRoles: string[],
  isAdmin?: boolean,
): GovernanceTransition[] {
  return GOVERNANCE_TRANSITIONS.filter(
    t => t.from.includes(currentStatus) && userHasRole(userRoles, t.roles, isAdmin),
  );
}

// ─────────────── Validation gates ───────────────

/**
 * Rule operators exist in two spellings, and both are live data.
 *
 * `bn_eligibility_fact.allowed_operators` stores symbols — ["=", "!=", ">",
 * ">=", "<", "<=", "between"] — and the Rule Catalogue form sets the rule's
 * operator FROM that list when a fact is chosen. This gate only accepted the
 * word spelling, so it rejected the very value the form had just written:
 * 13 of the 68 catalogue rules could never pass technical review, whichever
 * operator the reviewer picked.
 *
 * Both spellings are therefore accepted and normalised to one canonical form.
 * A spelling in neither table is still rejected — this widens the vocabulary,
 * it does not remove the check.
 */
/**
 * BUG-49 — the vocabulary used to be restated here, separately from the one
 * the runtime engine used, and the two disagreed: this gate accepted BOOLEAN
 * and GREATER_OR_EQUAL while the engine failed every rule that carried them.
 * There is now one definition, in `operatorEvaluator`, and it is the same one
 * the comparison is driven by. Re-exported so existing callers are unchanged.
 */
export { canonicalOperator } from '@/services/bn/eligibility/operatorEvaluator';
import { CANONICAL_OPERATORS } from '@/services/bn/eligibility/operatorEvaluator';

export async function validateTechnical(rule: RuleSnapshot): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  if (!rule.fact_key) {
    issues.push({ code: 'FACT_MISSING', message: 'Rule has no fact_key', severity: 'error' });
  } else {
    // A fact is registered in either of two places: the bn_eligibility_fact
    // table, or the application's own field/fact registries. Checking only the
    // table reported "not registered" for facts the evaluator resolves fine.
    const inCodeRegistry = lookupField(rule.fact_key) !== undefined;

    const { data: fact, error: factError } = await db.from('bn_eligibility_fact')
      .select('fact_key, implementation_status').eq('fact_key', rule.fact_key).maybeSingle();

    if (factError) {
      // The error used to be discarded, so an unreadable table was reported as
      // an unregistered fact — a false accusation against a valid rule.
      if (!inCodeRegistry) {
        issues.push({
          code: 'FACT_UNVERIFIABLE',
          message:
            `Could not check whether fact "${rule.fact_key}" is registered ` +
            `(${factError.message}). Retry, or confirm the fact registry is readable.`,
          severity: 'error',
        });
      }
      // Present in the code registry — the table read failing does not make the
      // rule invalid, so nothing is raised.
    } else if (!fact) {
      if (!inCodeRegistry) {
        issues.push({ code: 'FACT_NOT_REGISTERED',
          message: `Fact "${rule.fact_key}" is not registered`, severity: 'error' });
      }
    } else if (fact.implementation_status === 'NOT_IMPLEMENTED') {
      issues.push({ code: 'FACT_NOT_IMPLEMENTED',
        message: `Fact "${rule.fact_key}" is not implemented`, severity: 'error' });
    } else if (fact.implementation_status === 'PARTIAL') {
      issues.push({ code: 'FACT_PARTIAL',
        message: `Fact "${rule.fact_key}" is only partially implemented`, severity: 'warning' });
    }
  }

  const canonical = canonicalOperator(rule.operator);
  if (!canonical) {
    issues.push({
      code: 'OPERATOR_INVALID',
      message:
        `Operator "${rule.operator}" is not recognised. Use one of: ` +
        [...CANONICAL_OPERATORS].join(', ') + ' (or the symbol form =, !=, >, >=, <, <=).',
      severity: 'error',
    });
  }

  // Value presence checks run against the canonical form, so a rule stored with
  // the symbol spelling gets the same value validation as the word spelling.
  const op = canonical ?? '';
  if (op === 'BETWEEN' && (rule.value_from == null || rule.value_to == null)) {
    issues.push({ code: 'VALUE_RANGE_MISSING',
      message: 'BETWEEN requires both value_from and value_to', severity: 'error' });
  } else if ((op === 'IN' || op === 'NOT_IN') &&
             (!Array.isArray(rule.values) || rule.values.length === 0)) {
    issues.push({ code: 'VALUE_LIST_MISSING',
      message: `${op} requires a non-empty values list`, severity: 'error' });
  } else if (['EQUALS','NOT_EQUALS','GREATER_THAN','GREATER_OR_EQUAL',
              'LESS_THAN','LESS_OR_EQUAL','CONTAINS','BOOLEAN'].includes(op)
             && rule.value_from == null) {
    // Allow null only when product overrides expected — warn instead of block
    issues.push({ code: 'VALUE_MISSING',
      message: 'No default value — each product must override before publish',
      severity: 'warning' });
  }

  // Effective dates sanity
  if (rule.effective_from && rule.effective_to
      && new Date(rule.effective_from) > new Date(rule.effective_to)) {
    issues.push({ code: 'EFFECTIVE_DATES_INVERTED',
      message: 'effective_from is after effective_to', severity: 'error' });
  }

  return issues;
}

export function validateLegal(rule: RuleSnapshot, ctx: GovernanceContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const ref = ctx.legalReference ?? rule.legal_reference;
  const notes = ctx.legalNotes ?? rule.legal_notes;
  const jur = ctx.jurisdictionCountry ?? rule.jurisdiction_country;
  const eff = ctx.effectiveDate ?? rule.effective_date;

  if (!ref || !ref.trim()) issues.push({ code: 'LEGAL_REF_REQUIRED',
    message: 'Legal reference is required', severity: 'error' });
  if (!notes || !notes.trim()) issues.push({ code: 'LEGAL_NOTES_REQUIRED',
    message: 'Legal notes are required', severity: 'error' });
  if (!jur || !jur.trim()) issues.push({ code: 'JURISDICTION_REQUIRED',
    message: 'Jurisdiction / country is required', severity: 'error' });
  if (!eff) issues.push({ code: 'EFFECTIVE_DATE_REQUIRED',
    message: 'Effective date is required', severity: 'error' });
  if (!ctx.comment || !ctx.comment.trim()) issues.push({ code: 'APPROVER_COMMENT_REQUIRED',
    message: 'Approver comment is required', severity: 'error' });

  return issues;
}

// ─────────────── Transition execution ───────────────

export interface TransitionResult {
  ok: boolean;
  newStatus?: GovernanceStatus;
  issues?: ValidationIssue[];
  error?: string;
}

export async function executeTransition(
  ruleId: string,
  action: GovernanceAction,
  ctx: GovernanceContext,
): Promise<TransitionResult> {
  const transition = GOVERNANCE_TRANSITIONS.find(t => t.action === action);
  if (!transition) return { ok: false, error: 'Unknown action' };

  // Load current rule snapshot
  const { data: rule, error: loadErr } = await db
    .from('bn_rule_catalogue')
    .select('id, rule_code, rule_name, fact_key, operator, value_from, value_to, values, effective_from, effective_to, governance_status, legal_reference, legal_notes, jurisdiction_country, effective_date, legal_approver_comment')
    .eq('id', ruleId)
    .maybeSingle();
  if (loadErr || !rule) return { ok: false, error: loadErr?.message ?? 'Rule not found' };

  const current = rule.governance_status as GovernanceStatus;
  if (!transition.from.includes(current)) {
    return { ok: false, error: `Action "${action}" not allowed from state "${current}"` };
  }
  if (!userHasRole(ctx.userRoles, transition.roles, ctx.isAdmin)) {
    return { ok: false, error: `Your role is not authorised to perform "${transition.label}"` };
  }
  if (transition.requiresComment && (!ctx.comment || !ctx.comment.trim())) {
    return { ok: false, error: 'A comment is required for this action' };
  }

  // Gate: technical
  if (action === 'PASS_TECHNICAL_REVIEW') {
    const issues = await validateTechnical(rule as RuleSnapshot);
    if (issues.some(i => i.severity === 'error')) return { ok: false, issues };
  }
  // Gate: legal
  if (action === 'APPROVE_LEGAL') {
    const issues = validateLegal(rule as RuleSnapshot, ctx);
    if (issues.length) return { ok: false, issues };
  }

  // Build update payload
  const now = new Date().toISOString();
  const update: Record<string, any> = {
    governance_status: transition.to,
    governance_updated_by: ctx.userCode,
    governance_updated_at: now,
  };
  if (action === 'PASS_TECHNICAL_REVIEW') {
    update.technical_validated_by = ctx.userCode;
    update.technical_validated_at = now;
  }
  if (action === 'APPROVE_LEGAL') {
    update.legal_approved_by = ctx.userCode;
    update.legal_approved_at = now;
    update.legal_approver_comment = ctx.comment;
    if (ctx.legalReference)      update.legal_reference = ctx.legalReference;
    if (ctx.legalNotes)          update.legal_notes = ctx.legalNotes;
    if (ctx.jurisdictionCountry) update.jurisdiction_country = ctx.jurisdictionCountry;
    if (ctx.effectiveDate)       update.effective_date = ctx.effectiveDate;
  }
  // Keep legacy fields in sync where they overlap
  if (transition.to === 'ACTIVE' || transition.to === 'READY_FOR_PRODUCT_USE') {
    update.rule_status = transition.to === 'ACTIVE' ? 'PUBLISHED' : 'READY';
  } else if (transition.to === 'RETIRED') {
    update.rule_status = 'RETIRED';
  } else if (transition.to === 'DRAFT') {
    update.rule_status = 'DRAFT';
  }

  const { error: updErr } = await db.from('bn_rule_catalogue').update(update).eq('id', ruleId);
  if (updErr) return { ok: false, error: updErr.message };

  // Audit (critical for legal/retire/restore; info otherwise)
  const critical = ['APPROVE_LEGAL','REJECT_LEGAL','RETIRE','RESTORE'].includes(action);
  await writeBnAudit({
    module: 'BN_RULE_GOVERNANCE',
    entityType: 'BN_RULE_CATALOGUE',
    entityId: ruleId,
    action,
    beforeValue: { governance_status: current },
    afterValue:  { governance_status: transition.to },
    notes: ctx.comment ?? null,
    performedBy: ctx.userCode,
    critical,
    payload: {
      rule_code: rule.rule_code,
      legal_reference: ctx.legalReference,
      jurisdiction_country: ctx.jurisdictionCountry,
      effective_date: ctx.effectiveDate,
    },
  });

  // workflow_logs (best-effort; tied to workflow definition, no instance required)
  try {
    const { data: wf } = await db.from('workflow_definitions')
      .select('id').eq('name', 'RULE_GOVERNANCE_WORKFLOW').maybeSingle();
    if (wf?.id) {
      await db.from('workflow_logs').insert({
        instance_id: wf.id, // standalone (no instance per rule) — link via definition
        step_name: transition.to,
        action,
        old_status: current,
        new_status: transition.to,
        comments: ctx.comment ?? null,
        user_name: ctx.userCode,
        metadata: { rule_id: ruleId, rule_code: rule.rule_code },
      });
    }
  } catch (e) {
    // non-blocking; system_audit_trail is authoritative
    console.warn('[ruleGovernance] workflow_logs insert skipped:', e);
  }

  return { ok: true, newStatus: transition.to };
}

/**
 * System-triggered ACTIVATE_WHEN_USED — called when a product version becomes ACTIVE.
 * Promotes READY_FOR_PRODUCT_USE catalogue rules attached to the version into ACTIVE.
 */
export async function activateAttachedRules(productVersionId: string, userCode: string): Promise<number> {
  const { data: attached } = await db
    .from('bn_eligibility_rule')
    .select('catalogue_rule_id')
    .eq('product_version_id', productVersionId)
    .not('catalogue_rule_id', 'is', null);

  const ids = Array.from(new Set((attached ?? []).map((r: any) => r.catalogue_rule_id))) as string[];
  if (ids.length === 0) return 0;

  const { data: rules } = await db
    .from('bn_rule_catalogue')
    .select('id, rule_code, governance_status')
    .in('id', ids)
    .eq('governance_status', 'READY_FOR_PRODUCT_USE');

  let promoted = 0;
  for (const r of (rules ?? []) as any[]) {
    const res = await executeTransition(r.id, 'RETIRE' as any, // placeholder, overridden below
      { userCode, userRoles: ['BN_CONFIG_ADMIN'], isAdmin: true });
    // We need a custom ACTIVE transition — handle directly to avoid role coupling
    const now = new Date().toISOString();
    const { error } = await db.from('bn_rule_catalogue').update({
      governance_status: 'ACTIVE',
      rule_status: 'PUBLISHED',
      governance_updated_by: userCode,
      governance_updated_at: now,
    }).eq('id', r.id);
    if (!error) {
      promoted++;
      await writeBnAudit({
        module: 'BN_RULE_GOVERNANCE',
        entityType: 'BN_RULE_CATALOGUE',
        entityId: r.id,
        action: 'ACTIVATE_WHEN_USED',
        beforeValue: { governance_status: 'READY_FOR_PRODUCT_USE' },
        afterValue:  { governance_status: 'ACTIVE' },
        notes: `Activated via product version ${productVersionId}`,
        performedBy: userCode,
        critical: false,
      });
    }
    void res;
  }
  return promoted;
}

/**
 * Why an attached rule fails the governance gate. The two cases need
 * different actions from the user, so they are reported separately rather
 * than collapsed into one message.
 *
 *  NOT_REGISTERED — the rule was never entered in the Rule Catalogue, so it
 *                   has not been through the governance chain at all. It must
 *                   be registered and approved before it can be published.
 *  NOT_APPROVED   — the rule is in the catalogue but has not reached
 *                   Legal Confirmed / Ready / Active yet. It only needs
 *                   advancing.
 */
export type UngovernedRuleReason = 'NOT_REGISTERED' | 'NOT_APPROVED';

export interface UngovernedAttachedRule {
  rule_id: string;
  rule_code: string;
  rule_name: string;
  governance_status: string;
  reason: UngovernedRuleReason;
}

/**
 * Pre-activation guard for product versions: returns blocking rule list.
 *
 * BUG-13 — this previously discarded every rule with no catalogue link
 * (`.filter(Boolean)`), so a rule created directly on a product's Eligibility
 * tab passed the gate without ever having been approved. Where no rule on the
 * version had a catalogue link, the gate had an empty list and reported no
 * problems at all. A missing catalogue link means "never approved", not
 * "nothing to check".
 *
 * A rule row carries its own `governance_status` column, but that is not
 * evidence of approval: it can be set by whoever created the rule, without
 * legal review. The Rule Catalogue is the authority, so an unregistered rule
 * is ungoverned no matter what its own row claims.
 *
 * Inactive rules are excluded — they are not evaluated against claims, so
 * requiring their approval would block publishing for no benefit.
 *
 * Query failures now throw. Returning an empty list on error would make a
 * broken gate indistinguishable from a clean one.
 */
export async function findUngovernedAttachedRules(
  productVersionId: string,
): Promise<UngovernedAttachedRule[]> {
  const { data: attached, error: attachedError } = await db
    .from('bn_eligibility_rule')
    .select('id, rule_code, rule_name, catalogue_rule_id, catalogue_rule_code, is_active')
    .eq('product_version_id', productVersionId)
    .eq('is_active', true);
  if (attachedError) {
    throw new Error(
      `Cannot verify rule governance: ${attachedError.message}. Publishing is blocked until the check can run.`,
    );
  }

  const rules = (attached ?? []) as any[];
  if (rules.length === 0) return [];

  // Rules never registered in the catalogue — ungoverned by definition.
  const unregistered: UngovernedAttachedRule[] = rules
    .filter(r => !r.catalogue_rule_id)
    .map(r => ({
      rule_id: r.id,
      rule_code: r.rule_code || r.catalogue_rule_code || '(no code)',
      rule_name: r.rule_name || '(unnamed rule)',
      governance_status: 'NOT_IN_CATALOGUE',
      reason: 'NOT_REGISTERED' as const,
    }));

  const ids = Array.from(new Set(
    rules.map(r => r.catalogue_rule_id).filter(Boolean),
  )) as string[];
  if (ids.length === 0) return unregistered;

  const { data: cat, error: catError } = await db
    .from('bn_rule_catalogue')
    .select('id, rule_code, rule_name, governance_status')
    .in('id', ids);
  if (catError) {
    throw new Error(
      `Cannot verify rule governance: ${catError.message}. Publishing is blocked until the check can run.`,
    );
  }

  const catalogue = new Map<string, any>(((cat ?? []) as any[]).map(r => [r.id, r]));
  const allowed = new Set(['LEGAL_CONFIRMED','READY_FOR_PRODUCT_USE','ACTIVE']);

  const linked: UngovernedAttachedRule[] = [];
  for (const r of rules) {
    if (!r.catalogue_rule_id) continue;
    const entry = catalogue.get(r.catalogue_rule_id);
    if (!entry) {
      // The link points at a catalogue entry that no longer exists. Treated as
      // unregistered — there is nothing left to approve.
      linked.push({
        rule_id: r.id,
        rule_code: r.rule_code || r.catalogue_rule_code || '(no code)',
        rule_name: r.rule_name || '(unnamed rule)',
        governance_status: 'CATALOGUE_ENTRY_MISSING',
        reason: 'NOT_REGISTERED',
      });
      continue;
    }
    if (!allowed.has(entry.governance_status)) {
      linked.push({
        rule_id: entry.id,
        rule_code: entry.rule_code,
        rule_name: entry.rule_name,
        governance_status: entry.governance_status,
        reason: 'NOT_APPROVED',
      });
    }
  }

  return [...unregistered, ...linked];
}
