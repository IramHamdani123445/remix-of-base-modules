import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Internal Audit — Wave 3 read models, work queues and corrective-action commands.
 *
 * Every list on the Action Centre comes from a server-side read model that already
 * applies engagement access, respondent scope and the requested filters. Every state
 * change goes through a governed SECURITY DEFINER command that enforces its gate and
 * writes to the immutable `ia_audit_event` store.
 */

export interface IaFilters {
  plan_id?: string | null;
  engagement_id?: string | null;
  department_id?: string | null;
  function_id?: string | null;
  owner_profile_id?: string | null;
  finding_id?: string | null;
  severity?: string | null;
  status?: string | null;
  due_from?: string | null;
  due_to?: string | null;
  overdue?: boolean;
  due_soon?: boolean;
  open_only?: boolean;
  disputed?: boolean;
  response_outstanding?: boolean;
}

export interface IaCommandOutcome {
  success: boolean;
  code?: string;
  error?: string;
  reasons?: string[];
  [key: string]: unknown;
}

/** Strip empty values so the server treats them as "no filter". */
export function cleanFilters(filters: IaFilters = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(filters).forEach(([k, v]) => {
    if (v === null || v === undefined || v === '' || v === false || v === 'all') return;
    out[k] = v;
  });
  return out;
}

/** Legacy engagement links resolve to the canonical audit workspace URL. */
export function normalizeAuditLink(link?: string | null): string | undefined {
  if (!link) return undefined;
  return link.replace('/audit/engagements/', '/audit/audits/');
}

const ACTION_CENTRE_KEYS = [
  'ia_register_actions',
  'ia_register_findings',
  'ia_q_my_audit_work',
  'ia_q_management_actions',
  'ia_q_hia_attention',
  'ia_q_qa_queue',
  'ia_q_followup_queue',
  'ia_q_closure_blockers',
  'ia_q_plan_closure_readiness',
  'ia_q_action_centre_counts',
  'ia_action_tracking',
  'ia_action_progress_log',
  'ia_action_extensions',
  'ia_follow_ups',
  'ia_findings',
  'ia_audit_event',
];

