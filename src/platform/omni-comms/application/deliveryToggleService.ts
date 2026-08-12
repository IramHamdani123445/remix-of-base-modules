/**
 * Omni-Comms — plain-language delivery switch.
 *
 * The operator answers ONE question: should this module's business Email be
 * sent automatically? Every technical fact (release state, prerequisites,
 * certification, scheduler health) is derived by the server; this module only
 * translates the server's verdict into words an administrator can act on.
 *
 * Boundaries:
 *   - Pure translation plus one read RPC and one trusted Edge action.
 *   - Never decides readiness in the browser, never contacts a provider,
 *     never bypasses the two-person live approval.
 */
import type { OmniCommsRpcClient } from '@/platform/omni-comms/infrastructure/rpcClient';

export type DeliveryToggleState =
  | 'on'
  | 'off'
  | 'awaiting_approval'
  | 'action_required'
  | 'suspended';

export interface DeliveryIndicator {
  readonly key: string;
  readonly ready: boolean;
  readonly codes: readonly string[];
}

export interface DeliveryToggleSnapshot {
  readonly channel: string;
  readonly state: DeliveryToggleState;
  readonly indicators: readonly DeliveryIndicator[];
  readonly blockers: readonly string[];
  readonly canEnable: boolean;
  readonly canDisable: boolean;
  readonly awaitingSelfApproval: boolean;
  readonly permittedEventCodes: readonly string[];
  readonly permittedModules: readonly string[];
  readonly evidence: {
    readonly queueDepth: number;
    readonly lastAttemptAt: string | null;
    readonly lastAcceptedAt: string | null;
    readonly lastDeliveredAt: string | null;
    readonly schedulerLastRunAt: string | null;
    readonly schedulerHealthy: boolean;
  };
  readonly generatedAt: string | null;
}

export const INDICATOR_LABEL: Record<string, string> = {
  provider: 'Email provider account',
  sender_domain: 'Sender address and domain',
  events_templates: 'Business events and letters',
  dispatcher: 'Automatic sending service',
  callbacks: 'Delivery result tracking',
  safety: 'Safety limits and approvals',
};

export const STATE_LABEL: Record<DeliveryToggleState, string> = {
  on: 'ON — sending automatically',
  off: 'OFF — nothing is sent',
  awaiting_approval: 'Waiting for a second approver',
  action_required: 'Setup incomplete',
  suspended: 'OFF — paused by an operator',
};

export const STATE_EXPLANATION: Record<DeliveryToggleState, string> = {
  on:
    'Configured business Email is being sent automatically to the recipient held '
    + 'on the business transaction.',
  off:
    'Everything needed is in place. Turn the switch on to request automatic '
    + 'sending; a second person must confirm it.',
  awaiting_approval:
    'A request to start automatic sending is recorded. A different administrator '
    + 'must turn the switch on to confirm it.',
  action_required:
    'Some setup is still outstanding. The items marked below must be completed '
    + 'before automatic sending can be requested.',
  suspended:
    'Automatic sending was turned off by an operator. Turn it on again to '
    + 'request it, with a second person confirming.',
};

