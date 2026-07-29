/**
 * Omni-Comms Slice 2b — trusted send-communication runtime service.
 *
 * The public façade at src/platform/omni-comms/sendCommunication.ts
 * calls ONLY this entrypoint. Business modules must not import from
 * src/platform/omni-comms/runtime/** directly (enforced by the
 * architecture checker).
 *
 * Responsibilities:
 *  - Public input validation (light — server RPC re-validates).
 *  - Canonicalize the request into a deterministic representation.
 *  - Compute the SHA-256 fingerprint (correlationId excluded).
 *  - Invoke the SECURITY DEFINER persistence RPC
 *    public.omni_comms_priv_send_communication which atomically:
 *      * locks the idempotency scope (org + caller_module + key),
 *      * returns replay on identical fingerprint,
 *      * rejects on fingerprint mismatch,
 *      * inserts the request + request_accepted event on first arrival.
 *  - Return the bounded public result. No provider is called.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  OMNI_COMMS_DEFAULT_CALLER_MODULE,
  validateSendCommunicationInput,
  type SendCommunicationInput,
  type SendCommunicationResult,
  type OmniCommsSendMode,
} from '../sendCommunication';
import {
  canonicalizeRequest,
  CanonicalizationError,
} from './canonicalize';
import { computeRequestFingerprint } from './fingerprint';
import {
  mapRpcErrorToRuntimeCode,
  type OmniCommsRuntimeErrorCode,
} from './runtimeErrors';

export interface RuntimeRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{
    data: unknown;
    error: { message?: string; details?: string; code?: string } | null;
  }>;
}

const DEFAULT_RPC_CLIENT: RuntimeRpcClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: async (fn, args) => (supabase as any).rpc(fn, args),
};

function blockedResult(
  input: SendCommunicationInput,
  blocker: OmniCommsRuntimeErrorCode,
): SendCommunicationResult {
  return {
    requestId: '',
    idempotencyKey: input?.idempotencyKey ?? '',
    mode: (input?.mode ?? 'dry_run') as OmniCommsSendMode,
    status: 'blocked',
    recipients: [],
    messages: [],
    blockers: [blocker],
    createdAt: new Date(0).toISOString(),
    replayed: false,
  };
}

interface PersistenceRpcResult {
  request_id: string;
  idempotency_key: string;
  mode: string;
  status: string;
  created_at: string;
  replayed: boolean;
}

/**
 * Execute the trusted runtime pipeline. Called from the public façade.
 * Accepts an optional RPC client for test injection; production
 * callers use the default supabase client.
 */
export async function executeSendCommunication(
  input: SendCommunicationInput,
  rpcClient: RuntimeRpcClient = DEFAULT_RPC_CLIENT,
): Promise<SendCommunicationResult> {
  // 1) Cheap public-shape validation.
  const shapeBlockers = validateSendCommunicationInput(input);
  if (shapeBlockers.length > 0) {
    return {
      requestId: '',
      idempotencyKey: input?.idempotencyKey ?? '',
      mode: (input?.mode ?? 'dry_run') as OmniCommsSendMode,
      status: 'blocked',
      recipients: [],
      messages: [],
      blockers: shapeBlockers,
      createdAt: new Date(0).toISOString(),
      replayed: false,
    };
  }

  // 2) Canonicalize + fingerprint. Canonicalization errors are already
  //    controlled codes (e.g. payload_too_large, channel_invalid).
  let canonical;
  try {
    canonical = canonicalizeRequest(input);
  } catch (err) {
    if (err instanceof CanonicalizationError) {
      return blockedResult(input, err.code as OmniCommsRuntimeErrorCode);
    }
    return blockedResult(input, 'invalid_input');
  }
  const fingerprint = await computeRequestFingerprint(canonical);

  // 3) Persistence RPC.
  const callerModule =
    canonical.callerContext.moduleCode ?? OMNI_COMMS_DEFAULT_CALLER_MODULE;

  const { data, error } = await rpcClient.rpc(
    'omni_comms_priv_send_communication',
    {
      p_organization_id: canonical.organizationId,
      p_department_id: canonical.departmentId,
      p_event_code: canonical.eventCode,
      p_mode: canonical.mode,
      p_idempotency_key: input.idempotencyKey,
      p_caller_module_code: callerModule,
      p_caller_entity_type: canonical.callerContext.entityType,
      p_caller_entity_id: canonical.callerContext.entityId,
      p_correlation_id: input.correlationId ?? null,
      p_request_fingerprint: fingerprint,
      p_payload: canonical.payload,
      p_requested_channels: canonical.requestedChannels,
    },
  );

  if (error) {
    return blockedResult(input, mapRpcErrorToRuntimeCode(error));
  }

  const row = data as PersistenceRpcResult | null;
  if (!row || typeof row !== 'object' || !row.request_id) {
    return blockedResult(input, 'runtime_persistence_failed');
  }

  return {
    requestId: row.request_id,
    idempotencyKey: row.idempotency_key,
    mode: row.mode as OmniCommsSendMode,
    status: row.status,
    recipients: [],
    messages: [],
    blockers: ['runtime_resolution_pending'],
    createdAt: row.created_at,
    replayed: row.replayed === true,
  };
}
