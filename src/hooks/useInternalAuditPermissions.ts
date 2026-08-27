import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { fetchAllUserPermissions } from '@/lib/permissions/fetchAllUserPermissions';

/**
 * Canonical Internal Audit capability names, mapped onto the database-governed
 * permission registry (`app_modules` + `module_actions` + `role_permissions`).
 *
 * Screens must gate on these names — never on role names — so that access is
 * changed on the Roles screen rather than in code.
 */
export const INTERNAL_AUDIT_PERMISSION_MAP = {
  view_audit_readonly: ['internal_audit:view'],

  create_audit_plans: ['audit_plans:create'],
  edit_audit_plans: ['audit_plans:edit'],
  submit_audit_plans: ['audit_plans:submit'],
  approve_audit_plans: ['plan_approval:approve'],
  reject_audit_plans: ['plan_approval:reject'],

  create_department_audits: ['audit_engagements:create'],
  edit_department_audits: ['audit_engagements:edit'],
  assign_auditors: ['audit_engagements:assign'],
  launch_department_audit: ['audit_engagements:launch'],
  close_department_audit: ['audit_engagements:close'],

  execute_audit_activities: ['activity_workbench:execute', 'control_testing:execute'],
  upload_audit_evidence: ['evidence_management:create'],
  create_working_papers: ['working_papers:create', 'working_papers:edit'],

  enter_audit_findings: ['findings_recommendations:create'],
  edit_audit_findings: ['findings_recommendations:edit'],
  approve_audit_findings: ['findings_recommendations:approve'],

  record_management_response: ['management_responses:create', 'management_responses:edit'],

  create_audit_actions: ['action_tracking:create'],
  progress_audit_actions: ['action_tracking:edit'],
  close_audit_actions: ['action_tracking:close'],

  manage_audit_followups: ['follow_up_tracker:create', 'follow_up_tracker:edit'],
  resolve_audit_followups: ['follow_up_tracker:close'],

  draft_audit_reports: ['audit_report_center:create'],
  issue_audit_reports: ['audit_report_center:issue'],

  record_quality_review: ['quality_review:create'],
  approve_quality_review: ['quality_review:approve'],

  approve_audit_closeouts: ['plan_closeout:approve'],
  close_annual_plan: ['plan_closeout:close'],

  configure_audit_system: ['audit_configuration:configure'],
  view_risk_settings: ['audit_risk_configuration:view'],
  edit_risk_settings: ['audit_risk_configuration:edit'],
  configure_risk_bands: ['audit_risk_configuration:configure'],

  manage_risk_register: ['risk_register:create', 'risk_register:edit'],
  manage_risk_assessments: ['risk_assessment:create', 'risk_assessment:edit'],
} as const;

export type InternalAuditPermission = keyof typeof INTERNAL_AUDIT_PERMISSION_MAP;

export interface InternalAuditPermissionContext {
  isLoading: boolean;
  isAdmin: boolean;
  /** True when the signed-in user holds at least one registry action behind the capability. */
  can: (permission: InternalAuditPermission) => boolean;
  /** Raw registry check, e.g. `has('action_tracking', 'close')`. */
  has: (moduleName: string, actionName: string) => boolean;
}

export function useInternalAuditPermissions(): InternalAuditPermissionContext {
  const { user, roles, isAuthenticated, isLoading: authLoading } = useSupabaseAuth();

  const { data: rows = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['internal-audit-permissions', user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const all = await fetchAllUserPermissions(user.id);
      return all.filter((entry) => entry.is_granted !== false);
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const normalizedRoles = (roles || []).map((role) => String(role).toLowerCase());
    const isAdmin = normalizedRoles.some((role) => role === 'admin' || role === 'application admin');
    const granted = new Set(rows.map((entry) => `${entry.module_name}:${entry.action_name}`));
    const isLoading = authLoading || permissionsLoading;

    const has = (moduleName: string, actionName: string) => {
      if (isAdmin) return true;
      if (isLoading || !isAuthenticated) return false;
      return granted.has(`${moduleName}:${actionName}`);
    };

    const can = (permission: InternalAuditPermission) => {
      if (isAdmin) return true;
      if (isLoading || !isAuthenticated) return false;
      const keys = INTERNAL_AUDIT_PERMISSION_MAP[permission] as readonly string[] | undefined;
      if (!keys) return false;
      return keys.some((key) => granted.has(key));
    };

    return { isLoading, isAdmin, can, has };
  }, [authLoading, isAuthenticated, permissionsLoading, roles, rows]);
}
