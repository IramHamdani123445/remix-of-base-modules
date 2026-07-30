/**
 * Shared Omni-Comms RPC invocation helper.
 *
 * Normalises PostgREST errors raised by the SECURITY DEFINER RPCs into the
 * canonical OmniCommsRpcError shape used across the admin surface.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import {
  OMNI_COMMS_ERROR_CODES,
  OmniCommsErrorCode,
  OmniCommsRpcError,
} from './eventCatalogueTypes';

export function parseOmniCommsError(
  raw: { message?: string; details?: string; code?: string } | null,
): OmniCommsRpcError {
  const msg = raw?.message ?? '';
  const codeMatch = msg.match(/\bOC(\d{3})\b/);
  const code = (codeMatch ? `OC${codeMatch[1]}` : 'OC500') as OmniCommsErrorCode;
  const detail = raw?.details ?? (msg.replace(/^OC\d{3}\s*/, '').trim() || undefined);
  return new OmniCommsRpcError(
    OMNI_COMMS_ERROR_CODES.includes(code) ? code : 'OC500',
    detail,
    msg || undefined,
  );
}

export async function callOmniCommsRpc<T>(
  client: OmniCommsRpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw parseOmniCommsError(error);
  return data as T;
}
