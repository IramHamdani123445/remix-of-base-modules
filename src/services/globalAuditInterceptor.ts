/**
 * Global Audit Interceptor Service
 * 
 * Centralized, non-hook audit write service used by:
 * 1. MutationCache global interceptor (App.tsx)
 * 2. SystemLoggingProvider for navigation events
 * 3. useAuditedMutation for enriched per-mutation logging
 * 
 * Writes to system_audit_trail. Resolves user identity automatically.
 * Never throws — failures are logged to console only.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  getCorrelationId,
  getSessionId,
  getDeviceInfo,
} from '@/services/correlationIdService';

interface AuditInterceptorEntry {
  action: string;
  entityType?: string;
  entityId?: string;
  module?: string;
  route?: string;
  screenName?: string;
  tabName?: string;
  sectionName?: string;
  beforeValue?: Record<string, any> | null;
  afterValue?: Record<string, any> | null;
  description?: string;
  metadata?: Record<string, any> | null;
}

// ─── Route → Module/Screen/Entity mapping ────────────────────────────────────
const ROUTE_MODULE_MAP: Array<{
  prefix: string;
  module: string;
  screen: string;
  entityType?: string;
}> = [
  // Cashier
  { prefix: '/cashier/cash-details', module: 'Cashier', screen: 'Cash Details', entityType: 'cn_cash_count' },
  { prefix: '/cashier/receipt', module: 'Cashier', screen: 'Receipts', entityType: 'cn_receipt' },
  { prefix: '/cashier/batches', module: 'Cashier', screen: 'Batch Management', entityType: 'cn_batch' },
  { prefix: '/cashier/posting', module: 'Cashier', screen: 'Posting', entityType: 'cn_batch' },
  { prefix: '/cashier/payment-voucher', module: 'Cashier', screen: 'Payment Voucher', entityType: 'cn_payment_voucher' },
  { prefix: '/cashier', module: 'Cashier', screen: 'Cashier Dashboard' },

  // Registration
  { prefix: '/registration/employer', module: 'Registration', screen: 'Employer Registration', entityType: 'er_master' },
  { prefix: '/registration/insured-person', module: 'Registration', screen: 'Insured Person Registration', entityType: 'ip_master' },
  { prefix: '/registration/search', module: 'Registration', screen: 'Registration Search' },
  { prefix: '/registration', module: 'Registration', screen: 'Registration' },

  // Compliance / BEMA
  { prefix: '/compliance/audit', module: 'Compliance', screen: 'Compliance Audit', entityType: 'bema_audit_cases' },
  { prefix: '/compliance/penalty', module: 'Compliance', screen: 'Penalty Management', entityType: 'compliance_penalties' },
  { prefix: '/compliance/waiver', module: 'Compliance', screen: 'Waiver Management', entityType: 'bema_waivers' },
  { prefix: '/compliance/arrears', module: 'Compliance', screen: 'Arrears Ledger', entityType: 'bema_arrears_ledger' },
  { prefix: '/compliance/payment-plan', module: 'Compliance', screen: 'Payment Plans', entityType: 'bema_payment_plans' },
  { prefix: '/compliance/inspector', module: 'Compliance', screen: 'Inspector Management', entityType: 'bema_inspector_assignments' },
  { prefix: '/compliance/c3', module: 'Compliance', screen: 'C3 Submissions', entityType: 'bema_c3_submissions' },
  { prefix: '/compliance/registration', module: 'Compliance', screen: 'BEMA Registration', entityType: 'bema_registrations' },
  { prefix: '/compliance', module: 'Compliance', screen: 'Compliance Dashboard' },

  // Benefits
  { prefix: '/benefits/short-term', module: 'Benefits', screen: 'Short Term Benefits', entityType: 'benefit_claims' },
  { prefix: '/benefits/long-term', module: 'Benefits', screen: 'Long Term Benefits', entityType: 'benefit_claims' },
  { prefix: '/benefits', module: 'Benefits', screen: 'Benefits' },

  // Internal Audit
  { prefix: '/audit/engagements', module: 'Internal Audit', screen: 'Engagement Workspace', entityType: 'ia_audit_engagements' },
  { prefix: '/audit/universe', module: 'Internal Audit', screen: 'Audit Universe', entityType: 'ia_departments' },
  { prefix: '/audit/risk-register', module: 'Internal Audit', screen: 'Risk Register', entityType: 'ia_risk_register' },
  { prefix: '/audit/risk', module: 'Internal Audit', screen: 'Risk Assessment', entityType: 'ia_risk_assessments' },
  { prefix: '/audit/plan', module: 'Internal Audit', screen: 'Audit Plan', entityType: 'ia_annual_plans' },
  { prefix: '/audit', module: 'Internal Audit', screen: 'Internal Audit' },

  // Admin / Configuration
  { prefix: '/admin/c3-configuration', module: 'C3 Configuration', screen: 'C3 Configuration', entityType: 'c3_calculation_config' },
  { prefix: '/admin/user-management', module: 'User Management', screen: 'User Management', entityType: 'profiles' },
  { prefix: '/admin/system-settings', module: 'System Settings', screen: 'System Settings', entityType: 'system_settings' },
  { prefix: '/admin/data-migration', module: 'Admin', screen: 'Data Migration' },
  { prefix: '/admin/security', module: 'Security', screen: 'Security Settings', entityType: 'security_policy_config' },
  { prefix: '/admin', module: 'Admin', screen: 'Admin' },

  // System Logs
  { prefix: '/system-logs/audit', module: 'System Logs', screen: 'Audit Trail' },
  { prefix: '/system-logs', module: 'System Logs', screen: 'System Logs' },

  // Legal
  { prefix: '/legal', module: 'Legal', screen: 'Legal' },

  // Self-Employed
  { prefix: '/self-employed', module: 'Self-Employed', screen: 'Self-Employed', entityType: 'au_ip_self_employ' },

  // Dashboard
  { prefix: '/dashboard', module: 'Dashboard', screen: 'Dashboard' },
  { prefix: '/', module: 'App', screen: 'Home' },
];

/**
 * Resolve module + screen + default entity type from a URL path.
 */
