/**
 * Omni-Comms C1 — the ONE Email readiness projection.
 *
 * Pure function shared by the Channel Catalogue card, the Email workspace
 * header and the Email Overview checklist so the three surfaces can never
 * disagree.
 *
 * Rules (permanent for C1):
 *   - Derived only from GENUINE records; reference/simulation records never
 *     contribute (see channelReferenceData.ts).
 *   - `summary.email_send_ready` is never consulted by the Channels UI.
 *   - Technical channel testing is not implemented, so the projection can
 *     never reach "Configuration complete".
 */
import type { EmailConfigSummary } from '@/platform/omni-comms/application/channelManagementTypes';
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
  readonly counts: {
    readonly accounts: number;
    readonly activeSenders: number;
    readonly activeVerifiedBindings: number;
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
  const counts = readinessCounts(part);
  const provider = summary?.provider ?? null;
  const setting = summary?.channel_setting ?? null;
  const verified = part.accounts.some((a) => a.verification_status === 'verified');

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
      label: 'Active verified binding present',
      state: yn(counts.activeVerifiedBindings > 0),
      detail: `${counts.activeVerifiedBindings} active verified binding(s).`,
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
      key: 'technical_test',
      label: 'Technical channel test',
      state: 'not_implemented',
      detail: `${TECHNICAL_TEST_PENDING} — technical testing is not implemented in C1.`,
    },
  ];

  const prerequisitesMet = checks
    .filter((c) => c.key !== 'technical_test')
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
    counts,
  };
}
