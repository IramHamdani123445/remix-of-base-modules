import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface EngagementProgressStage {
  code: string;
  label: string;
  done: boolean;
  detail: string;
}

export interface EngagementProgress {
  found: boolean;
  execution_status?: string;
  stages: EngagementProgressStage[];
  completed_stages: number;
  total_stages: number;
  percent: number;
  counts: {
    activities: number;
    activities_completed: number;
    findings: number;
    findings_draft: number;
    responses: number;
    actions: number;
    actions_completed: number;
    recommendations: number;
    recommendations_without_action: number;
  };
}

/** Server-derived lifecycle progress for one department audit. */
export function useEngagementProgress(engagementId?: string) {
  return useQuery({
    queryKey: ['ia_engagement_progress', engagementId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ia_engagement_progress', {
        p_engagement_id: engagementId,
      });
      if (error) throw error;
      return data as EngagementProgress;
    },
    enabled: !!engagementId,
  });
}

export interface EngagementRecommendation {
  id: string;
  finding_id: string;
  recommendation_text: string | null;
  priority: string | null;
  responsible_party: string | null;
  status: string | null;
  suggested_target_date: string | null;
  official_target_date: string | null;
  finding_title?: string | null;
}

/** Recommendations raised against findings of this engagement. */
export function useEngagementRecommendations(engagementId?: string) {
  return useQuery({
    queryKey: ['ia_engagement_recommendations', engagementId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_recommendations')
        .select('*, ia_findings!inner(id, title, engagement_id)')
        .eq('ia_findings.engagement_id', engagementId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data as any[]) || []).map((r) => ({
        ...r,
        finding_title: r.ia_findings?.title ?? null,
      })) as EngagementRecommendation[];
    },
    enabled: !!engagementId,
  });
}

export function useCreateActionFromRecommendation() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_action_tracking', 'from_recommendation'],
    mutationFn: async (vars: {
      recommendationId: string;
      responsiblePerson?: string | null;
      targetDate?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)('ia_create_action_from_recommendation', {
        p_recommendation_id: vars.recommendationId,
        p_responsible_person: vars.responsiblePerson ?? null,
        p_target_date: vars.targetDate ?? null,
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) throw new Error(result?.error || 'Could not create the action.');
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia_action_tracking'] });
      qc.invalidateQueries({ queryKey: ['eng_actions'] });
      qc.invalidateQueries({ queryKey: ['ia_engagement_recommendations'] });
      qc.invalidateQueries({ queryKey: ['ia_engagement_progress'] });
      toast({ title: 'Action created', description: 'The recommendation is now tracked as an audit action.' });
    },
    onError: (e: any) =>
      toast({ title: 'Not created', description: e.message, variant: 'destructive' }),
  });
}

export function useLinkActionEvidence() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_action_tracking', 'link_evidence'],
    mutationFn: async (vars: { actionId: string; evidenceIds: string[] }) => {
      const { data, error } = await (supabase.rpc as any)('ia_link_action_evidence', {
        p_action_id: vars.actionId,
        p_evidence_ids: vars.evidenceIds,
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) throw new Error(result?.error || 'Could not link documents.');
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia_action_tracking'] });
      qc.invalidateQueries({ queryKey: ['eng_actions'] });
      toast({ title: 'Documents linked' });
    },
    onError: (e: any) =>
      toast({ title: 'Linking failed', description: e.message, variant: 'destructive' }),
  });
}
