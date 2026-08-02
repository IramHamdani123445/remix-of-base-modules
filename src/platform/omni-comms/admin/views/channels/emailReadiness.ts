/**
 * Omni-Comms C1 / C3B — the ONE Email readiness projection.
 *
 * Pure function shared by the Channel Catalogue card, the Email workspace
 * header and the Email Overview checklist so the three surfaces can never
 * disagree.
 *
 * Rules (permanent for C1 + C3B):
 *   - Derived only from GENUINE records; reference/simulation records never
 *     contribute (see channelReferenceData.ts).
 *   - `summary.email_send_ready` is never consulted by the Channels UI.
 *   - Technical channel testing is not implemented, so the projection can
 *     never reach "Configuration complete".
 *   - C3B adds endpoint checks. C3B performs no DNS lookup and no provider
 *     verification call, so a sending domain can never become
 *     `verified` from this screen, and no callback receiver exists.
 */
import type {
  EmailConfigSummary,
  EmailEndpointRow,
} from '@/platform/omni-comms/application/channelManagementTypes';
import { partitionEmailConfig, readinessCounts } from './channelReferenceData';

export type EmailReadinessState = 'unknown' | 'incomplete' | 'prerequisites_met';

export const EMAIL_READINESS_LABEL: Record<EmailReadinessState, string> = {
  unknown: 'Readiness unknown',
  incomplete: 'Configuration incomplete',
  prerequisites_met: 'Configuration prerequisites met',
};

/** Supporting explanation shown wherever readiness is presented. */
export const TECHNICAL_TEST_PENDING = 'Technical test pending';

/** Technical channel testing is not implemented in C1. */
export const EMAIL_TECHNICAL_TEST_IMPLEMENTED = false;

/** C3B introduces no callback receiver route. */
export const EMAIL_CALLBACK_RECEIVER_IMPLEMENTED = false;

export const EMAIL_CALLBACK_RECEIVER_PENDING =
  'Callback receiver not implemented';

/**
 * Genuine, operational Email endpoints only. Reference, draft, disabled and
 * retired endpoint records never contribute to readiness.
 */
export function genuineActiveEmailEndpoints(
  endpoints: readonly EmailEndpointRow[] | null | undefined,
  endpointType: 'sending_domain' | 'event_callback',
): EmailEndpointRow[] {
  return (endpoints ?? []).filter(
    (e) =>
      e.endpoint_type === endpointType
      && e.status === 'active'
      && e.data_origin !== 'reference_seed',
  );
}


export type EmailReadinessCheckState = 'met' | 'unmet' | 'not_implemented';

export interface EmailReadinessCheck {
  readonly key: string;
  readonly label: string;
  readonly state: EmailReadinessCheckState;
  readonly detail: string;
}

export interface EmailReadinessProjection {
  readonly state: EmailReadinessState;
  /** Operator-facing state label. Never "Configuration complete". */
  readonly label: string;
  /** Supporting explanation; always the technical-test caveat in C1. */
  readonly explanation: string;
  readonly checks: readonly EmailReadinessCheck[];
  /** True when every required (non technical-test) check is met. */
  readonly prerequisitesMet: boolean;
  readonly technicalTestImplemented: boolean;
  readonly callbackReceiverImplemented: boolean;
  readonly counts: {
    readonly accounts: number;
    readonly activeSenders: number;
    readonly activeVerifiedBindings: number;
    /** C4A — genuine active bindings. */
    readonly activeBindings: number;
    /** C4A — active bindings verified by a provider or trusted service. */
    readonly providerVerifiedBindings: number;
    /** C3B — genuine active sending-domain endpoints. */
    readonly activeSendingDomains: number;
    /** C3B — genuine active sending domains marked verified by a provider. */
    readonly verifiedSendingDomains: number;
    /** C3B — genuine active event-callback endpoints with the required secret. */
    readonly activeEventCallbacks: number;
  };
}


