/**
 * Omni-Comms C1 — Channels workspace: catalogue, URL state, email
 * preservation, empty states and reference-data isolation.
 *
 * Static + pure-function verification (repository convention for Omni-Comms).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  CHANNEL_WORKSPACE_TABS,
  OMNI_COMMS_CHANNEL_UI_CATALOGUE,
  getChannelUi,
  isChannelConfigurable,
  isTabDisabled,
  resolveChannelUi,
  validateChannelUiCatalogue,
} from '@/platform/omni-comms/admin/views/channels/channelUiRegistry';
import {
  partitionEmailConfig,
  readinessCounts,
  visibleRecords,
  isReferenceProviderAccount,
  isReferenceSenderIdentity,
} from '@/platform/omni-comms/admin/views/channels/channelReferenceData';
import {
  OMNI_COMMS_CHANNEL_TAB_ALIASES,
  resolveChannelWorkspaceTab,
} from '@/platform/omni-comms/admin/hooks/useOmniCommsTabParam';

const DIR = 'src/platform/omni-comms/admin/views/channels';
const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
const read = (p: string) => readFileSync(p, 'utf8');
const page = read(PAGE);
const allChannelSrc = [
  'ChannelCatalogue.tsx', 'ChannelWorkspaceHeader.tsx', 'ChannelOverviewTab.tsx',
  'ChannelAccountsTab.tsx', 'ChannelIdentitiesTab.tsx', 'ChannelEndpointsTab.tsx',
  'ChannelBindingsTab.tsx', 'ChannelPoliciesTab.tsx', 'ChannelTestCentreTab.tsx',
  'ChannelDiagnosticsTab.tsx', 'channelUiRegistry.ts', 'channelReferenceData.ts',
  'emailReadiness.ts',
].map((f) => `${DIR}/${f}`);

describe('C1 — file structure', () => {
  it('creates every required channel workspace file', () => {
    for (const f of allChannelSrc) expect(existsSync(f), f).toBe(true);
  });
});

describe('C1 — channel catalogue', () => {
  it('1. Channels defaults to the channel catalogue (no ?channel)', () => {
    expect(page).toContain('if (!definition)');
    expect(page).toContain('<ChannelCatalogue');
    expect(resolveChannelUi(null)).toBeNull();
  });

  it('2. all eight channel cards render', () => {
    expect(OMNI_COMMS_CHANNEL_UI_CATALOGUE).toHaveLength(8);
    expect(OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((d) => d.code)).toEqual([
      'email', 'sms', 'whatsapp', 'push', 'in_app', 'webhook', 'print', 'voice',
    ]);
    expect(OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((d) => d.name)).toEqual([
      'Email', 'SMS', 'WhatsApp', 'Push Notifications', 'In-App Notifications',
      'Webhooks', 'Print and Correspondence', 'Voice and IVR',
    ]);
    expect(read(`${DIR}/ChannelCatalogue.tsx`)).toContain(
      'omni-comms-channel-card-',
    );
  });

  it('3. email is shown as configuring and database supported', () => {
    const email = getChannelUi('email');
    expect(email.implementationState).toBe('configuring');
    expect(email.databaseSupported).toBe(true);
    expect(isChannelConfigurable(email)).toBe(true);
  });

  it('4. webhook and voice are planned and require a database extension', () => {
    for (const code of ['webhook', 'voice'] as const) {
      const d = getChannelUi(code);
      expect(d.implementationState).toBe('planned');
      expect(d.databaseSupported).toBe(false);
      expect(isChannelConfigurable(d)).toBe(false);
    }
    for (const code of ['sms', 'whatsapp', 'push', 'in_app', 'print'] as const) {
      const d = getChannelUi(code);
      expect(d.implementationState).toBe('not_configured');
      expect(d.databaseSupported).toBe(true);
    }
    expect(validateChannelUiCatalogue()).toEqual([]);
  });

  it('catalogue never invents counts for non-email channels', () => {
    const src = read(`${DIR}/ChannelCatalogue.tsx`);
    expect(src).toContain("def.code === 'email' ? emailCounts ?? null : null");
    expect(src).toContain('Not configured');
  });
});

describe('C1 — URL channel and tab state', () => {
  it('5. selecting email opens the email workspace', () => {
    expect(resolveChannelUi('email')?.code).toBe('email');
    expect(page).toContain('useOmniCommsSelectedChannel');
  });

  it('6. selecting SMS opens a truthful empty configuration workspace', () => {
    const sms = resolveChannelUi('sms');
    expect(sms?.implementationState).toBe('not_configured');
    expect(read(`${DIR}/ChannelAccountsTab.tsx`)).toContain(
      'omni-comms-accounts-empty-state',
    );
    expect(sms?.accounts.examples).toContain('Twilio');
  });

  it('7. invalid channel falls back to the catalogue', () => {
    expect(resolveChannelUi('nope')).toBeNull();
    expect(resolveChannelUi('')).toBeNull();
    expect(resolveChannelUi(undefined)).toBeNull();
  });

  it('8. invalid tab falls back to overview', () => {
    expect(resolveChannelWorkspaceTab('nope')).toBe('overview');
    expect(resolveChannelWorkspaceTab(null)).toBe('overview');
    for (const t of CHANNEL_WORKSPACE_TABS) {
      expect(resolveChannelWorkspaceTab(t)).toBe(t);
    }
  });

  it('9. old providers tab aliases to overview', () => {
    expect(resolveChannelWorkspaceTab('providers')).toBe('overview');
  });

  it('10. old senders tab aliases to identities', () => {
    expect(resolveChannelWorkspaceTab('senders')).toBe('identities');
  });

  it('11. old settings tab aliases to policies', () => {
    expect(resolveChannelWorkspaceTab('settings')).toBe('policies');
    expect(Object.keys(OMNI_COMMS_CHANNEL_TAB_ALIASES).sort()).toEqual([
      'providers', 'senders', 'settings',
    ]);
  });

  it('24. existing deep links remain safe (accounts/bindings unchanged)', () => {
    expect(resolveChannelWorkspaceTab('accounts')).toBe('accounts');
    expect(resolveChannelWorkspaceTab('bindings')).toBe('bindings');
  });

  it('changing channel or tab replaces history entries', () => {
    const hook = read(
      'src/platform/omni-comms/admin/hooks/useOmniCommsChannelParam.ts',
    );
    expect(hook).toContain('{ replace: true }');
    const tabs = read(
      'src/platform/omni-comms/admin/hooks/useOmniCommsTabParam.ts',
    );
    expect(tabs).toContain('{ replace: true }');
  });
});

describe('C1 — page composition', () => {
  it('12. duplicate tenant selector is removed from the page', () => {
    expect(page).not.toContain('OmniCommsTenantSelector');
    for (const f of allChannelSrc) {
      expect(read(f), f).not.toContain('OmniCommsTenantSelector');
    }
    expect(page).toContain('useOmniCommsTenant');
  });

  it('page is a coordinator and holds no RPC logic beyond the summary read', () => {
    expect(page).not.toContain('upsertProviderAccountDraft');
    expect(page).not.toContain('upsertEmailChannelSetting');
    expect(page.split('\n').length).toBeLessThan(260);
  });
});

describe('C1 — email functionality preserved', () => {
  const accounts = read(`${DIR}/ChannelAccountsTab.tsx`);
  const identities = read(`${DIR}/ChannelIdentitiesTab.tsx`);
  const bindings = read(`${DIR}/ChannelBindingsTab.tsx`);
  const policies = read(`${DIR}/ChannelPoliciesTab.tsx`);

  it('13. existing email account actions remain available', () => {
    // C2 supersedes the email-specific upsert/activate calls with the generic
    // provider-account service; manual evidence and verification are unchanged.
    expect(accounts).toContain('upsertChannelProviderAccountDraft');
    expect(accounts).toContain('setChannelProviderAccountLifecycle');
    expect(accounts).toContain('recordProviderAccountCredentialCheck');
    expect(accounts).toContain('verifyProviderCredentials');
  });

  it('14. existing email sender actions remain available', () => {
    // C3A — Email identity administration is preserved through the generic,
    // provider-independent Channel Identities model.
    expect(identities).toContain('upsertChannelIdentityDraft');
    expect(identities).toContain('setChannelIdentityLifecycle');
    expect(identities).toContain("channel === 'email'");
  });

  it('15. existing email binding actions remain available with richer columns', () => {
    // C4A — Email binding administration is preserved through the generic,
    // provider-independent Channel Bindings model. Manual administrator
    // verification was deliberately removed; the provider owns that evidence.
    expect(bindings).toContain('upsertChannelBindingDraft');
    expect(bindings).toContain('setChannelBindingLifecycle');
    expect(bindings).not.toContain('recordBindingVerification');
    expect(bindings).toContain('Identity');
    expect(bindings).toContain('Provider account');
    expect(bindings).toContain('Priority');
  });


  it('16. existing email policy save remains available', () => {
    // C4B — the Email-only setting mutation was superseded by the generic
    // channel-policy mutation; saving Email policy remains available.
    expect(policies).toContain('upsertChannelPolicy');
    expect(policies).toContain('POLICY_STATE_NOTICE');
  });

  it('overview replaces the "Register provider" organisation action', () => {
    const overview = read(`${DIR}/ChannelOverviewTab.tsx`);
    expect(overview).not.toContain('Register provider');
    expect(overview).not.toContain('ensureEmailProvider');
    expect(overview).toContain('Resend adapter is not installed in this environment.');
    for (const f of allChannelSrc) {
      expect(read(f), f).not.toContain('ensureEmailProvider');
    }
  });
});

describe('C1 — safety boundaries', () => {
  it('17. no sendCommunication import exists in the Channels UI', () => {
    for (const f of [PAGE, ...allChannelSrc]) {
      expect(read(f), f).not.toContain('sendCommunication');
    }
  });

  it('18. no provider SDK import exists in the Channels UI', () => {
    for (const f of [PAGE, ...allChannelSrc]) {
      const src = read(f);
      expect(src, f).not.toMatch(/from ['"]resend['"]/);
      expect(src, f).not.toMatch(/from ['"]twilio['"]/);
      expect(src, f).not.toMatch(/api\.resend\.com/);
    }
  });

  it('19. Test Centre creates no request, message, job or attempt', () => {
    const src = read(`${DIR}/ChannelTestCentreTab.tsx`);
    // C5A — the Test Centre runs a configuration preflight only.
    expect(src).toContain('NEVER sends a message');
    expect(src).toContain('No message is sent.');
    expect(src).toContain('No provider is contacted.');
    expect(src).not.toContain('invoke(');
    expect(src).not.toContain('supabase');
    expect(src).not.toContain('sendCommunication(');
  });

  it('23. planned channels expose no fake mutation controls', () => {
    for (const code of ['webhook', 'voice'] as const) {
      const d = getChannelUi(code);
      expect(isTabDisabled(d, 'accounts')).toBe(true);
      expect(isTabDisabled(d, 'bindings')).toBe(true);
      expect(isTabDisabled(d, 'overview')).toBe(false);
    }
    expect(isTabDisabled(getChannelUi('sms'), 'accounts')).toBe(false);
    expect(read(`${DIR}/ChannelAccountsTab.tsx`)).toContain(
      'No account can be created here.',
    );
  });

  it('endpoints tab performs no external call (C3B configuration only)', () => {
    const src = read(`${DIR}/ChannelEndpointsTab.tsx`);
    // C3B replaced the C1 shell with a configuration screen. It still must not
    // contact DNS, a provider or a callback URL.
    expect(src).toContain('No DNS lookup, provider call or');
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).not.toMatch(/from ['"]resend['"]/);
  });


  it('diagnostics implements no queries', () => {
    const src = read(`${DIR}/ChannelDiagnosticsTab.tsx`);
    expect(src).not.toContain('rpc(');
    expect(src).toContain('Credential verification history');
  });
});

// ─── Reference-data isolation ────────────────────────────────────────

const acct = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'a1', code: 'prod_primary', display_name: 'Primary',
  secret_ref: 'OMNI_COMMS_RESEND_PRIMARY', region: null, sandbox_mode: false,
  status: 'active', health_state: 'healthy', health_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z', verification_status: 'verified',
  ...over,
}) as never;

const sender = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 's1', code: 'prod_sender', display_name: 'Sender',
  from_address: 'noreply@ssb.gov.kn', from_name: null, reply_to_address: null,
  status: 'active', department_id: null, event_definition_id: null,
  updated_at: '2026-01-01T00:00:00Z', ...over,
}) as never;

const binding = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'b1', sender_identity_id: 's1', provider_account_id: 'a1', priority: 100,
  external_sender_ref: null, verification_status: 'verified', verified_at: null,
  status: 'active', updated_at: '2026-01-01T00:00:00Z', ...over,
}) as never;

describe('C1 — reference-data isolation', () => {
  const part = partitionEmailConfig({
    accounts: [
      acct(),
      acct({ id: 'a2', code: 'ref_sim_email', secret_ref: 'OMNI_COMMS_SIMULATION_EMAIL' }),
      acct({ id: 'a3', code: 'simulation_email' }),
    ],
    senders: [
      sender(),
      sender({ id: 's2', code: 'ref_sender_email', from_address: 'demo@example.com' }),
      sender({ id: 's3', code: 'omni_pilot_sender' }),
    ],
    bindings: [binding(), binding({ id: 'b2', sender_identity_id: 's2' })],
  });

  it('20. reference data is hidden by default', () => {
    expect(part.accounts.map((a) => a.id)).toEqual(['a1']);
    expect(part.senders.map((s) => s.id)).toEqual(['s1']);
    expect(part.bindings.map((b) => b.id)).toEqual(['b1']);
    expect(part.hiddenCount).toBe(5);
    expect(part.hasReferenceData).toBe(true);
    expect(visibleRecords(part.accounts, part.referenceAccounts, false)).toHaveLength(1);
  });

  it('detects every seed convention without mutating anything', () => {
    expect(isReferenceProviderAccount(acct({ code: 'simulation_sms' }))).toBe(true);
    expect(isReferenceProviderAccount(acct({ code: 'ref_sim_inapp' }))).toBe(true);
    expect(isReferenceSenderIdentity(sender({ from_address: 'x@example.com' }))).toBe(true);
    expect(isReferenceProviderAccount(acct())).toBe(false);
    const helper = read(`${DIR}/channelReferenceData.ts`);
    expect(helper).not.toMatch(/\.delete\(/);
    expect(helper).not.toContain('rpc(');
    // C2 makes explicit data_origin classification authoritative.
    expect(helper).toContain('data_origin');
    expect(helper).not.toContain('is_synthetic');
  });

  it('21. reference data can be shown only in non-production', () => {
    const controls = read(`${DIR}/ReferenceDataControls.tsx`);
    expect(controls).toContain('isNonProduction');
    expect(controls).toContain('Show reference data');
    expect(controls).toContain('if (hiddenCount <= 0) return null;');
    expect(controls).toContain('allowSwitch ?');
    expect(visibleRecords(part.accounts, part.referenceAccounts, true)).toHaveLength(3);
  });

  it('22. reference data never contributes to genuine readiness', () => {
    const counts = readinessCounts(part);
    expect(counts.accounts).toBe(1);
    expect(counts.activeSenders).toBe(1);
    expect(counts.activeVerifiedBindings).toBe(1);
    expect(page).toContain('projectEmailReadiness');
    const readiness = read(`${DIR}/emailReadiness.ts`);
    expect(readiness).toContain('partitionEmailConfig');
  });

  it('overview never claims send readiness and marks the test not implemented', () => {
    const readiness = read(`${DIR}/emailReadiness.ts`);
    expect(readiness).toContain("state: 'not_implemented'");
    expect(readiness).toContain('TECHNICAL_TEST_PENDING');
  });
});

describe('C1 — no schema change', () => {
  it('adds no migration and no new database table for endpoints', () => {
    for (const f of allChannelSrc) {
      const src = read(f);
      expect(src, f).not.toContain('create table');
      expect(src, f).not.toContain('omni_comms_endpoint');
    }
  });
});
