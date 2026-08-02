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
 *   - C5A adds the technical configuration preflight. The projection reaches
 *     "Configuration prerequisites met" only when a CURRENT passed preflight
 *     exists for the selected binding. A preflight never sends a message.
 *   - C3B adds endpoint checks. C3B performs no DNS lookup and no provider
 *     verification call, so a sending domain can never become
 *     `verified` from this screen, and no callback receiver exists.
 */
import type {
  EmailConfigSummary,
  EmailEndpointRow,
} from '@/platform/omni-comms/application/channelManagementTypes';
import type {
  ChannelPolicySummary,
} from '@/platform/omni-comms/application/channelPolicyTypes';
import {
  operationalStateAllowsConfiguration,
} from '@/platform/omni-comms/application/channelPolicyTypes';
import type {
  ChannelTestCentreSummary,
} from '@/platform/omni-comms/application/channelTestCentreTypes';
import type {
  ChannelTestDeliveryDiagnostics,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import {
  hasVerifiedCallbackEvidence,
  isDeliveryCurrent,
  latestDelivery,
} from '@/platform/omni-comms/application/channelTestDeliveryTypes';
import type { ChannelReleaseControlSummary } from '@/platform/omni-comms/application/channelReleaseControlTypes';
import {
  isControlledPilotGovernanceActive,
  isReleaseControlConfigured,
  releaseBlockers,
} from '@/platform/omni-comms/application/channelReleaseControlTypes';
import { partitionEmailConfig, readinessCounts } from './channelReferenceData';

/** C6 — Release Control governance is implemented (configuration + approval). */
export const EMAIL_RELEASE_CONTROL_IMPLEMENTED = true;

/**
 * C6 — business provider dispatch is deliberately NOT implemented. Release
 * Control decides what is ALLOWED; it never makes a job runnable.
 */
export const EMAIL_BUSINESS_DISPATCH_IMPLEMENTED = false;

export const EMAIL_RELEASE_CONTROL_PENDING =
  'Release Control is configured but no controlled pilot has been approved and '
  + 'activated for this scope.';

export const EMAIL_BUSINESS_DISPATCH_PENDING =
  'Business provider dispatch is not implemented in C6. Jobs created under a '
  + 'controlled pilot remain held and non-runnable, and live delivery stays '
  + 'disabled.';

export type EmailReadinessState = 'unknown' | 'incomplete' | 'prerequisites_met';

export const EMAIL_READINESS_LABEL: Record<EmailReadinessState, string> = {
  unknown: 'Readiness unknown',
  incomplete: 'Configuration incomplete',
  prerequisites_met: 'Configuration prerequisites met',
};

/** Supporting explanation shown while no current passed preflight exists. */
export const CONFIGURATION_PREFLIGHT_PENDING = 'Configuration preflight pending';

/** Shown once a current passed preflight exists for the selected binding. */
export const CONFIGURATION_PREFLIGHT_CURRENT =
  'Configuration preflight passed for the current configuration. No message '
  + 'has been sent.';

/** Shown when a stored preflight no longer matches the live configuration. */
export const CONFIGURATION_PREFLIGHT_STALE =
  'Configuration changed — run preflight again.';

/** Provider delivery remains a SEPARATE capability from the preflight. */
export const PROVIDER_DELIVERY_TEST_PENDING = 'Provider delivery test pending';

export const PROVIDER_DELIVERY_TEST_DETAIL =
  'Configuration preflight does not send an email. Delivery is proven only by '
  + 'an approved provider test delivery to an approved test address.';

export const PROVIDER_DELIVERY_TEST_PASSED =
  'The provider accepted an approved technical test message for the current '
  + 'configuration. Live delivery remains disabled.';

export const PROVIDER_DELIVERY_TEST_FAILED =
  'The most recent provider test delivery was not accepted. Review the '
  + 'delivery diagnostics.';

/** The zero-send configuration preflight exists. */
export const EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED = true;

/**
 * Approved provider test delivery now exists. It is deliberately separate from
 * the configuration preflight, which still never sends anything.
 */
export const EMAIL_PROVIDER_DELIVERY_TEST_IMPLEMENTED = true;


/** The Resend callback receiver records test-delivery evidence. */
export const EMAIL_CALLBACK_RECEIVER_IMPLEMENTED = true;

export const EMAIL_CALLBACK_RECEIVER_PENDING =
  'Callback receiver records approved test-delivery evidence only';

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
  /** Supporting explanation; always carries the provider-delivery caveat. */
  readonly explanation: string;
  readonly checks: readonly EmailReadinessCheck[];
  /** True when every required (non not_implemented) check is met. */
  readonly prerequisitesMet: boolean;
  /** C5A — zero-send configuration preflight exists. */
  readonly configurationPreflightImplemented: boolean;
  /** C5A — provider delivery test does NOT exist. Always false here. */
  readonly providerDeliveryTestImplemented: boolean;
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
  policySummary?: ChannelPolicySummary | null,
  /**
   * C5A — Test Centre summary for the selected binding. When omitted the
   * technical-test check stays `not_implemented` (callers that cannot supply
   * a preflight result must not be able to fabricate readiness).
   */
  testCentre?: ChannelTestCentreSummary | null,
  /**
   * Approved provider test-delivery evidence. When omitted the delivery check
   * stays `not_implemented`, so no caller can fabricate delivery proof.
   */
  deliveryDiagnostics?: ChannelTestDeliveryDiagnostics | null,
  /**
   * C6 — Release Control summary. When omitted the release checks stay
   * `not_implemented`, so no caller can fabricate governance approval.
   */
  releaseSummary?: ChannelReleaseControlSummary | null,
): EmailReadinessProjection {
  const testPassed = Boolean(
    testCentre?.latest_run
    && !testCentre.latest_run_is_stale
    && testCentre.latest_run.status === 'passed',
  );
  const testStale = Boolean(testCentre?.latest_run && testCentre.latest_run_is_stale);
  const part = partitionEmailConfig({
    accounts: summary?.provider_accounts,
    senders: summary?.sender_identities,
    bindings: summary?.bindings,
  });
  const baseCounts = readinessCounts(part);
  const provider = summary?.provider ?? null;
  // C4B — readiness uses the GENUINE effective Email policy only. Reference
  // policies never contribute and `live_delivery_enabled` is never consulted.
  const effectivePolicy =
    policySummary?.effective_policy
    && policySummary.effective_policy.data_origin !== 'reference_seed'
      ? policySummary.effective_policy
      : null;
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

  const delivery = latestDelivery(
    deliveryDiagnostics,
    testCentre?.selected_binding_id ?? null,
  );
  const deliveryCurrent = isDeliveryCurrent(
    delivery,
    testCentre?.configuration_fingerprint ?? null,
  );
  // C5B — only a CURRENT, terminal, accepted delivery proves provider delivery.
  const deliveryAccepted = deliveryCurrent && delivery?.status === 'accepted';
  // C5B — callback evidence must be current AND signature-verified.
  const callbackVerified = hasVerifiedCallbackEvidence(
    delivery,
    testCentre?.configuration_fingerprint ?? null,
  );

  const yn = (ok: boolean): EmailReadinessCheckState => (ok ? 'met' : 'unmet');

  // C6 — genuine Release Control governance. Never inferred, never assumed.
  const releaseConfigured = isReleaseControlConfigured(releaseSummary);
  const releaseBlockerCount = releaseBlockers(releaseSummary?.prerequisites).length;
  const pilotGovernanceActive = isControlledPilotGovernanceActive(releaseSummary);


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
      label: 'Effective genuine Email policy exists',
      state: yn(Boolean(effectivePolicy)),
      detail: effectivePolicy
        ? `Effective policy resolved from the ${
          effectivePolicy.department_id ? 'department override' : 'organisation baseline'
        }.`
        : 'No genuine effective Email policy for this scope.',
    },
    {
      key: 'policy_state',
      label: 'Email policy operational state allows configuration',
      state: yn(operationalStateAllowsConfiguration(effectivePolicy?.operational_state)),
      detail: effectivePolicy
        ? `Operational state is ${effectivePolicy.operational_state}.`
        : 'No effective policy, so no operational state applies.',
    },
    {
      key: 'release_control_configured',
      label: 'Release Control configured for this scope',
      state: releaseSummary ? yn(releaseConfigured) : 'not_implemented',
      detail: !releaseSummary
        ? 'Release Control state has not been loaded for this scope.'
        : releaseConfigured
          ? 'A genuine Release Control record governs this scope.'
          : 'No genuine Release Control record exists for this scope.',
    } as EmailReadinessCheck,
    {
      key: 'release_prerequisites',
      label: 'Release prerequisites satisfied',
      state: !releaseSummary
        ? 'not_implemented'
        : yn(releaseConfigured && releaseBlockerCount === 0),
      detail: !releaseSummary
        ? 'Release prerequisites have not been evaluated.'
        : releaseBlockerCount === 0 && releaseConfigured
          ? 'All blocking release prerequisites are satisfied.'
          : `${releaseBlockerCount} blocking release prerequisite(s) outstanding.`,
    } as EmailReadinessCheck,
    {
      key: 'release_control',
      label: 'Controlled pilot approved and active',
      state: !releaseSummary ? 'not_implemented' : yn(pilotGovernanceActive),
      detail: pilotGovernanceActive
        ? 'An approved controlled pilot is active, unexpired and bound to the '
          + 'certified commit. Live delivery remains disabled.'
        : EMAIL_RELEASE_CONTROL_PENDING,
    } as EmailReadinessCheck,
    {
      key: 'business_dispatch',
      label: 'Business provider dispatch',
      state: 'not_implemented',
      detail: EMAIL_BUSINESS_DISPATCH_PENDING,
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
      state: callbackVerified
        ? 'met'
        : (delivery?.events.length ?? 0) > 0
          ? 'unmet'
          : 'not_implemented',
      detail: callbackVerified
        ? `${delivery?.events.filter((e) => e.signature_verified).length} signature-verified `
          + 'provider callback event(s) recorded against the current configuration.'
        : (delivery?.events.length ?? 0) > 0
          ? 'Callback evidence exists but is stale or unverified — it does not '
            + 'prove the current configuration.'
          : `${EMAIL_CALLBACK_RECEIVER_PENDING} — no verified provider callback has been received yet.`,
    } as EmailReadinessCheck,
    {
      key: 'configuration_preflight',
      label: 'Current configuration preflight passed',
      state: testCentre === undefined
        ? 'not_implemented'
        : testPassed
          ? 'met'
          : 'unmet',
      detail: testCentre === undefined
        ? `${CONFIGURATION_PREFLIGHT_PENDING} — no Test Centre result supplied.`
        : testPassed
          ? CONFIGURATION_PREFLIGHT_CURRENT
          : testStale
            ? CONFIGURATION_PREFLIGHT_STALE
            : `${CONFIGURATION_PREFLIGHT_PENDING} — run a configuration preflight `
              + 'for the selected binding in the Test Centre.',
    } as EmailReadinessCheck,
    {
      key: 'provider_delivery_test',
      label: 'Provider delivery test',
      state: deliveryDiagnostics === undefined || !delivery
        ? 'not_implemented'
        : deliveryAccepted
          ? 'met'
          : 'unmet',
      detail: deliveryDiagnostics === undefined || !delivery
        ? PROVIDER_DELIVERY_TEST_DETAIL
        : deliveryAccepted
          ? PROVIDER_DELIVERY_TEST_PASSED
          : delivery.status === 'accepted'
            ? 'A provider test delivery was accepted, but the configuration has '
              + 'changed since. Run it again.'
            : delivery.status === 'outcome_unknown'
              ? 'The last provider test delivery ended with an unknown outcome. '
                + 'Retry it safely — the provider idempotency key prevents a '
                + 'second send.'
              : delivery.status === 'pending' || delivery.status === 'dispatching'
                ? 'A provider test delivery is still in progress.'
                : PROVIDER_DELIVERY_TEST_FAILED,
    } as EmailReadinessCheck,
  ];

  const prerequisitesMet = checks
    .filter((c) => c.state !== 'not_implemented')
    .every((c) => c.state === 'met');

  const state: EmailReadinessState = !summary
    ? 'unknown'
    : prerequisitesMet
      ? 'prerequisites_met'
      : 'incomplete';

  const preflightExplanation = testPassed
    ? CONFIGURATION_PREFLIGHT_CURRENT
    : testStale
      ? CONFIGURATION_PREFLIGHT_STALE
      : CONFIGURATION_PREFLIGHT_PENDING;

  return {
    state,
    label: EMAIL_READINESS_LABEL[state],
    explanation: `${preflightExplanation} · ${
      deliveryAccepted ? 'Provider delivery test passed' : PROVIDER_DELIVERY_TEST_PENDING
    }`,
    checks,
    prerequisitesMet: Boolean(summary) && prerequisitesMet,
    configurationPreflightImplemented: EMAIL_CONFIGURATION_PREFLIGHT_IMPLEMENTED,
    providerDeliveryTestImplemented: EMAIL_PROVIDER_DELIVERY_TEST_IMPLEMENTED,
    callbackReceiverImplemented: EMAIL_CALLBACK_RECEIVER_IMPLEMENTED,

    counts,
  };
}
