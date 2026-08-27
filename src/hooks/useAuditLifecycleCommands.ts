import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Internal Audit — Wave 2 governed lifecycle commands.
 *
 * Every state change in the executable audit lifecycle goes through a
 * server-side command (SECURITY DEFINER RPC) that:
 *   - checks permission and engagement access,
 *   - enforces the lifecycle gate for that step,
 *   - writes an immutable entry to `ia_audit_event`.
 *
 * The UI must never write these lifecycle columns directly — use these hooks.
 */

export interface IaCommandResult {
  success: boolean;
  code?: string;
  error?: string;
  reasons?: string[];
  [key: string]: unknown;
}

const LIFECYCLE_KEYS = [
  'ia_audit_engagements',
  'ia_activities',
  'ia_control_tests',
  'ia_findings',
  'ia_management_responses',
  'ia_action_tracking',
  'ia_quality_reviews',
  'ia_audit_reports',
  'ia_report_versions',
  'ia_finding_severity_history',
  'ia_action_extensions',
  'ia_audit_event',
  'ia_engagement_closure_gate',
  'ia_engagement_closure_gate_v2',
];

function useLifecycleCommand<TVars>(
  command: string,
  buildParams: (vars: TVars) => Record<string, unknown>,
  successTitle: string,
) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'lifecycle', command],
    mutationFn: async (vars: TVars): Promise<IaCommandResult> => {
      const { data, error } = await (supabase.rpc as any)(command, buildParams(vars));
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as IaCommandResult;
      if (!result.success) {
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        throw new Error([result.error, ...reasons].filter(Boolean).join(' — ') || 'Command rejected');
      }
      return result;
    },
    onSuccess: () => {
      LIFECYCLE_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      toast({ title: successTitle });
    },
    onError: (e: any) =>
      toast({ title: 'Action blocked', description: e.message, variant: 'destructive' }),
  });
}

/* ------------------------------------------------------------------ */
/* Preparation                                                         */
/* ------------------------------------------------------------------ */
export function useCompletePreparation() {
  return useLifecycleCommand<{ engagementId: string; notes?: string | null }>(
    'ia_complete_preparation',
    (v) => ({ p_engagement_id: v.engagementId, p_notes: v.notes ?? null }),
    'Preparation completed',
  );
}

/* ------------------------------------------------------------------ */
/* Fieldwork activities                                                */
/* ------------------------------------------------------------------ */
export function useAssignActivity() {
  return useLifecycleCommand<{
    activityId: string;
    ownerAuditorId: string;
    reviewerAuditorId?: string | null;
    plannedHours?: number | null;
  }>(
    'ia_assign_activity',
    (v) => ({
      p_activity_id: v.activityId,
      p_owner_auditor_id: v.ownerAuditorId,
      p_reviewer_auditor_id: v.reviewerAuditorId ?? null,
      p_planned_hours: v.plannedHours ?? null,
    }),
    'Activity assigned',
  );
}

export function useCompleteActivity() {
  return useLifecycleCommand<{ activityId: string; actualHours?: number | null; notes?: string | null }>(
    'ia_complete_activity',
    (v) => ({ p_activity_id: v.activityId, p_actual_hours: v.actualHours ?? null, p_notes: v.notes ?? null }),
    'Activity completed',
  );
}

export function useReviewActivity() {
  return useLifecycleCommand<{
    activityId: string;
    outcome: 'Reviewed' | 'Rework Required';
    notes?: string | null;
  }>(
    'ia_review_activity',
    (v) => ({ p_activity_id: v.activityId, p_outcome: v.outcome, p_notes: v.notes ?? null }),
    'Activity review recorded',
  );
}

