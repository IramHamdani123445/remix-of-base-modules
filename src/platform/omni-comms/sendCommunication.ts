/**
 * Omni-Comms — Canonical send façade.
 *
 * The SINGLE authorised entrypoint for business callers.
 * Business modules import ONLY this file — never the runtime internals
 * under src/platform/omni-comms/runtime/**.
 *
 * Current implementation state (do not overstate this in docs or UI):
 *  - Source implemented: canonicalization, fingerprinting, authorisation,
 *    resolution, deterministic rendering, held (non-runnable) dispatch jobs.
 *  - Staging verified: SQL verifiers + vitest suites.
 *  - Privileged runtime certification: NOT certified (requires the
 *    privileged harness run against staging).
 *  - Live provider delivery: unavailable. No provider is ever contacted.
 *
 * Behaviour:
 *  - Validates the public input shape (cheap, non-authoritative).
 *  - Delegates to the trusted runtime service, which invokes the
 *    `omni-comms-runtime` Edge Function. The Edge Function authenticates,
 *    AUTHORISES the actor server-side (organisation, department, capability,
 *    caller module), canonicalizes, fingerprints and persists.
 *  - Returns the versioned canonical result contract
 *    (`OMNI_COMMS_RESULT_CONTRACT_VERSION`). Fresh and replay responses carry
 *    the same bounded messages and statuses.
 *  - Never touches a provider SDK. Never sends email. Never writes to runtime
 *    tables from the browser.
 *
 * Rules enforced by the architecture checker (Rule 9):
 *  - This is the ONLY permitted location for the export
 *    `sendCommunication` under src/platform/omni-comms/**.
 *  - Provider SDKs may not be imported here.
 *  - Aliases (sendOmniCommunication / dispatchCommunication /
 *    queueCommunication) are prohibited.
 */

import { executeSendCommunication } from './runtime/sendCommunicationRuntime';

export {
  OMNI_COMMS_RESULT_CONTRACT_VERSION,
  OMNI_COMMS_SEND_MODES,
  OMNI_COMMS_CHANNELS,
  parseSendCommunicationResult,
  buildBlockedResult,
} from './runtime/responseContract';

export type {
  OmniCommsSendMode,
  OmniCommsChannel,
  SendCommunicationRecipientResult,
  SendCommunicationMessageResult,
  SendCommunicationResult,
} from './runtime/responseContract';

import type { OmniCommsSendMode, OmniCommsChannel, SendCommunicationResult } from './runtime/responseContract';

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


/** Default caller-module used when callerContext.moduleCode is omitted. */
export const OMNI_COMMS_DEFAULT_CALLER_MODULE = 'OMNI_COMMS_DIRECT';

/** Minimum idempotency key length. Mirrors the DB CHECK constraint. */
const IDEMPOTENCY_KEY_MIN = 8;
const IDEMPOTENCY_KEY_MAX = 200;

/**
 * Public-shape validation the façade performs BEFORE handing off to the
 * trusted runtime. Returns a list of bounded blocker codes. Empty means
 * the input is well-formed enough to enter the runtime pipeline —
 * server-side then re-validates authoritatively.
 */
export function validateSendCommunicationInput(
  input: SendCommunicationInput,
): string[] {
  const blockers: string[] = [];
  if (!input || typeof input !== 'object') return ['invalid_input'];

  if (!input.eventCode || typeof input.eventCode !== 'string') {
    blockers.push('invalid_input');
  }
  if (!input.organizationId || typeof input.organizationId !== 'string') {
    blockers.push('organization_required');
  }
  if (
    !input.idempotencyKey ||
    typeof input.idempotencyKey !== 'string' ||
    input.idempotencyKey.length < IDEMPOTENCY_KEY_MIN
  ) {
    blockers.push('idempotency_key_required');
  }
  if (
    typeof input.idempotencyKey === 'string' &&
    input.idempotencyKey.length > IDEMPOTENCY_KEY_MAX
  ) {
    blockers.push('idempotency_key_too_long');
  }
  if (!input.mode || !['dry_run', 'shadow', 'queued'].includes(input.mode)) {
    blockers.push('mode_invalid');
  }
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    blockers.push('recipients_required');
  }
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload)
  ) {
    blockers.push('payload_invalid');
  }
  return blockers;
}

/**
 * Canonical façade — Slice 2b.
 *
 * Delegates to the trusted internal runtime entrypoint. Returns the
 * bounded public result. Never throws for controlled conditions; all
 * failures surface as bounded `blockers[]` codes on a `status:"blocked"`
 * result.
 */
export async function sendCommunication(
  input: SendCommunicationInput,
): Promise<SendCommunicationResult> {
  return executeSendCommunication(input);
}
