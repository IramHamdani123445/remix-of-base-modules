/**
 * Unified workflow access logic for Internal Audit Annual Plan submission & approval.
 * 
 * Single source of truth for:
 * - Who can submit a plan
 * - Who can approve/reject/send-back a plan
 * - Why a button is disabled (human-readable reasons)
 * - Which statuses are submittable / approvable
 * 
 * Used by: AuditPlansNew (list), AuditPlanDetail (workspace), PlanApproval (approver screen).
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { fetchAllUserPermissions } from '@/lib/permissions/fetchAllUserPermissions';

export interface PlanReadinessSummary {
  ready: boolean;
  reason?: string;
  failedChecks?: string[];
}

export interface AnnualPlanPermissionContext {
  isAuthenticated: boolean;
  isLoading: boolean;
  isAdmin: boolean;
  canManagePlans: boolean;
  canApprovePlans: boolean;
  canViewPlans: boolean;
  roles: string[];
  moduleViews: string[];
  hasPermission: (permission: string) => boolean;
}

type PermissionRow = {
  module_name: string;
  action_name: string;
  is_granted?: boolean;
};

// ── Constants ────────────────────────────────────────────────────────

export const PLAN_STATUSES = [
  'Draft',
  'Submitted',
  'Under Review',
  'Approved',
  'Rejected',
  'Changes Requested',
  'Amendment Pending',
  'Superseded',
  'Archived',
] as const;

export type PlanStatus = (typeof PLAN_STATUSES)[number];

const SUBMITTABLE_STATUSES: PlanStatus[] = ['Draft', 'Rejected', 'Changes Requested', 'Amendment Pending'];
const APPROVABLE_STATUSES: PlanStatus[] = ['Submitted', 'Under Review'];
const EDITABLE_STATUSES: PlanStatus[] = ['Draft', 'Rejected', 'Changes Requested', 'Amendment Pending'];
const WITHDRAWABLE_STATUSES: PlanStatus[] = ['Submitted'];
const REVISABLE_STATUSES: PlanStatus[] = ['Approved'];

// ── Permission helpers (pure functions, no hooks) ────────────────────

/** Maker/submitter permissions: anyone with screen access can submit */
const SUBMIT_PERMISSIONS = ['create_audit_plans', 'edit_audit_plans', 'view_audit_plans'] as const;

/** Approver permissions */
const APPROVE_PERMISSIONS = ['approve_audit_plans'] as const;

/** Admin-level overrides that grant all capabilities */
const ADMIN_PERMISSIONS = ['admin', 'system_administration'] as const;

function hasAnyPermission(
  checker: (p: string) => boolean,
  permissions: readonly string[],
): boolean {
  return permissions.some(checker);
}

function isAdminUser(checker: (p: string) => boolean): boolean {
  return hasAnyPermission(checker, ADMIN_PERMISSIONS);
}

export function isEditablePlanStatus(planStatus?: string): boolean {
  return !!planStatus && EDITABLE_STATUSES.includes(planStatus as PlanStatus);
}

export function isLockedPlanStatus(planStatus?: string): boolean {
  return !!planStatus && ['Submitted', 'Under Review', 'Approved', 'Superseded', 'Archived'].includes(planStatus);
}

