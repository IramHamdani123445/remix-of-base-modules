/**
 * BN Means-Test — governed command service.
 *
 * The ONLY way browser code may mutate Means-Test state. Browser roles
 * hold SELECT-only privileges on every `bn_means_*` table; all writes go
 * through the SECURITY DEFINER RPC `bn_means_execute_command_v1`, which
 * enforces authentication, the module dark-launch gate, granular
 * permission, state transition, row version, idempotency, payload-hash
 * match, maker-checker and audit.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnMeansCommandName } from '@/types/bn/meansTests/meansCommands';

export interface BnMeansCommandRequest {
  readonly command: BnMeansCommandName;
  readonly assessmentId?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly reasonCode?: string | null;
  readonly justification?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export type BnMeansCommandStatus = 'EXECUTED' | 'REPLAYED' | 'FAILED';

/** Structured reasons surfaced to the UI. Mirrors the SQL error codes. */
export type BnMeansCommandErrorCode =
  | 'ACTIONS_DISABLED'
  | 'PERMISSION_DENIED'
  | 'UNAUTHENTICATED'
  | 'INVALID_STATE'
  | 'MISSING_REQUIRED_INFORMATION'
  | 'MISSING_EVIDENCE'
  | 'EVIDENCE_REFERENCE_REQUIRED'
  | 'STALE_ROW_VERSION'
  | 'MAKER_CHECKER_REQUIRED'
  | 'SELF_APPROVAL_DENIED'
  | 'POLICY_NOT_EFFECTIVE'
  | 'POLICY_NOT_FOUND'
  | 'CURRENCY_MISMATCH'
  | 'DUPLICATE_OPEN_ASSESSMENT'
  | 'INVALID_EFFECTIVE_DATES'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'ALREADY_SUBMITTED'
  | 'NOT_FOUND'
  | 'ENTITY_REQUIRED'
  | 'COMMAND_NOT_IMPLEMENTED'
  | 'COMMAND_UNKNOWN'
  | 'HOUSEHOLD_VALIDATION_FAILED'
  | 'MEMBER_NOT_FOUND'
  | 'CONTEXT_CORRECTION_NOT_PERMITTED'
  | 'INCOME_VALIDATION_FAILED'
  | 'INCOME_FACT_NOT_FOUND'
  | 'FOREIGN_CURRENCY_NOT_SUPPORTED'
  | 'SECTION_NOT_READY'
  | 'ASSET_VALIDATION_FAILED'
  | 'ASSET_FACT_NOT_FOUND'
  | 'DEDUCTION_VALIDATION_FAILED'
  | 'DEDUCTION_FACT_NOT_FOUND'
  // EPIC 6 — evidence and information requests.
  | 'DUPLICATE_EVIDENCE_LINK'
  | 'INVALID_VALUE'
  | 'VERSION_CONFLICT'
  | 'FORBIDDEN'
  | 'UNKNOWN';

export interface BnMeansCommandResult {
  readonly status: BnMeansCommandStatus;
  readonly data: Record<string, unknown> | null;
  readonly assessmentId?: string;
  readonly entityVersion?: number;
  readonly errorCode?: BnMeansCommandErrorCode;
  readonly errorDetail?: string;
  readonly correlationId: string;
}

const KNOWN_ERROR_CODES = new Set<string>([
  'ACTIONS_DISABLED', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'INVALID_STATE',
  'MISSING_REQUIRED_INFORMATION', 'MISSING_EVIDENCE', 'EVIDENCE_REFERENCE_REQUIRED',
  'STALE_ROW_VERSION', 'MAKER_CHECKER_REQUIRED', 'SELF_APPROVAL_DENIED',
  'POLICY_NOT_EFFECTIVE', 'POLICY_NOT_FOUND', 'CURRENCY_MISMATCH',
  'DUPLICATE_OPEN_ASSESSMENT', 'INVALID_EFFECTIVE_DATES',
  'IDEMPOTENCY_PAYLOAD_MISMATCH', 'ALREADY_SUBMITTED', 'NOT_FOUND',
  'ENTITY_REQUIRED', 'COMMAND_NOT_IMPLEMENTED', 'COMMAND_UNKNOWN',
  'MODULE_DISABLED', 'ROUTES_DISABLED', 'ACTION_DISABLED', 'ACTION_UNREGISTERED',
  'MODULE_NOT_REGISTERED',
  'HOUSEHOLD_VALIDATION_FAILED', 'MEMBER_NOT_FOUND', 'CONTEXT_CORRECTION_NOT_PERMITTED',
  'INCOME_VALIDATION_FAILED', 'INCOME_FACT_NOT_FOUND', 'FOREIGN_CURRENCY_NOT_SUPPORTED',
  'SECTION_NOT_READY', 'ASSET_VALIDATION_FAILED', 'ASSET_FACT_NOT_FOUND',
  'DEDUCTION_VALIDATION_FAILED', 'DEDUCTION_FACT_NOT_FOUND',
  'DUPLICATE_EVIDENCE_LINK', 'INVALID_VALUE', 'VERSION_CONFLICT', 'FORBIDDEN',
]);

