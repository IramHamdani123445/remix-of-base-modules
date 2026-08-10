/**
 * Omni-Comms — sending-domain verification (external claim + DNS evidence).
 *
 * Why this exists: the runtime Resend credential is deliberately
 * SENDING-ONLY, so it cannot read the provider's domain API. An operator
 * therefore verifies the sending domain in the provider's own console. That
 * claim is never trusted on its own — the trusted server independently
 * resolves the DNS records the provider requires and records what it
 * observed. Only server-observed evidence can mark a domain verified.
 *
 * Boundaries (permanent):
 *   - The browser performs NO DNS lookup and contacts NO provider.
 *   - Reads/writes go through bounded SECURITY DEFINER RPCs; the DNS probe
 *     goes through the trusted `omni-comms-runtime` Edge Function.
 *   - No credential material is sent, returned or displayed.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  callOmniCommsRpc,
  type OmniCommsRpcClient,
} from './omniCommsRpcErrors';

export type DomainVerificationSource =
  | 'unknown'
  | 'provider_api'
  | 'external_provider_plus_dns'
  | 'external_admin_attestation';

export type DomainVerificationStatus =
  | 'external_verification_required'
  | 'pending'
  | 'verified'
  | 'failed';

/**
 * `contains` is a LEGACY generic mode kept only so historic rows remain
 * readable. Readiness requires exact modes.
 */
export type DnsMatchMode = 'contains' | 'equals' | 'exact_txt' | 'exact_mx';

export const EXACT_DNS_MATCH_MODES: readonly DnsMatchMode[] = [
  'equals',
  'exact_txt',
  'exact_mx',
];

export interface ExpectedDnsRecord {
  recordType: 'TXT' | 'MX' | 'CNAME' | 'A';
  name: string;
  expectedValue: string;
  matchMode: DnsMatchMode;
  required: boolean;
  purpose?: string | null;
  /** Exact MX priority published by the provider (exact_mx only). */
  expectedPriority?: number | null;
}

export interface DnsEvidenceEntry extends ExpectedDnsRecord {
  observed: string[];
  matched: boolean;
  resolverStatus: string;
}

export type ProviderDomainStatus =
  | 'not_started'
  | 'pending'
  | 'temporary_failure'
  | 'verified'
  | 'failed'
  | 'not_found';

export type SendingCapability = 'enabled' | 'disabled' | 'unknown';

export interface DomainVerificationRow {
  id: string;
  channelEndpointId: string;
  providerAccountId: string | null;
  domainName: string;
  verificationSource: DomainVerificationSource;
  claimedStatus: string | null;
  providerReference: string | null;
  expectedDns: ExpectedDnsRecord[];
  dnsEvidence: DnsEvidenceEntry[];
  dnsCheckedAt: string | null;
  status: DomainVerificationStatus;
  resultCode: string | null;
  detail: string | null;
  notes: string | null;
  verifiedAt: string | null;
  updatedAt: string;
  /** Human labels for the provider account the domain is claimed against. */
  providerAccountCode?: string | null;
  providerAccountName?: string | null;
  /** Exact, non-secret provider domain facts captured from the console. */
  providerCode?: string | null;
  providerDomainId?: string | null;
  providerDomainStatus?: ProviderDomainStatus | null;
  providerDomainRegion?: string | null;
  sendingCapability?: SendingCapability | null;
  /** Freshness windows applied by the server to each kind of evidence. */
  dnsFreshnessDays?: number | null;
  associationFreshnessDays?: number | null;
  dnsFresh?: boolean;
  associationFresh?: boolean;
  expectationsExact?: boolean;
  accountMatchesEndpoint?: boolean;
  endpointProviderAccountId?: string | null;
  endpointChannel?: string | null;
  /** Server-computed single next blocker; authoritative when present. */
  readinessBlocker?: string | null;
  /**
   * Provider-account association evidence. DNS proves domain control; it does
   * NOT prove the domain lives in the exact provider account used at runtime.
   */
  associationConfirmed: boolean;
  associationProviderStatus: string | null;
  associationProviderReference: string | null;
  associationNote: string | null;
  associationConfirmedAt: string | null;
  /**
   * Server truth: exact expectations matched, association confirmed against
   * the endpoint's own provider account, and all evidence still fresh.
   */
  readyForProviderAccount: boolean;
}


