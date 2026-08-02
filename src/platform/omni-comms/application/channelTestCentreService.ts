/**
 * Omni-Comms C5A — typed adapter over the Channel Test Centre RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never imports a provider SDK, never calls sendCommunication, never
 *     creates a request, message, dispatch job or delivery attempt, and never
 *     performs a network call to a provider.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  ChannelTestCentreSummary,
  RunChannelTestPreflightInput,
  RunChannelTestPreflightResult,
  TestCentreChannel,
} from './channelTestCentreTypes';

export function getChannelTestCentreSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel: TestCentreChannel,
  departmentId: string | null = null,
  bindingId: string | null = null,
  historyLimit = 20,
): Promise<ChannelTestCentreSummary> {
  return callOmniCommsRpc<ChannelTestCentreSummary>(
    client,
    'omni_comms_channel_test_centre_summary',
    {
      p_organization_id: organizationId,
      p_department_id: departmentId,
      p_channel: channel,
      p_binding_id: bindingId,
      p_history_limit: historyLimit,
    },
  );
}

/**
 * Runs a configuration preflight. This NEVER sends a message: the RPC records
 * an immutable ledger row and returns the checklist outcome only.
 */
export function runChannelTestPreflight(
  client: OmniCommsRpcClient,
  input: RunChannelTestPreflightInput,
): Promise<RunChannelTestPreflightResult> {
  return callOmniCommsRpc<RunChannelTestPreflightResult>(
    client,
    'omni_comms_channel_test_run_preflight',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_channel: input.channel,
      p_binding_id: input.bindingId,
      p_target: input.target,
      p_payload: input.payload,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}