export function resolveRouteContext(pathname: string): { module: string; screen: string; entityType?: string } {
  for (const entry of ROUTE_MODULE_MAP) {
    if (pathname.startsWith(entry.prefix)) {
      return { module: entry.module, screen: entry.screen, entityType: entry.entityType };
    }
  }
  return { module: 'App', screen: pathname };
}

/**
 * Tables with DB-level audit triggers — the app interceptor marks its entries
 * as supplementary for these to avoid double-counting.
 */
/**
 * Complete set of tables with DB-level audit triggers (fn_audit_row_change).
 * All three app-level audit paths check this set and skip writing — the DB trigger
 * is the single authoritative source. Add new tables here when attaching the trigger.
 * Includes both actual table names and mutation-key aliases.
 */
export const DB_TRIGGER_TABLES = new Set([
  // Cashier
  'cn_receipt', 'cn_batch', 'cn_cash_count', 'cn_card_machine',
  'cn_batch_card_transaction', 'cn_batch_cheque_verification',
  // Registration
  'er_master', 'ip_master', 'ip_self_employ', 'profiles',
  // Compliance / BEMA
  'bema_c3_submissions', 'bema_registrations', 'bema_audit_cases',
  'bema_payment_plans', 'bema_waivers',
  // Internal Audit
  'ia_findings', 'ia_audit_engagements', 'ia_risk_assessments', 'ia_audit_reports',
  'ia_risk_register', 'ia_risk_mitigation_actions', 'ia_risk_reviews',
  // Configuration & Settings
  'system_settings', 'security_policy_config', 'ip_access_rules',
  'c3_calculation_config', 'payment_module_config',
  'tb_levy_slabs', 'tb_levy_slab_details',
  'tb_currencies', 'tb_self_emp_contrib_rate', 'tb_pay_periods',
  // API & Workflow
  'api_settings', 'api_registry', 'workflow_instances',
  // Mutation-key aliases (used in mutationKey arrays, map to real tables above)
  'levy_slabs', 'levy_slab_details',
  'currencies',
  'c3_config_management', 'c3_config_periods', 'c3_config_details',
]);

