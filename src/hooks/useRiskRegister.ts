import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuditFields } from '@/hooks/useAuditTrail';

export const RISK_CATEGORIES = ['Operational', 'Financial', 'Compliance', 'IT', 'Strategic', 'Reputational'] as const;
export const RISK_STATUSES = ['Open', 'Mitigating', 'Under Review', 'Closed', 'Accepted'] as const;
export const CONTROL_EFFECTIVENESS = ['Strong', 'Moderate', 'Weak', 'None'] as const;
export const MITIGATION_STATUSES = ['Planned', 'In Progress', 'Completed', 'Overdue', 'Cancelled'] as const;
export const MITIGATION_PRIORITIES = ['High', 'Medium', 'Low'] as const;
export const RISK_SOURCES = ['Previous Audit', 'Self-Assessment', 'External Review', 'Regulatory', 'Risk Workshop', 'Management Referral', 'Other'] as const;

// Risk scoring delegated to centralized engine — use the hook for live config
export { calculateRiskLevel, getRiskLevelVariant } from '@/lib/audit/riskEngine';
import { calculateScore, getRiskRating } from '@/lib/audit/riskEngine';
import { useRiskRatingCalculator } from '@/hooks/useRiskConfig';

// ============= RISK REGISTER =============
export function useRiskRegister(filters?: { department_id?: string; status?: string; category?: string }) {
  return useQuery({
    queryKey: ['ia_risk_register', filters],
    queryFn: async () => {
      let query = supabase
        .from('ia_risk_register' as any)
        .select('*, ia_departments!left(id, name, office_code)')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (filters?.department_id) query = query.eq('department_id', filters.department_id);
      if (filters?.status) query = query.eq('status', filters.status);
      if (filters?.category) query = query.eq('risk_category', filters.category);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useRiskRegisterMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getCreateFields, getUpdateFields, userCode } = useAuditFields();
  const { calculateScore: calcScore, getRiskRating: getRating } = useRiskRatingCalculator();

  /** Compute score + level using centralized engine config */
  const computeScoreAndLevel = (likelihood: number, impact: number) => {
    const score = calcScore(likelihood, impact);
    const rating = getRating(score);
    return { score, level: rating.label };
  };

  const create = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_register', 'create'],
    mutationFn: async (risk: any) => {
      const sanitized = Object.fromEntries(
        Object.entries(risk).map(([k, v]) => [k, v === '' ? null : v])
      );

      // If caller provides override fields, honour them; otherwise compute
      const isOverride = !!sanitized.is_score_overridden;
      let scoreFields: Record<string, any>;

      if (isOverride) {
        // Manual override — require justification
        if (!sanitized.override_justification) {
          throw new Error('Override justification is required when manually overriding risk scores.');
        }
        scoreFields = {
          inherent_risk_score: sanitized.inherent_risk_score,
          inherent_risk_level: sanitized.inherent_risk_level,
          residual_risk_score: sanitized.residual_risk_score,
          residual_risk_level: sanitized.residual_risk_level,
          is_score_overridden: true,
          override_justification: sanitized.override_justification,
          override_by: userCode || 'SYSTEM',
          override_at: new Date().toISOString(),
          override_approved_by: null,
          override_approved_at: null,
        };
      } else {
        const inherent = computeScoreAndLevel(Number(sanitized.inherent_likelihood) || 0, Number(sanitized.inherent_impact) || 0);
        const residual = computeScoreAndLevel(Number(sanitized.residual_likelihood) || 0, Number(sanitized.residual_impact) || 0);
        scoreFields = {
          inherent_risk_score: inherent.score,
          inherent_risk_level: inherent.level,
          residual_risk_score: residual.score,
          residual_risk_level: residual.level,
          is_score_overridden: false,
        };
      }

      const { data, error } = await supabase
        .from('ia_risk_register' as any)
        .insert({ ...sanitized, ...scoreFields, ...getCreateFields() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_register'] });
      toast({ title: 'Risk Created', description: 'Risk register entry added.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const update = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_register', 'update'],
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const sanitized = Object.fromEntries(
        Object.entries(updates).map(([k, v]) => [k, v === '' ? null : v])
      );

      const isOverride = !!sanitized.is_score_overridden;
      let scoreFields: Record<string, any>;

      if (isOverride) {
        if (!sanitized.override_justification) {
          throw new Error('Override justification is required when manually overriding risk scores.');
        }
        scoreFields = {
          inherent_risk_score: sanitized.inherent_risk_score,
          inherent_risk_level: sanitized.inherent_risk_level,
          residual_risk_score: sanitized.residual_risk_score,
          residual_risk_level: sanitized.residual_risk_level,
          is_score_overridden: true,
          override_justification: sanitized.override_justification,
          override_by: userCode || 'SYSTEM',
          override_at: new Date().toISOString(),
          // Approval is NOT auto-granted — must be set separately
          override_approved_by: sanitized.override_approved_by || null,
          override_approved_at: sanitized.override_approved_at || null,
        };
      } else {
        const inherent = computeScoreAndLevel(sanitized.inherent_likelihood || 0, sanitized.inherent_impact || 0);
        const residual = computeScoreAndLevel(sanitized.residual_likelihood || 0, sanitized.residual_impact || 0);
        scoreFields = {
          inherent_risk_score: inherent.score,
          inherent_risk_level: inherent.level,
          residual_risk_score: residual.score,
          residual_risk_level: residual.level,
          is_score_overridden: false,
          override_justification: null,
          override_by: null,
          override_at: null,
          override_approved_by: null,
          override_approved_at: null,
        };
      }

      const { data, error } = await supabase
        .from('ia_risk_register' as any)
        .update({ ...sanitized, ...scoreFields, ...getUpdateFields() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_register'] });
      toast({ title: 'Risk Updated', description: 'Risk register entry updated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const remove = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_register', 'delete'],
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('ia_risk_register' as any)
        .update({ is_active: false, ...getUpdateFields() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_register'] });
      toast({ title: 'Risk Removed', description: 'Risk has been deactivated.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  /** Approve a pending score override */
  const approveOverride = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_register', 'approve_override'],
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from('ia_risk_register' as any)
        .update({
          override_approved_by: userCode || 'SYSTEM',
          override_approved_at: new Date().toISOString(),
          ...getUpdateFields(),
        })
        .eq('id', id)
        .eq('is_score_overridden', true)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_register'] });
      toast({ title: 'Override Approved', description: 'Risk score override has been approved.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  /** Reject/clear an override — recalculates using engine */
  const rejectOverride = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_register', 'reject_override'],
    mutationFn: async ({ id, currentRisk }: { id: string; currentRisk: any }) => {
      const inherent = computeScoreAndLevel(currentRisk.inherent_likelihood || 0, currentRisk.inherent_impact || 0);
      const residual = computeScoreAndLevel(currentRisk.residual_likelihood || 0, currentRisk.residual_impact || 0);
      const { data, error } = await supabase
        .from('ia_risk_register' as any)
        .update({
          inherent_risk_score: inherent.score,
          inherent_risk_level: inherent.level,
          residual_risk_score: residual.score,
          residual_risk_level: residual.level,
          is_score_overridden: false,
          override_justification: null,
          override_by: null,
          override_at: null,
          override_approved_by: null,
          override_approved_at: null,
          ...getUpdateFields(),
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_register'] });
      toast({ title: 'Override Rejected', description: 'Risk score recalculated using standard formula.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return { create, update, remove, approveOverride, rejectOverride };
}

// ============= MITIGATION ACTIONS =============
export function useRiskMitigationActions(riskId?: string) {
  return useQuery({
    queryKey: ['ia_risk_mitigation_actions', riskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_risk_mitigation_actions' as any)
        .select('*')
        .eq('risk_id', riskId!)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!riskId,
  });
}

export function useRiskMitigationMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getCreateFields, getUpdateFields } = useAuditFields();

  const create = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_mitigation_actions', 'create'],
    mutationFn: async (action: any) => {
      const { data, error } = await supabase
        .from('ia_risk_mitigation_actions' as any)
        .insert({ ...action, ...getCreateFields() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_mitigation_actions'] });
      toast({ title: 'Action Created', description: 'Mitigation action added.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  const update = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_mitigation_actions', 'update'],
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { data, error } = await supabase
        .from('ia_risk_mitigation_actions' as any)
        .update({ ...updates, ...getUpdateFields() })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_mitigation_actions'] });
      toast({ title: 'Action Updated' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return { create, update };
}

// ============= RISK REVIEWS =============
export function useRiskReviews(riskId?: string) {
  return useQuery({
    queryKey: ['ia_risk_reviews', riskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ia_risk_reviews' as any)
        .select('*')
        .eq('risk_id', riskId!)
        .order('review_date', { ascending: false });
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!riskId,
  });
}

export function useRiskReviewMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getCreateFields } = useAuditFields();

  const create = useMutation({
    mutationKey: ['Internal Audit', 'ia_risk_reviews', 'risk_reviewed'],
    mutationFn: async (review: any) => {
      const { data, error } = await supabase
        .from('ia_risk_reviews' as any)
        .insert({ ...review, ...getCreateFields() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_risk_reviews'] });
      toast({ title: 'Review Recorded', description: 'Risk review added to timeline.' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return { create };
}

// ============= DUPLICATE CHECK =============
export function useDuplicateRiskCheck(departmentId?: string, riskTitle?: string, riskCategory?: string) {
  return useQuery({
    queryKey: ['ia_risk_register_dupes', departmentId, riskTitle, riskCategory],
    queryFn: async () => {
      if (!departmentId || !riskTitle || riskTitle.length < 3) return [];
      const { data, error } = await supabase
        .from('ia_risk_register' as any)
        .select('id, risk_title, risk_category, status, inherent_risk_score')
        .eq('department_id', departmentId)
        .eq('is_active', true)
        .ilike('risk_title', `%${riskTitle}%`);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!departmentId && !!riskTitle && riskTitle.length >= 3,
  });
}

// ============= MITIGATION TEMPLATES =============
export function useMitigationTemplates(category?: string) {
  return useQuery({
    queryKey: ['ia_mitigation_templates', category],
    queryFn: async () => {
      let query = supabase
        .from('ia_mitigation_templates' as any)
        .select('*')
        .eq('is_active', true)
        .order('template_name');
      if (category) query = query.eq('category', category);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });
}

export function useMitigationTemplateMutations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { getCreateFields, getUpdateFields } = useAuditFields();

  const create = useMutation({
    mutationFn: async (tpl: any) => {
      const { data, error } = await supabase
        .from('ia_mitigation_templates' as any)
        .insert({ ...tpl, ...getCreateFields() })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ia_mitigation_templates'] });
      toast({ title: 'Template Created' });
    },
    onError: (err: any) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  return { create };
}
