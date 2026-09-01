/**
 * Centralized Audit Trail Service
 * 
 * All create, update, delete, approve, reject, verify, cancel, enable, disable,
 * and configuration change actions MUST use this service to write audit entries
 * to the `system_audit_trail` table.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  getCorrelationId,
  getSessionId,
  getDeviceInfo,
} from '@/services/correlationIdService';
import { DB_TRIGGER_TABLES } from '@/services/globalAuditInterceptor';

export interface AuditTrailEntry {
  action: string;
  entityType: string;
  entityId?: string;
  module?: string;
  beforeValue?: Record<string, any> | null;
  afterValue?: Record<string, any> | null;
  userCode?: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Compute field-level diff between two records.
 * Returns an array of { field, oldValue, newValue } for changed fields only.
 * Skips meta fields (updated_at, modified_by, etc.)
 */
export function computeFieldDiff(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined
): Array<{ field: string; oldValue: any; newValue: any }> | null {
  if (!before && !after) return null;

  const diffs: Array<{ field: string; oldValue: any; newValue: any }> = [];
  const skipFields = new Set([
    'updated_at', 'modified_date', 'updated_by', 'modified_by',
    'created_at', 'created_by',
  ]);

  if (!before && after) {
    // CREATE: show all non-null after fields
    for (const [key, val] of Object.entries(after)) {
      if (skipFields.has(key) || val === null || val === undefined) continue;
      diffs.push({ field: key, oldValue: null, newValue: val });
    }
    return diffs.length > 0 ? diffs : null;
  }

  if (before && !after) {
    // DELETE: show all non-null before fields
    for (const [key, val] of Object.entries(before)) {
      if (skipFields.has(key) || val === null || val === undefined) continue;
      diffs.push({ field: key, oldValue: val, newValue: null });
    }
    return diffs.length > 0 ? diffs : null;
  }

  // UPDATE: compare field by field
  const allKeys = new Set([...Object.keys(before!), ...Object.keys(after!)]);
  for (const key of allKeys) {
    if (skipFields.has(key)) continue;
    const oldVal = before![key];
    const newVal = after![key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diffs.push({ field: key, oldValue: oldVal ?? null, newValue: newVal ?? null });
    }
  }

  return diffs.length > 0 ? diffs : null;
}

/**
 * Write an audit trail entry to system_audit_trail.
 * Returns the inserted row id or null on failure.
 */
export async function logAuditTrail(entry: AuditTrailEntry): Promise<string | null> {
  try {
    // Skip manual logging for tables covered by DB triggers — the trigger writes accurate full-row data
    if (entry.entityType && DB_TRIGGER_TABLES.has(entry.entityType)) {
      console.debug('[AuditService] Skipping manual log for DB-triggered table:', entry.entityType);
      return null;
    }

    // Skip any entry where both before and after values are empty — these are noise
    const hasBefore = entry.beforeValue && Object.keys(entry.beforeValue).length > 0;
    const hasAfter = entry.afterValue && Object.keys(entry.afterValue).length > 0;
    if (!hasBefore && !hasAfter) {
      console.debug('[AuditService] Skipping empty audit entry for:', entry.entityType, entry.action);
      return null;
    }

    let userId = entry.userId;
    if (!userId) {
      // Local session only — audit logging must never be able to sign the user out.
      const { data: { session } } = await supabase.auth.getSession();
      userId = session?.user?.id;
    }

    const { data, error } = await supabase.from('system_audit_trail').insert({
      correlation_id: getCorrelationId(),
      session_id: getSessionId(),
      user_id: userId,
      device_info: getDeviceInfo(),
      timestamp: new Date().toISOString(),
      action: entry.action,
      entity_type: entry.entityType,
      entity_id: entry.entityId || null,
      module: entry.module || null,
      before_value: entry.beforeValue || null,
      after_value: entry.afterValue || null,
      user_name: entry.userCode || 'SYSTEM',
      payload_json: entry.metadata || null,
      severity: 'info',
    }).select('id').single();

    if (error) {
      console.error('[AuditService] Failed to write audit trail:', error);
      return null;
    }

    return data?.id || null;
  } catch (err) {
    console.error('[AuditService] Unexpected error writing audit trail:', err);
    return null;
  }
}
