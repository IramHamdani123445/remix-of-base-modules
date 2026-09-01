/**
 * Hooks for the Omni-Comms "My Communications" user inbox.
 *
 * Lives outside `src/platform/omni-comms/` because the realtime subscription
 * must name the `in_app_notifications` projection table, which the Omni
 * architecture boundary forbids inside the new-system roots. All data access
 * itself is still governed: reads go through the `auth.uid()`-scoped RPCs and
 * the realtime channel is only used as an invalidation signal.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { useInAppNotificationRpcClient } from '@/platform/omni-comms/admin/hooks/useInAppNotificationRpcClient';
import {
  fetchMyCommunications,
  fetchMyUnreadCount,
  type MyCommunicationsPage,
} from '@/platform/omni-comms/application/myCommunicationsService';

export const MY_COMMUNICATIONS_KEY = 'omni-my-communications';
export const MY_COMMUNICATIONS_UNREAD_KEY = 'omni-my-communications-unread';

/** Keeps the inbox and the badge in step with delivered communications. */
export function useMyCommunicationsRealtime(): void {
  const { user } = useSupabaseAuth();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user?.id) return;

    const invalidate = () => {
      queryClient.invalidateQueries({ queryKey: [MY_COMMUNICATIONS_UNREAD_KEY, user.id] });
      queryClient.invalidateQueries({ queryKey: [MY_COMMUNICATIONS_KEY, user.id] });
    };

    const channel = supabase
      .channel(`my-communications:${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'in_app_notifications',
          filter: `user_id=eq.${user.id}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, queryClient]);
}

/** Authoritative unread Omni communication count for the signed-in user. */
export function useMyCommunicationsUnreadCount() {
  const { user, isAuthenticated } = useSupabaseAuth();
  const rpcClient = useInAppNotificationRpcClient();
  useMyCommunicationsRealtime();

  return useQuery({
    queryKey: [MY_COMMUNICATIONS_UNREAD_KEY, user?.id],
    queryFn: () => fetchMyUnreadCount(rpcClient),
    enabled: Boolean(isAuthenticated && user?.id),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
}

/** One page of the signed-in user's Omni communications. */
export function useMyCommunications(options: {
  page: number;
  pageSize: number;
  unreadOnly: boolean;
}) {
  const { user, isAuthenticated } = useSupabaseAuth();
  const rpcClient = useInAppNotificationRpcClient();
  useMyCommunicationsRealtime();

  return useQuery<MyCommunicationsPage>({
    queryKey: [
      MY_COMMUNICATIONS_KEY,
      user?.id,
      options.page,
      options.pageSize,
      options.unreadOnly,
    ],
    queryFn: () =>
      fetchMyCommunications(rpcClient, {
        limit: options.pageSize,
        offset: options.page * options.pageSize,
        unreadOnly: options.unreadOnly,
      }),
    enabled: Boolean(isAuthenticated && user?.id),
    placeholderData: (previous) => previous,
  });
}
