/**
 * bnRegistryValidationService — drift-aware conformance checks.
 *
 * Behavior (per Option B):
 *   - bn_claim_transition_rule is the RUNTIME SOURCE OF TRUTH.
 *   - transitionRegistry.ts is only for editor suggestions / icons / labels.
 *   - Transition drift surfaces as WARNING, never ERROR.
 *   - True ERRORS are reserved for structural issues:
 *        null from/to/action, duplicate rules, missing/inactive role refs.
 *   - A separate drift report enumerates statuses/actions present in DB but
 *     missing from the registry (and vice versa).
 *   - generateRegistrySuggestions() emits a JSON preview for devs — it does
 *     NOT modify source code.
 */
import { supabase } from '@/integrations/supabase/client';
import { ALLOWED_TRANSITIONS, CLAIM_STATUSES, CLAIM_ACTIONS } from './registries/transitionRegistry';
import { FORMULA_VARIABLES } from './registries/formulaVariableRegistry';
import { ELIGIBILITY_FIELDS } from './registries/eligibilityFieldRegistry';
import { SMART_FIELD_TYPES } from './registries/smartFieldRegistry';
import { fetchWorkflowRoles } from './workflowRoleCatalogService';
import { parseFormula } from '@/lib/bn/formulaParser';

const db = supabase as any;

export interface RegistryFinding {
  category:
    | 'TRANSITION'
    | 'FORMULA_VARIABLE'
    | 'ELIGIBILITY_KEY'
    | 'SMART_FIELD_TYPE'
    | 'WORKFLOW_ROLE'
    | 'ORPHAN_REFERENCE';
  severity: 'ERROR' | 'WARNING';
  entity: string;
  entityId?: string;
  message: string;
}

export interface RegistryDrift {
  statusesInDbMissingFromRegistry: string[];
  actionsInDbMissingFromRegistry: string[];
  statusesInRegistryUnusedInDb: string[];
  actionsInRegistryUnusedInDb: string[];
}

export interface RegistryValidationReport {
  ranAt: string;
  total: number;
  errors: number;
  warnings: number;
  findings: RegistryFinding[];
  drift: RegistryDrift;
}

async function safeFetch<T = any>(table: string, select = '*'): Promise<T[]> {
  try {
    const { data, error } = await db.from(table).select(select);
    if (error) return [];
    return (data ?? []) as T[];
  } catch {
    return [];
  }
}

