/**
 * Omni-Comms Slice 2c-i — trusted send-communication runtime service.
 *
 * The public façade at src/platform/omni-comms/sendCommunication.ts calls
 * ONLY this entrypoint. Business modules must not import from
 * src/platform/omni-comms/runtime/** directly (enforced by the
 * architecture checker).
 *
 * Slice 2c-i change: authoritative canonicalization, fingerprinting and
 * persistence moved BEHIND the trusted Edge Function boundary
 * `omni-comms-runtime`. The browser side of the runtime performs only:
 *
 *   - cheap public-shape validation (server re-validates authoritatively),
 *   - transport invocation of the Edge Function with the raw input,
 *   - shielded mapping of transport errors to bounded blocker codes.
 *
 * The browser MUST NOT call the SECURITY DEFINER persistence RPC
 * directly — the RPC's EXECUTE grant has been revoked from
 * `authenticated` and moved to `service_role` only. The Edge Function is
 * the only path that reaches it.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  validateSendCommunicationInput,
  type SendCommunicationInput,
  type SendCommunicationResult,
  type OmniCommsSendMode,
} from '../sendCommunication';
import type { OmniCommsRuntimeErrorCode } from './runtimeErrors';

/**
 * Transport contract for the trusted runtime boundary. In production
 * this is the Supabase Functions client invocation of
 * `omni-comms-runtime`. Tests inject a mock transport to exercise
 * shielded error mapping without a live network call.
 */
export interface RuntimeTransport {
  invoke: (input: SendCommunicationInput) => Promise<{
    data: SendCommunicationResult | null;
    error: { message?: string; name?: string; status?: number } | null;
  }>;
}

const OMNI_COMMS_RUNTIME_FUNCTION = 'omni-comms-runtime';

const DEFAULT_TRANSPORT: RuntimeTransport = {
  invoke: async (input) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).functions.invoke(
      OMNI_COMMS_RUNTIME_FUNCTION,
      { body: input },
    );
    return {
      data: (data ?? null) as SendCommunicationResult | null,
      error: error ?? null,
    };
  },
};

function blockedResult(
  input: SendCommunicationInput,
  blockers: OmniCommsRuntimeErrorCode[],
): SendCommunicationResult {
  return {
    requestId: '',
    idempotencyKey: input?.idempotencyKey ?? '',
    mode: (input?.mode ?? 'dry_run') as OmniCommsSendMode,
    status: 'blocked',
    recipients: [],
    messages: [],
    blockers,
    createdAt: new Date(0).toISOString(),
    replayed: false,
  };
}

/**
 * Execute the trusted runtime pipeline via the Edge Function boundary.
 * Called from the public façade. Tests inject `transport` to bypass the
 * network layer while still exercising validation + error mapping.
 */
export async function executeSendCommunication(
  input: SendCommunicationInput,
  transport: RuntimeTransport = DEFAULT_TRANSPORT,
): Promise<SendCommunicationResult> {
  // 1) Cheap public-shape validation. Server re-validates authoritatively.
  const shapeBlockers = validateSendCommunicationInput(input);
  if (shapeBlockers.length > 0) {
    return blockedResult(input, shapeBlockers as OmniCommsRuntimeErrorCode[]);
  }

  // 2) Invoke the trusted Edge Function boundary. It authenticates,
  //    canonicalizes, fingerprints, and persists via service_role.
  let result: {
    data: SendCommunicationResult | null;
    error: { message?: string; name?: string; status?: number } | null;
  };
  try {
    result = await transport.invoke(input);
  } catch {
    return blockedResult(input, ['runtime_transport_failed']);
  }

  if (result.error && !result.data) {
    // Transport-level failure (network, 5xx without body). Never leak.
    const status = result.error.status ?? 0;
    if (status === 401) return blockedResult(input, ['authentication_required']);
    if (status === 403) return blockedResult(input, ['permission_denied']);
    return blockedResult(input, ['runtime_transport_failed']);
  }

  const row = result.data;
  if (!row || typeof row !== 'object' || typeof row.status !== 'string') {
    return blockedResult(input, ['runtime_persistence_failed']);
  }

  // The Edge Function returns an already-bounded SendCommunicationResult.
  // We defensively normalize array fields so a partial payload never
  // reaches the caller with undefined lists.
  return {
    requestId: row.requestId ?? '',
    idempotencyKey: row.idempotencyKey ?? (input.idempotencyKey ?? ''),
    mode: (row.mode ?? input.mode) as OmniCommsSendMode,
    status: row.status,
    recipients: Array.isArray(row.recipients) ? row.recipients : [],
    messages: Array.isArray(row.messages) ? row.messages : [],
    blockers: Array.isArray(row.blockers) ? row.blockers : [],
    createdAt: row.createdAt ?? new Date(0).toISOString(),
    replayed: row.replayed === true,
  };
}
