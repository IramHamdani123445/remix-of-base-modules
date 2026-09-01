import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useIAPlanChangeLog(planId?: string) {
  return useQuery({
    queryKey: ['ia_plan_change_log', planId],
    queryFn: async () => {
      let q = supabase.from('ia_plan_change_log' as any).select('*').order('change_date', { ascending: false });
      if (planId) q = q.eq('plan_id', planId);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    enabled: !!planId,
  });
}

export function useIAPlanChangeLogMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const create = useMutation({
    mutationKey: ['InternalAudit', 'ia_plan_change_log', 'create'],
    mutationFn: async (entry: { plan_id: string; change_type: string; description: string; changed_by: string }) => {
      const { data, error } = await supabase.from('ia_plan_change_log' as any).insert(entry as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['ia_plan_change_log', variables.plan_id] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  return { create };
}

export function useIAPlanEngagements(planId?: string) {
  return useQuery({
    queryKey: ['ia_plan_engagements', planId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_audit_engagements' as any)
        .select('*')
        .eq('annual_plan_id', planId)
        .or('is_active.is.null,is_active.eq.true')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!planId,
  });
}
