/**
 * Omni-Comms Event Routes — typed RPC adapter.
 *
 * Wraps the SECURITY DEFINER event-route administration RPCs. Never imports
 * the browser Supabase client; consumers pass a bound OmniCommsRpcClient.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';

export type OmniCommsChannel =
  | 'email' | 'sms' | 'whatsapp' | 'push' | 'in_app' | 'print';

export const OMNI_COMMS_CHANNELS: OmniCommsChannel[] = [
  'email', 'sms', 'whatsapp', 'push', 'in_app', 'print',
];

export type EventRouteLifecycle = 'draft' | 'active' | 'suspended' | 'retired';

export type SenderResolutionPolicy =
  | 'explicit' | 'event_default' | 'organisation_default';

export type PreferencePolicy = 'honour' | 'bypass_for_required' | 'ignore';

export interface EventRouteListItem {
  id: string;
  organization_id: string;
  department_id: string | null;
  event_definition_id: string;
  event_code: string;
  event_name: string;
  channel: OmniCommsChannel;
  is_required: boolean;
  is_enabled: boolean;
  priority: number;
  template_family_id: string | null;
  template_family_code: string | null;
  sender_identity_id: string | null;
  sender_identity_code: string | null;
  sender_resolution_policy: SenderResolutionPolicy;
  preference_policy: PreferencePolicy;
  lifecycle_state: EventRouteLifecycle;
  created_at: string;
  updated_at: string;
}

export interface EventRouteRow extends EventRouteListItem {
  [key: string]: unknown;
}

export interface UpsertEventRouteInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  eventDefinitionId: string;
  channel: OmniCommsChannel;
  isRequired?: boolean;
  isEnabled?: boolean;
  priority?: number;
  templateFamilyId?: string | null;
  senderIdentityId?: string | null;
  senderResolutionPolicy?: SenderResolutionPolicy;
  preferencePolicy?: PreferencePolicy;
  correlationId?: string | null;
}

export function listEventRoutes(
  client: OmniCommsRpcClient,
  input: {
    organizationId: string;
    departmentId?: string | null;
    eventDefinitionId?: string | null;
    channel?: OmniCommsChannel | null;
    lifecycleState?: EventRouteLifecycle | null;
    limit?: number;
    offset?: number;
  },
): Promise<EventRouteListItem[]> {
  return callOmniCommsRpc<EventRouteListItem[]>(client, 'omni_comms_event_route_list', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_event_definition_id: input.eventDefinitionId ?? null,
    p_channel: input.channel ?? null,
    p_lifecycle_state: input.lifecycleState ?? null,
    p_limit: input.limit ?? 100,
    p_offset: input.offset ?? 0,
  });
}

export function getEventRoute(
  client: OmniCommsRpcClient,
  id: string,
): Promise<EventRouteRow> {
  return callOmniCommsRpc<EventRouteRow>(client, 'omni_comms_event_route_get', { p_id: id });
}

export function upsertEventRouteDraft(
  client: OmniCommsRpcClient,
  input: UpsertEventRouteInput,
): Promise<string> {
  return callOmniCommsRpc<string>(client, 'omni_comms_event_route_upsert_draft', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_event_definition_id: input.eventDefinitionId,
    p_channel: input.channel,
    p_is_required: input.isRequired ?? false,
    p_is_enabled: input.isEnabled ?? false,
    p_priority: input.priority ?? 100,
    p_template_family_id: input.templateFamilyId ?? null,
    p_sender_identity_id: input.senderIdentityId ?? null,
    p_sender_resolution_policy: input.senderResolutionPolicy ?? 'organisation_default',
    p_preference_policy: input.preferencePolicy ?? 'honour',
    p_correlation_id: input.correlationId ?? null,
  });
}

export function setEventRouteLifecycle(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    targetState: 'active' | 'suspended' | 'retired';
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<void> {
  return callOmniCommsRpc<void>(client, 'omni_comms_event_route_set_lifecycle', {
    p_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_target_state: input.targetState,
    p_reason: input.reason ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}