/* ------------------------------------------------------------------ */
/* Control testing                                                     */
/* ------------------------------------------------------------------ */
export function useConcludeControlTest() {
  return useLifecycleCommand<{
    testId: string;
    result: string;
    conclusion: string;
    noFindingRationale?: string | null;
  }>(
    'ia_conclude_control_test',
    (v) => ({
      p_test_id: v.testId,
      p_result: v.result,
      p_conclusion: v.conclusion,
      p_no_finding_rationale: v.noFindingRationale ?? null,
    }),
    'Control test concluded',
  );
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */
export type FindingLifecycleStatus =
  | 'Draft'
  | 'Under Review'
  | 'Confirmed'
  | 'Released'
  | 'Responded'
  | 'Closed'
  | 'Withdrawn';

export function useTransitionFinding() {
  return useLifecycleCommand<{
    findingId: string;
    targetStatus: Exclude<FindingLifecycleStatus, 'Draft'>;
    reason?: string | null;
  }>(
    'ia_transition_finding',
    (v) => ({ p_finding_id: v.findingId, p_target_status: v.targetStatus, p_reason: v.reason ?? null }),
    'Finding updated',
  );
}

export function useChangeFindingSeverity() {
  return useLifecycleCommand<{
    findingId: string;
    severity: 'Low' | 'Medium' | 'High' | 'Critical';
    reason: string;
  }>(
    'ia_change_finding_severity',
    (v) => ({ p_finding_id: v.findingId, p_new_severity: v.severity, p_reason: v.reason }),
    'Severity changed',
  );
}

export function useFindingSeverityHistory(findingId?: string) {
  return useQuery({
    queryKey: ['ia_finding_severity_history', findingId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_finding_severity_history')
        .select('*')
        .eq('finding_id', findingId)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!findingId,
  });
}

/* ------------------------------------------------------------------ */
/* Management responses                                                */
/* ------------------------------------------------------------------ */
export type ManagementPosition = 'Accepted' | 'Partially Accepted' | 'Rejected';

export function useRecordManagementResponse() {
  return useLifecycleCommand<{
    findingId: string;
    position: ManagementPosition;
    responseText: string;
    actionPlan?: string | null;
    responsiblePerson?: string | null;
    targetDate?: string | null;
    rejectionRationale?: string | null;
  }>(
    'ia_record_management_response',
    (v) => ({
      p_finding_id: v.findingId,
      p_management_position: v.position,
      p_response_text: v.responseText,
      p_action_plan: v.actionPlan ?? null,
      p_responsible_person: v.responsiblePerson ?? null,
      p_target_date: v.targetDate ?? null,
      p_rejection_rationale: v.rejectionRationale ?? null,
    }),
    'Management response recorded',
  );
}

export function useReviewManagementResponse() {
  return useLifecycleCommand<{
    responseId: string;
    outcome: 'Accepted' | 'Escalated' | 'Revision Requested';
    notes?: string | null;
  }>(
    'ia_review_management_response',
    (v) => ({ p_response_id: v.responseId, p_outcome: v.outcome, p_notes: v.notes ?? null }),
    'Response reviewed',
  );
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */
export function useExtendActionTarget() {
  return useLifecycleCommand<{
    actionId: string;
    newTargetDate: string;
    reason: string;
    approvedBy?: string | null;
  }>(
    'ia_extend_action_target',
    (v) => ({
      p_action_id: v.actionId,
      p_new_target_date: v.newTargetDate,
      p_reason: v.reason,
      p_approved_by: v.approvedBy ?? null,
    }),
    'Target date extended',
  );
}

export function useCloseAction() {
  return useLifecycleCommand<{ actionId: string; closureNotes: string; evidenceIds?: string[] | null }>(
    'ia_close_action',
    (v) => ({
      p_action_id: v.actionId,
      p_closure_notes: v.closureNotes,
      p_evidence_ids: v.evidenceIds && v.evidenceIds.length > 0 ? v.evidenceIds : null,
    }),
    'Action closed',
  );
}

export function useActionExtensions(actionId?: string) {
  return useQuery({
    queryKey: ['ia_action_extensions', actionId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_action_extensions')
        .select('*')
        .eq('action_id', actionId)
        .order('approved_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!actionId,
  });
}

/* ------------------------------------------------------------------ */
/* Quality assurance                                                   */
/* ------------------------------------------------------------------ */
export function useStartQualityReview() {
  return useLifecycleCommand<{ engagementId: string; reviewType?: string }>(
    'ia_start_quality_review',
    (v) => ({ p_engagement_id: v.engagementId, p_review_type: v.reviewType ?? 'Engagement QA' }),
    'Quality review started',
  );
}

export function useConcludeQualityReview() {
  return useLifecycleCommand<{
    reviewId: string;
    outcome: 'Cleared' | 'Rework Required';
    qualityRating?: string | null;
    notes?: string | null;
  }>(
    'ia_conclude_quality_review',
    (v) => ({
      p_review_id: v.reviewId,
      p_outcome: v.outcome,
      p_quality_rating: v.qualityRating ?? null,
      p_notes: v.notes ?? null,
    }),
    'Quality review concluded',
  );
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */
export function useCreateReportVersion() {
  return useLifecycleCommand<{
    reportId: string;
    content?: Record<string, unknown>;
    changeSummary?: string | null;
    versionLabel?: string | null;
  }>(
    'ia_create_report_version',
    (v) => ({
      p_report_id: v.reportId,
      p_content: v.content ?? {},
      p_change_summary: v.changeSummary ?? null,
      p_version_label: v.versionLabel ?? null,
    }),
    'Report version created',
  );
}

export function useIssueReport() {
  return useLifecycleCommand<{ reportId: string; notes?: string | null }>(
    'ia_issue_report',
    (v) => ({ p_report_id: v.reportId, p_notes: v.notes ?? null }),
    'Report issued',
  );
}

export function useReportVersions(reportId?: string) {
  return useQuery({
    queryKey: ['ia_report_versions', reportId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_report_versions')
        .select('*')
        .eq('report_id', reportId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
    enabled: !!reportId,
  });
}

/* ------------------------------------------------------------------ */
/* Closure readiness (Wave 2 evaluation)                               */
/* ------------------------------------------------------------------ */
export interface EngagementClosureReadiness {
  can_close: boolean;
  reasons: string[];
  checked_at?: string;
}

export function useEngagementClosureReadiness(engagementId?: string) {
  return useQuery({
    queryKey: ['ia_engagement_closure_gate_v2', engagementId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ia_evaluate_engagement_closure_v2', {
        p_engagement_id: engagementId,
      });
      if (error) throw error;
      const result = (data ?? {}) as any;
      return {
        can_close: !!result.can_close,
        reasons: Array.isArray(result.reasons) ? result.reasons : [],
        checked_at: result.checked_at,
      } as EngagementClosureReadiness;
    },
    enabled: !!engagementId,
  });
}
