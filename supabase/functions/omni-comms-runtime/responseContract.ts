// Omni-Comms — Canonical public result contract (v1) — EDGE MIRROR.
//
// Structural mirror of `src/platform/omni-comms/runtime/responseContract.ts`.
// Deno cannot import from `src/`, so the contract is duplicated deliberately
// and kept in lockstep by
// `src/__tests__/omni-comms/contract-mirror-drift.test.ts`, which compares the
// declared contract version, the vocabularies and the interface field names of
// both files.

//
// The Edge Function builds EVERY response through this module: fresh
// resolution, rendered result, replay, and every bounded rejection. That is
// what guarantees a replay returns the same messages and statuses as the
// original call.

export const OMNI_COMMS_RESULT_CONTRACT_VERSION = "omni_comms.result.v1";

export const OMNI_COMMS_SEND_MODES = ["dry_run", "shadow", "queued"] as const;
export type OmniCommsSendMode = (typeof OMNI_COMMS_SEND_MODES)[number];

export const OMNI_COMMS_CHANNELS = [
  "email",
  "sms",
  "whatsapp",
  "push",
  "in_app",
  "print",
] as const;
export type OmniCommsChannel = (typeof OMNI_COMMS_CHANNELS)[number];

export const OMNI_COMMS_MESSAGE_STATUSES = [
  "pending",
  "rendered",
  "blocked",
  "dry_run_completed",
  "shadow_completed",
  "held",
] as const;

export const OMNI_COMMS_TERMINAL_MESSAGE_STATUS: Record<OmniCommsSendMode, string> = {
  dry_run: "dry_run_completed",
  shadow: "shadow_completed",
  queued: "held",
};

export const OMNI_COMMS_REQUEST_STATUSES = [
  "received",
  "accepted",
  "processing",
  "completed",
  "completed_with_blockers",
  "blocked",
] as const;

export const OMNI_COMMS_ELIGIBILITY_STATUSES = [
  "eligible",
  "partially_eligible",
  "blocked",
  "invalid",
] as const;


export interface SendCommunicationRecipientResult {
  recipientId: string | null;
  inputIndex: number | null;
  recipientReference: string | null;
  resolvedChannels: string[];
  eligibilityStatus: string;
  blockers: string[];
}

export interface SendCommunicationMessageResult {
  messageId: string;
  recipientId: string | null;
  channel: string;
  status: string;
  renderedChecksum: string | null;
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

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function nullableStr(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function nullableInt(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function isOmniCommsSendMode(v: unknown): v is OmniCommsSendMode {
  return typeof v === "string" &&
    (OMNI_COMMS_SEND_MODES as readonly string[]).includes(v);
}

/**
 * Normalise one persisted message row (snake_case, from
 * `omni_comms_priv_load_persisted_messages`) into the public contract.
 */
export function messageFromPersistedRow(
  raw: unknown,
): SendCommunicationMessageResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const messageId = str(m.message_id);
  const channel = str(m.channel);
  const status = str(m.status);
  if (messageId === "" || channel === "" || status === "") return null;
  return {
    messageId,
    recipientId: nullableStr(m.recipient_id),
    channel,
    status,
    renderedChecksum: nullableStr(m.rendered_checksum),
    dispatchJobId: nullableStr(m.dispatch_job_id),
    blockers: strArray(m.blockers),
  };
}

export function messagesFromPersistedProjection(
  raw: unknown,
): SendCommunicationMessageResult[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).messages;
  if (!Array.isArray(list)) return [];
  return list
    .map(messageFromPersistedRow)
    .filter((m): m is SendCommunicationMessageResult => m !== null);
}

export interface BuildResultInput {
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

/** Single construction point for every successful/bounded runtime response. */
export function buildResult(input: BuildResultInput): SendCommunicationResult {
  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: str(input.requestId),
    idempotencyKey: str(input.idempotencyKey),
    mode: isOmniCommsSendMode(input.mode) ? input.mode : "dry_run",
    status: str(input.status, "blocked"),
    recipients: Array.isArray(input.recipients) ? input.recipients : [],
    messages: Array.isArray(input.messages) ? input.messages : [],
    blockers: strArray(input.blockers),
    createdAt: str(input.createdAt, new Date(0).toISOString()),
    replayed: input.replayed === true,
  };
}

/** Canonical rejection shape. Never carries diagnostics. */
export function buildBlockedResult(
  blockers: string[],
  fallback: { idempotencyKey?: string; mode?: OmniCommsSendMode } = {},
): SendCommunicationResult {
  return buildResult({
    requestId: "",
    idempotencyKey: fallback.idempotencyKey ?? "",
    mode: fallback.mode ?? "dry_run",
    status: "blocked",
    recipients: [],
    messages: [],
    blockers,
    createdAt: new Date(0).toISOString(),
    replayed: false,
  });
}

export function normalizeRecipientResult(
  raw: unknown,
): SendCommunicationRecipientResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    recipientId: nullableStr(r.recipientId),
    inputIndex: nullableInt(r.inputIndex),
    recipientReference: nullableStr(r.recipientReference),
    resolvedChannels: strArray(r.resolvedChannels),
    eligibilityStatus: str(r.eligibilityStatus, "unknown"),
    blockers: strArray(r.blockers),
  };
}

/* ─── canonical persisted RECIPIENT projection ──────────────────────────── */

/**
 * Normalise one persisted recipient row (snake_case, from
 * `omni_comms_priv_load_persisted_recipients`) into the public contract.
 * The source RPC returns no destination value of any kind.
 */
export function recipientFromPersistedRow(
  raw: unknown,
): SendCommunicationRecipientResult | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const recipientId = nullableStr(r.recipient_id);
  if (recipientId === null) return null;
  return {
    recipientId,
    inputIndex: nullableInt(r.input_index),
    recipientReference: nullableStr(r.recipient_reference),
    resolvedChannels: strArray(r.resolved_channels),
    eligibilityStatus: str(r.eligibility_status, "unknown"),
    blockers: strArray(r.blockers),
  };
}

export function recipientsFromPersistedProjection(
  raw: unknown,
): SendCommunicationRecipientResult[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as Record<string, unknown>).recipients;
  if (!Array.isArray(list)) return [];
  return list
    .map(recipientFromPersistedRow)
    .filter((r): r is SendCommunicationRecipientResult => r !== null);
}
