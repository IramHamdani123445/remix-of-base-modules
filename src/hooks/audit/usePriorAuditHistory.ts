import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Prior Audit History — auditor-private continuity workspace.
 *
 * Historical Corrective Actions are never cloned or re-parented. The current
 * engagement can only hold a *reference* to a prior action, created through
 * `ia_link_prior_action`.
 */

async function callRpc<T = any>(fn: any, args: any): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type PriorRelationshipType = 'PRIOR_ACTION_REVIEW' | 'REPEAT_FINDING' | 'FOLLOWUP_RETEST';

export interface PriorAuditHistory {
  success: boolean;
  code?: string;
  error?: string;
  engagement_id?: string;
  acknowledged_at?: string | null;
  acknowledged_by?: string | null;
  acknowledgement_note?: string | null;
  prior_audits?: Array<any>;
}

export interface PriorActionDetail {
  success: boolean;
  code?: string;
  error?: string;
  actions?: Array<any>;
}

export function usePriorAuditHistory(engagementId?: string, sameFunctionOnly = false) {
  return useQuery({
    queryKey: ['ia-prior-audit-history', engagementId, sameFunctionOnly],
    queryFn: () =>
      callRpc<PriorAuditHistory>('ia_prior_audit_history', {
        p_engagement_id: engagementId,
        p_same_function_only: sameFunctionOnly,
      }),
    enabled: !!engagementId,
    staleTime: 30_000,
  });
}

export function usePriorActionDetail(engagementId?: string, sameFunctionOnly = false) {
  return useQuery({
    queryKey: ['ia-prior-action-detail', engagementId, sameFunctionOnly],
    queryFn: () =>
      callRpc<PriorActionDetail>('ia_prior_action_detail', {
        p_engagement_id: engagementId,
        p_same_function_only: sameFunctionOnly,
      }),
    enabled: !!engagementId,
    staleTime: 30_000,
  });
}

export function usePriorAuditHistoryMutations(engagementId?: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ia-prior-audit-history', engagementId] });
    qc.invalidateQueries({ queryKey: ['ia-prior-action-detail', engagementId] });
  };

  const handle = (result: any, okMessage: string) => {
    if (!result?.success) {
      toast.error(result?.error || result?.code || 'The request was refused.');
      return false;
    }
    toast.success(okMessage);
    invalidate();
    return true;
  };

  const linkPriorAction = useMutation({
    mutationFn: (vars: {
      priorActionId: string;
      relationshipType?: PriorRelationshipType;
      relevanceReason?: string;
    }) =>
      callRpc('ia_link_prior_action', {
        p_engagement_id: engagementId,
        p_prior_action_id: vars.priorActionId,
        p_relationship_type: vars.relationshipType || 'PRIOR_ACTION_REVIEW',
        p_relevance_reason: vars.relevanceReason || null,
      }),
    onSuccess: (result) => handle(result, 'Prior corrective action referenced in this audit.'),
    onError: (e: any) => toast.error(e?.message || 'Could not reference the prior action.'),
  });

  const unlinkPriorAction = useMutation({
    mutationFn: (referenceId: string) => callRpc('ia_unlink_prior_action', { p_reference_id: referenceId }),
    onSuccess: (result) => handle(result, 'Reference removed.'),
    onError: (e: any) => toast.error(e?.message || 'Could not remove the reference.'),
  });

  const acknowledgeHistory = useMutation({
    mutationFn: (note?: string) =>
      callRpc('ia_acknowledge_prior_history', { p_engagement_id: engagementId, p_note: note || null }),
    onSuccess: (result) => handle(result, 'Prior Audit History reviewed.'),
    onError: (e: any) => toast.error(e?.message || 'Could not record the acknowledgement.'),
  });

  return { linkPriorAction, unlinkPriorAction, acknowledgeHistory };
}