export function useAuditAnnualPlanPermissionContext(): AnnualPlanPermissionContext {
  const { user, roles, isAuthenticated, isLoading: authLoading } = useSupabaseAuth();

  const { data: permissionRows = [], isLoading: permissionsLoading } = useQuery({
    queryKey: ['audit-annual-plan-runtime-access', user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as PermissionRow[];
      const all = await fetchAllUserPermissions(user.id);
      return (all as PermissionRow[]).filter((entry) => entry.is_granted !== false);
    },

    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const normalizedRoles = (roles || []).map((role) => role.toLowerCase());
    const isAdmin = normalizedRoles.some((role) => role === 'admin' || role === 'application admin');
    const permissionSet = new Set(permissionRows.map((entry) => `${entry.module_name}:${entry.action_name}`));
    const moduleViews = Array.from(new Set(permissionRows.filter((entry) => entry.action_name === 'view').map((entry) => entry.module_name).filter(Boolean)));
    // DEF-S1B-35: maker authority requires an explicit create/edit grant — read access alone must not expose plan authoring controls.
    const canManagePlans = isAdmin || permissionSet.has('audit_plans:create') || permissionSet.has('audit_plans:edit');
    const canApprovePlans = isAdmin || permissionSet.has('plan_approval:approve');
    const canViewPlans = isAdmin || moduleViews.includes('audit_plans') || canManagePlans || canApprovePlans;
    const isLoading = authLoading || permissionsLoading;

    const hasPermission = (permission: string) => {
      if (isLoading || !isAuthenticated) return false;

      switch (permission) {
        case 'create_audit_plans':
        case 'edit_audit_plans':
          return canManagePlans;
        case 'view_audit_plans':
          return canViewPlans;

        case 'approve_audit_plans':
          return canApprovePlans;
        case 'admin':
        case 'system_administration':
          return isAdmin;
        default:
          return false;
      }
    };

    return {
      isAuthenticated,
      isLoading,
      isAdmin,
      canManagePlans,
      canApprovePlans,
      canViewPlans,
      roles,
      moduleViews,
      hasPermission,
    };
  }, [authLoading, isAuthenticated, permissionRows, permissionsLoading, roles]);
}

function getMissingAuthReason(): string {
  return 'You must be signed in with a real application account to perform this action.';
}

function getLockedReason(planStatus?: string): string {
  switch (planStatus) {
    case 'Submitted':
    case 'Under Review':
      return `Plan is in "${planStatus}" status and is waiting for approval.`;
    case 'Approved':
      return 'Approved plans are locked. Use the revision/amendment flow instead of normal editing or submission.';
    case 'Superseded':
    case 'Archived':
      return `Plan is in "${planStatus}" status and is locked.`;
    default:
      return `Plan is in "${planStatus || 'unknown'}" status and is locked.`;
  }
}

// ── Submit eligibility ──────────────────────────────────────────────

export interface ActionEligibility {
  /** Whether the button should be rendered at all */
  visible: boolean;
  /** Whether the button should be clickable */
  enabled: boolean;
  /** Human-readable reason when disabled */
  reason?: string;
}

export function getSubmitEligibility(
  hasPermission: (p: string) => boolean,
  planStatus?: string,
  readiness?: PlanReadinessSummary,
): ActionEligibility {
  const admin = isAdminUser(hasPermission);
  const hasMakerPerm = admin || hasAnyPermission(hasPermission, SUBMIT_PERMISSIONS);

  if (!hasMakerPerm) {
    // DEF-S1B-35: hide maker controls entirely from users without submission authority.
    return { visible: false, enabled: false, reason: 'Missing submission permission. Only annual plan makers/preparers can submit this plan.' };
  }

  if (!planStatus || !SUBMITTABLE_STATUSES.includes(planStatus as PlanStatus)) {
    return { visible: true, enabled: false, reason: getLockedReason(planStatus) };
  }

  if (readiness && !readiness.ready) {
    return {
      visible: true,
      enabled: false,
      reason: readiness.reason || 'Readiness checks failed. Complete required plan and engagement details before submitting.',
    };
  }

  return { visible: true, enabled: true };
}

export function getEditEligibility(
  hasPermission: (p: string) => boolean,
  planStatus?: string,
): ActionEligibility {
  const admin = isAdminUser(hasPermission);
  const hasPerm = admin || hasAnyPermission(hasPermission, SUBMIT_PERMISSIONS);

  if (!hasPerm) {
    return { visible: true, enabled: false, reason: 'Missing edit permission for annual plans.' };
  }

  if (!planStatus || !EDITABLE_STATUSES.includes(planStatus as PlanStatus)) {
    return { visible: true, enabled: false, reason: getLockedReason(planStatus) };
  }

  return { visible: true, enabled: true };
}