export interface DomainVerificationSummary {
  organizationId: string;
  canManage: boolean;
  domains: DomainVerificationRow[];
  generatedAt: string;
}

export const DOMAIN_VERIFICATION_STATUS_LABELS: Record<string, string> = {
  external_verification_required: 'External verification required',
  pending: 'Awaiting DNS evidence',
  verified: 'Verified by DNS evidence',
  failed: 'DNS evidence did not match',
};

export const DOMAIN_VERIFICATION_SOURCE_LABELS: Record<string, string> = {
  unknown: 'Not recorded',
  provider_api: 'Confirmed by provider API',
  external_provider_plus_dns:
    'Verified in the provider console, proven here by DNS',
  external_admin_attestation:
    'Administrator statement only (never treated as verified)',
};

export const DOMAIN_VERIFICATION_RESULT_MESSAGES: Record<string, string> = {
  verified: 'Every required DNS record was observed by the server.',
  dns_mismatch:
    'One or more required DNS records are published but do not match the expected value.',
  dns_records_missing:
    'One or more required DNS records are not published yet. DNS changes can take time to propagate.',
  dns_lookup_failed: 'The DNS resolver could not be reached. Try again shortly.',
  awaiting_dns_evidence: 'No DNS check has been run for this domain yet.',
  permission_denied: 'You do not have permission to verify sending domains.',
  organization_access_denied: 'You do not have access to this organisation.',
  authentication_required: 'Sign in again to verify this domain.',
  not_found: 'Sending-domain record not found.',
  configuration_incomplete:
    'Record the DNS records the provider requires before running a check.',
  invalid_input: 'The verification request was incomplete.',
  verification_unavailable: 'The verification service is unavailable.',
  verification_not_recorded: 'The evidence could not be saved. Try again.',
};

/**
 * Exact provider domain facts, copied by an administrator from the provider
 * console. Nothing here is secret, and none of it is guessed: a generic
 * "looks like Resend" expectation is no longer accepted as evidence.
 */
export interface ResendDomainFacts {
  /** Exact TXT value published at `send.<domain>` (the SPF record). */
  spfValue: string;
  /** Exact MX host published at `send.<domain>`. */
  mxHost: string;
  /** Exact MX priority published at `send.<domain>`. */
  mxPriority: number;
  /** DKIM selector, e.g. `resend`. */
  dkimSelector: string;
  /** Exact DKIM TXT value, including `p=`. */
  dkimValue: string;
}

export const RESEND_DEFAULT_DKIM_SELECTOR = 'resend';

export const EXACT_FACTS_REQUIRED_HELP =
  'Copy the exact SPF value, MX host and priority, and DKIM key from the '
  + 'provider console. Generic expectations such as “contains amazonses.com” '
  + 'are no longer accepted as evidence that this domain is configured.';

/** True only when every required expectation states an exact provider value. */
export function expectationsAreExact(
  records: readonly ExpectedDnsRecord[],
): boolean {
  const required = records.filter((r) => r.required);
  return required.length > 0
    && required.every((r) => EXACT_DNS_MATCH_MODES.includes(r.matchMode));
}

/**
 * Builds the EXACT DNS expectations for a Resend sending domain from facts an
 * administrator read in the provider console. Values are compared exactly;
 * the MX priority is part of the comparison.
 */
