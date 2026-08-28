import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

/**
 * Persona classification for Internal Audit screens.
 *
 * Audit-team personas are those linked to an `ia_auditors` record (HIA, Lead
 * Auditor, Auditor, Quality Reviewer) plus platform admins. Everyone else that
 * can reach Internal Audit screens is a management respondent and must only see
 * management-facing surfaces (DEF-S1B-33 / DEF-S1B-34).
 */
export interface InternalAuditPersona {
  isLoading: boolean;
  isAdmin: boolean;
  isAuditTeam: boolean;
  isManagementOnly: boolean;
  auditorId: string | null;
  auditorRole: string | null;
}

export function useInternalAuditPersona(): InternalAuditPersona {
  const { user, isAdmin, isLoading: authLoading } = useSupabaseAuth();

  const { data, isLoading } = useQuery({
    queryKey: ['internal-audit-persona', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('ia_auditors')
        .select('id, role')
        .eq('profile_id', user.id)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const loading = authLoading || isLoading;
  const isAuditTeam = isAdmin || !!data?.id;

  return {
    isLoading: loading,
    isAdmin,
    isAuditTeam,
    isManagementOnly: !loading && !isAuditTeam,
    auditorId: data?.id ?? null,
    auditorRole: (data as any)?.role ?? null,
  };
}
