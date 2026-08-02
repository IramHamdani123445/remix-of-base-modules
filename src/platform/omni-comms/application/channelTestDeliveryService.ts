/**
 * Omni-Comms — typed adapter for controlled channel test delivery.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; callers pass a bound RPC
 *     client and a bound function invoker.
 *   - Never imports a provider SDK and never contacts a provider from the
 *     browser: the credential never leaves the trusted edge boundary.
 *   - Never calls sendCommunication and never writes an Omni-Comms runtime
 *     table. The evidence ledger is written server-side only.
 */
import {
  callOmniCommsRpc,
  OmniCommsRpcError,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelTestDeliveryApproval,
  ChannelTestDeliveryDiagnostics,
  ChannelTestDeliveryResult,
  RunChannelTestDeliveryInput,
} from './channelTestDeliveryTypes';
import type { TestCentreChannel } from './channelTestCentreTypes';

/** Trusted-boundary transport. Production binds this to the Edge Function. */
export interface ChannelTestDeliveryTransport {
  invoke: (body: Record<string, unknown>) => Promise<{
    data: unknown;
    error: { message?: string; name?: string; status?: number } | null;
  }>;
}

export const OMNI_COMMS_TEST_DELIVERY_FUNCTION = 'omni-comms-test-delivery';

export function getChannelTestDeliveryDiagnostics(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: TestCentreChannel,
  departmentId: string | null = null,
  bindingId: string | null = null,
  limit = 20,
): Promise<ChannelTestDeliveryDiagnostics> {
  return callOmniCommsRpc<ChannelTestDeliveryDiagnostics>(
    client,
    'omni_comms_channel_test_delivery_diagnostics',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_channel: channel,
      p_binding_id: bindingId,
      p_limit: limit,
    },
  );
}

export function setChannelTestDeliveryApproval(
  client: OmniCommsRpcClient,
  input: {
    organizationId: string;
    departmentId?: string | null;
    channel: TestCentreChannel;
    enabled: boolean;
    recipients: readonly string[];
  },
): Promise<ChannelTestDeliveryApproval> {
  return callOmniCommsRpc<ChannelTestDeliveryApproval>(
    client,
    'omni_comms_channel_test_delivery_set_approval',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_enabled: input.enabled,
      p_recipients: [...input.recipients],
    },
  );
}

/**
 * Requests one authorised technical test delivery. Every safety decision is
 * made server-side; a retry with the same idempotency key returns the existing
 * evidence row without contacting the provider again.
 */
export async function runChannelTestDelivery(
  transport: ChannelTestDeliveryTransport,
  input: RunChannelTestDeliveryInput,
): Promise<ChannelTestDeliveryResult> {
  const { data, error } = await transport.invoke({
    testRunId: input.testRunId,
    target: input.target,
    idempotencyKey: input.idempotencyKey,
    subject: input.subject ?? '',
    bodyText: input.bodyText ?? '',
    correlationId: input.correlationId ?? null,
  });

  const payload = (data ?? null) as Record<string, unknown> | null;

  if (error || (payload && typeof payload.error === 'string')) {
    const code = payload && typeof payload.error === 'string' ? payload.error : 'OC500';
    const detail = payload && typeof payload.detail === 'string'
      ? payload.detail
      : error?.message ?? 'test_delivery_failed';
    throw new OmniCommsRpcError(
      /^OC\d{3}$/.test(code) ? (code as never) : 'OC500',
      detail,
      `${code}: ${detail}`,
    );
  }

  return {
    replayed: payload?.replayed === true,
    dispatched: payload?.dispatched === true,
    delivery: (payload?.delivery ?? null) as ChannelTestDeliveryResult['delivery'],
  };
}
