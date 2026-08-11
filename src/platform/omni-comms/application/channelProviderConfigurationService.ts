/**
 * Omni-Comms — provider configuration (credentials + controlled test
 * recipients) client service.
 *
 * Boundaries (permanent):
 *   - A credential VALUE travels one way only: browser → trusted Edge
 *     Function → encrypted vault. It is never read back, never cached and
 *     never stored in component state after submission.
 *   - Status reads use bounded SECURITY DEFINER RPCs and return metadata
 *     only (configured / storage mode / last rotated / verification posture).
 *   - No provider SDK import and no send behaviour lives here.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  callOmniCommsRpc,
  OmniCommsRpcError,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';
import {
  isTestRecipientPurpose,
  type TestRecipientPurpose,
} from './testRecipientPurpose';

export type ProviderSecretPurpose = 'api_key' | 'webhook_signing';

export type ProviderSecretStorageMode = 'vault' | 'edge_env';

export type ProviderCredentialAccessClass =
  | 'sending'
  | 'full'
  | 'restricted'
  | 'unknown';

export interface ProviderSecretStatusRow {
  providerAccountId: string;
  providerAccountCode: string;
  providerAccountName: string;
  purpose: ProviderSecretPurpose | string;
  configured: boolean;
  storageMode: ProviderSecretStorageMode;
  secretRef: string;
  lastRotatedAt: string | null;
  accessClassification: ProviderCredentialAccessClass;
  verificationStatus: string | null;
  verificationResultCode: string | null;
  verificationCheckedAt: string | null;
}

export interface ProviderSecretConfiguration {
  organizationId: string;
  canManageCredentials: boolean;
  canConfigure: boolean;
  secrets: ProviderSecretStatusRow[];
  generatedAt: string;
}

export interface TestRecipientRow {
  id: string;
  label: string;
  address: string;
  addressMasked: boolean;
  purpose: string;
  channel: string;
  notes: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface TestRecipientSummary {
  organizationId: string;
  channel: string;
  canManage: boolean;
  recipients: TestRecipientRow[];
  generatedAt: string;
}

/** Human labels for the two credential purposes an Email provider needs. */
export const PROVIDER_SECRET_PURPOSE_LABELS: Record<string, string> = {
  api_key: 'Sending API key',
  webhook_signing: 'Webhook signing secret',
};

export const PROVIDER_SECRET_STORAGE_LABELS: Record<string, string> = {
  vault: 'Managed here (encrypted vault)',
  edge_env: 'Deployment secret (legacy)',
};

export const PROVIDER_SECRET_WRITE_MESSAGES: Record<string, string> = {
  ok: 'Credential saved securely. It can be replaced but never read back.',
  permission_denied: 'You do not have permission to configure this channel.',
  credential_permission_denied:
    'Saving a credential requires the provider-credential permission.',
  organization_access_denied: 'You do not have access to this organisation.',
  authentication_required: 'Sign in again to save this credential.',
  not_found: 'Provider account not found.',
  invalid_input: 'The credential request was incomplete.',
  invalid_secret_value: 'The value does not look like a usable credential.',
  credential_write_failed: 'The credential could not be saved. Try again.',
};

export function getProviderSecretConfiguration(
  client: OmniCommsRpcClient,
  organizationId: string,
): Promise<ProviderSecretConfiguration> {
  return callOmniCommsRpc<ProviderSecretConfiguration>(
    client,
    'omni_comms_provider_secret_configuration',
    { p_organization_id: organizationId },
  );
}

/** Observed health of inbound provider callbacks for one provider account. */
export type CallbackHealthState = 'healthy' | 'rejecting' | 'never_received';

export interface CallbackHealthRow {
  providerAccountId: string;
  providerAccountCode: string;
  providerAccountName: string;
  acceptedCount: number;
  rejectedCount: number;
  lastAcceptedAt: string | null;
  lastRejectedAt: string | null;
  lastRejectionReason: string | null;
  state: CallbackHealthState;
}

export interface CallbackHealthSummary {
  organizationId: string;
  accounts: CallbackHealthRow[];
  generatedAt: string;
}