export function resendExpectedDnsRecords(
  domain: string,
  facts: ResendDomainFacts,
): ExpectedDnsRecord[] {
  const d = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const selector = (facts.dkimSelector || RESEND_DEFAULT_DKIM_SELECTOR)
    .trim().toLowerCase().replace(/\.$/, '');
  return [
    {
      recordType: 'TXT',
      name: `send.${d}`,
      expectedValue: facts.spfValue.trim(),
      matchMode: 'exact_txt',
      required: true,
      purpose: 'spf',
    },
    {
      recordType: 'MX',
      name: `send.${d}`,
      expectedValue: facts.mxHost.trim().toLowerCase().replace(/\.$/, ''),
      matchMode: 'exact_mx',
      required: true,
      purpose: 'bounce_feedback',
      expectedPriority: facts.mxPriority,
    },
    {
      recordType: 'TXT',
      name: `${selector}._domainkey.${d}`,
      expectedValue: facts.dkimValue.trim(),
      matchMode: 'exact_txt',
      required: true,
      purpose: 'dkim',
    },
  ];
}

export function getDomainVerificationSummary(
  client: OmniCommsRpcClient,
  organizationId: string,
  channelEndpointId: string | null = null,
): Promise<DomainVerificationSummary> {
  return callOmniCommsRpc<DomainVerificationSummary>(
    client,
    'omni_comms_domain_verification_summary',
    {
      p_organization_id: organizationId,
      p_channel_endpoint_id: channelEndpointId,
    },
  );
}

export interface UpsertDomainVerificationInput {
  organizationId: string;
  channelEndpointId: string;
  domainName: string;
  providerAccountId?: string | null;
  verificationSource: DomainVerificationSource;
  claimedStatus?: string | null;
  providerReference?: string | null;
  expectedDns: readonly ExpectedDnsRecord[];
  notes?: string | null;
  /** Exact provider domain facts; a change to any of these voids old evidence. */
  providerCode?: string | null;
  providerDomainId?: string | null;
  providerDomainStatus?: ProviderDomainStatus | null;
  providerDomainRegion?: string | null;
  sendingCapability?: SendingCapability | null;
}

export function upsertDomainVerification(
  client: OmniCommsRpcClient,
  input: UpsertDomainVerificationInput,
): Promise<string> {
  return callOmniCommsRpc<string>(
    client,
    'omni_comms_domain_verification_upsert',
    {
      p_organization_id: input.organizationId,
      p_channel_endpoint_id: input.channelEndpointId,
      p_domain_name: input.domainName.trim().toLowerCase(),
      p_provider_account_id: input.providerAccountId ?? null,
      p_verification_source: input.verificationSource,
      p_claimed_status: input.claimedStatus ?? null,
      p_provider_reference: input.providerReference ?? null,
      p_expected_dns: input.expectedDns,
      p_notes: input.notes ?? null,
      p_provider_code: input.providerCode ?? 'resend',
      p_provider_domain_id: input.providerDomainId ?? null,
      p_provider_domain_status: input.providerDomainStatus ?? null,
      p_provider_domain_region: input.providerDomainRegion ?? null,
      p_sending_capability: input.sendingCapability ?? 'unknown',
    },
  );

}

export interface VerifySendingDomainResponse {
  ok: boolean;
  code: string;
  status: string | null;
  detail: string | null;
  domainName: string | null;
  evidence: DnsEvidenceEntry[];
  httpStatus: number;
}

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url ? `${url.replace(/\/$/, '')}/functions/v1` : '/functions/v1';
}

/**
 * Asks the trusted runtime to resolve the recorded DNS expectations and store
 * what it observed. The browser never resolves DNS itself, and no email is
 * sent by this action.
 */
export async function verifySendingDomain(params: {
  organizationId: string;
  domainVerificationId: string;
}): Promise<VerifySendingDomainResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const res = await fetch(
    `${functionsBaseUrl()}/omni-comms-runtime/verify-sending-domain`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(anon ? { apikey: anon } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        organizationId: params.organizationId,
        domainVerificationId: params.domainVerificationId,
      }),
    },
  );

  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* bounded */ }

  return {
    ok: body.ok === true,
    code: typeof body.code === 'string' ? body.code : 'verification_unavailable',
    status: (body.status as string) ?? null,
    detail: (body.detail as string) ?? null,
    domainName: (body.domainName as string) ?? null,
    evidence: Array.isArray(body.evidence) ? (body.evidence as DnsEvidenceEntry[]) : [],
    httpStatus: res.status,
  };
}

