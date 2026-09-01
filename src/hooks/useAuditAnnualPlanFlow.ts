import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';
import { notifyPlanSubmitted, notifyTeamConflict } from '@/services/iaNotificationService';


export interface AnnualPlanReadinessCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface AnnualPlanReadinessSummary {
  ready: boolean;
  failedChecks: string[];
  reason?: string;
}

function withDetail(label: string, detail?: string) {
  return detail ? `${label}: ${detail}` : label;
}

export function getAnnualPlanReadinessChecks(plan: any, engagements: any[] = []): AnnualPlanReadinessCheck[] {
  const checks: AnnualPlanReadinessCheck[] = [];

  checks.push({
    label: 'Fiscal year is set',
    passed: !!plan?.fiscal_year,
    detail: !plan?.fiscal_year ? 'Set the fiscal year in plan details.' : undefined,
  });

  checks.push({
    label: 'Plan title is set',
    passed: !!plan?.title?.trim(),
    detail: !plan?.title?.trim() ? 'Enter the annual plan title.' : undefined,
  });

  const hasNarrative = Boolean(
    plan?.executive_summary?.trim() ||
      plan?.objective?.trim() ||
      plan?.methodology?.trim() ||
      plan?.planning_assumptions?.trim()
  );

  checks.push({
    label: 'Planning narrative is complete',
    passed: hasNarrative,
    detail: !hasNarrative ? 'Add the executive summary, objective, methodology, or planning assumptions.' : undefined,
  });

  checks.push({
    label: 'At least one engagement exists',
    passed: engagements.length > 0,
    detail: engagements.length === 0 ? 'Add at least one engagement to the plan.' : `${engagements.length} engagement(s) linked.`,
  });

  const missingDept = engagements.filter((e: any) => !e.department_id && !e.department_name);
  checks.push({
    label: 'All engagements have a department',
    passed: missingDept.length === 0,
    detail: missingDept.length > 0 ? `${missingDept.length} engagement(s) missing department.` : undefined,
  });

  const missingFunction = engagements.filter((e: any) => !e.business_function_id && !e.function_id && !e.function_name);
  checks.push({
    label: 'All engagements have a business function',
    passed: missingFunction.length === 0,
    detail: missingFunction.length > 0 ? `${missingFunction.length} engagement(s) missing function.` : undefined,
  });

  const missingLead = engagements.filter((e: any) => !e.lead_auditor && !e.lead_auditor_id);
  checks.push({
    label: 'All engagements have a lead auditor',
    passed: missingLead.length === 0,
    detail: missingLead.length > 0 ? `${missingLead.length} engagement(s) missing lead auditor.` : undefined,
  });

  const missingSchedule = engagements.filter(
    (e: any) => !e.planned_start_date && !e.start_date && !e.planned_quarter && !e.quarter,
  );
  checks.push({
    label: 'All engagements have schedule',
    passed: missingSchedule.length === 0,
    detail: missingSchedule.length > 0 ? `${missingSchedule.length} engagement(s) missing dates or quarter.` : undefined,
  });

  const missingEffort = engagements.filter((e: any) => !e.estimated_days && !e.estimated_hours);
  checks.push({
    label: 'All engagements have estimated effort',
    passed: missingEffort.length === 0,
    detail: missingEffort.length > 0 ? `${missingEffort.length} engagement(s) missing days or hours.` : undefined,
  });

  return checks;
}

export function summarizeAnnualPlanReadiness(checks: AnnualPlanReadinessCheck[]): AnnualPlanReadinessSummary {
  const failedChecks = checks.filter((check) => !check.passed).map((check) => withDetail(check.label, check.detail));

  return {
    ready: failedChecks.length === 0,
    failedChecks,
    reason: failedChecks.length > 0 ? failedChecks.slice(0, 3).join(' ') : undefined,
  };
}

export function getAnnualPlanReadinessSummary(plan: any, engagements: any[] = []): AnnualPlanReadinessSummary {
  return summarizeAnnualPlanReadiness(getAnnualPlanReadinessChecks(plan, engagements));
}

/**
 * Server-authoritative readiness for a single annual plan.
 * Canonical source: ia_annual_plan_readiness (same function the submit command enforces).
 */
export function useAnnualPlanReadiness(planId?: string) {
  const { data, isLoading } = useQuery({
    queryKey: ['ia_annual_plan_readiness', planId],
    queryFn: async (): Promise<AnnualPlanReadinessSummary> => {
      const { data, error } = await supabase.rpc('ia_annual_plan_readiness' as any, { p_plan_id: planId });
      if (error) throw error;
      const result = (data || {}) as { ready?: boolean; blockers?: string[] };
      const failedChecks = result.blockers || [];
      return {
        ready: !!result.ready,
        failedChecks,
        reason: failedChecks.length > 0 ? failedChecks.slice(0, 3).join(' ') : undefined,
      };
    },
    enabled: !!planId,
  });

  return { readiness: data, isLoading };
}

