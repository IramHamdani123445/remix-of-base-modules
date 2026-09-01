import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface WorkbasketPermissionGap {
  assigned_role: string;
  basket_code: string;
  basket_name: string;
  missing_module: string;
  role_exists: boolean;
}

export const WORKBASKET_PERMISSION_GAP_KEY = ['bn', 'workbasket-permission-gaps'];

/**
 * Derived configuration check: every role named by an active bn_workbasket
 * must hold view access on bn_claim_queue and bn_claim_worklist.
 */
export function useWorkbasketPermissionGaps() {
  return useQuery({
    queryKey: WORKBASKET_PERMISSION_GAP_KEY,
    queryFn: async (): Promise<WorkbasketPermissionGap[]> => {
      const { data, error } = await (supabase as any).rpc('bn_workbasket_permission_gaps');
      if (error) throw error;
      return (data ?? []) as WorkbasketPermissionGap[];
    },
  });
}

export function useReconcileWorkbasketPermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('bn_sync_workbasket_queue_permissions');
      if (error) throw error;
      return (data ?? []) as { granted_role: string; granted_module: string; granted_action: string }[];
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: WORKBASKET_PERMISSION_GAP_KEY });
    },
  });
}
