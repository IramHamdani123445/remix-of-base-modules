/**
 * Neutral Omni-Comms RPC error model — shared by every catalogue adapter
 * (event, template, and future catalogues). Contains no catalogue-specific
 * coupling: only the transport convention (SQLSTATE P0001 + "OC### ..." message
 * prefix + DETAIL slug) and the shared error class.
 */

/** All controlled Omni-Comms RPC error codes across catalogues. */
export const OMNI_COMMS_ERROR_CODES = [
  'OC401', // authentication_required
  'OC403', // permission_denied
  'OC404', // not_found
  'OC409', // conflict (duplicate identity, publication race, etc.)
  'OC410', // duplicate_contract_version (event catalogue specific slug)
  'OC412', // invalid_state (lifecycle transition rejected)
  'OC413', // concurrent_update (optimistic concurrency)
  'OC422', // validation_error (generic; DETAIL slug carries specifics)
  'OC450', // audit_write_failed
  'OC500', // unexpected_error
] as const;

export type OmniCommsErrorCode = (typeof OMNI_COMMS_ERROR_CODES)[number];

export class OmniCommsRpcError extends Error {
  readonly code: OmniCommsErrorCode;
  readonly detail?: string;
  constructor(code: OmniCommsErrorCode, detail?: string, message?: string) {
    super(message ?? `${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'OmniCommsRpcError';
    this.code = code;
    this.detail = detail;
  }
}

export interface OmniCommsRpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message?: string; details?: string; code?: string } | null;
  }>;
}

export function parseOmniCommsRpcError(
  raw: { message?: string; details?: string; code?: string } | null,
): OmniCommsRpcError {
  const msg = raw?.message ?? '';
  const codeMatch = msg.match(/\bOC(\d{3})\b/);
  const code = (codeMatch ? `OC${codeMatch[1]}` : 'OC500') as OmniCommsErrorCode;
  const detail = raw?.details ?? (msg.replace(/^OC\d{3}\s*/, '').trim() || undefined);
  return new OmniCommsRpcError(
    (OMNI_COMMS_ERROR_CODES as readonly string[]).includes(code) ? code : 'OC500',
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
  if (error) throw parseOmniCommsRpcError(error);
  return data as T;
}
