import { supabase } from '@/integrations/supabase/client';
import type {
  AuditEventType,
  AuditEventTypeFormValues,
  AuditLogEntry,
  AuditLogFilters,
  AuditLogPayload,
  AuditPolicy,
  AuditPolicyFormValues,
  AuditSummaryMetrics,
} from './auditTypes';

const db = supabase as any;
const LOG_TABLE = 'core_audit_log';
const EVENT_TABLE = 'core_audit_event_type';
const POLICY_TABLE = 'core_audit_policy';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /access_?token/i,
  /refresh_?token/i,
  /authorization/i,
  /ssn/i,
  /nationalInsuranceNumber/i,
  /bank_?account/i,
  /account_?number/i,
  /medical/i,
  /health/i,
];

export function maskAuditPayload<T>(payload: T): T {
  if (payload == null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map((v) => maskAuditPayload(v)) as unknown as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((rx) => rx.test(k))) {
      out[k] = '***MASKED***';
    } else if (v && typeof v === 'object') {
      out[k] = maskAuditPayload(v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function calculateChangedFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): string[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) changed.push(k);
  }
  return changed;
}

async function getActorContext() {
  try {
    // Local session only — audit logging must never be able to sign the user out.
    const { data } = await supabase.auth.getSession();
    const user = data?.session?.user;
    return {
      actor_user_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      actor_name:
        (user?.user_metadata as any)?.full_name ??
        (user?.user_metadata as any)?.name ??
        user?.email ??
        null,
    };
  } catch {
    return { actor_user_id: null, actor_email: null, actor_name: null };
  }
}

function getRequestContext() {
  if (typeof window === 'undefined') return {};
  return {
    user_agent: window.navigator?.userAgent ?? null,
    source_route: window.location?.pathname ?? null,
  };
}

export async function logAction(payload: AuditLogPayload): Promise<void> {
  try {
    const actor = await getActorContext();
    const ctx = getRequestContext();
    const masked_before = payload.before_value ? maskAuditPayload(payload.before_value) : null;
    const masked_after = payload.after_value ? maskAuditPayload(payload.after_value) : null;
    const changed = payload.changed_fields ?? calculateChangedFields(masked_before, masked_after);

    await db.from(LOG_TABLE).insert({
      event_code: payload.event_code,
      event_name: payload.event_name ?? null,
      event_category: payload.event_category ?? null,
      severity: payload.severity ?? 'INFO',
      risk_level: payload.risk_level ?? 'LOW',
      module_code: payload.module_code ?? 'CORE',
      domain_code: payload.domain_code ?? null,
      entity_type: payload.entity_type ?? null,
      entity_id: payload.entity_id ?? null,
      entity_display_name: payload.entity_display_name ?? null,
      action: payload.action,
      outcome: payload.outcome ?? 'SUCCESS',
      before_value: masked_before,
      after_value: masked_after,
      changed_fields: changed.length ? changed : null,
      reason: payload.reason ?? null,
      notes: payload.notes ?? null,
      source: payload.source ?? 'APPLICATION',
      source_route: payload.source_route ?? ctx.source_route ?? null,
      source_component: payload.source_component ?? null,
      source_service: payload.source_service ?? null,
      user_agent: ctx.user_agent ?? null,
      correlation_id: payload.correlation_id ?? null,
      contains_pii: payload.contains_pii ?? false,
      contains_financial_data: payload.contains_financial_data ?? false,
      contains_health_data: payload.contains_health_data ?? false,
      metadata: payload.metadata ?? null,
      is_sensitive: payload.is_sensitive ?? false,
      is_system_generated: false,
      ...actor,
    });
  } catch (err) {
    // audit is best-effort
    console.warn('[coreAuditService] logAction failed', err);
  }
}

export const logCreate = (
  entityType: string,
  entityId: string,
  afterValue: Record<string, unknown>,
  context: Partial<AuditLogPayload> = {},
) =>
  logAction({
    event_code: context.event_code ?? `${entityType.toUpperCase()}_CREATED`,
    action: 'CREATE',
    entity_type: entityType,
    entity_id: entityId,
    after_value: afterValue,
    ...context,
  });

