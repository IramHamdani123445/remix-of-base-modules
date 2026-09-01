import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Internal Audit — DEF-1 governed escalation identity.
 *
 * Office holders (Head of Internal Audit, Department Heads) are never guessed.
 * They are explicitly designated through a maker-checker register and resolved
 * point-in-time by `ia_resolve_escalation_recipient`. When a required escalation
 * role cannot be resolved the scheduler records explicit evidence instead of
 * silently omitting the recipient — those rows are surfaced here.
 */

export interface OfficeHolderRow {
  id: string;
  function_code: string;
  scope_type: string;
  department_id: string | null;
  profile_id: string;
  is_primary: boolean;
  effective_from: string;
  effective_to: string | null;
  status: string;
  reason: string | null;
  assigned_by: string | null;
  assigned_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  revoked_by: string | null;
  revoked_at: string | null;
  fixture_tag: string | null;
}

export interface UnresolvedRoleRow {
  id: string;
  run_at: string;
  run_id: string | null;
  event_code: string | null;
  entity_type: string | null;
  entity_id: string | null;
  occurrence: string | null;
  required_role: string | null;
  outcome: string | null;
  reason: string | null;
  resolution_source: string | null;
  department_id: string | null;
  engagement_id: string | null;
}

const KEY = ['ia', 'escalation-roles'] as const;

export function useOfficeHolders() {
  return useQuery({
    queryKey: [...KEY, 'register'],
    queryFn: async (): Promise<OfficeHolderRow[]> => {
      const { data, error } = await supabase
        .from('ia_office_holder')
        .select('*')
        .order('function_code', { ascending: true })
        .order('effective_from', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as OfficeHolderRow[];
    },
  });
}

export function useOfficeHolderHealth(asOf?: string) {
  return useQuery({
    queryKey: [...KEY, 'health', asOf ?? 'today'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ia_office_holder_health', {
        p_as_of: asOf ?? new Date().toISOString().slice(0, 10),
      } as never);
      if (error) throw error;
      return data as unknown as Record<string, unknown>;
    },
  });
}

/** Explicit unresolved-role evidence produced by the reminder/escalation scheduler. */
export function useUnresolvedEscalationRoles(limit = 200) {
  return useQuery({
    queryKey: [...KEY, 'unresolved', limit],
    queryFn: async (): Promise<UnresolvedRoleRow[]> => {
      const { data, error } = await supabase
        .from('ia_comms_reminder_run_log')
        .select('id, run_at, run_id, event_code, entity_type, entity_id, occurrence, required_role, outcome, reason, resolution_source, department_id, engagement_id')
        .eq('outcome', 'escalation_role_unresolved')
        .order('run_at', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as unknown as UnresolvedRoleRow[];
    },
  });
}

export function useEscalationProfiles() {
  return useQuery({
    queryKey: [...KEY, 'profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, email, is_active')
        .order('full_name', { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data || []) as Array<{ id: string; full_name: string | null; email: string | null; is_active: boolean | null }>;
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: KEY });
}

export function useProposeOfficeHolder() {
  const { toast } = useToast();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: {
      function_code: string;
      profile_id: string;
      department_id?: string | null;
      effective_from: string;
      effective_to?: string | null;
      reason: string;
      is_primary?: boolean;
    }) => {
      const { data, error } = await supabase.rpc('ia_office_holder_propose', {
        p_function_code: input.function_code,
        p_profile_id: input.profile_id,
        p_department_id: input.department_id ?? null,
        p_effective_from: input.effective_from,
        p_effective_to: input.effective_to ?? null,
        p_reason: input.reason,
        p_is_primary: input.is_primary ?? true,
        p_fixture_tag: null,
      } as never);
      if (error) throw error;
      return data as unknown as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Designation proposed', description: 'A second authorised officer must approve it before it takes effect.' });
    },
    onError: (e: Error) => toast({ title: 'Could not propose designation', description: e.message, variant: 'destructive' }),
  });
}

export function useApproveOfficeHolder() {
  const { toast } = useToast();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { data, error } = await supabase.rpc('ia_office_holder_approve', {
        p_id: input.id,
        p_reason: input.reason,
      } as never);
      if (error) throw error;
      return data as unknown as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Designation approved', description: 'Escalations now resolve to this office holder.' });
    },
    onError: (e: Error) => toast({ title: 'Could not approve designation', description: e.message, variant: 'destructive' }),
  });
}

export function useRevokeOfficeHolder() {
  const { toast } = useToast();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string; effective_to?: string | null }) => {
      const { data, error } = await supabase.rpc('ia_office_holder_revoke', {
        p_id: input.id,
        p_reason: input.reason,
        p_effective_to: input.effective_to ?? null,
      } as never);
      if (error) throw error;
      return data as unknown as Record<string, unknown>;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Designation revoked', description: 'Escalations for this role will report as unresolved until a new holder is designated.' });
    },
    onError: (e: Error) => toast({ title: 'Could not revoke designation', description: e.message, variant: 'destructive' }),
  });
}
