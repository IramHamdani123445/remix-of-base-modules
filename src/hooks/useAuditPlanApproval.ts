import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';

async function syncAnnualPlanEngagementApprovalState(params: {
  planId: string;
  status: 'Approved' | 'Rejected' | 'Changes Requested' | 'Draft' | 'Superseded';
  userCode: string;
  approvedAt?: string | null;
  approvedVersion?: number | null;
  workflowInstanceId?: string | null;
}) {
  const baseUpdate: Record<string, any> = {
    workflow_instance_id: params.workflowInstanceId ?? null,
    updated_by: params.userCode,
    updated_at: new Date().toISOString(),
  };

  if (params.status === 'Approved') {
    baseUpdate.approved_by = params.userCode;
    baseUpdate.approved_at = params.approvedAt ?? new Date().toISOString();
    baseUpdate.approved_plan_version = params.approvedVersion ?? null;
  } else {
    baseUpdate.approved_by = null;
    baseUpdate.approved_at = null;
    baseUpdate.approved_plan_version = null;
  }

  const { error } = await supabase
    .from('ia_audit_engagements' as any)
    .update(baseUpdate as any)
    .eq('annual_plan_id', params.planId)
    .eq('is_active', true);

  if (error) throw error;
}

// ── Submission readiness checks ──────────────────────────────────────

export interface ReadinessCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export function validatePlanReadiness(plan: any, engagements: any[]): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  checks.push({
    label: 'Fiscal year is set',
    passed: !!plan?.fiscal_year,
  });
  checks.push({
    label: 'Plan title is set',
    passed: !!plan?.title?.trim(),
  });
  checks.push({
    label: 'Executive summary provided',
    passed: !!(plan?.executive_summary?.trim()),
    detail: !plan?.executive_summary?.trim() ? 'Add an executive summary in the Overview tab' : undefined,
  });
  checks.push({
    label: 'At least one engagement exists',
    passed: engagements.length > 0,
    detail: engagements.length === 0 ? 'Add engagements in the Engagements tab' : `${engagements.length} engagement(s)`,
  });

  const missingDept = engagements.filter((e: any) => !e.department_id && !e.department_name);
  checks.push({
    label: 'All engagements have a department',
    passed: missingDept.length === 0,
    detail: missingDept.length > 0 ? `${missingDept.length} missing department` : undefined,
  });

  const missingFunction = engagements.filter((e: any) => !e.business_function_id && !e.function_name);
  checks.push({
    label: 'All engagements have a business function',
    passed: missingFunction.length === 0,
    detail: missingFunction.length > 0 ? `${missingFunction.length} missing function` : undefined,
  });

  const missingLead = engagements.filter((e: any) => !e.lead_auditor);
  checks.push({
    label: 'All engagements have a lead auditor',
    passed: missingLead.length === 0,
    detail: missingLead.length > 0 ? `${missingLead.length} missing lead auditor` : undefined,
  });

  const missingSchedule = engagements.filter((e: any) => !e.planned_start_date && !e.start_date && !e.planned_quarter && !e.quarter);
  checks.push({
    label: 'All engagements have schedule (date or quarter)',
    passed: missingSchedule.length === 0,
    detail: missingSchedule.length > 0 ? `${missingSchedule.length} missing schedule` : undefined,
  });

  const missingEffort = engagements.filter((e: any) => !e.estimated_days && !e.estimated_hours);
  checks.push({
    label: 'All engagements have estimated effort',
    passed: missingEffort.length === 0,
    detail: missingEffort.length > 0 ? `${missingEffort.length} missing effort estimate` : undefined,
  });

  return checks;
}

// ── Approval history for a plan ──────────────────────────────────────