/**
 * Infer entity type from mutation variables by checking for known table-identifier keys.
 */
export function inferEntityTypeFromVariables(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const v = variables as Record<string, any>;

  if (v.table_name) return String(v.table_name);
  if (v.entityType) return String(v.entityType);
  if (v.entity_type) return String(v.entity_type);

  if (v.batch_number || v.batchNumber) return 'cn_batch';
  if (v.receipt_id || v.receiptId) return 'cn_receipt';
  if (v.registration_id || v.registrationId || v.registration_number) return 'bema_registrations';
  if (v.employer_id || v.employerId) return 'er_master';
  if (v.ssn && !v.employer_id) return 'ip_master';
  if (v.config_type || v.configType) return 'c3_calculation_config';
  if (v.periodId || v.period_id) return 'c3_calculation_config';
  if (v.engagement_id || v.engagementId) return 'ia_audit_engagements';
  if (v.plan_id || v.planId) return 'ia_annual_plans';
  if (v.waiver_number || v.waiverId) return 'bema_waivers';
  if (v.setting_key || v.settingKey) return 'system_settings';
  if (v.policy_name || v.policyName) return 'security_policy_config';
  if (v.finding_id || v.findingId) return 'ia_findings';
  if (v.hearing_id || v.hearingId) return 'legal_hearings';
  if (v.case_id || v.caseId) return 'legal_cases';
  if (v.designation_id || v.designationId) return 'designations';
  if (v.workflow_id || v.workflowId) return 'workflows';

  return undefined;
}

// Cache user identity to avoid repeated DB calls
let cachedUserId: string | null = null;
let cachedUserCode: string | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 60_000;

async function resolveUserIdentity(): Promise<{ userId: string | null; userCode: string | null }> {
  const now = Date.now();
  if (cachedUserId && now - cacheTimestamp < CACHE_TTL) {
    return { userId: cachedUserId, userCode: cachedUserCode };
  }

  try {
    // Read identity from the locally-stored session only.
    //
    // `supabase.auth.getUser()` calls the auth server on every audited
    // mutation; when that call fails with an authorization error (expired or
    // slow token) the auth client clears the session and signs the user out
    // mid-task. Audit logging must never be able to destroy a session, so the
    // acting user is taken from the session already held in memory.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    if (!user) return { userId: null, userCode: null };

    cachedUserId = user.id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('user_code, full_name')
      .eq('id', user.id)
      .maybeSingle();

    cachedUserCode = profile?.user_code || null;
    cacheTimestamp = now;

    return { userId: cachedUserId, userCode: cachedUserCode };
  } catch {
    return { userId: cachedUserId, userCode: cachedUserCode };
  }
}


/** Clear cached identity on auth state change */
export function clearAuditUserCache() {
  cachedUserId = null;
  cachedUserCode = null;
  cacheTimestamp = 0;
}

/**
 * Compute only the fields that actually changed between two objects.
 * Returns { before: {changedFields…}, after: {changedFields…} } or null if nothing changed.
 */
export function computeChangedFields(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined
): { before: Record<string, any>; after: Record<string, any> } | null {
  if (!before || !after) return null;

  const changedBefore: Record<string, any> = {};
  const changedAfter: Record<string, any> = {};
  let hasChanges = false;

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    if (['updated_at', 'modified_date', 'updated_by', 'modified_by'].includes(key)) continue;

    const oldVal = before[key];
    const newVal = after[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changedBefore[key] = oldVal ?? null;
      changedAfter[key] = newVal ?? null;
      hasChanges = true;
    }
  }

  return hasChanges ? { before: changedBefore, after: changedAfter } : null;
}

/**
 * Classify the action from mutation variables when mutationKey is missing.
 * Infers create/update/delete from variable shape.
 */
