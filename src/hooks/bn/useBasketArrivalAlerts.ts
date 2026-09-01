/**
 * Unread "a claim arrived in your basket" alerts for the signed-in user.
 *
 * The alerts themselves are written by the database trigger
 * `zz_bn_claim_queue_assignment_notify` when a claim is routed into a basket,
 * so the queue only has to read and clear them.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

const db = supabase as any;

export const BN_WORKBASKET_ARRIVAL = 'BN_WORKBASKET_ARRIVAL';

/** basket id → number of unread arrival alerts. */
export type BasketArrivalCounts = Record<string, number>;

export function useBasketArrivalAlerts(basketIds: string[]) {
  const { user } = useSupabaseAuth();
  const key = [...basketIds].sort().join(',');

  return useQuery({
    queryKey: ['bn', 'basket-arrival-alerts', user?.id, key],
    enabled: !!user?.id && basketIds.length > 0,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<BasketArrivalCounts> => {
      const { data, error } = await db
        .from('in_app_notifications')
        .select('metadata')
        .eq('user_id', user!.id)
        .eq('notification_type', BN_WORKBASKET_ARRIVAL)
        .eq('is_read', false)
        .limit(500);
      if (error) throw error;

      const counts: BasketArrivalCounts = {};
      for (const row of (data || []) as Array<{ metadata: any }>) {
        const basketId = row?.metadata?.workbasket_id;
        if (typeof basketId === 'string' && basketIds.includes(basketId)) {
          counts[basketId] = (counts[basketId] ?? 0) + 1;
        }
      }
      return counts;
    },
  });
}

/** Clear the arrival alerts for one basket once the user opens it. */
export function useClearBasketArrivalAlerts() {
  const { user } = useSupabaseAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (workbasketId: string) => {
      if (!user?.id || !workbasketId) return;
      const { error } = await db
        .from('in_app_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('notification_type', BN_WORKBASKET_ARRIVAL)
        .eq('is_read', false)
        .contains('metadata', { workbasket_id: workbasketId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bn', 'basket-arrival-alerts'] });
      queryClient.invalidateQueries({ queryKey: ['in-app-notifications'] });
    },
  });
}
