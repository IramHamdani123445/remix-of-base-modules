// Omni-Comms — Canonical public result contract (v1) — EDGE MIRROR.
//
// Structural mirror of `src/platform/omni-comms/runtime/responseContract.ts`.
// Deno cannot import from `src/`, so the contract is duplicated deliberately
// and kept in lockstep by
// `src/__tests__/omni-comms/runtime-hardening.test.ts`, which compares the
// declared contract version and the exported field lists of both files.
//
// The Edge Function builds EVERY response through this module: fresh
// resolution, rendered result, replay, and every bounded rejection. That is
// what guarantees a replay returns the same messages and statuses as the
// original call.

export const OMNI_COMMS_RESULT_CONTRACT_VERSION = "omni-comms.result.v1";

export const OMNI_COMMS_SEND_MODES = ["dry_run", "shadow", "queued"] as const;
export type OmniCommsSendMode = (typeof OMNI_COMMS_SEND_MODES)[number];

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
