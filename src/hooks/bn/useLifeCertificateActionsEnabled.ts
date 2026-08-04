import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Dark-launch gate for Life Certificates.
 *
 * The authoritative flag is `app_modules.actions_enabled` for the
 * `bn_life_certificate` module — the same flag the server commands check.
 * The UI mirrors it so actions render disabled rather than failing server-side.
 * Fails closed: any error or missing row means actions stay disabled.
 */
export interface LifeCertificateActionsState {
  /** Authoritative: true only when the module row says actions are enabled. */
  actionsEnabled: boolean;
  isLoading: boolean;
  isError: boolean;
}

export function useLifeCertificateActionsState(): LifeCertificateActionsState {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bn-life-certificate-actions-enabled'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_modules')
        .select('actions_enabled')
        .eq('name', 'bn_life_certificate')
        .maybeSingle();
      if (error) throw error;
      return Boolean((data as { actions_enabled?: boolean } | null)?.actions_enabled);
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  return {
    // Fail closed while loading or on error.
    actionsEnabled: data === true && !isLoading && !isError,
    isLoading,
    isError,
  };
}

export function useLifeCertificateActionsEnabled(): boolean {
  return useLifeCertificateActionsState().actionsEnabled;
}