export async function runRegistryValidation(): Promise<RegistryValidationReport> {
  const findings: RegistryFinding[] = [];

  // ---------- 1. Transition matrix — structural checks + drift ----------
  const transitionRules = await safeFetch('bn_claim_transition_rule');
  const activeRules = transitionRules.filter((r) => r.is_active !== false);

  // 1a. Structural ERRORS
  const seenKey = new Map<string, string>(); // key -> first id
  for (const r of activeRules) {
    if (!r.from_status || !r.to_status || !r.action_code) {
      findings.push({
        category: 'TRANSITION',
        severity: 'ERROR',
        entity: 'bn_claim_transition_rule',
        entityId: r.id,
        message: `Transition rule has null field(s): from=${r.from_status ?? 'NULL'} action=${r.action_code ?? 'NULL'} to=${r.to_status ?? 'NULL'}`,
      });
      continue;
    }
    const key = `${r.from_status}|${r.action_code}|${r.to_status}`;
    if (seenKey.has(key)) {
      findings.push({
        category: 'TRANSITION',
        severity: 'ERROR',
        entity: 'bn_claim_transition_rule',
        entityId: r.id,
        message: `Duplicate transition: ${r.from_status} —[${r.action_code}]→ ${r.to_status} (already defined by ${seenKey.get(key)})`,
      });
    } else {
      seenKey.set(key, r.id);
    }
  }

  // 1b. Drift WARNINGS — show how DB diverges from registry, but never fail valid rows
  const registryStatuses = new Set<string>(CLAIM_STATUSES as readonly string[]);
  const registryActions = new Set<string>(CLAIM_ACTIONS as readonly string[]);
  const dbStatuses = new Set<string>();
  const dbActions = new Set<string>();
  for (const r of activeRules) {
    if (r.from_status) dbStatuses.add(r.from_status);
    if (r.to_status) dbStatuses.add(r.to_status);
    if (r.action_code) dbActions.add(r.action_code);
  }
  const driftStatusesDbOnly = [...dbStatuses].filter((s) => !registryStatuses.has(s)).sort();
  const driftActionsDbOnly = [...dbActions].filter((a) => !registryActions.has(a)).sort();
  const driftStatusesRegOnly = [...registryStatuses].filter((s) => !dbStatuses.has(s)).sort();
  const driftActionsRegOnly = [...registryActions].filter((a) => !dbActions.has(a)).sort();

  if (driftStatusesDbOnly.length || driftActionsDbOnly.length) {
    findings.push({
      category: 'TRANSITION',
      severity: 'WARNING',
      entity: 'transitionRegistry.ts',
      message: `Registry drift: DB uses statuses/actions not in registry. Run "Generate Registry Suggestions" to refresh.`,
    });
  }

  // ---------- 2. Formula variable conformance ----------
  const allowedVars = new Set(FORMULA_VARIABLES.map((v) => v.key));
  const formulas = await safeFetch('bn_formula_template');
  for (const f of formulas) {
    if (f.is_active === false) continue;
    const expr: string = f.formula_expression || '';
    if (!expr) continue;
    try {
      const result = parseFormula(expr);
      if (!result.valid) {
        findings.push({
          category: 'FORMULA_VARIABLE',
          severity: 'WARNING',
          entity: 'bn_formula_template',
          entityId: f.id,
          message: `${f.template_code}: ${result.errors.join('; ') || 'parse error'}`,
        });
        continue;
      }
      const unknown = (result.variablesUsed || []).filter((v) => !allowedVars.has(v));
      if (unknown.length > 0) {
        findings.push({
          category: 'FORMULA_VARIABLE',
          severity: 'WARNING',
          entity: 'bn_formula_template',
          entityId: f.id,
          message: `${f.template_code}: variables not in registry [${unknown.join(', ')}]`,
        });
      }
    } catch (e: any) {
      findings.push({
        category: 'FORMULA_VARIABLE',
        severity: 'WARNING',
        entity: 'bn_formula_template',
        entityId: f.id,
        message: `${f.template_code}: parse error — ${e?.message ?? 'invalid'}`,
      });
    }
  }

  // ---------- 3. Eligibility field key drift (WARNING) ----------
  const allowedFields = new Set(ELIGIBILITY_FIELDS.map((f) => f.key));
  const collectFieldKeys = (node: any, acc: Set<string>): void => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach((n) => collectFieldKeys(n, acc)); return; }
    if (typeof node === 'object') {
      for (const [k, val] of Object.entries(node)) {
        if ((k === 'field_key' || k === 'field' || k === 'left_operand') && typeof val === 'string') acc.add(val);
        else collectFieldKeys(val, acc);
      }
    }
  };
  const versionsForEligibility = await safeFetch('bn_product_version');
  for (const v of versionsForEligibility) {
    if (!v.eligibility_config) continue;
    const used = new Set<string>();
    collectFieldKeys(v.eligibility_config, used);
    for (const key of used) {
      if (!allowedFields.has(key)) {
        findings.push({
          category: 'ELIGIBILITY_KEY',
          severity: 'WARNING',
          entity: 'bn_product_version',
          entityId: v.id,
          message: `V${v.version_number ?? '?'}: eligibility field key "${key}" not in registry`,
        });
      }
    }
  }

  // ---------- 4. Smart field type drift ----------
  const allowedTypes = new Set(SMART_FIELD_TYPES.map((t) => t.key as string));
  const fieldMeta = await safeFetch('bn_field_metadata');
  for (const f of fieldMeta) {
    const t = f.field_type;
    if (t && !allowedTypes.has(t)) {
      findings.push({
        category: 'SMART_FIELD_TYPE',
        severity: 'WARNING',
        entity: 'bn_field_metadata',
        entityId: f.id,
        message: `${f.field_name}: smart-field type "${t}" not in registry`,
      });
    }
  }

  // ---------- 5. Workflow role checks (ERROR — these break routing) ----------
  // Source of truth: public.roles (DB). Static BN_WORKFLOW_ROLES is fallback only.
  const allowedRoles = new Set<string>(await fetchWorkflowRoles());
  const workbaskets = await safeFetch('bn_workbasket');
  const workbasketByCode = new Map<string, any>();

  // Pre-fetch role coverage tables
  const workbasketRoles = await safeFetch('bn_workbasket_role'); // {workbasket_id, role_name}
  const rolesByBasket = new Map<string, string[]>();
  for (const wbr of workbasketRoles) {
    const list = rolesByBasket.get(wbr.workbasket_id) || [];
    list.push(wbr.role_name);
    rolesByBasket.set(wbr.workbasket_id, list);
  }

  // Effective-role coverage: which roles have at least one user (direct/bundle/delegation)
  const effRoles = await safeFetch('v_bn_user_effective_roles');
  const rolesWithUsers = new Set<string>(effRoles.map((r: any) => r.role_name));

  for (const w of workbaskets) {
    if (w.basket_code) workbasketByCode.set(w.basket_code, w);
    if (w.is_active === false) continue;

    // Legacy single-role check (kept for any rows not yet migrated)
    if (w.assigned_role && !allowedRoles.has(w.assigned_role)) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'ERROR',
        entity: 'bn_workbasket',
        entityId: w.id,
        message: `${w.basket_code}: role "${w.assigned_role}" not in workflow role registry`,
      });
    }

    // New: workbasket must have at least one mapped role
    const wbRoles = rolesByBasket.get(w.id) || (w.assigned_role ? [w.assigned_role] : []);
    if (wbRoles.length === 0) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'ERROR',
        entity: 'bn_workbasket',
        entityId: w.id,
        message: `${w.basket_code}: workbasket has no role assignments`,
      });
      continue;
    }

    // New: every mapped role must have at least one user (direct, bundle, or delegation)
    const uncovered = wbRoles.filter((r) => !rolesWithUsers.has(r));
    if (uncovered.length === wbRoles.length) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'ERROR',
        entity: 'bn_workbasket',
        entityId: w.id,
        message: `${w.basket_code}: no users hold any of its roles (${wbRoles.join(', ')})`,
      });
    } else if (uncovered.length > 0) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'WARNING',
        entity: 'bn_workbasket',
        entityId: w.id,
        message: `${w.basket_code}: role(s) without assigned users: ${uncovered.join(', ')}`,
      });
    }
  }

  // Approval policy alternate-approver check
  const approvalPolicies = await safeFetch('bn_approval_policy');
  for (const ap of approvalPolicies) {
    if (ap.is_enabled === false) continue;
    if (!ap.approval_role) continue;
    if (ap.self_approval_allowed === true) continue;
    if (!rolesWithUsers.has(ap.approval_role)) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'ERROR',
        entity: 'bn_approval_policy',
        entityId: ap.id,
        message: `${ap.policy_area}/${ap.action_code}: self-approval blocked but no eligible approver holds role "${ap.approval_role}"`,
      });
    }
  }

  const escPolicies = await safeFetch('bn_escalation_policy');
  for (const p of escPolicies) {
    if (p.is_active === false) continue;
    if (p.escalation_target_role && !allowedRoles.has(p.escalation_target_role)) {
      findings.push({
        category: 'WORKFLOW_ROLE',
        severity: 'ERROR',
        entity: 'bn_escalation_policy',
        entityId: p.id,
        message: `${p.policy_code}: target role "${p.escalation_target_role}" not in workflow role registry`,
      });
    }
  }

  // ---------- 5b. Queue access: active basket roles must be able to open their basket ----------
  try {
    const { data: gaps, error: gapErr } = await (db as any).rpc('bn_workbasket_permission_gaps');
    if (!gapErr) {
      for (const g of (gaps ?? []) as any[]) {
        findings.push({
          category: 'WORKFLOW_ROLE',
          severity: g.role_exists ? 'ERROR' : 'ERROR',
          entity: 'bn_workbasket',
          message: g.role_exists
            ? `${g.basket_code}: role "${g.assigned_role}" has no view access on ${g.missing_module} — this basket is invisible to its owner`
            : `${g.basket_code}: assigned role "${g.assigned_role}" does not exist in the role register`,
        });
      }
    }
  } catch {
    /* non-fatal */
  }



  // ---------- 6. Orphan / inactive-library references on active product versions ----------
  const productVersions = await safeFetch('bn_product_version');
  const liveVersions = productVersions.filter(
    (v) => ['ACTIVE', 'PUBLISHED', 'APPROVED'].includes(String(v.status || '').toUpperCase()),
  );

  const workflowTemplates = await safeFetch('bn_workflow_template');
  const wfById = new Map(workflowTemplates.map((t) => [t.id, t]));
  const screenTemplates = await safeFetch('bn_screen_template');
  const scrById = new Map(screenTemplates.map((t) => [t.id, t]));
  const docProfiles = await safeFetch('bn_document_profile');
  const dpById = new Map(docProfiles.map((t) => [t.id, t]));

  for (const v of liveVersions) {
    const label = `V${v.version_number ?? '?'} (${v.id?.slice(0, 8)})`;
    if (v.workflow_template_id) {
      const wf = wfById.get(v.workflow_template_id);
      if (!wf) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'ERROR', entity: 'bn_product_version', entityId: v.id, message: `${label}: workflow_template_id references missing record` });
      else if (wf.is_active === false) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'ERROR', entity: 'bn_product_version', entityId: v.id, message: `${label}: references inactive workflow template "${wf.template_code}"` });
    }
    if (v.screen_template_id) {
      const sc = scrById.get(v.screen_template_id);
      if (!sc) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'ERROR', entity: 'bn_product_version', entityId: v.id, message: `${label}: screen_template_id references missing record` });
      else if (sc.is_active === false) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'WARNING', entity: 'bn_product_version', entityId: v.id, message: `${label}: references inactive screen template "${sc.template_code}"` });
    }
    if (v.document_profile_id) {
      const dp = dpById.get(v.document_profile_id);
      if (!dp) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'ERROR', entity: 'bn_product_version', entityId: v.id, message: `${label}: document_profile_id references missing record` });
      else if (dp.is_active === false) findings.push({ category: 'ORPHAN_REFERENCE', severity: 'WARNING', entity: 'bn_product_version', entityId: v.id, message: `${label}: references inactive document profile "${dp.profile_code}"` });
    }
  }

  const commEvents = await safeFetch('bn_comm_event');
  const inactiveEventCodes = new Set(
    commEvents.filter((e) => e.is_active === false).map((e) => e.event_code),
  );
  const commMappings = await safeFetch('bn_comm_mapping');
  for (const m of commMappings) {
    if (m.is_active === false) continue;
    if (m.event_code && inactiveEventCodes.has(m.event_code)) {
      findings.push({
        category: 'ORPHAN_REFERENCE',
        severity: 'WARNING',
        entity: 'bn_comm_mapping',
        entityId: m.id,
        message: `Active mapping references inactive communication event "${m.event_code}"`,
      });
    }
  }

  const errors = findings.filter((f) => f.severity === 'ERROR').length;
  const warnings = findings.filter((f) => f.severity === 'WARNING').length;

  return {
    ranAt: new Date().toISOString(),
    total: findings.length,
    errors,
    warnings,
    findings,
    drift: {
      statusesInDbMissingFromRegistry: driftStatusesDbOnly,
      actionsInDbMissingFromRegistry: driftActionsDbOnly,
      statusesInRegistryUnusedInDb: driftStatusesRegOnly,
      actionsInRegistryUnusedInDb: driftActionsRegOnly,
    },
  };
}

