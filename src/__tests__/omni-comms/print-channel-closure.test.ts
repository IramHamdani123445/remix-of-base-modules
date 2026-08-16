/**
 * Print / Correspondence — credential-free channel closure.
 *
 * Proves the Print channel is honestly configurable: its internal adapter needs
 * no external credential, an account is therefore complete by definition, and
 * activation is not blocked by a verification step that can never run.
 */
import { describe, expect, it } from 'vitest';
import {
  adapterCredentialFree,
  adapterDeliveryImplemented,
  findAdapter,
} from '@/platform/omni-comms/domain/providerAdapterCatalogue';
import {
  credentialCompleteness,
  credentialsComplete,
  type ChannelProviderAccountRow,
} from '@/platform/omni-comms/application/channelProviderAccountTypes';
import { accountLifecycleActions } from '@/platform/omni-comms/admin/views/channels/ChannelAccountsTab';

const account = (
  over: Partial<ChannelProviderAccountRow> = {},
): ChannelProviderAccountRow => ({
  id: 'a1',
  code: 'PRINT_SPOOL_MAIN',
  display_name: 'Print spool',
  provider_id: 'p1',
  provider_adapter_key: 'print_spool',
  channel: 'print',
  environment: 'production',
  region: null,
  provider_account_reference: null,
  status: 'draft',
  data_origin: 'user',
  health_state: 'unknown',
  health_checked_at: null,
  verification_status: 'unverified',
  verification_result_code: null,
  verification_detail: null,
  verification_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z',
  secret_ref_purposes: [],
  required_credential_count: 0,
  configured_credential_count: 0,
  ...over,
});

describe('print channel — credential-free semantics', () => {
  it('registers a deployed internal print adapter with no credentials', () => {
    expect(adapterDeliveryImplemented('print_spool')).toBe(true);
    expect(findAdapter('print_spool')?.credentials).toEqual([]);
    expect(adapterCredentialFree('print_spool')).toBe(true);
  });

  it('does not treat credential-bearing adapters as credential-free', () => {
    expect(adapterCredentialFree('resend')).toBe(false);
    expect(adapterCredentialFree('twilio')).toBe(false);
    // Not deployed, so it must never be treated as ready.
    expect(adapterCredentialFree('internal_in_app')).toBe(false);
  });

  it('labels and treats a credential-free account as complete', () => {
    expect(credentialCompleteness(account())).toBe('No credential required');
    expect(credentialsComplete(account(), true)).toBe(true);
    expect(credentialsComplete(account(), false)).toBe(false);
  });

  it('allows activation of a credential-free draft account', () => {
    const actions = accountLifecycleActions(account(), {
      verifiable: false,
      complete: true,
      credentialFree: true,
    });
    const activate = actions.find((a) => a.key === 'activate');
    expect(activate?.disabled).toBeFalsy();
    expect(actions.some((a) => a.key === 'verify')).toBe(false);
  });

  it('still blocks activation for an unverified credential-bearing account', () => {
    const actions = accountLifecycleActions(
      account({ provider_adapter_key: 'resend', required_credential_count: 1 }),
      { verifiable: true, complete: true, credentialFree: false },
    );
    expect(actions.find((a) => a.key === 'activate')?.disabled).toBe(true);
  });
});