export function useIAPlanApprovalHistory(planId?: string) {
  return useQuery({
    queryKey: ['ia_plan_approval_history', planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_approval_actions' as any)
        .select('*')
        .eq('entity_id', planId)
        .eq('entity_type', 'annual_plan')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!planId,
  });
}

// ── Plan workflow mutations ──────────────────────────────────────────

export function useAuditPlanWorkflow() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { userCode } = useUserCode();

  const logAction = async (planId: string, action: string, comments?: string) => {
    try {
      await supabase.from('ia_approval_actions' as any).insert({
        entity_type: 'annual_plan',
        entity_id: planId,
        action,
        performed_by: userCode || 'system',
        performer_name: null,
        comments: comments || null,
      });
    } catch (e) {
      console.error('Failed to log approval action:', e);
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ia_annual_plans'] });
    queryClient.invalidateQueries({ queryKey: ['ia_plan_approval_history'] });
    queryClient.invalidateQueries({ queryKey: ['ia_plan_engagements'] });
  };

  // All submission and decision transitions run through governed server commands
  // (ia_submit_annual_plan / ia_decide_annual_plan). These enforce permissions,
  // readiness, segregation of duties, engagement stamping and immutable audit events.
  const callGovernedCommand = async (fn: string, args: Record<string, any>) => {
    const { data, error } = await supabase.rpc(fn as any, args);
    if (error) throw error;
    const result = (data || {}) as any;
    if (!result.success) {
      const blockers = Array.isArray(result.blockers) ? result.blockers : [];
      throw new Error(
        [result.error || 'The request could not be completed.', ...blockers].join(' '),
      );
    }
    return result;
  };

  const submitForApproval = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'update'],
    mutationFn: async ({ planId, notes }: { planId: string; notes?: string }) =>
      callGovernedCommand('ia_submit_annual_plan', { p_plan_id: planId, p_notes: notes ?? null }),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Plan Submitted', description: 'The plan has been submitted for approval.' });
    },
    onError: (e: any) => toast({ title: 'Submission Failed', description: e.message, variant: 'destructive' }),
  });

  const approvePlan = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'approve'],
    mutationFn: async ({ planId, comments, committeeName, minutesRef }: { planId: string; comments?: string; committeeName?: string; minutesRef?: string }) =>
      callGovernedCommand('ia_decide_annual_plan', {
        p_plan_id: planId,
        p_decision: 'approve',
        p_comments: comments ?? null,
        p_committee_name: committeeName ?? null,
        p_minutes_reference: minutesRef ?? null,
      }),
    onSuccess: (result: any) => {
      invalidate();
      toast({
        title: 'Plan Approved',
        description: result?.superseded_plans
          ? `The annual audit plan has been approved. ${result.superseded_plans} earlier plan(s) superseded.`
          : 'The annual audit plan has been approved.',
      });
    },
    onError: (e: any) => toast({ title: 'Approval Failed', description: e.message, variant: 'destructive' }),
  });

  const rejectPlan = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'approve'],
    mutationFn: async ({ planId, comments }: { planId: string; comments: string }) =>
      callGovernedCommand('ia_decide_annual_plan', {
        p_plan_id: planId,
        p_decision: 'reject',
        p_comments: comments,
        p_committee_name: null,
        p_minutes_reference: null,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Plan Rejected', description: 'The plan has been rejected with comments.' });
    },
    onError: (e: any) => toast({ title: 'Rejection Failed', description: e.message, variant: 'destructive' }),
  });

  const sendBackForChanges = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'reject'],
    mutationFn: async ({ planId, comments }: { planId: string; comments: string }) =>
      callGovernedCommand('ia_decide_annual_plan', {
        p_plan_id: planId,
        p_decision: 'changes_requested',
        p_comments: comments,
        p_committee_name: null,
        p_minutes_reference: null,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: 'Changes Requested', description: 'The plan has been sent back for revisions.' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });


  const withdrawSubmission = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'update'],
    mutationFn: async ({ planId }: { planId: string }) => {
      const { data, error } = await supabase
        .from('ia_annual_plans' as any)
        .update({
          status: 'Draft',
          current_workflow_step: 'draft',
          is_locked: false,
        })
        .eq('id', planId)
        .select()
        .single();
      if (error) throw error;
      await syncAnnualPlanEngagementApprovalState({
        planId,
        status: 'Draft',
        userCode: userCode || 'system',
        workflowInstanceId: null,
      });
      await logAction(planId, 'Withdrawn', 'Submission withdrawn by maker');
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Submission Withdrawn', description: 'The plan is back in draft.' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const markAmendmentPending = useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'update'],
    mutationFn: async ({ planId, reason }: { planId: string; reason?: string }) => {
      const { data, error } = await supabase
        .from('ia_annual_plans' as any)
        .update({
          status: 'Amendment Pending',
          current_workflow_step: 'amendment_pending',
          is_locked: false,
          last_material_change_at: new Date().toISOString(),
          last_material_change_by: userCode,
        })
        .eq('id', planId)
        .select()
        .single();
      if (error) throw error;
      await logAction(planId, 'Amendment Pending', reason || 'Material change detected, re-approval required');
      return data;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Amendment Pending', description: 'Plan requires re-approval after changes.' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return {
    submitForApproval,
    approvePlan,
    rejectPlan,
    sendBackForChanges,
    withdrawSubmission,
    markAmendmentPending,
  };
}

// ── Editable state helper ────────────────────────────────────────────

export function isPlanEditable(status?: string): boolean {
  if (!status) return true;
  return ['Draft', 'Changes Requested', 'Rejected'].includes(status);
}

export function isPlanLocked(status?: string): boolean {
  if (!status) return false;
  return ['Submitted', 'Under Review', 'Approved', 'Superseded', 'Archived'].includes(status);
}
