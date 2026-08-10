/**
 * Omni-Comms — provider-account association evidence for sending domains.
 *
 * Static and unit proof only. No provider is contacted and no DNS lookup is
 * performed by these tests.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ASSOCIATION_REQUIRED_HELP,
  confirmDomainProviderAssociation,
  domainReadinessBlocker,
  PROVIDER_CONSOLE_STATUS_LABELS,
  PROVIDER_CONSOLE_STATUSES,
} from '@/platform/omni-comms/application/domainVerificationService';

const UI = 'src/platform/omni-comms/admin/views/channels/SendingDomainVerificationSection.tsx';
const read = (p: string) => readFileSync(p, 'utf8');

function makeClient(calls: { fn: string; args: unknown }[]) {
  return {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: { readyForProviderAccount: true }, error: null };
    },
  };
}

describe('provider-account association', () => {
  it('calls only the bounded confirmation RPC with structured evidence', async () => {
    const calls: { fn: string; args: unknown }[] = [];
    await confirmDomainProviderAssociation(makeClient(calls), {
      organizationId: 'org-1',
      domainVerificationId: 'dv-1',
      providerAccountId: 'acct-1',
      providerConsoleStatus: 'verified',
      providerReference: 'dom_123',
      note: 'Checked in provider console',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('omni_comms_domain_association_confirm');
    expect(calls[0].args).toEqual({
      p_organization_id: 'org-1',
      p_domain_verification_id: 'dv-1',
      p_provider_account_id: 'acct-1',
      p_provider_console_status: 'verified',
      p_provider_reference: 'dom_123',
      p_note: 'Checked in provider console',
    });
  });

  it('offers a bounded set of provider console statuses', () => {
    expect(PROVIDER_CONSOLE_STATUSES).toEqual([
      'verified',
      'pending',
      'failed',
      'not_found',
    ]);
    for (const s of PROVIDER_CONSOLE_STATUSES) {
      expect(PROVIDER_CONSOLE_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it('never treats DNS alone or attestation alone as ready', () => {
    expect(
      domainReadinessBlocker({
        status: 'verified',
        associationConfirmed: false,
        verificationSource: 'external_provider_plus_dns',
        readyForProviderAccount: false,
      }),
    ).toMatch(/exact provider account/i);

    expect(
      domainReadinessBlocker({
        status: 'pending',
        associationConfirmed: true,
        verificationSource: 'external_provider_plus_dns',
        readyForProviderAccount: false,
      }),
    ).toMatch(/DNS evidence/i);

    expect(
      domainReadinessBlocker({
        status: 'verified',
        associationConfirmed: true,
        verificationSource: 'external_admin_attestation',
        readyForProviderAccount: false,
      }),
    ).toMatch(/administrator statement/i);

    expect(
      domainReadinessBlocker({
        status: 'verified',
        associationConfirmed: true,
        verificationSource: 'external_provider_plus_dns',
        readyForProviderAccount: true,
      }),
    ).toBeNull();
  });

  it('explains why DNS alone is insufficient', () => {
    expect(ASSOCIATION_REQUIRED_HELP).toMatch(/same\s+provider account/i);
  });
});

describe('association UI boundaries', () => {
  const ui = read(UI);

  it('captures structured evidence rather than a free-text "verified" field', () => {
    expect(ui).toContain('omni-comms-domain-association-save');
    expect(ui).toContain('Status shown in the provider console');
    expect(ui).toContain('Provider domain ID / reference');
    expect(ui).toContain('PROVIDER_CONSOLE_STATUSES');
  });

  it('shows exactly one next blocker and never asks for a secret', () => {
    expect(ui).toContain('domainReadinessBlocker');
    expect(ui).not.toMatch(/type=['"]password['"]/);
    expect(ui).not.toContain('api.resend.com');
  });
});
