/**
 * Omni-Comms — Email "Sender Addresses" operator model.
 *
 * Operator vocabulary layer over the internal `omni_comms_sender_identity`
 * record. The screen never calls the primary concept an "identity"; the
 * database object, service names and RPCs are unchanged.
 *
 * Boundaries (permanent):
 *   - No provider SDK, no send behaviour, no binding creation, no routing.
 *   - Domain readiness is BACKEND TRUTH. Nothing here re-derives DNS state.
 */

export type SenderAddressStatus = 'draft' | 'active' | 'disabled' | 'retired';

/** Friendly, operator-facing status shown in the list and details. */
export type SenderAddressDisplayStatus =
  | 'Draft'
  | 'Ready'
  | 'Active'
  | 'Disabled'
  | 'Retired'
  | 'Needs attention';

export interface SenderAddressRow {
  id: string;
  code: string;
  display_name: string;
  channel: 'email';
  identity_type: string | null;
  identity_config: Record<string, string>;
  department_id: string | null;
  department_name: string | null;
  status: SenderAddressStatus;
  data_origin: 'system_seed' | 'user' | 'reference_seed';
  from_address: string | null;
  from_name: string | null;
  reply_to_address: string | null;
  created_at: string;
  updated_at: string;
  activated_at: string | null;
  retired_at: string | null;
  retirement_reason: string | null;

  /** Backend-derived sending-domain and provider facts. */
  domain_name: string | null;
  channel_endpoint_id: string | null;
  channel_endpoint_code: string | null;
  channel_endpoint_status: string | null;
  domain_verification_status: string | null;
  domain_association_confirmed: boolean;
  domain_ready: boolean;
  provider_account_id: string | null;
  provider_account_code: string | null;
  provider_account_name: string | null;
  provider_account_status: string | null;

  usage_routes: number;
  usage_bindings: number;
  usage_messages: number;
  usage_test_deliveries: number;
  usage_total: number;

  activation_blocker: string | null;
  can_activate: boolean;
  can_hard_delete: boolean;
}

export interface SenderAddressSummary {
  organization_id: string;
  department_id: string | null;
  channel: 'email';
  can_manage: boolean;
  senders: SenderAddressRow[];
  reference_senders: SenderAddressRow[];
  reference_sender_count: number;
  generated_at: string;
}

export interface UpsertSenderAddressInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  code: string;
  displayName: string;
  fromAddress: string;
  replyToAddress?: string | null;
  correlationId?: string | null;
}

export const SENDER_ADDRESS_SCREEN_TITLE = 'Sender Addresses';

export const SENDER_ADDRESS_SCREEN_DESCRIPTION =
  'Manage the addresses recipients see Email coming from.';

export const REFERENCE_SENDER_READ_ONLY_HELP =
  'Reference sender — read-only, excluded from operational readiness and never used for real delivery.';

/** Operator wording for each backend activation blocker slug. */
export const SENDER_ADDRESS_BLOCKER_MESSAGES: Record<string, string> = {
  invalid_email_address: 'Enter a valid From address before activating.',
  display_name_required: 'Add a display name before activating.',
  domain_not_configured:
    'This sending domain has not been added to Omni-Comms yet.',
  domain_not_verified: 'This sending domain has not been verified.',
  domain_association_not_confirmed:
    'The sending domain is not yet confirmed against the provider account.',
  sending_domain_not_active: 'The sending domain is not active.',
  provider_account_unusable:
    'The provider account for this domain is not usable.',
  sender_has_dependencies:
    'This sender is already in use and cannot be permanently deleted.',
};

export function senderBlockerMessage(
  blocker: string | null | undefined,
  domain?: string | null,
): string | null {
  if (!blocker) return null;
  const base =
    SENDER_ADDRESS_BLOCKER_MESSAGES[blocker]
    ?? 'This sender cannot be activated yet.';
  if (blocker === 'domain_not_configured' && domain) {
    return `Domain ${domain} has not been added to Omni-Comms.`;
  }
  if (blocker === 'domain_not_verified' && domain) {
    return `Domain ${domain} has not been verified.`;
  }
  return base;
}

