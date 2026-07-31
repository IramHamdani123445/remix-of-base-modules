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

export const OMNI_COMMS_RESULT_CONTRACT_VERSION = 'omni_comms.result.v1';

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

/**
 * Complete message-status vocabulary. `rendered` is transient; the terminal
 * status is mode-derived: `dry_run_completed`, `shadow_completed` or `held`.
 */
export const OMNI_COMMS_MESSAGE_STATUSES = [
  'pending',
  'rendered',
  'blocked',
  'dry_run_completed',
  'shadow_completed',
  'held',
] as const;
export type OmniCommsMessageStatus = (typeof OMNI_COMMS_MESSAGE_STATUSES)[number];

/** Terminal message status for a successfully rendered message, per mode. */
export const OMNI_COMMS_TERMINAL_MESSAGE_STATUS: Record<OmniCommsSendMode, string> = {
  dry_run: 'dry_run_completed',
  shadow: 'shadow_completed',
  queued: 'held',
};

/** Complete request-status vocabulary returned on the public contract. */
export const OMNI_COMMS_REQUEST_STATUSES = [
  'received',
  // `accepted` is the persisted status the runtime writes on first admission,
  // before resolution runs. It is part of the real vocabulary and must not be
  // rejected by contract validation.
  'accepted',
  'processing',
  'completed',
  'completed_with_blockers',
  'blocked',
] as const;
export type OmniCommsRequestStatus = (typeof OMNI_COMMS_REQUEST_STATUSES)[number];

/** Complete recipient-eligibility vocabulary. */
export const OMNI_COMMS_ELIGIBILITY_STATUSES = [
  'eligible',
  'partially_eligible',
  'blocked',
  'invalid',
] as const;
export type OmniCommsEligibilityStatus = (typeof OMNI_COMMS_ELIGIBILITY_STATUSES)[number];

function inVocabulary(v: unknown, vocab: readonly string[]): boolean {
  return typeof v === 'string' && vocab.includes(v);
}


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

/**
 * A recipient projection must carry a complete, in-vocabulary shape:
 *   * `eligibilityStatus` MUST be one of the four known values;
 *   * every `resolvedChannels` entry MUST be a known channel;
 *   * `inputIndex`, when present, MUST be a non-negative integer.
 * Anything else invalidates the element (and therefore the whole payload).
 */
export function normalizeRecipientResult(
  raw: unknown,
): SendCommunicationRecipientResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (!inVocabulary(r.eligibilityStatus, OMNI_COMMS_ELIGIBILITY_STATUSES)) return null;

  if (r.resolvedChannels !== undefined && !Array.isArray(r.resolvedChannels)) return null;
  const resolvedChannels = strArray(r.resolvedChannels);
  if (resolvedChannels.length !== ((r.resolvedChannels ?? []) as unknown[]).length) return null;
  for (const c of resolvedChannels) {
    if (!inVocabulary(c, OMNI_COMMS_CHANNELS)) return null;
  }

  const inputIndex = nullableInt(r.inputIndex);
  if (inputIndex !== null && (!Number.isInteger(inputIndex) || inputIndex < 0)) return null;

  if (r.blockers !== undefined && !Array.isArray(r.blockers)) return null;
  const blockers = strArray(r.blockers);
  if (blockers.length !== ((r.blockers ?? []) as unknown[]).length) return null;

  return {
    recipientId: nullableStr(r.recipientId),
    inputIndex,
    recipientReference: nullableStr(r.recipientReference),
    resolvedChannels,
    eligibilityStatus: r.eligibilityStatus as string,
    blockers,
  };
}

/**
 * A message projection is only valid with a real message id, a KNOWN channel
 * and a KNOWN status. A rendered-checksum, when present, must be a sha-256
 * digest. Anything else invalidates the element.
 */
export function normalizeMessageResult(
  raw: unknown,
): SendCommunicationMessageResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const messageId = str(m.messageId);
  if (messageId === '') return null;
  if (!inVocabulary(m.channel, OMNI_COMMS_CHANNELS)) return null;
  if (!inVocabulary(m.status, OMNI_COMMS_MESSAGE_STATUSES)) return null;

  const renderedChecksum = nullableStr(m.renderedChecksum);
  if (renderedChecksum !== null && !/^[0-9a-f]{64}$/i.test(renderedChecksum)) return null;

  if (m.blockers !== undefined && !Array.isArray(m.blockers)) return null;
  const blockers = strArray(m.blockers);
  if (blockers.length !== ((m.blockers ?? []) as unknown[]).length) return null;

  return {
    messageId,
    recipientId: nullableStr(m.recipientId),
    channel: m.channel as string,
    status: m.status as string,
    renderedChecksum,
    dispatchJobId: nullableStr(m.dispatchJobId),
    blockers,
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
 *
 * Strictness rules (a contract, not a best-effort coercion):
 *   * `contractVersion` MUST be present and MUST equal the supported version.
 *   * every recipient and message element MUST validate; a single malformed
 *     element invalidates the whole payload rather than being silently dropped.
 *   * `blockers`, `recipients` and `messages` MUST be arrays when present.
 *   * a non-blocked result MUST carry a non-empty `requestId`.
 */
export function parseSendCommunicationResult(
  raw: unknown,
  fallback: ParseResultFallback = {},
): SendCommunicationResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  if (r.contractVersion !== OMNI_COMMS_RESULT_CONTRACT_VERSION) return null;

  // Request status must be in the complete, closed vocabulary.
  if (!inVocabulary(r.status, OMNI_COMMS_REQUEST_STATUSES)) return null;
  const status = r.status as string;


  if (!isOmniCommsSendMode(r.mode)) return null;
  const mode = r.mode;

  if (r.recipients !== undefined && !Array.isArray(r.recipients)) return null;
  if (r.messages !== undefined && !Array.isArray(r.messages)) return null;
  if (r.blockers !== undefined && !Array.isArray(r.blockers)) return null;

  const recipients: SendCommunicationRecipientResult[] = [];
  for (const item of (r.recipients ?? []) as unknown[]) {
    const parsed = normalizeRecipientResult(item);
    if (!parsed) return null;
    recipients.push(parsed);
  }

  const messages: SendCommunicationMessageResult[] = [];
  for (const item of (r.messages ?? []) as unknown[]) {
    const parsed = normalizeMessageResult(item);
    if (!parsed) return null;
    messages.push(parsed);
  }

  const blockers = ((r.blockers ?? []) as unknown[]).filter(
    (b): b is string => typeof b === 'string',
  );
  if (blockers.length !== ((r.blockers ?? []) as unknown[]).length) return null;

  const requestId = str(r.requestId);
  if (requestId === '' && status !== 'blocked') return null;

  const createdAt = str(r.createdAt);
  if (createdAt === '' || Number.isNaN(Date.parse(createdAt))) return null;

  if (typeof r.replayed !== 'boolean') return null;

  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId,
    idempotencyKey: str(r.idempotencyKey, fallback.idempotencyKey ?? ''),
    mode,
    status,
    recipients,
    messages,
    blockers,
    createdAt,
    replayed: r.replayed,
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
