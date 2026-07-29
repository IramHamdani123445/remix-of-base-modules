/**
 * Omni-Comms Accelerated Build 2 — typed adapter over channel-management RPCs.
 *
 * Every function accepts a supabase-like RPC client (see OmniCommsRpcClient)
 * and forwards to the SECURITY DEFINER RPCs. Errors bubble as OmniCommsRpcError
 * via the shared parseOmniCommsRpcError helper.
 */
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import type {
  EmailConfigSummary,
  UpsertBindingInput,
  UpsertChannelSettingInput,
  UpsertProviderAccountInput,
  UpsertSenderIdentityInput,
  CredentialCheckResult,
  VerificationStatus,
} from './channelManagementTypes';

// ─── Provider (Resend) ────────────────────────────────────────────────
export function ensureEmailProvider(
  client: OmniCommsRpcClient,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_email_provider_ensure', {
    p_correlation_id: correlationId ?? null,
  });
}

export function activateEmailProvider(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_email_provider_activate', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_correlation_id: correlationId ?? null,
  });
}

// ─── Provider account ────────────────────────────────────────────────
export function upsertProviderAccountDraft(
  client: OmniCommsRpcClient,
  input: UpsertProviderAccountInput,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_provider_account_upsert_draft', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_code: input.code,
    p_display_name: input.displayName,
    p_secret_ref: input.secretRef,
    p_region: input.region ?? null,
    p_sandbox_mode: input.sandboxMode ?? false,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function activateProviderAccount(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_provider_account_activate', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_correlation_id: correlationId ?? null,
  });
}

export function recordProviderAccountCredentialCheck(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  result: CredentialCheckResult,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(
    client,
    'omni_comms_provider_account_record_credential_check',
    {
      p_id: id,
      p_expected_updated_at: expectedUpdatedAt,
      p_result: result,
      p_correlation_id: correlationId ?? null,
    },
  );
}

// ─── Sender identity ─────────────────────────────────────────────────
export function upsertSenderIdentityDraft(
  client: OmniCommsRpcClient,
  input: UpsertSenderIdentityInput,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_sender_identity_upsert_draft', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_event_definition_id: input.eventDefinitionId ?? null,
    p_code: input.code,
    p_display_name: input.displayName,
    p_from_address: input.fromAddress,
    p_from_name: input.fromName ?? null,
    p_reply_to_address: input.replyToAddress ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function activateSenderIdentity(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_sender_identity_activate', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_correlation_id: correlationId ?? null,
  });
}

// ─── Binding ─────────────────────────────────────────────────────────
export function upsertBindingDraft(
  client: OmniCommsRpcClient,
  input: UpsertBindingInput,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_binding_upsert_draft', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_sender_identity_id: input.senderIdentityId,
    p_provider_account_id: input.providerAccountId,
    p_priority: input.priority ?? null,
    p_external_sender_ref: input.externalSenderRef ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function recordBindingVerification(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  status: Exclude<VerificationStatus, 'unverified'>,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_binding_record_verification', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_status: status,
    p_correlation_id: correlationId ?? null,
  });
}

export function activateBinding(
  client: OmniCommsRpcClient,
  id: string,
  expectedUpdatedAt: string,
  correlationId?: string | null,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_binding_activate', {
    p_id: id,
    p_expected_updated_at: expectedUpdatedAt,
    p_correlation_id: correlationId ?? null,
  });
}

// ─── Channel setting ─────────────────────────────────────────────────
export function upsertEmailChannelSetting(
  client: OmniCommsRpcClient,
  input: UpsertChannelSettingInput,
): Promise<string> {
  return callOmniCommsRpc(client, 'omni_comms_channel_setting_upsert', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_channel: 'email',
    p_enabled: input.enabled,
    p_live_delivery_enabled: input.liveDeliveryEnabled,
    p_quiet_hours_start: input.quietHoursStart ?? null,
    p_quiet_hours_end: input.quietHoursEnd ?? null,
    p_quiet_hours_timezone: input.quietHoursTimezone ?? null,
    p_per_minute_limit: input.perMinuteLimit ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

// ─── Summary ─────────────────────────────────────────────────────────
export function getEmailConfigSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
): Promise<EmailConfigSummary> {
  return callOmniCommsRpc<EmailConfigSummary>(
    client,
    'omni_comms_email_config_summary',
    { p_organization_id: organizationId },
  );
}
