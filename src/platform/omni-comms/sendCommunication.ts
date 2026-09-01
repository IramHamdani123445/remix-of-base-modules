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
 *  - Privileged runtime certification: certified for the governed Benefits
 *    Email path.
 *  - Provider delivery is performed SERVER-SIDE by the governed scheduler when
 *    the channel's delivery state is ON. This façade itself never contacts a
 *    provider and never sends from the browser.
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
  /** Canonical PERSISTENCE vocabulary: user | contact | group | external | … */
  recipientType: string;
  /**
   * First-class SEMANTIC business role (`claimant`, `employer_contact`, …).
   * Distinct from `recipientType`; used for policy resolution and recipient
   * evidence, never as the persisted type.
   */
  recipientRole?: string | null;
  recipientReference?: string | null;
  displayName?: string | null;
  locale?: string | null;
  email?: string | null;
  phone?: string | null;
  /**
   * @deprecated Never supply a device token. Push resolves server-side from
   * the recipient identity to governed Push registrations; anything passed
   * here is ignored by the runtime and is prohibited in business code by the
   * business-boundary guardrails.
   */
  pushDestination?: string | null;
  /**
   * Physical postal destination for the Print / Correspondence channel.
   * Never used by a digital channel; it is snapshotted onto the message and
   * becomes the address of record on the produced print item.
   */
  postalAddress?: {
    addressee?: string | null;
    addressLines: string[];
    locality?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
}

export interface SendCommunicationCallerContext {
  moduleCode?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Governed attachment reference (DEF-3).
 *
 * A business caller NEVER supplies bytes, a storage path, a bucket, a signed
 * URL or a data URI. It supplies ONLY the identifier of an attachment that was
 * previously registered through the governed registry
 * (`omni_comms_register_attachment`), which validated the storage area, the
 * content type, the size and the content checksum.
 *
 * The runtime pins the registered version (checksum + byte size + file name)
 * onto the request, so the exact bytes that were approved are the exact bytes
 * that can ever be delivered — a later overwrite of the storage object is
 * detected at dispatch time and refused.
 */
export interface SendCommunicationAttachmentInput {
  /** Identifier returned by the governed attachment registry. */
  attachmentId: string;
  /** `attachment` (default) or `inline`. */
  disposition?: 'attachment' | 'inline';
  /**
   * When true, a channel that cannot carry the attachment BLOCKS the message
   * instead of silently delivering an incomplete communication.
   */
  requiredForDelivery?: boolean;
}

/** Maximum governed attachments per request. Mirrors the DB bound. */
export const OMNI_COMMS_MAX_ATTACHMENTS = 20;

const UUID_LIKE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;



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
  /**
   * Trusted business resolution context (product policy, recipient roles).
   * Server-validated, used ONLY for configuration resolution. It is never
   * forwarded to a provider.
   */
  resolutionContext?: {
    productId?: string | null;
    recipientRoles?: string[];
  };
  /**
   * Governed attachment references (identifiers only — never bytes, never a
   * storage location). Order is the delivery order.
   */
  attachments?: SendCommunicationAttachmentInput[];
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
  if (input.attachments !== undefined && input.attachments !== null) {
    if (!Array.isArray(input.attachments)) {
      blockers.push('attachments_invalid');
    } else if (input.attachments.length > OMNI_COMMS_MAX_ATTACHMENTS) {
      blockers.push('attachment_limit_exceeded');
    } else {
      const seen = new Set<string>();
      for (const a of input.attachments) {
        if (!a || typeof a !== 'object' || typeof a.attachmentId !== 'string' || !UUID_LIKE.test(a.attachmentId)) {
          blockers.push('attachment_reference_invalid');
          break;
        }
        const key = a.attachmentId.toLowerCase();
        if (seen.has(key)) {
          blockers.push('attachment_duplicate');
          break;
        }
        seen.add(key);
        if (a.disposition !== undefined && a.disposition !== 'attachment' && a.disposition !== 'inline') {
          blockers.push('attachment_disposition_invalid');
          break;
        }
      }
    }
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