/**
 * Server-authoritative readiness for a list of plans (portfolio register).
 */
export function useAuditAnnualPlanReadinessMap(plans: any[] = []) {
  const planIds = useMemo(() => plans.map((plan) => plan.id).filter(Boolean), [plans]);

  const { data = {}, isLoading } = useQuery({
    queryKey: ['ia_annual_plan_readiness_map', planIds],
    queryFn: async () => {
      if (planIds.length === 0) return {} as Record<string, AnnualPlanReadinessSummary>;

      const results = await Promise.all(
        planIds.map(async (planId) => {
          const { data, error } = await supabase.rpc('ia_annual_plan_readiness' as any, { p_plan_id: planId });
          if (error) throw error;
          const result = (data || {}) as { ready?: boolean; blockers?: string[] };
          const failedChecks = result.blockers || [];
          const summary: AnnualPlanReadinessSummary = {
            ready: !!result.ready,
            failedChecks,
            reason: failedChecks.length > 0 ? failedChecks.slice(0, 3).join(' ') : undefined,
          };
          return [planId, summary] as const;
        }),
      );

      return Object.fromEntries(results) as Record<string, AnnualPlanReadinessSummary>;
    },
    enabled: planIds.length > 0,
  });

  return { readinessMap: data, isLoading };
}

/**
 * Canonical annual plan submission.
 *
 * All gating (permission, readiness, status, team-availability conflicts, version
 * snapshot, plan locking, engagement approval reset, approval action and event log)
 * is performed inside ia_start_plan_approval_workflow. The client performs no
 * parallel validation and no direct table writes.
 */
export async function submitAnnualPlanWorkflow(params: {
  planId: string;
  userCode: string;
  fullName?: string;
  plan?: any;
  engagements?: any[];
  isRevision?: boolean;
}) {
  const { data: result, error } = await supabase.rpc('ia_start_plan_approval_workflow', {
    p_plan_id: params.planId,
    p_submitted_by: params.userCode,
    p_is_revision: params.isRevision || false,
  });

  if (error) throw error;

  const payload = (result || {}) as any;

  if (!payload?.success) {
    const blockers: string[] = payload?.blockers || [];
    if (payload?.conflicts) {
      notifyTeamConflict(params.planId, {
        plan_title: params.plan?.title || 'Audit Plan',
        conflict_type: 'multiple',
        auditor_name: 'Team',
        conflict_dates: 'See details',
        severity: 'blocking',
      });
    }
    throw new Error(
      blockers.length > 0
        ? `${payload?.error || 'Plan readiness checks failed'}: ${blockers.join(' ')}`
        : payload?.error || 'Failed to start the annual plan approval workflow.',
    );
  }

  notifyPlanSubmitted(params.planId, {
    plan_title: params.plan?.title || 'Audit Plan',
    fiscal_year: params.plan?.fiscal_year || '',
    submitted_by: params.userCode,
    submitted_by_name: params.fullName || undefined,
    plan_id: params.planId,
    department_name: '',
    risk_level: '',
  });

  return payload;
}


export function useSubmitAnnualPlanWorkflow() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { userCode, fullName } = useUserCode();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'mutation'],
    mutationFn: async (params: {
      planId: string;
      plan?: any;
      engagements?: any[];
      isRevision?: boolean;
    }) => {
      if (!userCode) {
        throw new Error('Current user identity is unavailable. Please sign in again.');
      }

      const result = await submitAnnualPlanWorkflow({
        ...params,
        userCode,
        fullName: fullName || undefined,
      });

      queryClient.invalidateQueries({ queryKey: ['ia_annual_plans'] });
      queryClient.invalidateQueries({ queryKey: ['ia_plan_versions'] });
      queryClient.invalidateQueries({ queryKey: ['workflow_instances'] });
      queryClient.invalidateQueries({ queryKey: ['ia_plan_approval_history'] });
      queryClient.invalidateQueries({ queryKey: ['ia_plan_engagements', params.planId] });
      queryClient.invalidateQueries({ queryKey: ['ia_annual_plan_readiness', params.planId] });
      queryClient.invalidateQueries({ queryKey: ['ia_annual_plan_readiness_map'] });

      return result;
    },
    onSuccess: (result: any) => {
      toast({
        title: 'Plan Submitted',
        description: `Plan submitted for approval${result?.version_number ? ` (v${result.version_number})` : ''}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: 'Submission Failed',
        description: error?.message || 'Unable to submit the annual plan for approval.',
        variant: 'destructive',
      });
    },
  });
}