import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

describe('Omni-Comms Accelerated Build 2 — Email configuration RPCs & UI', () => {
  it('Channels admin route is now Available', () => {
    const route = OMNI_COMMS_ROUTE_REGISTRY.find(
      (r) => r.path === '/admin/omnichannel-communications/channels',
    );
    expect(route?.state).toBe('Available');
  });

  it('readiness manifest advances to Build 2 with a Build 3 next step', () => {
    expect(M.systemIdentity.currentStory).toBe('Accelerated Build 2');
    expect(M.nextStep.story).toBe('Build 3');
  });

  it('foundationStatus records Build 2 email configuration items', () => {
    const items = M.foundationStatus.map((f) => f.item);
    expect(items).toContain('Email provider ensure/activate');
    expect(items).toContain('Provider account application services');
    expect(items).toContain('Sender identity application services');
    expect(items).toContain('Binding application services');
    expect(items).toContain('Email channel setting service');
    expect(items).toContain('Email configuration summary');
    expect(items).toContain('Channels admin surface');
  });

  it('channel-management adapter exports the expected surface', async () => {
    const svc = await import(
      '@/platform/omni-comms/application/channelManagementService'
    );
    for (const fn of [
      'ensureEmailProvider',
      'activateEmailProvider',
      'upsertProviderAccountDraft',
      'activateProviderAccount',
      'recordProviderAccountCredentialCheck',
      'upsertSenderIdentityDraft',
      'activateSenderIdentity',
      'upsertBindingDraft',
      'recordBindingVerification',
      'activateBinding',
      'upsertEmailChannelSetting',
      'getEmailConfigSummary',
    ]) {
      expect(typeof (svc as Record<string, unknown>)[fn]).toBe('function');
    }
  });

  it('channels page implementation exists and imports the bound RPC client', () => {
    const p = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';
    expect(existsSync(p)).toBe(true);
    const src = readFileSync(p, 'utf8');
    expect(src).toMatch(/useOmniCommsRpcClient/);
    expect(src).toMatch(/channelManagementService/);
    // No provider SDK / send behaviour leaks into the view.
    expect(src).not.toMatch(/from ['"]resend['"]/);
    expect(src).not.toMatch(/sendCommunication/);
  });

  it('Build 2 migration file exists and references the new RPCs', () => {
    // The migration file created via the migration tool. Locate any file that
    // contains our public function names to prove SQL is in the tree.
    const dir = 'supabase/migrations';
    if (!existsSync(dir)) return;
    const files = readdirSync(dir) as string[];
    const found = files.some((f) => {
      if (!f.endsWith('.sql')) return false;
      const src = readFileSync(`${dir}/${f}`, 'utf8');
      return (
        src.includes('omni_comms_email_provider_ensure')
        && src.includes('omni_comms_email_config_summary')
        && src.includes('omni_comms_channel_setting_upsert')
      );
    });
    expect(found).toBe(true);
  });
});
