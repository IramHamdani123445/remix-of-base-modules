/**
 * Omni-Comms C6 — bound transport for the trusted Release Control Edge
 * boundary.
 *
 * Views MUST consume this hook rather than touching the browser Supabase
 * client directly. The Edge boundary performs approval and activation only;
 * it sends nothing and contacts no provider.
 */
import { useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RELEASE_CONTROL_EDGE_FUNCTION } from '@/platform/omni-comms/application/channelReleaseControlService';

export interface ChannelReleaseControlTransport {
  invoke: (
    body: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string; status?: number } | null }>;
}

interface FunctionErrorContext {
  status?: number;
  clone?: () => Response;
  json?: () => Promise<unknown>;
}

async function releaseControlError(
  error: { message?: string; context?: FunctionErrorContext } | null,
): Promise<{ message?: string; code?: string; status?: number } | null> {
  if (!error) return null;

  const context = error.context;
  try {
    const response = context?.clone?.() ?? context;
    const payload = await response?.json?.() as { error?: string; detail?: string } | undefined;
    const code = payload?.error;
    const message = payload?.detail
      ? `${code ?? 'release_control_failed'}: ${payload.detail}`
      : code ?? error.message;
    return { message, code, status: context?.status };
  } catch {
    return { message: error.message, status: context?.status };
  }
}

export function useChannelReleaseControlTransport(): ChannelReleaseControlTransport {
  return useMemo<ChannelReleaseControlTransport>(
    () => ({
      invoke: async (body) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await (supabase as any).functions.invoke(RELEASE_CONTROL_EDGE_FUNCTION, {
          body,
        });
        return {
          data: res.data ?? null,
          error: await releaseControlError(res.error ?? null),
        };
      },
    }),
    [],
  );
}
