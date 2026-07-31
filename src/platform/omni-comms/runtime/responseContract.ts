/**
 * Omni-Comms — Canonical public result contract (v1).
 *
 * ONE versioned shape is used by every producer and consumer of a
 * `sendCommunication()` outcome:
 *
 *   - `src/platform/omni-comms/sendCommunication.ts`      (public façade type)
 *   - `runtime/sendCommunicationRuntime.ts`               (browser transport)
 *   - Edge Function fresh response                        (mirrored contract)
 *   - Edge Function replay response                       (mirrored contract)
 *   - persisted-message projection                        (DB → Edge → caller)
 *
 * The Edge mirror lives at
 * `supabase/functions/omni-comms-runtime/responseContract.ts` and MUST stay
 * structurally identical. `src/__tests__/omni-comms/runtime-hardening.test.ts`
 * asserts that both files declare the same contract version and field set.
 *
 * Design rules:
 *   * Replay returns the SAME bounded messages and statuses as the original
 *     call. An empty `messages` array is only ever correct when the request
 *     genuinely produced no message.
 *   * Every field is validated at runtime (`parseSendCommunicationResult`).
 *     TypeScript casting alone is not a contract.
 *   * The contract carries no rendered content, no PII, and no provider detail.
 */

export const OMNI_COMMS_RESULT_CONTRACT_VERSION = 'omni-comms.result.v1';

export const OMNI_COMMS_SEND_MODES = ['dry_run', 'shadow', 'queued'] as const;
export type OmniCommsSendMode = (typeof OMNI_COMMS_SEND_MODES)[number];

export const OMNI_COMMS_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app',
  'print',
] as const;
export type OmniCommsChannel = (typeof OMNI_COMMS_CHANNELS)[number];

/** Bounded recipient projection. Never carries a destination value. */
export interface SendCommunicationRecipientResult {
  /** Persisted recipient id. `null` before persistence (blocked results). */
  recipientId: string | null;
  /** Position of the recipient in the submitted array. */
  inputIndex: number | null;
  /** Caller-supplied opaque reference, echoed unchanged. */
  recipientReference: string | null;
  resolvedChannels: string[];
  eligibilityStatus: string;
  blockers: string[];
}

/** Bounded message projection. Identical on fresh and replay responses. */
export interface SendCommunicationMessageResult {
  messageId: string;
  recipientId: string | null;
  channel: string;
  status: string;
  /** Null while a message is blocked or not yet rendered. */
  renderedChecksum: string | null;
  /** Held (non-runnable) dispatch job, or null when no job exists. */
  dispatchJobId: string | null;
  blockers: string[];
}

export interface SendCommunicationResult {
  contractVersion: typeof OMNI_COMMS_RESULT_CONTRACT_VERSION;
  requestId: string;
  idempotencyKey: string;
  mode: OmniCommsSendMode;
  status: string;
  recipients: SendCommunicationRecipientResult[];
  messages: SendCommunicationMessageResult[];
  blockers: string[];
  createdAt: string;
  replayed: boolean;
}

/* ─── runtime validation ────────────────────────────────────────────────── */

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function nullableStr(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function nullableInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function isOmniCommsSendMode(v: unknown): v is OmniCommsSendMode {
  return typeof v === 'string' && (OMNI_COMMS_SEND_MODES as readonly string[]).includes(v);
}

export function normalizeRecipientResult(
  raw: unknown,
): SendCommunicationRecipientResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    recipientId: nullableStr(r.recipientId),
    inputIndex: nullableInt(r.inputIndex),
    recipientReference: nullableStr(r.recipientReference),
    resolvedChannels: strArray(r.resolvedChannels),
    eligibilityStatus: str(r.eligibilityStatus, 'unknown'),
    blockers: strArray(r.blockers),
  };
}

/**
 * A message projection is only valid with a real message id and channel.
 * Anything else is dropped rather than surfaced as a half-formed record.
 */
export function normalizeMessageResult(
  raw: unknown,
): SendCommunicationMessageResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const messageId = str(m.messageId);
  const channel = str(m.channel);
  const status = str(m.status);
  if (messageId === '' || channel === '' || status === '') return null;
  return {
    messageId,
    recipientId: nullableStr(m.recipientId),
    channel,
    status,
    renderedChecksum: nullableStr(m.renderedChecksum),
    dispatchJobId: nullableStr(m.dispatchJobId),
    blockers: strArray(m.blockers),
  };
}

export interface ParseResultFallback {
  idempotencyKey?: string;
  mode?: OmniCommsSendMode;
}

/**
 * Runtime shape validation of a result received across a trust boundary.
 * Returns `null` when the payload cannot be reconciled with the contract —
 * callers then surface a bounded blocker instead of leaking a partial object.
 */
export function parseSendCommunicationResult(
  raw: unknown,
  fallback: ParseResultFallback = {},
): SendCommunicationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const status = str(r.status);
  if (status === '') return null;

  const mode = isOmniCommsSendMode(r.mode)
    ? r.mode
    : (fallback.mode ?? 'dry_run');

  const recipients = Array.isArray(r.recipients)
    ? r.recipients
        .map(normalizeRecipientResult)
        .filter((x): x is SendCommunicationRecipientResult => x !== null)
    : [];

  const messages = Array.isArray(r.messages)
    ? r.messages
        .map(normalizeMessageResult)
        .filter((x): x is SendCommunicationMessageResult => x !== null)
    : [];

  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: str(r.requestId),
    idempotencyKey: str(r.idempotencyKey, fallback.idempotencyKey ?? ''),
    mode,
    status,
    recipients,
    messages,
    blockers: strArray(r.blockers),
    createdAt: str(r.createdAt, new Date(0).toISOString()),
    replayed: r.replayed === true,
  };
}

/** Canonical "blocked" result. Used whenever the runtime refuses a request. */
export function buildBlockedResult(
  blockers: string[],
  fallback: ParseResultFallback = {},
): SendCommunicationResult {
  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: '',
    idempotencyKey: fallback.idempotencyKey ?? '',
    mode: fallback.mode ?? 'dry_run',
    status: 'blocked',
    recipients: [],
    messages: [],
    blockers,
    createdAt: new Date(0).toISOString(),
    replayed: false,
  };
}
