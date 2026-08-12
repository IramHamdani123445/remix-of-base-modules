/**
 * Omni-Comms — bound transport for the canonical dispatcher.
 *
 * The dispatcher is the ONLY component that contacts the Email provider. This
 * hook merely carries an operator-initiated tick; it decides nothing. Every
 * authorisation, scope, release check and limit is enforced server-side, and
 * the batch limit is fixed at one message.
 */
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

export const OMNI_COMMS_DISPATCH_FUNCTION = 'omni-comms-dispatch';

export interface OmniCommsDispatchTransport {
  releaseOneMessage: (
    correlationId?: string | null,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

export function useOmniCommsDispatchTransport(): OmniCommsDispatchTransport {
  return useMemo<OmniCommsDispatchTransport>(
    () => ({
      releaseOneMessage: async (correlationId) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).functions.invoke(OMNI_COMMS_DISPATCH_FUNCTION, {
          body: { batchLimit: 1, ...(correlationId ? { correlationId } : {}) },
        });
        return { data: res.data ?? null, error: res.error ?? null };
      },
    }),
    [],
  );
}
