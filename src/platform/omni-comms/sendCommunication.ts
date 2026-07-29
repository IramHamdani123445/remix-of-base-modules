/**
 * Omni-Comms — Canonical send façade.
 *
 * Milestone: Accelerated Build 3 — Slice 2a introduces this file as the
 * SINGLE authorised entrypoint for business callers. The typed contract
 * is complete and stable; the runtime service that fulfils it lands in
 * Slice 2b (server-authoritative persistence RPC) and Slice 2c
 * (TypeScript resolvers / canonicalization / fingerprint / rendering
 * pipeline).
 *
 * Until the trusted runtime service is wired, invoking this façade
 * returns a bounded result carrying a single controlled blocker
 * `runtime_not_available` — it never throws raw errors, never touches
 * a provider, never inserts runtime rows.
 *
 * Rules enforced by the architecture checker (Rule 9):
 *  - This file is the ONLY permitted location for the export
 *    `sendCommunication` under src/platform/omni-comms/**.
 *  - Business modules may import ONLY this file — runtime internals
 *    under src/platform/omni-comms/runtime/ are off-limits.
 *  - Provider SDKs may not be imported here.
 */

export type OmniCommsSendMode = 'dry_run' | 'shadow' | 'queued';

export type OmniCommsChannel =
  | 'email'
  | 'sms'
  | 'whatsapp'
  | 'push'
  | 'in_app'
  | 'print';

export interface SendCommunicationRecipientInput {
  recipientType: string;
  recipientReference?: string | null;
  displayName?: string | null;
  locale?: string | null;
  email?: string | null;
  phone?: string | null;
  pushDestination?: string | null;
}

export interface SendCommunicationCallerContext {
  moduleCode?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export interface SendCommunicationInput {
  eventCode: string;
  organizationId: string;
  departmentId?: string | null;
  recipients: SendCommunicationRecipientInput[];
  payload: Record<string, unknown>;
  mode: OmniCommsSendMode;
  idempotencyKey: string;
  correlationId?: string | null;
  requestedChannels?: OmniCommsChannel[];
  callerContext?: SendCommunicationCallerContext;
}

export interface SendCommunicationRecipientResult {
  recipientId: string;
  resolvedChannels: string[];
  blockers: string[];
}

export interface SendCommunicationMessageResult {
  messageId: string;
  recipientId: string;
  channel: string;
  status: string;
  renderedChecksum: string;
  dispatchJobId?: string | null;
}

export interface SendCommunicationResult {
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

/** Bounded default caller-module when the caller omits callerContext.moduleCode. */
export const OMNI_COMMS_DEFAULT_CALLER_MODULE = 'OMNI_COMMS_DIRECT';

/**
 * Minimal, deterministic input validation the façade performs BEFORE
 * delegating to the trusted runtime service. Returns a list of bounded
 * blocker codes; empty means the input is well-formed enough to enter
 * the runtime pipeline.
 *
 * Runtime-side (server) will re-validate everything authoritatively —
 * this pre-check exists so the façade can return a controlled result
 * on obvious misuse without a round-trip.
 */
export function validateSendCommunicationInput(
  input: SendCommunicationInput,
): string[] {
  const blockers: string[] = [];
  if (!input || typeof input !== 'object') {
    return ['invalid_input'];
  }
  if (!input.eventCode || typeof input.eventCode !== 'string') {
    blockers.push('event_code_required');
  }
  if (!input.organizationId || typeof input.organizationId !== 'string') {
    blockers.push('organization_id_required');
  }
  if (!input.idempotencyKey || typeof input.idempotencyKey !== 'string') {
    blockers.push('idempotency_key_required');
  }
  if (!input.mode || !['dry_run', 'shadow', 'queued'].includes(input.mode)) {
    blockers.push('mode_invalid');
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    blockers.push('recipients_required');
  }
  if (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload)) {
    blockers.push('payload_invalid');
  }
  return blockers;
}

/**
 * Canonical façade — Slice 2a skeleton.
 *
 * The stable typed contract is implemented; delegation into the trusted
 * runtime service is deliberately not yet wired. Until Slice 2b lands
 * the persistence RPC, every invocation returns a bounded result with a
 * single `runtime_not_available` blocker so callers observe the exact
 * public shape they will consume in Slice 2c and beyond.
 */
export async function sendCommunication(
  input: SendCommunicationInput,
): Promise<SendCommunicationResult> {
  const preBlockers = validateSendCommunicationInput(input);
  const blockers =
    preBlockers.length > 0 ? preBlockers : ['runtime_not_available'];
  return {
    requestId: '',
    idempotencyKey: input?.idempotencyKey ?? '',
    mode: input?.mode ?? 'dry_run',
    status: 'blocked',
    recipients: [],
    messages: [],
    blockers,
    createdAt: new Date(0).toISOString(),
    replayed: false,
  };
}