export function getWithdrawEligibility(
  hasPermission: (p: string) => boolean,
  planStatus?: string,
): ActionEligibility {
  const admin = isAdminUser(hasPermission);
  const hasPerm = admin || hasAnyPermission(hasPermission, SUBMIT_PERMISSIONS);

  if (!hasPerm) {
    return { visible: false, enabled: false };
  }

  if (!planStatus || !WITHDRAWABLE_STATUSES.includes(planStatus as PlanStatus)) {
    return { visible: false, enabled: false };
  }

  return { visible: true, enabled: true };
}

export function getReviseEligibility(
  hasPermission: (p: string) => boolean,
  planStatus?: string,
): ActionEligibility {
  const admin = isAdminUser(hasPermission);
  const hasPerm = admin || hasAnyPermission(hasPermission, SUBMIT_PERMISSIONS);

  if (!hasPerm) {
    return { visible: false, enabled: false };
  }

  if (!planStatus || !REVISABLE_STATUSES.includes(planStatus as PlanStatus)) {
    return { visible: false, enabled: false };
  }

  return { visible: true, enabled: true };
}

// ── Approve / Reject / Send-back eligibility ────────────────────────

export function getApproveEligibility(
  hasPermission: (p: string) => boolean,
  planStatus?: string,
): ActionEligibility {
  const admin = isAdminUser(hasPermission);
  const hasApproverPerm = admin || hasAnyPermission(hasPermission, APPROVE_PERMISSIONS);

  if (!hasApproverPerm) {
    return { visible: false, enabled: false, reason: 'You do not have plan approval permission.' };
  }

  if (!planStatus || !APPROVABLE_STATUSES.includes(planStatus as PlanStatus)) {
    return { visible: true, enabled: false, reason: `Plan is in "${planStatus}" status and cannot be approved right now.` };
  }

  return { visible: true, enabled: true };
}

// ── React hook convenience wrapper ──────────────────────────────────

export function usePlanWorkflowAccess(planStatus?: string, readiness?: PlanReadinessSummary) {
  const context = useAuditAnnualPlanPermissionContext();
  const hasPermission = context.hasPermission;

  if (context.isLoading) {
    // While permissions are loading, keep buttons enabled (optimistic) so users don't see a flash of disabled state.
    // The readiness dialog still runs its own validation before actual submission.
    const loadingState = { visible: true, enabled: true, reason: undefined };
    return {
      submit: loadingState,
      edit: loadingState,
      withdraw: { visible: false, enabled: false } as ActionEligibility,
      revise: { visible: false, enabled: false } as ActionEligibility,
      approve: { visible: false, enabled: false } as ActionEligibility,
      isApprover: false,
      isMaker: false,
      isLoading: true,
      permissionContext: context,
    };
  }

  if (!context.isAuthenticated) {
    const authBlocked = { visible: true, enabled: false, reason: getMissingAuthReason() };
    return {
      submit: authBlocked,
      edit: authBlocked,
      withdraw: { visible: false, enabled: false } as ActionEligibility,
      revise: { visible: false, enabled: false } as ActionEligibility,
      approve: { visible: false, enabled: false, reason: getMissingAuthReason() } as ActionEligibility,
      isApprover: false,
      isMaker: false,
      isLoading: false,
      permissionContext: context,
    };
  }

  return {
    submit: getSubmitEligibility(hasPermission, planStatus, readiness),
    edit: getEditEligibility(hasPermission, planStatus),
    withdraw: getWithdrawEligibility(hasPermission, planStatus),
    revise: getReviseEligibility(hasPermission, planStatus),
    approve: getApproveEligibility(hasPermission, planStatus),
    isApprover: context.canApprovePlans,
    isMaker: context.canManagePlans,
    isLoading: false,
    permissionContext: context,
  };
}