export function projectEmailReadiness(
  summary: EmailConfigSummary | null | undefined,
): EmailReadinessProjection {
  const part = partitionEmailConfig({
    accounts: summary?.provider_accounts,
    senders: summary?.sender_identities,
    bindings: summary?.bindings,
  });
  const baseCounts = readinessCounts(part);
  const provider = summary?.provider ?? null;
  const setting = summary?.channel_setting ?? null;
  const verified = part.accounts.some((a) => a.verification_status === 'verified');

  const domains = genuineActiveEmailEndpoints(summary?.endpoints, 'sending_domain');
  const callbacks = genuineActiveEmailEndpoints(summary?.endpoints, 'event_callback');
  const verifiedDomains = domains.filter((d) => d.verification_status === 'verified');
  const signedCallbacks = callbacks.filter((c) =>
    (c.secret_refs ?? []).some((s) => s.purpose === 'signing_secret' && Boolean(s.secret_ref)),
  );
  const counts = {
    ...baseCounts,
    activeSendingDomains: domains.length,
    verifiedSendingDomains: verifiedDomains.length,
    activeEventCallbacks: signedCallbacks.length,
  };

  const yn = (ok: boolean): EmailReadinessCheckState => (ok ? 'met' : 'unmet');


  const checks: EmailReadinessCheck[] = [
    {
      key: 'adapter',
      label: 'Resend adapter present and active',
      state: yn(Boolean(provider) && provider?.status === 'active'),
      detail: provider
        ? `Adapter ${provider.code} — ${provider.status}`
        : 'Resend adapter is not installed in this environment.',
    },
    {
      key: 'account',
      label: 'Provider account present',
      state: yn(counts.accounts > 0),
      detail: `${counts.accounts} organisation provider account(s).`,
    },
    {
      key: 'credentials',
      label: 'Credential verification status',
      state: yn(verified),
      detail: verified
        ? 'At least one account has verified Resend credentials.'
        : 'No account has verified credentials.',
    },
    {
      key: 'identity',
      label: 'Active sender identity present',
      state: yn(counts.activeSenders > 0),
      detail: `${counts.activeSenders} active identity(ies).`,
    },
    {
      key: 'binding',
      label: 'Active identity-to-provider binding present',
      state: yn(counts.activeBindings > 0),
      detail: `${counts.activeBindings} active binding(s).`,
    },
    {
      key: 'binding_verification',
      label: 'Binding provider verification',
      state:
        counts.providerVerifiedBindings > 0
          ? 'met'
          : 'not_implemented',
      detail:
        counts.providerVerifiedBindings > 0
          ? `${counts.providerVerifiedBindings} binding(s) verified by a provider or trusted service.`
          : 'Binding verification is recorded only by the provider or a trusted '
            + 'service; this screen performs no verification and legacy manual '
            + 'evidence does not count.',
    },

    {
      key: 'policy',
      label: 'Email policy present',
      state: yn(Boolean(setting)),
      detail: setting ? 'Channel policy record exists.' : 'No channel policy saved.',
    },
    {
      key: 'enabled',
      label: 'Email channel enabled',
      state: yn(Boolean(setting?.enabled)),
      detail: setting?.enabled
        ? 'Channel flag is enabled.'
        : 'Channel flag is disabled.',
    },
    {
      key: 'sending_domain',
      label: 'Active sending domain configured',
      state: yn(counts.activeSendingDomains > 0),
      detail: `${counts.activeSendingDomains} active sending domain endpoint(s).`,
    },
    {
      key: 'sending_domain_verification',
      label: 'Sending-domain provider verification',
      state:
        counts.verifiedSendingDomains > 0
          ? 'met'
          : 'not_implemented',
      detail:
        counts.verifiedSendingDomains > 0
          ? `${counts.verifiedSendingDomains} domain(s) recorded as provider-verified.`
          : 'Provider verification is not performed by this screen; no DNS or provider check runs here.',
    },
    {
      key: 'event_callback',
      label: 'Event callback configured with signing secret',
      state: yn(counts.activeEventCallbacks > 0),
      detail: `${counts.activeEventCallbacks} active event callback(s) with a signing secret reference.`,
    },
    {
      key: 'callback_receiver',
      label: 'Callback receiver route',
      state: 'not_implemented',
      detail: `${EMAIL_CALLBACK_RECEIVER_PENDING} — C3B stores callback configuration only.`,
    },
    {
      key: 'technical_test',
      label: 'Technical channel test',
      state: 'not_implemented',
      detail: `${TECHNICAL_TEST_PENDING} — technical testing is not implemented in C1.`,
    },
  ];

  const prerequisitesMet = checks
    .filter((c) => c.state !== 'not_implemented')
    .every((c) => c.state === 'met');

  const state: EmailReadinessState = !summary
    ? 'unknown'
    : prerequisitesMet
      ? 'prerequisites_met'
      : 'incomplete';

  return {
    state,
    label: EMAIL_READINESS_LABEL[state],
    explanation: TECHNICAL_TEST_PENDING,
    checks,
    prerequisitesMet: Boolean(summary) && prerequisitesMet,
    technicalTestImplemented: EMAIL_TECHNICAL_TEST_IMPLEMENTED,
    callbackReceiverImplemented: EMAIL_CALLBACK_RECEIVER_IMPLEMENTED,
    counts,
  };
}
