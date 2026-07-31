/**
 * Omni-Comms Slice 2b — controlled runtime error codes.
 *
 * These are the ONLY blocker/error codes the façade emits publicly.
 * Server errors (SQLSTATE, constraint names, raw messages) are mapped
 * to one of these codes; unmapped conditions surface as
 * runtime_persistence_failed with no diagnostic leakage.
 */
export const OMNI_COMMS_RUNTIME_ERROR_CODES = [
  'invalid_input',
  'authentication_required',
  'organization_required',
  'department_organization_mismatch',
  'recipients_required',
  'recipient_limit_exceeded',
  'payload_invalid',
  'payload_too_large',
  'mode_invalid',
  // Authoritative server-side authorisation refusals (never browser-decided).
  'organization_access_denied',
  'department_access_denied',
  'caller_module_not_registered',

  'channel_invalid',
  'idempotency_key_required',
  'idempotency_key_too_long',
  'idempotency_payload_mismatch',
  'canonical_fingerprint_mismatch',
  'event_code_not_found',
  'runtime_persistence_failed',
  'runtime_transport_failed',
  'permission_denied',
] as const;

export type OmniCommsRuntimeErrorCode =
  (typeof OMNI_COMMS_RUNTIME_ERROR_CODES)[number];

const CODES = new Set<string>(OMNI_COMMS_RUNTIME_ERROR_CODES);

/**
 * Map a raw Supabase RPC error into a controlled blocker code.
 * The server uses the `OC### <slug>` convention documented in
 * omniCommsRpcErrors.ts.
 */
export function mapRpcErrorToRuntimeCode(raw: {
  message?: string;
  details?: string;
  code?: string;
} | null | undefined): OmniCommsRuntimeErrorCode {
  if (!raw) return 'runtime_persistence_failed';
  const text = `${raw.message ?? ''} ${raw.details ?? ''}`;
  const slugMatch = text.match(/OC\d{3}\s+([a-z_]+)/);
  const slug = slugMatch?.[1];
  if (slug && CODES.has(slug)) return slug as OmniCommsRuntimeErrorCode;

  // Numeric-only OC codes fall back to safe classes.
  const codeMatch = text.match(/\bOC(\d{3})\b/);
  if (codeMatch) {
    const c = codeMatch[1];
    if (c === '401') return 'authentication_required';
    if (c === '403') return 'permission_denied';
    if (c === '404') return 'event_code_not_found';
    if (c === '409') return 'idempotency_payload_mismatch';
    if (c === '422') return 'invalid_input';
  }
  return 'runtime_persistence_failed';
}
