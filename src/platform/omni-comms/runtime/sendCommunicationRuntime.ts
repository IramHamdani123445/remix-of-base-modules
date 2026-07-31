/**
 * Omni-Comms — trusted send-communication runtime service (browser side).
 *
 * The public façade at src/platform/omni-comms/sendCommunication.ts calls
 * ONLY this entrypoint. Business modules must not import from
 * src/platform/omni-comms/runtime/** directly (enforced by the
 * architecture checker).
 *
 * Authoritative canonicalization, AUTHORISATION, fingerprinting, resolution,
 * rendering and persistence all live BEHIND the trusted Edge Function
 * boundary `omni-comms-runtime`. The browser side performs only:
 *
 *   - cheap public-shape validation (server re-validates authoritatively),
 *   - transport invocation of the Edge Function with the raw input,
 *   - RUNTIME validation of the returned payload against the canonical
 *     versioned result contract (never a bare TypeScript cast),
 *   - shielded mapping of transport errors to bounded blocker codes.
 *
 * The browser MUST NOT call the SECURITY DEFINER persistence or
 * authorisation RPCs directly — their EXECUTE grants are service_role only.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  validateSendCommunicationInput,
  type SendCommunicationInput,
} from '../sendCommunication';
import {
  buildBlockedResult,
  parseSendCommunicationResult,
  type OmniCommsSendMode,
  type SendCommunicationResult,
} from './responseContract';
import type { OmniCommsRuntimeErrorCode } from './runtimeErrors';

/**
 * Transport contract for the trusted runtime boundary. In production
 * this is the Supabase Functions client invocation of
 * `omni-comms-runtime`. Tests inject a mock transport to exercise
 * shielded error mapping without a live network call.
 */
export interface RuntimeTransport {
  invoke: (input: SendCommunicationInput) => Promise<{
    data: unknown;
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
    return { data: data ?? null, error: error ?? null };
  },
};

function blocked(
  input: SendCommunicationInput,
  blockers: OmniCommsRuntimeErrorCode[],
): SendCommunicationResult {
  return buildBlockedResult(blockers, {
    idempotencyKey: input?.idempotencyKey ?? '',
    mode: (input?.mode ?? 'dry_run') as OmniCommsSendMode,
  });
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
    return blocked(input, shapeBlockers as OmniCommsRuntimeErrorCode[]);
  }

  // 2) Invoke the trusted Edge Function boundary. It authenticates,
  //    AUTHORISES, canonicalizes, fingerprints and persists via service_role.
  let result: {
    data: unknown;
    error: { message?: string; name?: string; status?: number } | null;
  };
  try {
    result = await transport.invoke(input);
  } catch {
    return blocked(input, ['runtime_transport_failed']);
  }

  if (result.error && !result.data) {
    // Transport-level failure (network, 5xx without body). Never leak.
    const status = result.error.status ?? 0;
    if (status === 401) return blocked(input, ['authentication_required']);
    if (status === 403) return blocked(input, ['permission_denied']);
    return blocked(input, ['runtime_transport_failed']);
  }

  // 3) Runtime contract validation. A payload that cannot be reconciled with
  //    the canonical contract is treated as a persistence failure — we never
  //    hand a partially-shaped object back to the caller.
  const parsed = parseSendCommunicationResult(result.data, {
    idempotencyKey: input.idempotencyKey,
    mode: input.mode,
  });
  if (!parsed) return blocked(input, ['runtime_persistence_failed']);
  return parsed;
}
