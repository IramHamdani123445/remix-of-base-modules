import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ClosureBlocker {
  code: string;
  message: string;
  count?: number;
}

export interface EngagementClosureGate {
  found: boolean;
  execution_status?: string;
  can_close: boolean;
  blockers: ClosureBlocker[];
  open_actions: number;
  open_follow_ups: number;
  suggested_disposition: 'Closed' | 'Closed – Actions Pending';
}

export interface PlanClosureEngagement {
  engagement_id: string;
  engagement_code: string | null;
  engagement_name: string | null;
  execution_status: string;
  status: string | null;
  disposition_required: boolean;
  untouched: boolean;
}

export interface PlanClosureGate {
  found: boolean;
  plan_status?: string;
  already_closed?: boolean;
  can_close: boolean;
  pending_count: number;
  engagements: PlanClosureEngagement[];
}

export type PlanDispositionInput = {
  engagement_id: string;
  disposition: 'Cancelled' | 'Carried Forward';
  reason: string;
};

/** Server-evaluated closure gate for a single department audit (engagement). */
export function useEngagementClosureGate(engagementId?: string) {
  return useQuery({
    queryKey: ['ia_engagement_closure_gate', engagementId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ia_evaluate_engagement_closure', {
        p_engagement_id: engagementId,
      });
      if (error) throw error;
      return data as EngagementClosureGate;
    },
    enabled: !!engagementId,
  });
}

export function useCloseEngagement() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_audit_engagements', 'close'],
    mutationFn: async (vars: {
      engagementId: string;
      disposition: 'Closed' | 'Closed – Actions Pending';
      finalRating?: string | null;
      notes?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)('ia_close_engagement', {
        p_engagement_id: vars.engagementId,
        p_disposition: vars.disposition,
        p_final_rating: vars.finalRating ?? null,
        p_notes: vars.notes ?? null,
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) {
        const detail: string[] = (result?.blockers || []).map((b: ClosureBlocker) => b.message);
        throw new Error([result?.error, ...detail].filter(Boolean).join(' — '));
      }
      return result;
    },
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ['ia_engagement_closure_gate'] });
      qc.invalidateQueries({ queryKey: ['ia_audit_engagements'] });
      qc.invalidateQueries({ queryKey: ['ia_department_audits'] });
      toast({ title: 'Audit closed', description: `Disposition: ${result.disposition}` });
    },
    onError: (e: any) =>
      toast({ title: 'Closure blocked', description: e.message, variant: 'destructive' }),
  });
}

/** Server-evaluated closure gate for an annual plan. */
export function usePlanClosureGate(planId?: string) {
  return useQuery({
    queryKey: ['ia_plan_closure_gate', planId],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ia_evaluate_plan_closure', {
        p_plan_id: planId,
      });
      if (error) throw error;
      return data as PlanClosureGate;
    },
    enabled: !!planId,
  });
}

export function useCloseAnnualPlan() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationKey: ['InternalAudit', 'ia_annual_plans', 'close'],
    mutationFn: async (vars: {
      planId: string;
      dispositions: PlanDispositionInput[];
      notes?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)('ia_close_annual_plan', {
        p_plan_id: vars.planId,
        p_dispositions: vars.dispositions,
        p_notes: vars.notes ?? null,
      });
      if (error) throw error;
      const result = data as any;
      if (!result?.success) {
        const detail: string[] = (result?.issues || []).map((i: any) => i.message);
        throw new Error([result?.error, ...detail].filter(Boolean).join(' — '));
      }
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia_plan_closure_gate'] });
      qc.invalidateQueries({ queryKey: ['ia_annual_plans'] });
      qc.invalidateQueries({ queryKey: ['ia_audit_engagements'] });
      toast({ title: 'Annual plan closed' });
    },
    onError: (e: any) =>
      toast({ title: 'Plan closure blocked', description: e.message, variant: 'destructive' }),
  });
}