/** Deterministic key ordering so replays produce an identical hash. */
export function canonicalisePayload(payload: unknown): string {
  if (payload === null || payload === undefined) return 'null';
  if (Array.isArray(payload)) return `[${payload.map(canonicalisePayload).join(',')}]`;
  if (typeof payload === 'object') {
    const entries = Object.entries(payload as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalisePayload(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(payload);
}

export async function computePayloadHash(payload: unknown): Promise<string> {
  const text = canonicalisePayload(payload);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Deterministic non-cryptographic fallback (test/SSR environments).
    let h = 0;
    for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
    return `fnv:${(h >>> 0).toString(16)}`;
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Parses `E_<CODE>:<detail>` raised by the SQL boundary. */
export function parseCommandError(message: string): {
  code: BnMeansCommandErrorCode;
  detail: string;
} {
  const match = /E_([A-Z_]+):?(.*)/.exec(message ?? '');
  if (!match) return { code: 'UNKNOWN', detail: message ?? '' };
  const raw = match[1];
  const code = KNOWN_ERROR_CODES.has(raw) ? raw : 'UNKNOWN';
  return { code: code as BnMeansCommandErrorCode, detail: match[2]?.trim() ?? '' };
}

function newUuid(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

/**
 * EPIC 6 — commands served by the governed evidence boundary.
 * `BN_MEANS_ATTACH_EVIDENCE` stays the canonical business command; it is
 * routed here so linking writes the authoritative evidence link register.
 */
const EVIDENCE_COMMANDS = new Set<string>([
  'BN_MEANS_ATTACH_EVIDENCE',
  'BN_MEANS_UNLINK_EVIDENCE',
  'BN_MEANS_RECORD_EVIDENCE_USABILITY',
  'BN_MEANS_REQUEST_INFORMATION',
  'BN_MEANS_RECORD_INFORMATION_RESPONSE',
  'BN_MEANS_CLOSE_INFORMATION_REQUEST',
  'BN_MEANS_MARK_EVIDENCE_COMPLETE',
  'BN_MEANS_REOPEN_EVIDENCE',
]);

export const meansCommandService = {
  canonicalisePayload,
  computePayloadHash,
  parseCommandError,

  async execute(request: BnMeansCommandRequest): Promise<BnMeansCommandResult> {
    const correlationId = request.correlationId ?? newUuid();
    const payload = request.payload ?? {};
    const payloadHash = await computePayloadHash(payload);

    const { data: auth } = await supabase.auth.getUser();
    const actorUserId = auth?.user?.id ?? null;
    if (!actorUserId) {
      return {
        status: 'FAILED',
        data: null,
        errorCode: 'UNAUTHENTICATED',
        errorDetail: 'No authenticated actor',
        correlationId,
      };
    }

    // EPIC 6 — evidence and information-request supporting operations are
    // served by a dedicated governed boundary with the identical contract
    // (permission, row version, idempotency, payload hash, audit event).
    const rpcName = EVIDENCE_COMMANDS.has(request.command)
      ? 'bn_means_evidence_command_v1'
      : 'bn_means_execute_command_v1';

    const { data, error } = await supabase.rpc(rpcName as never, {
      p_command_name: request.command,
      p_assessment_id: request.assessmentId ?? null,
      p_actor_user_id: actorUserId,
      p_actor_user_code: auth?.user?.email ?? actorUserId,
      p_correlation_id: correlationId,
      p_expected_row_version: request.expectedRowVersion ?? null,
      p_reason_code: request.reasonCode ?? null,
      p_justification: request.justification ?? null,
      p_payload: payload as never,
      p_payload_hash: payloadHash,
      p_idempotency_key: request.idempotencyKey ?? newUuid(),
    } as never);

    if (error) {
      const parsed = parseCommandError(error.message);
      return {
        status: 'FAILED',
        data: null,
        errorCode: parsed.code,
        errorDetail: parsed.detail,
        correlationId,
      };
    }

    const result = (data ?? {}) as Record<string, unknown>;
    return {
      status: (result.status as BnMeansCommandStatus) ?? 'EXECUTED',
      data: result,
      assessmentId: result.assessment_id as string | undefined,
      entityVersion: result.entity_version as number | undefined,
      correlationId,
    };
  },
};