/**
 * Read-only callback evidence projection. Never sends, never mutates and never
 * exposes secrets — only counts, timestamps and a bounded rejection reason.
 */
export function getCallbackHealth(
  client: OmniCommsRpcClient,
  organizationId: string,
): Promise<CallbackHealthSummary> {
  return callOmniCommsRpc<CallbackHealthSummary>(
    client,
    'omni_comms_channel_callback_health',
    { p_organization_id: organizationId },
  );
}

/** Operator-facing explanation for an observed callback health state. */
export const CALLBACK_HEALTH_GUIDANCE: Record<CallbackHealthState, string> = {
  healthy:
    'Signed provider callbacks are arriving and passing signature verification.',
  rejecting:
    'Callbacks are arriving but the signature does not match the saved signing secret. The secret saved here is different from the one the provider is signing with — replace it with the secret shown for THIS webhook endpoint in the provider console.',
  never_received:
    'No provider callback has ever reached this endpoint. The webhook is most likely not registered, or the registered URL is missing its ?account= parameter. Copy the URL below exactly as shown.',
};

export function getTestRecipientSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channel = 'email',
): Promise<TestRecipientSummary> {
  return callOmniCommsRpc<TestRecipientSummary>(
    client,
    'omni_comms_test_recipient_summary',
    { p_organization_id: organizationId, p_channel: channel },
  );
}

export interface UpsertTestRecipientInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  channel: string;
  label: string;
  address: string;
  /** Bounded vocabulary — mirrors the database CHECK constraint exactly. */
  purpose: TestRecipientPurpose;
  notes?: string | null;
  correlationId?: string | null;
}

export function upsertTestRecipient(
  client: OmniCommsRpcClient,
  input: UpsertTestRecipientInput,
): Promise<string> {
  // Bounded before transport: an out-of-vocabulary purpose can never reach the
  // database, so an operator can never be shown a raw CHECK-violation dump.
  if (!isTestRecipientPurpose(input.purpose)) {
    return Promise.reject(
      new OmniCommsRpcError('OC422', 'invalid_test_recipient_purpose'),
    );
  }
  return callOmniCommsRpc<string>(client, 'omni_comms_test_recipient_upsert', {
    p_id: input.id ?? null,
    p_expected_updated_at: input.expectedUpdatedAt ?? null,
    p_organization_id: input.organizationId,
    p_channel: input.channel,
    p_label: input.label,
    p_address: input.address,
    p_purpose: input.purpose,
    p_notes: input.notes ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export function setTestRecipientActive(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    isActive: boolean;
    correlationId?: string | null;
  },
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_test_recipient_set_active',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_is_active: input.isActive,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

export interface WriteProviderSecretResponse {
  ok: boolean;
  code: string;
  storageMode?: string | null;
  lastRotatedAt?: string | null;
  verificationReset?: boolean;
  httpStatus: number;
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url ? `${url.replace(/\/$/, '')}/functions/v1` : '/functions/v1';
}

/**
 * Write-only credential submission.
 *
 * The value is posted once to the trusted `omni-comms-runtime` boundary and
 * stored in the encrypted vault. No response ever contains credential
 * material, and no provider is contacted by this call.
 */
export async function writeProviderSecret(params: {
  organizationId: string;
  providerAccountId: string;
  purpose: ProviderSecretPurpose;
  secretValue: string;
  accessClassification?: ProviderCredentialAccessClass | null;
  correlationId?: string | null;
}): Promise<WriteProviderSecretResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const res = await fetch(`${functionsBaseUrl()}/omni-comms-runtime/provider-secret`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(anon ? { apikey: anon } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      organizationId: params.organizationId,
      providerAccountId: params.providerAccountId,
      purpose: params.purpose,
      secretValue: params.secretValue,
      accessClassification: params.accessClassification ?? null,
      correlationId: params.correlationId ?? null,
    }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* bounded */
  }

  return {
    ok: body.ok === true,
    code: typeof body.code === 'string' ? body.code : 'credential_write_failed',
    storageMode: (body.storageMode as string) ?? null,
    lastRotatedAt: (body.lastRotatedAt as string) ?? null,
    verificationReset: body.verificationReset === true,
    httpStatus: res.status,
  };
}