export const logUpdate = (
  entityType: string,
  entityId: string,
  beforeValue: Record<string, unknown> | null,
  afterValue: Record<string, unknown>,
  context: Partial<AuditLogPayload> = {},
) =>
  logAction({
    event_code: context.event_code ?? `${entityType.toUpperCase()}_UPDATED`,
    action: 'UPDATE',
    entity_type: entityType,
    entity_id: entityId,
    before_value: beforeValue ?? undefined,
    after_value: afterValue,
    ...context,
  });

export const logDelete = (
  entityType: string,
  entityId: string,
  beforeValue: Record<string, unknown> | null,
  context: Partial<AuditLogPayload> = {},
) =>
  logAction({
    event_code: context.event_code ?? `${entityType.toUpperCase()}_DELETED`,
    action: 'DELETE',
    entity_type: entityType,
    entity_id: entityId,
    before_value: beforeValue ?? undefined,
    severity: 'WARNING',
    risk_level: 'HIGH',
    ...context,
  });

export const logSecurityEvent = (eventCode: string, context: Partial<AuditLogPayload> = {}) =>
  logAction({
    event_code: eventCode,
    action: context.action ?? 'SECURITY',
    event_category: 'SECURITY',
    severity: 'WARNING',
    risk_level: 'HIGH',
    is_sensitive: true,
    ...context,
  });

export const logMigrationEvent = (eventCode: string, context: Partial<AuditLogPayload> = {}) =>
  logAction({
    event_code: eventCode,
    action: context.action ?? 'MIGRATION',
    event_category: 'MIGRATION',
    source: 'MIGRATION',
    ...context,
  });

export const logAccessDenied = (context: Partial<AuditLogPayload> = {}) =>
  logAction({
    event_code: 'ACCESS_DENIED',
    action: 'ACCESS',
    event_category: 'SECURITY',
    outcome: 'DENIED',
    severity: 'WARNING',
    risk_level: 'HIGH',
    ...context,
  });

export const logExportCreated = (context: Partial<AuditLogPayload> = {}) =>
  logAction({
    event_code: 'EXPORT_CREATED',
    action: 'EXPORT',
    event_category: 'EXPORT',
    severity: 'INFO',
    risk_level: 'HIGH',
    is_sensitive: true,
    ...context,
  });

export const logSensitiveDataViewed = (context: Partial<AuditLogPayload> = {}) =>
  logAction({
    event_code: 'SENSITIVE_DATA_VIEWED',
    action: 'VIEW',
    event_category: 'SECURITY',
    risk_level: 'HIGH',
    is_sensitive: true,
    contains_pii: true,
    ...context,
  });

// ============ Queries ============

export async function getAuditLogs(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
  let q = db.from(LOG_TABLE).select('*').order('event_time', { ascending: false });
  if (filters.date_from) q = q.gte('event_time', filters.date_from);
  if (filters.date_to) q = q.lte('event_time', filters.date_to);
  if (filters.event_category) q = q.eq('event_category', filters.event_category);
  if (filters.event_code) q = q.eq('event_code', filters.event_code);
  if (filters.module_code) q = q.eq('module_code', filters.module_code);
  if (filters.actor_user_id) q = q.eq('actor_user_id', filters.actor_user_id);
  if (filters.entity_type) q = q.eq('entity_type', filters.entity_type);
  if (filters.entity_id) q = q.eq('entity_id', filters.entity_id);
  if (filters.outcome) q = q.eq('outcome', filters.outcome);
  if (filters.severity) q = q.eq('severity', filters.severity);
  if (filters.risk_level) q = q.eq('risk_level', filters.risk_level);
  if (typeof filters.contains_pii === 'boolean') q = q.eq('contains_pii', filters.contains_pii);
  if (typeof filters.contains_financial_data === 'boolean')
    q = q.eq('contains_financial_data', filters.contains_financial_data);
  if (typeof filters.contains_health_data === 'boolean')
    q = q.eq('contains_health_data', filters.contains_health_data);
  if (filters.source) q = q.eq('source', filters.source);
  if (filters.search) {
    const s = `%${filters.search}%`;
    q = q.or(
      `event_code.ilike.${s},event_name.ilike.${s},entity_display_name.ilike.${s},actor_name.ilike.${s},actor_email.ilike.${s}`,
    );
  }
  q = q.limit(filters.limit ?? 500);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditLogEntry[];
}