/**
 * Structured provider-account association.
 *
 * DNS evidence proves the domain is configured for the provider's
 * infrastructure. It cannot prove the domain is registered in the SAME
 * provider account the runtime credential belongs to, because that credential
 * is deliberately sending-only. An administrator therefore confirms the
 * association from the provider console, and that confirmation is stored as
 * structured, non-secret evidence with actor and server timestamp.
 */
export const PROVIDER_CONSOLE_STATUSES = [
  'verified',
  'pending',
  'failed',
  'not_found',
] as const;

export type ProviderConsoleStatus = (typeof PROVIDER_CONSOLE_STATUSES)[number];

export const PROVIDER_CONSOLE_STATUS_LABELS: Record<ProviderConsoleStatus, string> = {
  verified: 'Verified in the provider console',
  pending: 'Pending in the provider console',
  failed: 'Failed in the provider console',
  not_found: 'Not present in this provider account',
};

export const ASSOCIATION_REQUIRED_HELP =
  'DNS proves the domain is configured, but not that it lives in the same '
  + 'provider account this platform sends with. Confirm the association from '
  + 'the provider console before the domain is treated as ready.';

export interface ConfirmDomainAssociationInput {
  organizationId: string;
  domainVerificationId: string;
  providerAccountId: string;
  providerConsoleStatus: ProviderConsoleStatus;
  providerReference?: string | null;
  note?: string | null;
}

export interface ConfirmDomainAssociationResult {
  id: string;
  domainName: string;
  providerAccountCode: string;
  providerAccountName: string;
  associationConfirmed: boolean;
  associationProviderStatus: string;
  associationProviderReference: string | null;
  associationConfirmedAt: string;
  readyForProviderAccount: boolean;
  readinessBlocker?: string | null;
}

export function confirmDomainProviderAssociation(
  client: OmniCommsRpcClient,
  input: ConfirmDomainAssociationInput,
): Promise<ConfirmDomainAssociationResult> {
  return callOmniCommsRpc<ConfirmDomainAssociationResult>(
    client,
    'omni_comms_domain_association_confirm',
    {
      p_organization_id: input.organizationId,
      p_domain_verification_id: input.domainVerificationId,
      p_provider_account_id: input.providerAccountId,
      p_provider_console_status: input.providerConsoleStatus,
      p_provider_reference: input.providerReference ?? null,
      p_note: input.note ?? null,
    },
  );
}

/**
 * Single, human-readable next blocker for a sending domain.
 *
 * The server computes the authoritative blocker; when it is present it is
 * shown verbatim so the UI can never be more optimistic than the evidence.
 */
export function domainReadinessBlocker(
  row: Pick<
    DomainVerificationRow,
    'status' | 'associationConfirmed' | 'verificationSource' | 'readyForProviderAccount'
  > & Partial<DomainVerificationRow>,
): string | null {
  if (row.readyForProviderAccount) return null;
  if (row.readinessBlocker) return row.readinessBlocker;
  if (row.status !== 'verified') return 'Server DNS evidence has not passed yet.';
  if (row.verificationSource === 'external_admin_attestation') {
    return 'An administrator statement alone cannot make this domain ready.';
  }
  if (row.expectationsExact === false) {
    return 'Record the exact provider DNS values (SPF, MX with priority, DKIM key) before this domain can be used.';
  }
  if (row.dnsFresh === false) {
    return 'DNS evidence is beyond the freshness window. Run the DNS check again.';
  }
  if (!row.associationConfirmed) {
    return 'Confirm the domain is registered in this exact provider account.';
  }
  if (row.accountMatchesEndpoint === false) {
    return 'The confirmed provider account is not the account assigned to this sending-domain endpoint.';
  }
  if (row.associationFresh === false) {
    return 'The provider-account confirmation is beyond the freshness window. Confirm it again.';
  }
  if (row.providerDomainStatus && row.providerDomainStatus !== 'verified') {
    return 'The provider does not report this domain as verified.';
  }
  if (row.sendingCapability && row.sendingCapability !== 'enabled') {
    return 'Sending is not enabled for this domain in the provider account.';
  }
  return 'Domain readiness is incomplete.';
}

