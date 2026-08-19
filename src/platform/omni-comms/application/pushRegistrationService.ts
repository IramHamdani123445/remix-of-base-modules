/**
 * Omni-Comms — typed adapter over the governed Push registration
 * administration RPCs.
 *
 * Boundaries (permanent):
 *   - A device token is NEVER returned to, entered in, or displayed by an
 *     administration screen. Only a short non-reversible fingerprint is shown.
 *   - A registration is created only by the owning installation itself
 *     (auth-derived binding, server-side). Operators may inspect and retire.
 *   - Never imports a provider SDK and never contacts a provider.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';

export type PushPlatform = 'android' | 'ios' | 'web';

export interface PushRegistrationRow {
  id: string;
  platform: PushPlatform | string;
  state: string;
  recipient_reference: string | null;
  recipient_reference_verified: boolean;
  token_fingerprint: string;
  app_identifier: string | null;
  app_version: string | null;
  device_model: string | null;
  locale: string | null;
  failure_count: number;
  revoked_reason: string | null;
  last_seen_at: string | null;
  last_success_at: string | null;
  updated_at: string;
}

export interface PushDeliveryTargetRow {
  id: string;
  push_device_id: string;
  platform: string;
  attempt_status: string;
  provider_message_id: string | null;
  rejection_classification: string | null;
  error_code: string | null;
  attempted_at: string | null;
  settled_at: string | null;
}

export const PUSH_PLATFORM_LABEL: Record<string, string> = {
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
};

export function listPushRegistrations(
  client: OmniCommsRpcClient,
  organizationId: string,
  includeRetired = false,
): Promise<PushRegistrationRow[]> {
  return callOmniCommsRpc<PushRegistrationRow[]>(
    client,
    'omni_comms_push_device_admin_list',
    { p_organization_id: organizationId, p_include_retired: includeRetired },
  );
}

export function retirePushRegistration(
  client: OmniCommsRpcClient,
  id: string,
  reason?: string | null,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_push_device_admin_retire',
    { p_id: id, p_reason: reason ?? null },
  );
}

export function listPushDeliveryTargets(
  client: OmniCommsRpcClient,
  messageId: string,
): Promise<PushDeliveryTargetRow[]> {
  return callOmniCommsRpc<PushDeliveryTargetRow[]>(
    client,
    'omni_comms_push_delivery_target_list',
    { p_message_id: messageId },
  );
}