/** The one next action offered for a blocked sender. */
export function senderBlockerAction(
  blocker: string | null | undefined,
): { label: string; tab: string } | null {
  switch (blocker) {
    case 'domain_not_configured':
    case 'domain_not_verified':
    case 'domain_association_not_confirmed':
    case 'sending_domain_not_active':
      return { label: 'Configure domain', tab: 'endpoints' };
    case 'provider_account_unusable':
      return { label: 'Open provider account', tab: 'accounts' };
    default:
      return null;
  }
}

/** Email address shape accepted by the screen (backend re-validates). */
export const SENDER_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/;

export function isValidSenderEmail(value: string): boolean {
  return SENDER_EMAIL_PATTERN.test(value.trim());
}

/** Derive the sending domain from a From address. Never asked of the user. */
export function deriveSenderDomain(address: string): string | null {
  const at = address.trim().toLowerCase().split('@');
  if (at.length !== 2) return null;
  return at[1].trim() || null;
}

/**
 * Derive a stable technical code from the display name.
 * "Benefits Department" → "benefits_department".
 */
export function deriveSenderCode(displayName: string): string {
  const slug = displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return slug || 'sender';
}

/** Resolve a collision by appending _2, _3, … against the existing codes. */
export function resolveSenderCode(
  displayName: string,
  existingCodes: readonly string[],
): string {
  const base = deriveSenderCode(displayName);
  const taken = new Set(existingCodes.map((c) => c.trim().toLowerCase()));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** Friendly status combining lifecycle state and readiness facts. */
export function senderDisplayStatus(
  row: Pick<SenderAddressRow, 'status' | 'can_activate'>,
): SenderAddressDisplayStatus {
  switch (row.status) {
    case 'active':
      return 'Active';
    case 'disabled':
      return 'Disabled';
    case 'retired':
      return 'Retired';
    default:
      return row.can_activate ? 'Ready' : 'Draft';
  }
}

export function senderScopeLabel(row: SenderAddressRow): string {
  if (!row.department_id) return 'Organisation-wide';
  return row.department_name?.trim() || 'Department';
}

/** Operator sentence describing the sending domain state. */
export function senderDomainLabel(row: SenderAddressRow): string {
  if (!row.domain_name) return 'No domain';
  if (row.domain_ready) return `${row.domain_name} — Verified`;
  if (row.domain_verification_status === 'verified') {
    return `${row.domain_name} — Verified, association pending`;
  }
  if (!row.channel_endpoint_id) return `${row.domain_name} — Not configured`;
  return `${row.domain_name} — Not verified`;
}

/** Provider readiness for the sender (never a routing statement). */
export function senderProviderLabel(row: SenderAddressRow): string {
  if (!row.provider_account_name && !row.provider_account_code) {
    return 'No provider account';
  }
  const name = row.provider_account_name ?? row.provider_account_code;
  return row.domain_ready ? `${name} — Ready` : `${name} — Not ready`;
}

export function senderUsageLabel(row: SenderAddressRow): string {
  const parts: string[] = [`${row.usage_routes} route${row.usage_routes === 1 ? '' : 's'}`];
  if (row.usage_bindings > 0) parts.push(`${row.usage_bindings} provider binding${row.usage_bindings === 1 ? '' : 's'}`);
  if (row.usage_messages > 0) parts.push(`${row.usage_messages} historical message${row.usage_messages === 1 ? '' : 's'}`);
  if (row.usage_test_deliveries > 0) parts.push(`${row.usage_test_deliveries} test delivery`);
  return parts.join(' · ');
}

/** True when the row is reference/simulation data and must stay untouched. */
export function isReferenceSender(row: SenderAddressRow): boolean {
  return row.data_origin === 'reference_seed';
}
