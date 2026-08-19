/**
 * Bound RPC client for the governed In-App notification operations.
 *
 * Notification surfaces (Bell, Notification Center) consume this hook and pass
 * it to `inAppNotificationService`; they never call the browser Supabase client
 * directly for Omni-Comms engagement.
 */
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { InAppRpcClient } from '@/platform/omni-comms/application/inAppNotificationService';

export function useInAppNotificationRpcClient(): InAppRpcClient {
  return useMemo<InAppRpcClient>(
    () => ({
      rpc: async (fn, args) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).rpc(fn, args ?? {});
        return { data: res.data ?? null, error: res.error ?? null };
      },
    }),
    [],
  );
}