/**
 * Generate a developer preview of what transitionRegistry.ts would look like
 * if regenerated from the live bn_claim_transition_rule table. Returns JSON;
 * does NOT modify source files.
 */
export async function generateRegistrySuggestions(): Promise<{
  generatedAt: string;
  source: 'bn_claim_transition_rule';
  statuses: string[];
  actions: string[];
  allowedTransitions: { from: string; action: string; to: string }[];
}> {
  const rules = await safeFetch('bn_claim_transition_rule');
  const active = rules.filter((r) => r.is_active !== false && r.from_status && r.to_status && r.action_code);
  const statuses = new Set<string>();
  const actions = new Set<string>();
  const transitions = new Map<string, { from: string; action: string; to: string }>();
  for (const r of active) {
    statuses.add(r.from_status);
    statuses.add(r.to_status);
    actions.add(r.action_code);
    const key = `${r.from_status}|${r.action_code}|${r.to_status}`;
    if (!transitions.has(key)) transitions.set(key, { from: r.from_status, action: r.action_code, to: r.to_status });
  }
  return {
    generatedAt: new Date().toISOString(),
    source: 'bn_claim_transition_rule',
    statuses: [...statuses].sort(),
    actions: [...actions].sort(),
    allowedTransitions: [...transitions.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.action.localeCompare(b.action),
    ),
  };
}
