/**
 * Omni-Comms — Module → Sender Profile application service.
 *
 * Typed adapter over the bounded SECURITY DEFINER module-sender-profile RPCs.
 *
 * Boundaries (permanent):
 *   - Never imports the browser Supabase singleton; the caller passes a bound
 *     Omni-Comms RPC client.
 *   - Never queries tables directly, never imports a provider SDK, never
 *     sends, and never mutates an event route.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';
import type {
  ModuleSenderBootstrapResult,
  ModuleSenderImpact,
  ModuleSenderProfileRole,
  ModuleSenderProfileSummary,
  ModuleSenderResolution,
} from './moduleSenderProfileTypes';

export function getModuleSenderProfileSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel = 'email',
): Promise<ModuleSenderProfileSummary> {
  return callOmniCommsRpc<ModuleSenderProfileSummary>(
    client,
    'omni_comms_module_sender_profile_summary',
    { p_organization_id: organizationId, p_channel: channel },
  );
}

export interface UpsertModuleSenderProfileInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  callerModuleCode: string;
  channel: string;
  senderIdentityId: string;
  profileRole?: ModuleSenderProfileRole;
  communicationClass?: string | null;
  isDefault?: boolean;
  allowEventOverride?: boolean;
  allowOrganizationFallback?: boolean;
  correlationId?: string | null;
}

export function upsertModuleSenderProfileDraft(
  client: OmniCommsRpcClient,
  input: UpsertModuleSenderProfileInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_module_sender_profile_upsert_draft',
    {
      p_id: input.id ?? null,
      p_expected_updated_at: input.expectedUpdatedAt ?? null,
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
      p_caller_module_code: input.callerModuleCode,
      p_channel: input.channel,
      p_sender_identity_id: input.senderIdentityId,
      p_profile_role: input.profileRole ?? 'default',
      p_communication_class: input.communicationClass ?? null,
      p_is_default: input.isDefault ?? false,
      p_allow_event_override: input.allowEventOverride ?? true,
      p_allow_organization_fallback: input.allowOrganizationFallback ?? false,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export function setModuleSenderProfileLifecycle(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    action: 'activate' | 'disable' | 'retire';
    reason?: string | null;
    correlationId?: string | null;
  },
): Promise<{ id: string; status: string; impact: ModuleSenderImpact }> {
  return callOmniCommsRpc(client, 'omni_comms_module_sender_profile_set_lifecycle', {
    p_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_action: input.action,
    p_reason: input.reason ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function getModuleSenderProfileImpact(
  client: OmniCommsRpcClient,
  id: string,
): Promise<ModuleSenderImpact> {
  return callOmniCommsRpc<ModuleSenderImpact>(
    client,
    'omni_comms_module_sender_profile_impact',
    { p_id: id },
  );
}

export function deleteModuleSenderProfile(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId: string | null = null,
): Promise<{ id: string; deleted: boolean }> {
  return callOmniCommsRpc(client, 'omni_comms_module_sender_profile_delete', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_correlation_id: correlationId,
  });
}

/**
 * Configuration-time resolution for an event. Used to preselect the module
 * default when an operator creates a NEW route. Never called at send time.
 */
export function resolveModuleSenderForEvent(
  client: OmniCommsRpcClient,
  organizationId: string,
  eventDefinitionId: string,
  channel = 'email',
): Promise<ModuleSenderResolution> {
  return callOmniCommsRpc<ModuleSenderResolution>(
    client,
    'omni_comms_module_sender_profile_resolve',
    {
      p_organization_id: organizationId,
      p_event_definition_id: eventDefinitionId,
      p_channel: channel,
    },
  );
}

/** Idempotent module-assignment bootstrap. `apply=false` previews only. */
export function bootstrapModuleSenderProfiles(
  client: OmniCommsRpcClient,
  organizationId: string,
  apply: boolean,
  channel = 'email',
  correlationId: string | null = null,
): Promise<ModuleSenderBootstrapResult> {
  return callOmniCommsRpc<ModuleSenderBootstrapResult>(
    client,
    'omni_comms_module_sender_profile_bootstrap',
    {
      p_organization_id: organizationId,
      p_apply: apply,
      p_channel: channel,
      p_correlation_id: correlationId,
    },
  );
}