async function callList(fn: string, params: Record<string, unknown> = {}): Promise<any[]> {
  const { data, error } = await (supabase.rpc as any)(fn, params);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

function useListQuery(fn: string, params: Record<string, unknown> = {}, enabled = true) {
  return useQuery({
    queryKey: [fn, params],
    queryFn: () => callList(fn, params),
    enabled,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Registers                                                           */
/* ------------------------------------------------------------------ */
export function useIaActionRegister(filters: IaFilters = {}) {
  return useListQuery('ia_register_actions', { p_filters: cleanFilters(filters) });
}

export function useIaFindingRegister(filters: IaFilters = {}) {
  return useListQuery('ia_register_findings', { p_filters: cleanFilters(filters) });
}

/* ------------------------------------------------------------------ */
/* Work queues                                                         */
/* ------------------------------------------------------------------ */
export function useIaMyAuditWork() {
  return useListQuery('ia_q_my_audit_work');
}

export function useIaManagementActionsQueue() {
  return useListQuery('ia_q_management_actions');
}

export function useIaHeadOfAuditAttention() {
  return useListQuery('ia_q_hia_attention');
}

export function useIaQualityReviewQueue() {
  return useListQuery('ia_q_qa_queue');
}

export function useIaFollowUpQueue(filters: IaFilters = {}) {
  return useListQuery('ia_q_followup_queue', { p_filters: cleanFilters(filters) });
}

export function useIaClosureBlockers(filters: IaFilters = {}) {
  return useListQuery('ia_q_closure_blockers', { p_filters: cleanFilters(filters) });
}

export function useIaPlanClosureReadiness(planId?: string | null) {
  return useListQuery('ia_q_plan_closure_readiness', { p_plan_id: planId }, !!planId);
}

export function useIaActionCentreCounts(filters: IaFilters = {}) {
  const params = { p_filters: cleanFilters(filters) };
  return useQuery({
    queryKey: ['ia_q_action_centre_counts', params],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ia_q_action_centre_counts', params);
      if (error) throw new Error(error.message);
      return (data ?? {}) as Record<string, any>;
    },
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/* Per-action capability probes                                        */
/* ------------------------------------------------------------------ */
export function useIaActionCapabilities(actionId?: string | null) {
  return useQuery({
    queryKey: ['ia_action_capabilities', actionId],
    enabled: !!actionId,
    queryFn: async () => {
      const [manage, verify] = await Promise.all([
        (supabase.rpc as any)('ia_action_can_manage', { p_action_id: actionId }),
        (supabase.rpc as any)('ia_action_can_verify', { p_action_id: actionId }),
      ]);
      return {
        canManage: !!manage?.data,
        canVerify: !!verify?.data,
      };
    },
  });
}

/* ------------------------------------------------------------------ */
/* Governed commands                                                   */
/* ------------------------------------------------------------------ */
function useActionCommand<TVars>(
  command: string,
  buildParams: (vars: TVars) => Record<string, unknown>,
  successTitle: string,
) {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'action-centre', command],
    mutationFn: async (vars: TVars): Promise<IaCommandOutcome> => {
      const { data, error } = await (supabase.rpc as any)(command, buildParams(vars));
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as IaCommandOutcome;
      if (!result.success) {
        const reasons = Array.isArray(result.reasons) ? result.reasons : [];
        throw new Error([result.error, ...reasons].filter(Boolean).join(' — ') || 'Command rejected');
      }
      return result;
    },
    onSuccess: () => {
      ACTION_CENTRE_KEYS.forEach(key => qc.invalidateQueries({ queryKey: [key] }));
      qc.invalidateQueries({ queryKey: ['ia_action_capabilities'] });
      toast({ title: successTitle });
    },
    onError: (err: Error) => {
      toast({ title: 'Not permitted', description: err.message, variant: 'destructive' });
    },
  });
}

export const useIaActionAssign = () =>
  useActionCommand<{
    actionId: string;
    responsibleProfileId?: string | null;
    accountableDepartmentId?: string | null;
    functionId?: string | null;
    targetDate?: string | null;
    description?: string | null;
  }>('ia_action_assign', v => ({
    p_action_id: v.actionId,
    p_responsible_profile_id: v.responsibleProfileId ?? null,
    p_accountable_department_id: v.accountableDepartmentId ?? null,
    p_function_id: v.functionId ?? null,
    p_target_date: v.targetDate ?? null,
    p_description: v.description ?? null,
  }), 'Action assigned');

export const useIaActionUpdateProgress = () =>
  useActionCommand<{ actionId: string; progressPct: number; note: string; evidenceIds?: string[] }>(
    'ia_action_update_progress',
    v => ({
      p_action_id: v.actionId,
      p_progress_pct: v.progressPct,
      p_note: v.note,
      p_evidence_ids: v.evidenceIds ?? null,
    }),
    'Progress recorded',
  );

export const useIaActionRequestExtension = () =>
  useActionCommand<{ actionId: string; proposedDate: string; reason: string }>(
    'ia_action_request_extension',
    v => ({ p_action_id: v.actionId, p_proposed_date: v.proposedDate, p_reason: v.reason }),
    'Extension requested',
  );

export const useIaActionDecideExtension = () =>
  useActionCommand<{ extensionId: string; decision: 'Approved' | 'Rejected'; comments?: string }>(
    'ia_action_decide_extension',
    v => ({ p_extension_id: v.extensionId, p_decision: v.decision, p_comments: v.comments ?? null }),
    'Extension decision recorded',
  );

export const useIaActionSubmitCompletion = () =>
  useActionCommand<{ actionId: string; note: string; evidenceIds?: string[] }>(
    'ia_action_submit_completion',
    v => ({ p_action_id: v.actionId, p_note: v.note, p_evidence_ids: v.evidenceIds ?? null }),
    'Completion submitted for verification',
  );

export const useIaActionStartVerification = () =>
  useActionCommand<{ actionId: string }>(
    'ia_action_start_verification',
    v => ({ p_action_id: v.actionId }),
    'Verification started',
  );

export const useIaActionVerify = () =>
  useActionCommand<{ actionId: string; notes: string }>(
    'ia_action_verify',
    v => ({ p_action_id: v.actionId, p_notes: v.notes }),
    'Action verified',
  );

export const useIaActionRejectVerification = () =>
  useActionCommand<{ actionId: string; reason: string; requestMoreEvidence?: boolean }>(
    'ia_action_reject_verification',
    v => ({
      p_action_id: v.actionId,
      p_reason: v.reason,
      p_request_more_evidence: !!v.requestMoreEvidence,
    }),
    'Action returned to management',
  );

export const useIaActionReopen = () =>
  useActionCommand<{ actionId: string; reason: string; newTargetDate?: string | null }>(
    'ia_action_reopen',
    v => ({ p_action_id: v.actionId, p_reason: v.reason, p_new_target_date: v.newTargetDate ?? null }),
    'Action reopened',
  );

export const useIaActionCancel = () =>
  useActionCommand<{ actionId: string; reason: string }>(
    'ia_action_cancel',
    v => ({ p_action_id: v.actionId, p_reason: v.reason }),
    'Action cancelled',
  );

export const useIaActionClose = () =>
  useActionCommand<{ actionId: string; closureNotes: string }>(
    'ia_action_close_v2',
    v => ({ p_action_id: v.actionId, p_closure_notes: v.closureNotes }),
    'Action closed',
  );

export const useIaFollowUpSchedule = () =>
  useActionCommand<{
    actionId: string;
    scheduledDate: string;
    followUpType?: string | null;
    notes?: string | null;
    fiscalYear?: string | null;
  }>('ia_followup_schedule', v => ({
    p_action_id: v.actionId,
    p_scheduled_date: v.scheduledDate,
    p_follow_up_type: v.followUpType ?? null,
    p_notes: v.notes ?? null,
    p_fiscal_year: v.fiscalYear ?? null,
  }), 'Follow-up scheduled');

export const useIaFollowUpRecordOutcome = () =>
  useActionCommand<{ followUpId: string; outcome: string; notes?: string | null }>(
    'ia_followup_record_outcome',
    v => ({ p_followup_id: v.followUpId, p_outcome: v.outcome, p_notes: v.notes ?? null }),
    'Follow-up outcome recorded',
  );

/* ------------------------------------------------------------------ */
/* Action history                                                      */
/* ------------------------------------------------------------------ */
export function useIaActionHistory(actionId?: string | null) {
  return useQuery({
    queryKey: ['ia_action_progress_log', actionId],
    enabled: !!actionId,
    queryFn: async () => {
      const [progress, extensions] = await Promise.all([
        (supabase.from as any)('ia_action_progress_log')
          .select('*')
          .eq('action_id', actionId)
          .order('created_at', { ascending: false }),
        (supabase.from as any)('ia_action_extensions')
          .select('*')
          .eq('action_id', actionId)
          .order('created_at', { ascending: false }),
      ]);
      return {
        progress: (progress?.data ?? []) as any[],
        extensions: (extensions?.data ?? []) as any[],
      };
    },
  });
}
