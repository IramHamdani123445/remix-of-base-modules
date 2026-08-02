/**
 * Omni-Comms — bound transport for the controlled channel test delivery
 * Edge Function.
 *
 * Views MUST consume this hook rather than touching the browser Supabase
 * client directly. The function boundary is trusted: it holds the provider
 * credential, re-checks every safety condition in the database, and returns
 * only the bounded delivery evidence projection.
 */
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  OMNI_COMMS_TEST_DELIVERY_FUNCTION,
  type ChannelTestDeliveryTransport,
} from '@/platform/omni-comms/application/channelTestDeliveryService';

export function useChannelTestDeliveryTransport(): ChannelTestDeliveryTransport {
  return useMemo<ChannelTestDeliveryTransport>(
    () => ({
      invoke: async (body) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).functions.invoke(
          OMNI_COMMS_TEST_DELIVERY_FUNCTION,
          { body },
        );
        return { data: res.data ?? null, error: res.error ?? null };
      },
    }),
    [],
  );
}
