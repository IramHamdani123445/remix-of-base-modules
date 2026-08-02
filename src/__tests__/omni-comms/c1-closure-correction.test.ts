/**
 * Omni-Comms C1 closure correction.
 *
 * Proves (1) one canonical channel source of truth and tab vocabulary, and
 * (2) one Email readiness projection shared by catalogue, header and overview.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  OMNI_COMMS_CHANNELS,
  OMNI_COMMS_CHANNEL_CATALOGUE,
  OMNI_COMMS_GENERIC_TABS,
  findChannelDescriptor,
  validateChannelCatalogue,
} from '@/platform/omni-comms/domain/channelCatalogue';
import {
  CHANNEL_WORKSPACE_TABS,
  OMNI_COMMS_CHANNEL_UI_CATALOGUE,
  validateChannelUiCatalogue,
} from '@/platform/omni-comms/admin/views/channels/channelUiRegistry';
import {
  OMNI_COMMS_CHANNEL_WORKSPACE_TABS,
  resolveChannelWorkspaceTab,
} from '@/platform/omni-comms/admin/hooks/useOmniCommsTabParam';
import {
  EMAIL_READINESS_LABEL,
  TECHNICAL_TEST_PENDING,
  projectEmailReadiness,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import type { EmailConfigSummary } from '@/platform/omni-comms/application/channelManagementTypes';

const DIR = 'src/platform/omni-comms/admin/views/channels';
const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
const read = (p: string) => readFileSync(p, 'utf8');
/** File text with comments stripped — used for "must not appear" assertions. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
const page = read(PAGE);

const UI_FILES = [
  PAGE,
  `${DIR}/ChannelCatalogue.tsx`,
  `${DIR}/ChannelWorkspaceHeader.tsx`,
  `${DIR}/ChannelOverviewTab.tsx`,
  `${DIR}/ChannelAccountsTab.tsx`,
  `${DIR}/ChannelIdentitiesTab.tsx`,
  `${DIR}/ChannelEndpointsTab.tsx`,
  `${DIR}/ChannelBindingsTab.tsx`,
  `${DIR}/ChannelPoliciesTab.tsx`,
  `${DIR}/ChannelTestCentreTab.tsx`,
  `${DIR}/ChannelDiagnosticsTab.tsx`,
  `${DIR}/channelUiRegistry.ts`,
  `${DIR}/channelReferenceData.ts`,
  `${DIR}/emailReadiness.ts`,
];

// ─── 1. one canonical source of truth ────────────────────────────────

describe('C1 closure — one channel source of truth', () => {
  it('1. one canonical channel identifier list exists', () => {
    expect(validateChannelCatalogue()).toEqual([]);
    expect(validateChannelUiCatalogue()).toEqual([]);
    expect(OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((d) => d.code)).toEqual([
      ...OMNI_COMMS_CHANNELS,
    ]);
    const registry = read(`${DIR}/channelUiRegistry.ts`);
    expect(registry).toContain('OMNI_COMMS_CHANNEL_CATALOGUE');
    // the registry must not redefine the channel list, schema support or tabs
    expect(registry).not.toMatch(/code:\s*'email'/);
    expect(registry).not.toMatch(/databaseSupported:\s*(true|false)/);
    expect(registry).not.toMatch(/implementationState:\s*'/);
  });

  it('domain owns schema support and build ownership', () => {
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      const ui = OMNI_COMMS_CHANNEL_UI_CATALOGUE.find((u) => u.code === d.channel)!;
      expect(ui.databaseSupported).toBe(d.databaseSupported);
      expect(ui.tabs).toBe(d.tabs);
    }
  });

  it('2. one workspace-tab vocabulary exists', () => {
    expect(CHANNEL_WORKSPACE_TABS).toBe(OMNI_COMMS_GENERIC_TABS);
    expect(OMNI_COMMS_CHANNEL_WORKSPACE_TABS).toBe(OMNI_COMMS_GENERIC_TABS);
  });

  it('3. `test` is not used as a Channels tab identifier', () => {
    expect(OMNI_COMMS_GENERIC_TABS).toContain('test-centre');
    expect(OMNI_COMMS_GENERIC_TABS as readonly string[]).not.toContain('test');
    expect(resolveChannelWorkspaceTab('test')).toBe('overview');
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      expect(d.tabs as readonly string[]).not.toContain('test');
    }
  });

  it('4. unknown or missing channel displays the catalogue', () => {
    expect(findChannelDescriptor(null)).toBeNull();
    expect(findChannelDescriptor(undefined)).toBeNull();
    expect(findChannelDescriptor('')).toBeNull();
    expect(findChannelDescriptor('fax')).toBeNull();
    expect(findChannelDescriptor('email')?.channel).toBe('email');
    const hook = read(
      'src/platform/omni-comms/admin/hooks/useOmniCommsChannelParam.ts',
    );
    expect(hook).toContain('findChannelDescriptor');
    expect(hook).not.toContain('OMNI_COMMS_DEFAULT_CHANNEL');
    expect(page).toContain('if (!definition)');
    expect(page).toContain('<ChannelCatalogue');
  });

  it('5. the competing selector and tab shell components are removed', () => {
    for (const f of [
      'src/platform/omni-comms/admin/components/OmniCommsChannelSelector.tsx',
      'src/platform/omni-comms/admin/components/OmniCommsChannelTabShell.tsx',
    ]) {
      expect(existsSync(f), f).toBe(false);
    }
    for (const f of UI_FILES) {
      expect(read(f), f).not.toContain('OmniCommsChannelTabShell');
      expect(read(f), f).not.toContain('OmniCommsChannelSelector');
    }
  });
});

// ─── 2. one Email readiness projection ───────────────────────────────

const provider = { code: 'resend', status: 'active' } as never;

const acct = (over: Record<string, unknown> = {}) => ({
  id: 'a1', code: 'prod_primary', display_name: 'Primary',
  secret_ref: 'OMNI_COMMS_RESEND_PRIMARY', region: null, sandbox_mode: false,
  status: 'active', health_state: 'healthy', health_checked_at: null,
  updated_at: '2026-01-01T00:00:00Z', verification_status: 'verified',
  ...over,
}) as never;

const sender = (over: Record<string, unknown> = {}) => ({
  id: 's1', code: 'prod_sender', display_name: 'Sender',
  from_address: 'noreply@ssb.gov.kn', from_name: null, reply_to_address: null,
  status: 'active', department_id: null, event_definition_id: null,
  updated_at: '2026-01-01T00:00:00Z', ...over,
}) as never;

const binding = (over: Record<string, unknown> = {}) => ({
  id: 'b1', sender_identity_id: 's1', provider_account_id: 'a1', priority: 100,
  external_sender_ref: null, verification_status: 'verified', verified_at: null,
  status: 'active', updated_at: '2026-01-01T00:00:00Z', ...over,
}) as never;

const summaryOf = (over: Partial<EmailConfigSummary>): EmailConfigSummary =>
  ({
    provider,
    provider_accounts: [],
    sender_identities: [],
    bindings: [],
    channel_setting: { enabled: true },
    email_send_ready: true,
    ...over,
  }) as unknown as EmailConfigSummary;

describe('C1 closure — one Email readiness projection', () => {
  it('6. summary.email_send_ready is not used by the C1 Channels UI', () => {
    for (const f of UI_FILES) {
      expect(code(f), f).not.toContain('email_send_ready');
    }
  });

  it('7. synthetic accounts, senders and bindings cannot make the catalogue ready', () => {
    const synthetic = projectEmailReadiness(
      summaryOf({
        provider_accounts: [
          acct({ id: 'a9', code: 'ref_sim_email', secret_ref: 'OMNI_COMMS_SIMULATION_EMAIL' }),
        ] as never,
        sender_identities: [
          sender({ id: 's9', code: 'ref_sender_email', from_address: 'demo@example.com' }),
        ] as never,
        bindings: [binding({ id: 'b9', sender_identity_id: 's9', provider_account_id: 'a9' })] as never,
      }),
    );
    expect(synthetic.counts).toMatchObject({
      accounts: 0,
      activeSenders: 0,
      activeVerifiedBindings: 0,
    });
    expect(synthetic.state).toBe('incomplete');
    expect(synthetic.label).toBe('Configuration incomplete');
  });

  it('8. synthetic records cannot make the header ready', () => {
    const header = read(`${DIR}/ChannelWorkspaceHeader.tsx`);
    expect(header).toContain('EmailReadinessProjection');
    expect(code(`${DIR}/ChannelWorkspaceHeader.tsx`)).not.toContain('Configuration complete');
    expect(page).toContain('readiness={readiness}');
  });

  it('9. catalogue, header and Overview use the same projection', () => {
    expect(page).toContain('projectEmailReadiness');
    expect(page).toContain('emailReadiness.label');
    expect(read(`${DIR}/ChannelOverviewTab.tsx`)).toContain('projectEmailReadiness');
    // the overview no longer builds its own checklist
    expect(read(`${DIR}/ChannelOverviewTab.tsx`)).not.toContain(
      'buildEmailReadinessChecklist',
    );
  });

  it('10. technical test pending prevents "Configuration complete" wording', () => {
    const complete = projectEmailReadiness(
      summaryOf({
        provider_accounts: [acct()] as never,
        sender_identities: [sender()] as never,
        bindings: [binding()] as never,
      }),
    );
    expect(complete.prerequisitesMet).toBe(true);
    expect(complete.state).toBe('prerequisites_met');
    expect(complete.label).toBe('Configuration prerequisites met');
    expect(complete.explanation).toBe(TECHNICAL_TEST_PENDING);
    expect(complete.technicalTestImplemented).toBe(false);
    expect(complete.checks.at(-1)?.state).toBe('not_implemented');
    expect(Object.values(EMAIL_READINESS_LABEL)).not.toContain(
      'Configuration complete',
    );
    for (const f of UI_FILES) {
      expect(code(f), f).not.toContain('Configuration complete');
    }
  });

  it('projects unknown readiness when no summary has loaded', () => {
    const unknown = projectEmailReadiness(null);
    expect(unknown.state).toBe('unknown');
    expect(unknown.prerequisitesMet).toBe(false);
  });

  it('requires every genuine prerequisite', () => {
    const noPolicy = projectEmailReadiness(
      summaryOf({
        provider_accounts: [acct()] as never,
        sender_identities: [sender()] as never,
        bindings: [binding()] as never,
        channel_setting: null as never,
      }),
    );
    expect(noPolicy.state).toBe('incomplete');
    const unverified = projectEmailReadiness(
      summaryOf({
        provider_accounts: [acct({ verification_status: 'unverified' })] as never,
        sender_identities: [sender()] as never,
        bindings: [binding()] as never,
      }),
    );
    expect(unverified.state).toBe('incomplete');
  });
});

// ─── preservation and safety ─────────────────────────────────────────

describe('C1 closure — preservation and safety', () => {
  it('11. all existing Email mutations remain preserved', () => {
    const accounts = read(`${DIR}/ChannelAccountsTab.tsx`);
    const identities = read(`${DIR}/ChannelIdentitiesTab.tsx`);
    const bindings = read(`${DIR}/ChannelBindingsTab.tsx`);
    const policies = read(`${DIR}/ChannelPoliciesTab.tsx`);
    for (const fn of [
      // C2: generic provider-account service replaces the email-only calls.
      'upsertChannelProviderAccountDraft',
      'setChannelProviderAccountLifecycle',
      'recordProviderAccountCredentialCheck',
      'verifyProviderCredentials',
    ]) expect(accounts).toContain(fn);
    expect(identities).toContain('upsertChannelIdentityDraft');
    expect(identities).toContain('setChannelIdentityLifecycle');
    expect(bindings).toContain('upsertBindingDraft');
    expect(bindings).toContain('recordBindingVerification');
    expect(bindings).toContain('activateBinding');
    expect(policies).toContain('upsertEmailChannelSetting');
  });

  it('12. no migration, provider call, send or runtime mutation is introduced', () => {
    for (const f of UI_FILES) {
      const src = read(f);
      expect(src, f).not.toContain('sendCommunication');
      expect(src, f).not.toContain('create table');
      expect(src, f).not.toMatch(/api\.resend\.com/);
      expect(src, f).not.toMatch(/from ['"]resend['"]/);
    }
    const readiness = read(`${DIR}/emailReadiness.ts`);
    expect(readiness).not.toContain('rpc(');
    expect(readiness).not.toContain('supabase');
  });
});
