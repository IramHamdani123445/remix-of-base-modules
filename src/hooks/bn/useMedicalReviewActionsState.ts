import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Authoritative dark-launch gate for Benefits Medical Reviews.
 *
 * The single source of truth is `app_modules.actions_enabled` for the
 * `bn_medical_review` module — the very flag the server-side commands assert.
 * No hard-coded constant, no build flag, no env var is consulted.
 *
 * Fails closed: loading, error, or a missing module row all yield
 * `actionsEnabled = false`, so the UI renders read-only rather than offering
 * controls that would be rejected server-side.
 */
export interface MedicalReviewActionsState {
  actionsEnabled: boolean;
  routesEnabled: boolean;
  moduleEnabled: boolean;
  rolloutState: string | null;
  isLoading: boolean;
  isError: boolean;
}

interface ModuleRow {
  is_enabled: boolean | null;
  routes_enabled: boolean | null;
  actions_enabled: boolean | null;
  rollout_state: string | null;
}

export const MEDICAL_REVIEW_MODULE_NAME = 'bn_medical_review';

export function useMedicalReviewActionsState(): MedicalReviewActionsState {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['bn-medical-review-actions-enabled'],
    queryFn: async (): Promise<ModuleRow | null> => {
      const { data, error } = await supabase
        .from('app_modules')
        .select('is_enabled,routes_enabled,actions_enabled,rollout_state')
        .eq('name', MEDICAL_REVIEW_MODULE_NAME)
        .maybeSingle();
      if (error) throw error;
      return (data as ModuleRow | null) ?? null;
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const settled = !isLoading && !isError && !!data;

  return {
    actionsEnabled: settled && data!.actions_enabled === true,
    routesEnabled: settled && data!.routes_enabled === true,
    moduleEnabled: settled && data!.is_enabled === true,
    rolloutState: settled ? data!.rollout_state : null,
    isLoading,
    isError,
  };
}

export function useMedicalReviewActionsEnabled(): boolean {
  return useMedicalReviewActionsState().actionsEnabled;
}