export function classifyActionFromVariables(variables: unknown, result: unknown): string {
  if (!variables || typeof variables !== 'object') return 'mutation';
  const v = variables as Record<string, any>;

  // Status change patterns
  if (v.status !== undefined && v.id) return 'status_change';
  if (v.is_active !== undefined && v.id) return v.is_active ? 'enable' : 'disable';
  if (v.is_approved !== undefined) return v.is_approved ? 'approve' : 'reject';
  if (v.approved !== undefined) return v.approved ? 'approve' : 'reject';

  // CRUD patterns
  const hasId = !!(v.id || v.entity_id || v.entityId || v.receipt_id || v.batch_number);
  const fieldCount = Object.keys(v).length;

  if (hasId && fieldCount === 1) return 'delete';
  if (hasId && fieldCount > 1) return 'update';
  if (!hasId && fieldCount > 0) return 'create';

  // Check result
  if (result === undefined || result === null) return 'delete';

  return 'mutation';
}

/**
 * Write an audit entry to system_audit_trail.
 * Non-blocking — never throws.
 */
export async function logAuditEntry(entry: AuditInterceptorEntry): Promise<void> {
  try {
    const { userId, userCode } = await resolveUserIdentity();

    const route = entry.route || (typeof window !== 'undefined' ? window.location.pathname : undefined);
    let module = entry.module;
    let screenName = entry.screenName;
    let entityType = entry.entityType;

    if (route) {
      const ctx = resolveRouteContext(route);
      if (!module) module = ctx.module;
      if (!screenName) screenName = ctx.screen;
      if (!entityType) entityType = ctx.entityType;
    }

    // If this table has DB triggers, skip app-level logging entirely — the trigger writes accurate before/after
    const isDbTriggered = entityType ? DB_TRIGGER_TABLES.has(entityType) : false;
    const source = entry.metadata?.source || 'app_interceptor';
    if (isDbTriggered && source !== 'db_trigger') return;

    // Skip ANY entry where both before and after values are empty — these are noise
    const hasBefore = entry.beforeValue && Object.keys(entry.beforeValue).length > 0;
    const hasAfter = entry.afterValue && Object.keys(entry.afterValue).length > 0;
    if (!hasBefore && !hasAfter) return;

    const descParts: string[] = [];
    if (entry.description) descParts.push(entry.description);
    if (entry.tabName) descParts.push(`Tab: ${entry.tabName}`);
    if (entry.sectionName) descParts.push(`Section: ${entry.sectionName}`);

    await supabase.from('system_audit_trail').insert({
      correlation_id: getCorrelationId(),
      session_id: getSessionId(),
      user_id: userId,
      user_name: userCode || 'ANONYMOUS',
      device_info: getDeviceInfo(),
      timestamp: new Date().toISOString(),
      action: entry.action,
      entity_type: entityType || null,
      entity_id: entry.entityId || null,
      module: module || null,
      route: route || null,
      before_value: entry.beforeValue || null,
      after_value: entry.afterValue || null,
      payload_json: {
        ...(entry.metadata || {}),
        source,
        supplementary: isDbTriggered && source !== 'db_trigger',
        screen: screenName || undefined,
        tab: entry.tabName || undefined,
        section: entry.sectionName || undefined,
        description: descParts.length > 0 ? descParts.join(' | ') : undefined,
      },
      severity: 'info',
    });
  } catch (err) {
    console.error('[GlobalAuditInterceptor] Failed to write audit entry:', err);
  }
}

/**
 * Parse a mutation key into structured audit metadata.
 * Convention: mutationKey = ['module', 'entity', 'action']
 */
export function parseMutationKey(
  mutationKey: readonly unknown[] | undefined
): { module?: string; entityType?: string; action: string } {
  if (!mutationKey || mutationKey.length === 0) {
    return { action: 'mutation' };
  }

  const parts = mutationKey.map(String);

  if (parts.length >= 3) {
    return {
      module: parts[0],
      entityType: parts[1],
      action: parts[2],
    };
  }

  if (parts.length === 2) {
    return {
      module: parts[0],
      action: parts[1],
    };
  }

  return { action: parts[0] };
}

/**
 * Extract a likely entity ID from mutation variables.
 */
export function extractEntityId(variables: unknown): string | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const v = variables as Record<string, any>;
  return (
    v.id || v.entityId || v.entity_id ||
    v.batchNumber || v.batch_number ||
    v.registrationId || v.registration_id ||
    v.receiptId || v.receipt_id ||
    v.ssn || v.regno ||
    undefined
  );
}
