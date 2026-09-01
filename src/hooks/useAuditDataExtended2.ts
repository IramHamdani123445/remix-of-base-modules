import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { notifyFindingCreated } from '@/services/auditNotificationService';

// ============= FINDINGS =============
export function useIAFindings(activityId?: string) {
  return useQuery({
    queryKey: ['ia_findings', activityId],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_findings' as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const result = data ?? [];
      return activityId ? result.filter((r: any) => r.activity_id === activityId) : result;
      return data ?? [];
    },
  });
}

export function useIAFindingMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Auto-generate corrective action when finding is created
  const autoCreateAction = async (finding: any) => {
    try {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + 30);
      await supabase.from('ia_action_tracking').insert({
        finding_id: finding.id,
        action_description: `Address finding: ${finding.title}`,
        responsible_person: null,
        target_date: targetDate.toISOString().split('T')[0],
        status: 'Not Started',
        // ADR-01: canonical spine is the engagement, not the legacy department audit.
        engagement_id: finding.engagement_id || null,
        created_by: finding.created_by || null,
      });
      // Also send notification if department_id is set
      if (finding.department_id) {
        await notifyFindingCreated(finding.title, finding.department_id);
      }
    } catch (err) {
      console.error('Auto corrective action generation failed:', err);
    }
  };

  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'delete'],
    mutationFn: async (f: any) => { const { data, error } = await supabase.from('ia_findings').insert(f).select().single(); if (error) throw error; return data; },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['ia_findings'] });
      queryClient.invalidateQueries({ queryKey: ['ia_action_tracking'] });
      toast({ title: 'Finding Created', description: 'A corrective action has been auto-generated.' });
      autoCreateAction(data);
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_findings').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_findings'] }); toast({ title: 'Finding Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const remove = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (id: string) => { const { error } = await supabase.from('ia_findings').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_findings'] }); toast({ title: 'Finding Deleted' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update, remove };
}

// ============= RECOMMENDATIONS =============
export function useIARecommendations(findingId?: string) {
  return useQuery({
    queryKey: ['ia_recommendations', findingId],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_recommendations' as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const result = data ?? [];
      return findingId ? result.filter((r: any) => r.finding_id === findingId) : result;
      return data ?? [];
    },
  });
}

export function useIARecommendationMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (rec: any) => { const { data, error } = await supabase.from('ia_recommendations').insert(rec).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_recommendations'] }); toast({ title: 'Recommendation Created' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_recommendations').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_recommendations'] }); toast({ title: 'Recommendation Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= MANAGEMENT RESPONSES =============
export function useIAManagementResponses(findingId?: string) {
  return useQuery({
    queryKey: ['ia_management_responses', findingId],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_management_responses' as any).select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const result = data ?? [];
      return findingId ? result.filter((r: any) => r.finding_id === findingId) : result;
      return data ?? [];
    },
  });
}

export function useIAManagementResponseMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (r: any) => { const { data, error } = await supabase.from('ia_management_responses').insert(r).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_management_responses'] }); toast({ title: 'Response Submitted' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_management_responses').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_management_responses'] }); toast({ title: 'Response Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= ACTION TRACKING =============
export function useIAActionTracking() {
  return useQuery({
    queryKey: ['ia_action_tracking'],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_action_tracking').select('*').order('target_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIAActionTrackingMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (a: any) => { const { data, error } = await supabase.from('ia_action_tracking').insert(a).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_action_tracking'] }); toast({ title: 'Action Created' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_action_tracking').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_action_tracking'] }); toast({ title: 'Action Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= FOLLOW-UPS =============
export function useIAFollowUps() {
  return useQuery({
    queryKey: ['ia_follow_ups'],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_follow_ups').select('*').order('due_date', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIAFollowUpMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (f: any) => { const { data, error } = await supabase.from('ia_follow_ups').insert(f).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_follow_ups'] }); toast({ title: 'Follow-Up Created' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_follow_ups').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_follow_ups'] }); toast({ title: 'Follow-Up Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= DOCUMENT TEMPLATES =============
export function useIADocumentTemplates(category?: string) {
  return useQuery({
    queryKey: ['ia_document_templates', category],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_document_templates' as any).select('*').eq('is_active', true).order('name');
      if (error) throw error;
      const result = data ?? [];
      return category ? result.filter((r: any) => r.category === category) : result;
      return data ?? [];
    },
  });
}

export function useIADocumentTemplateMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (t: any) => { const { data, error } = await supabase.from('ia_document_templates').insert(t).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_document_templates'] }); toast({ title: 'Template Created' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_document_templates').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_document_templates'] }); toast({ title: 'Template Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= COMMUNICATIONS =============
export function useIACommunications() {
  return useQuery({
    queryKey: ['ia_communications'],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_communications').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useIACommunicationMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'update'],
    mutationFn: async (c: any) => { const { data, error } = await supabase.from('ia_communications').insert(c).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_communications'] }); toast({ title: 'Communication Sent' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  const update = useMutation({
    mutationKey: ['InternalAudit', 'ia_findings', 'create'],
    mutationFn: async ({ id, ...u }: { id: string; [k: string]: any }) => { const { data, error } = await supabase.from('ia_communications').update(u).eq('id', id).select().single(); if (error) throw error; return data; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ia_communications'] }); toast({ title: 'Communication Updated' }); },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });
  return { create, update };
}

// ============= AUDITOR WORKLOAD (view) =============
export function useIAAuditorWorkload() {
  return useQuery({
    queryKey: ['ia_auditor_workload'],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await supabase.from('ia_auditor_workload').select('*').order('period_start', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}
