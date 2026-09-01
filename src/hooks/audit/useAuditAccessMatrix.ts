import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { INTERNAL_AUDIT_PERMISSION_MAP } from '@/hooks/useInternalAuditPermissions';

/**
 * Internal Audit Access Matrix + permission reconciliation.
 *
 * Read / explain / audit only. Internal Audit consumes central identity
 * (profiles → user_roles → roles → role_permissions → app_modules) and never
 * maintains its own user or permission registry.
 */

async function callRpc<T = any>(fn: any, args: any): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface AccessMatrixUser {
  profile_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  roles: string[];
  ia_roles: string[];
  capabilities: string[];
  auditor: {
    id: string;
    employee_no: string | null;
    auditor_role: string | null;
    seniority: string | null;
    employment_status: string | null;
  } | null;
  department_scope: string[];
  lead_assignments: number;
  reviewer_assignments: number;
  active_engagements: number;
  sod_conflicts: string[];
}

export interface ReconciliationRow {
  capability: string;
  module: string;
  action: string;
  registry_status: 'REGISTERED' | 'MISSING_MODULE' | 'MISSING_ACTION' | 'DISABLED';
  roles_granted: string[];
  unexpected_roles?: string[];
  grant_count: number;
  final_status: 'PASS' | 'MISSING' | 'MISMATCHED' | 'UNUSED' | 'OVER-BROAD';
}

/** Flatten the UI capability map into the expected-permission contract. */
export function buildExpectedPermissionContract() {
  const expected: Array<{ capability: string; module: string; action: string }> = [];
  Object.entries(INTERNAL_AUDIT_PERMISSION_MAP).forEach(([capability, keys]) => {
    (keys as readonly string[]).forEach((key) => {
      const [module, action] = key.split(':');
      expected.push({ capability, module, action });
    });
  });
  return expected;
}

export function useAuditAccessMatrix() {
  return useQuery({
    queryKey: ['ia-access-matrix'],
    queryFn: () => callRpc<{ success: boolean; code?: string; error?: string; users?: AccessMatrixUser[] }>(
      'ia_access_matrix',
      {},
    ),
    staleTime: 60_000,
  });
}

export function useAuditPermissionReconciliation() {
  return useQuery({
    queryKey: ['ia-permission-reconciliation'],
    queryFn: () =>
      callRpc<{
        success: boolean;
        code?: string;
        rows?: ReconciliationRow[];
        registry_only?: Array<{ module: string; action: string }>;
      }>('ia_permission_reconciliation', { p_expected: buildExpectedPermissionContract() }),
    staleTime: 60_000,
  });
}

export const SOD_CONFLICT_LABELS: Record<string, string> = {
  PLAN_PREPARER_AND_APPROVER: 'Prepares and approves the Annual Plan',
  LEAD_AND_QUALITY_REVIEWER: 'Leads audits and signs quality review',
  AUDITOR_AND_MANAGEMENT_SAME_SCOPE: 'Audits a department they head',
  ADMIN_AND_BUSINESS_APPROVER: 'Configures the module and approves plans',
  ACTION_OWNER_AND_VERIFIER: 'Owns and verifies the same corrective action',
};
