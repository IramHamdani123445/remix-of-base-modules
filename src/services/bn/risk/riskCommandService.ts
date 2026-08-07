/**
 * BN Risk / Fraud — governed command service (EPIC 0).
 *
 * The ONLY way browser code may create or change a risk signal. Browser
 * roles hold SELECT-only privileges on every `bn_risk_*` table; all writes
 * go through the SECURITY DEFINER RPC `bn_risk_execute_command_v1`, which
 * enforces authentication, the module gate, granular permission, state
 * transitions, row versions, de-duplication, idempotency, payload-hash
 * match and audit event capture.
 */
import { supabase } from '@/integrations/supabase/client';
import type { BnRiskEpic0Command } from '@/types/bn/risk/riskSignals';
import type { BnRiskCanonicalCommandName } from '@/types/bn/risk/riskCanonicalCommands';

export interface BnRiskCommandRequest {
  readonly command: BnRiskCanonicalCommandName;
  readonly signalId?: string | null;
  readonly expectedRowVersion?: number | null;
  readonly reasonCode?: string | null;
  readonly justification?: string | null;
  readonly payload?: Record<string, unknown>;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export type BnRiskCommandStatus = 'EXECUTED' | 'REPLAYED' | 'DUPLICATE' | 'FAILED';

export type BnRiskCommandErrorCode =
  | 'UNAUTHENTICATED'
  | 'MODULE_NOT_REGISTERED'
  | 'MODULE_DISABLED'
  | 'ROUTES_DISABLED'
  | 'ACTIONS_DISABLED'
  | 'ACTION_DISABLED'
  | 'ACTION_UNREGISTERED'
  | 'PERMISSION_DENIED'
  | 'COMMAND_NOT_IMPLEMENTED'
  | 'MISSING_REQUIRED_INFORMATION'
  | 'JUSTIFICATION_REQUIRED'
  | 'REASON_CODE_REQUIRED'
  | 'INVALID_VALUE'
  | 'INVALID_STATE'
  | 'STALE_ROW_VERSION'
  | 'IDEMPOTENCY_PAYLOAD_MISMATCH'
  | 'DUPLICATE_LINK'
  | 'ENTITY_REQUIRED'
  | 'NOT_FOUND'
  | 'UNKNOWN';

const KNOWN_ERROR_CODES = new Set<string>([
  'UNAUTHENTICATED', 'MODULE_NOT_REGISTERED', 'MODULE_DISABLED', 'ROUTES_DISABLED',
  'ACTIONS_DISABLED', 'ACTION_DISABLED', 'ACTION_UNREGISTERED', 'PERMISSION_DENIED',
  'COMMAND_NOT_IMPLEMENTED', 'MISSING_REQUIRED_INFORMATION', 'JUSTIFICATION_REQUIRED',
  'REASON_CODE_REQUIRED', 'INVALID_VALUE', 'INVALID_STATE', 'STALE_ROW_VERSION',
  'IDEMPOTENCY_PAYLOAD_MISMATCH', 'DUPLICATE_LINK', 'ENTITY_REQUIRED', 'NOT_FOUND',
]);

/** Business-readable messages. No SQL wording ever reaches an officer. */
const ERROR_MESSAGES: Record<BnRiskCommandErrorCode, string> = {
  UNAUTHENTICATED: 'You are not signed in.',
  MODULE_NOT_REGISTERED: 'The Risk module is not registered on this environment.',
  MODULE_DISABLED: 'The Risk module is currently disabled.',
  ROUTES_DISABLED: 'Risk screens are currently disabled by administration.',
  ACTIONS_DISABLED: 'Risk actions are currently disabled for this pilot.',
  ACTION_DISABLED: 'This action is currently disabled.',
  ACTION_UNREGISTERED: 'This action is not registered for the Risk module.',
  PERMISSION_DENIED: 'You do not have permission to perform this action.',
  COMMAND_NOT_IMPLEMENTED: 'This capability is not available yet.',
  MISSING_REQUIRED_INFORMATION: 'Some required information is missing.',
  JUSTIFICATION_REQUIRED: 'A justification is required.',
  REASON_CODE_REQUIRED: 'A reason must be selected.',
  INVALID_VALUE: 'One of the selected values is not valid.',
  INVALID_STATE: 'This signal is not at a stage where that action is allowed.',
  STALE_ROW_VERSION: 'This signal was updated by someone else. Refresh and try again.',
  IDEMPOTENCY_PAYLOAD_MISMATCH: 'This request was already submitted with different details.',
  DUPLICATE_LINK: 'These signals are already linked.',
  ENTITY_REQUIRED: 'No signal was selected.',
  NOT_FOUND: 'The record could not be found.',
  UNKNOWN: 'The action could not be completed.',
};

export interface BnRiskCommandResult {
  readonly status: BnRiskCommandStatus;
  readonly data: Record<string, unknown> | null;
  readonly signalId?: string;
  readonly signalReference?: string;
  readonly entityVersion?: number;
  readonly errorCode?: BnRiskCommandErrorCode;
  readonly errorDetail?: string;
  readonly errorMessage?: string;
  readonly correlationId: string;
}

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
  code: BnRiskCommandErrorCode;
  detail: string;
} {
  const match = /E_([A-Z_]+):?(.*)/.exec(message ?? '');
  if (!match) return { code: 'UNKNOWN', detail: message ?? '' };
  const raw = match[1];
  const code = (KNOWN_ERROR_CODES.has(raw) ? raw : 'UNKNOWN') as BnRiskCommandErrorCode;
  return { code, detail: match[2]?.trim() ?? '' };
}