export async function getAuditLogById(id: string): Promise<AuditLogEntry | null> {
  const { data, error } = await db.from(LOG_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as AuditLogEntry | null;
}

export async function getAuditSummary(
  filters: AuditLogFilters = {},
): Promise<AuditSummaryMetrics> {
  const rows = await getAuditLogs({ ...filters, limit: 2000 });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return {
    total: rows.length,
    security: rows.filter((r) => r.event_category === 'SECURITY').length,
    failedOrDenied: rows.filter((r) => r.outcome === 'FAILURE' || r.outcome === 'DENIED' || r.outcome === 'ERROR').length,
    highRisk: rows.filter((r) => r.risk_level === 'HIGH' || r.risk_level === 'CRITICAL').length,
    configuration: rows.filter((r) => r.event_category === 'CONFIGURATION').length,
    userAdminChanges: rows.filter((r) => r.event_code?.startsWith('USER_') || r.event_code?.startsWith('STAFF_')).length,
    sensitive: rows.filter((r) => r.is_sensitive || r.contains_pii || r.contains_financial_data || r.contains_health_data).length,
    today: rows.filter((r) => new Date(r.event_time) >= startOfToday).length,
  };
}

// ============ Event Types ============

export async function getAuditEventTypes(filters: { search?: string; is_active?: boolean } = {}): Promise<AuditEventType[]> {
  let q = db.from(EVENT_TABLE).select('*').order('event_code');
  if (typeof filters.is_active === 'boolean') q = q.eq('is_active', filters.is_active);
  if (filters.search) {
    const s = `%${filters.search}%`;
    q = q.or(`event_code.ilike.${s},event_name.ilike.${s}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditEventType[];
}

export async function createAuditEventType(payload: AuditEventTypeFormValues) {
  const { data, error } = await db.from(EVENT_TABLE).insert(payload).select('*').single();
  if (error) throw error;
  return data as AuditEventType;
}
export async function updateAuditEventType(id: string, payload: Partial<AuditEventTypeFormValues>) {
  const { data, error } = await db.from(EVENT_TABLE).update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AuditEventType;
}
export async function deactivateAuditEventType(id: string) {
  const { error } = await db.from(EVENT_TABLE).update({ is_active: false }).eq('id', id);
  if (error) throw error;
}
export async function reactivateAuditEventType(id: string) {
  const { error } = await db.from(EVENT_TABLE).update({ is_active: true }).eq('id', id);
  if (error) throw error;
}

// ============ Policies ============

export async function getAuditPolicies(filters: { search?: string; is_active?: boolean } = {}): Promise<AuditPolicy[]> {
  let q = db.from(POLICY_TABLE).select('*').order('policy_code');
  if (typeof filters.is_active === 'boolean') q = q.eq('is_active', filters.is_active);
  if (filters.search) {
    const s = `%${filters.search}%`;
    q = q.or(`policy_code.ilike.${s},policy_name.ilike.${s}`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditPolicy[];
}
export async function createAuditPolicy(payload: AuditPolicyFormValues) {
  const { data, error } = await db.from(POLICY_TABLE).insert(payload).select('*').single();
  if (error) throw error;
  return data as AuditPolicy;
}
export async function updateAuditPolicy(id: string, payload: Partial<AuditPolicyFormValues>) {
  const { data, error } = await db.from(POLICY_TABLE).update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data as AuditPolicy;
}
export async function deactivateAuditPolicy(id: string) {
  const { error } = await db.from(POLICY_TABLE).update({ is_active: false }).eq('id', id);
  if (error) throw error;
}
export async function reactivateAuditPolicy(id: string) {
  const { error } = await db.from(POLICY_TABLE).update({ is_active: true }).eq('id', id);
  if (error) throw error;
}

export const coreAuditService = {
  logAction,
  logCreate,
  logUpdate,
  logDelete,
  logSecurityEvent,
  logMigrationEvent,
  logAccessDenied,
  logExportCreated,
  logSensitiveDataViewed,
  getAuditLogs,
  getAuditLogById,
  getAuditSummary,
  getAuditEventTypes,
  createAuditEventType,
  updateAuditEventType,
  deactivateAuditEventType,
  reactivateAuditEventType,
  getAuditPolicies,
  createAuditPolicy,
  updateAuditPolicy,
  deactivateAuditPolicy,
  reactivateAuditPolicy,
  maskAuditPayload,
  calculateChangedFields,
};