/** Plain-English meaning of the server's blocker codes. */
export const BLOCKER_MESSAGE: Record<string, string> = {
  release_control_missing: 'No delivery rules exist yet for this organisation.',
  reference_release_non_operational:
    'This scope only holds an example record, which can never send.',
  deployed_revision_unavailable:
    'The deployed version of the sending service could not be confirmed.',
  runtime_environment_known: 'The environment has not been confirmed yet.',
  runtime_certification_effective: 'This deployment has not been certified yet.',
  deployed_revision_matches_certification:
    'The running version does not match the certified version.',
  provider_present: 'No email provider is connected.',
  provider_account_active: 'The email provider account is not active.',
  provider_credentials_complete: 'The provider sending key is incomplete.',
  provider_credentials_verified: 'The provider sending key has not been verified.',
  sender_identity_active: 'No active sender address is configured.',
  sending_domain_active: 'No active sending domain is configured.',
  sending_domain_verified: 'The sending domain is not verified with the provider.',
  binding_active: 'The sender address is not linked to the provider account.',
  binding_provider_verified: 'The sender link has not been verified by the provider.',
  callback_endpoint_active: 'Delivery result tracking is not switched on.',
  signed_delivery_callback_received: 'No verified delivery result has been received yet.',
  no_bounce_or_complaint_evidence: 'A bounce or complaint is recorded against the test send.',
  producer_binding_active: 'No business event is wired to this channel.',
  event_route_active: 'The business event has no active route.',
  template_family_active: 'No active letter template exists for the event.',
  published_template_version_present: 'The letter template has no published version.',
  current_preflight_passed: 'The zero-send configuration check has not passed.',
  technical_provider_delivery_accepted: 'The technical test delivery has not been accepted.',
  release_volume_limits_valid: 'The sending limits are not valid.',
  business_dispatch_dispatcher_installed: 'The automatic sending service is not installed.',
  effective_policy_present: 'No email policy exists for this organisation.',
  policy_test_or_pilot_state: 'The email policy is not in a state that allows sending.',
};

export const describeBlocker = (code: string): string =>
  BLOCKER_MESSAGE[code] ?? `Outstanding setup item: ${code.replace(/_/g, ' ')}.`;

const asArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

export const parseDeliveryToggleSnapshot = (raw: unknown): DeliveryToggleSnapshot | null => {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, any>;
  const state = (['on', 'off', 'awaiting_approval', 'action_required', 'suspended']
    .includes(row.state) ? row.state : 'action_required') as DeliveryToggleState;
  const evidence = (row.evidence ?? {}) as Record<string, any>;
  const release = (row.release ?? {}) as Record<string, any>;
  return {
    channel: typeof row.channel === 'string' ? row.channel : 'email',
    state,
    indicators: Array.isArray(row.indicators)
      ? row.indicators.map((i: any) => ({
        key: String(i?.key ?? ''),
        ready: i?.ready === true,
        codes: asArray(i?.codes),
      }))
      : [],
    blockers: asArray(row.blockers),
    canEnable: row.can_enable === true,
    canDisable: row.can_disable === true,
    awaitingSelfApproval: row.awaiting_self_approval === true,
    permittedEventCodes: asArray(release.permitted_event_codes),
    permittedModules: asArray(release.permitted_caller_modules),
    evidence: {
      queueDepth: Number(evidence.queue_depth ?? 0),
      lastAttemptAt: evidence.last_attempt_at ?? null,
      lastAcceptedAt: evidence.last_accepted_at ?? null,
      lastDeliveredAt: evidence.last_delivered_at ?? null,
      schedulerLastRunAt: evidence.scheduler_last_run_at ?? null,
      schedulerHealthy: evidence.scheduler_healthy === true,
    },
    generatedAt: typeof row.generated_at === 'string' ? row.generated_at : null,
  };
};

export const getDeliveryToggleSnapshot = async (
  client: OmniCommsRpcClient,
  params: { organizationId: string; departmentId?: string | null; channel?: string },
): Promise<DeliveryToggleSnapshot | null> => {
  const res = await client.rpc('omni_comms_live_delivery_state', {
    p_organization_id: params.organizationId,
    p_department_id: params.departmentId ?? null,
    p_channel: params.channel ?? 'email',
  });
  if (res.error) throw new Error(res.error.message ?? 'delivery_state_unavailable');
  return parseDeliveryToggleSnapshot(res.data);
};

/** Body for the trusted Edge boundary. The browser sends scope and intent only. */
export const buildDeliveryRequestBody = (params: {
  organizationId: string;
  departmentId?: string | null;
  channel?: string;
  intent: 'enable' | 'disable';
}) => ({
  action: 'delivery_request' as const,
  organizationId: params.organizationId,
  departmentId: params.departmentId ?? null,
  channel: params.channel ?? 'email',
  intent: params.intent,
});
