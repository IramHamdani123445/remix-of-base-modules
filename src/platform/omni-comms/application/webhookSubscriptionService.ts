/**
 * Omni-Comms — typed adapter over the webhook subscription administration
 * RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly; only bounded SECURITY DEFINER RPCs.
 *   - Never performs a DNS lookup, never fetches a subscriber URL, never
 *     emits through the façade and never creates a request, message,
 *     dispatch job or delivery attempt.
 *   - Only bounded Edge secret reference NAMES are captured; a signing secret
 *     value is never entered, stored or displayed here.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';

export type WebhookSubscriptionStatus = 'active' | 'suspended' | 'retired';

export interface WebhookSubscriptionRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  action_id: string | null;
  action_code: string | null;
  action_name: string | null;
  endpoint_id: string;
  endpoint_code: string;
  display_name: string;
  endpoint_status: string;
  payload_template_family_id: string | null;
  signing_secret_ref: string | null;
  endpoint_config_checksum: string | null;
  endpoint_current_checksum: string | null;
  status: WebhookSubscriptionStatus;
  data_origin: string | null;
  updated_at: string;
}

export interface CommunicationActionOption {
  id: string;
  code: string;
  name: string | null;
  recipient_role: string | null;
  status: string;
  department_id: string | null;
}

export interface UpsertWebhookSubscriptionInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  actionId: string;
  endpointId: string;
  payloadTemplateFamilyId?: string | null;
  signingSecretRef?: string | null;
}

/** Signing secret references are NAMES only, never values. */
export const WEBHOOK_SIGNING_SECRET_REF_PATTERN =
  /^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(_[A-Z0-9]+)*$/;

export function isValidWebhookSigningSecretRef(value: string): boolean {
  return WEBHOOK_SIGNING_SECRET_REF_PATTERN.test(value.trim());
}

/**
 * A subscription whose snapshotted endpoint checksum no longer matches the
 * endpoint's current configuration must be treated as drifted: the endpoint
 * was changed after the binding was approved.
 */
export function hasEndpointDrift(row: WebhookSubscriptionRow): boolean {
  return (
    row.status !== 'retired' &&
    !!row.endpoint_config_checksum &&
    !!row.endpoint_current_checksum &&
    row.endpoint_config_checksum !== row.endpoint_current_checksum
  );
}

export function listWebhookSubscriptions(
  client: OmniCommsRpcClient,
  organizationId: string,
  departmentId: string | null = null,
): Promise<WebhookSubscriptionRow[]> {
  return callOmniCommsRpc<WebhookSubscriptionRow[]>(
    client,
    'omni_comms_webhook_subscription_list',
    { p_organization_id: organizationId, p_department_id: departmentId },
  );
}

export function listCommunicationActions(
  client: OmniCommsRpcClient,
  organizationId: string,
  departmentId: string | null = null,
): Promise<CommunicationActionOption[]> {
  return callOmniCommsRpc<CommunicationActionOption[]>(
    client,
    'omni_comms_communication_action_list',
    { p_organization_id: organizationId, p_department_id: departmentId },
  );
}

export function upsertWebhookSubscription(
  client: OmniCommsRpcClient,
  input: UpsertWebhookSubscriptionInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_webhook_subscription_upsert',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_action_id: input.actionId,
      p_endpoint_id: input.endpointId,
      p_payload_template_family_id: input.payloadTemplateFamilyId ?? null,
      p_signing_secret_ref: input.signingSecretRef ?? null,
    },
  );
}

export function setWebhookSubscriptionLifecycle(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    action: 'activate' | 'suspend' | 'retire';
    reason?: string | null;
  },
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_webhook_subscription_set_lifecycle',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_action: input.action,
      p_reason: input.reason ?? null,
    },
  );
}