export function riskErrorMessage(code: BnRiskCommandErrorCode, detail?: string): string {
  const base = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN;
  return detail ? `${base} (${detail})` : base;
}

export function newRiskUuid(): string {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export const BN_RISK_IMPLEMENTED_COMMANDS: ReadonlySet<string> = new Set<BnRiskEpic0Command>([
  'BN_RISK_GENERATE_SIGNAL',
  'BN_RISK_REGISTER_MANUAL_SIGNAL',
  'BN_RISK_TRIAGE_SIGNAL',
  'BN_RISK_LINK_SIGNALS',
  'BN_RISK_DISMISS_SIGNAL',
]);

export const riskCommandService = {
  canonicalisePayload,
  computePayloadHash,
  parseCommandError,
  riskErrorMessage,

  async execute(request: BnRiskCommandRequest): Promise<BnRiskCommandResult> {
    const correlationId = request.correlationId ?? newRiskUuid();
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
        errorMessage: riskErrorMessage('UNAUTHENTICATED'),
        correlationId,
      };
    }

    const { data, error } = await supabase.rpc('bn_risk_execute_command_v1' as never, {
      p_command_name: request.command,
      p_signal_id: request.signalId ?? null,
      p_actor_user_id: actorUserId,
      p_actor_user_code: auth?.user?.email ?? actorUserId,
      p_correlation_id: correlationId,
      p_expected_row_version: request.expectedRowVersion ?? null,
      p_reason_code: request.reasonCode ?? null,
      p_justification: request.justification ?? null,
      p_payload: payload as never,
      p_payload_hash: payloadHash,
      p_idempotency_key: request.idempotencyKey ?? newRiskUuid(),
    } as never);

    if (error) {
      const parsed = parseCommandError(error.message);
      return {
        status: 'FAILED',
        data: null,
        errorCode: parsed.code,
        errorDetail: parsed.detail,
        errorMessage: riskErrorMessage(parsed.code, parsed.detail),
        correlationId,
      };
    }

    const result = (data ?? {}) as Record<string, unknown>;
    return {
      status: (result.status as BnRiskCommandStatus) ?? 'EXECUTED',
      data: result,
      signalId: result.signal_id as string | undefined,
      signalReference: result.signal_reference as string | undefined,
      entityVersion: result.entity_version as number | undefined,
      correlationId,
    };
  },
};
