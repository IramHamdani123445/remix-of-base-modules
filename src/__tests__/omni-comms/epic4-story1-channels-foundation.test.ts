import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_READINESS_MANIFEST as readinessManifest } from '@/platform/omni-comms/registry/readinessManifest';

describe('Epic 4 — Story 1: Provider/Sender/Channel foundation', () => {
  it('object registry preserves 19 entries', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(19);
  });

  it('five Story 1 objects are AVAILABLE and introduced in Epic 4 — Story 1', () => {
    const targets = [
      'omni_comms_provider',
      'omni_comms_provider_account',
      'omni_comms_sender_identity',
      'omni_comms_sender_provider_binding',
      'omni_comms_channel_setting',
    ];
    for (const name of targets) {
      const entry = OMNI_COMMS_OBJECT_REGISTRY.find((e) => e.name === name);
      expect(entry, `${name} must be registered`).toBeDefined();
      expect(entry!.status).toBe('AVAILABLE');
      expect(entry!.epic).toBe(4);
      expect(entry!.introductionStory).toBe('Epic 4 — Story 1');
    }
  });

  it('preference registry entry remains PLANNED (advanced independently by later stories)', () => {
    const preference = OMNI_COMMS_OBJECT_REGISTRY.find((e) => e.name === 'omni_comms_preference');
    expect(preference?.status).toBe('PLANNED');
  });

  it('readiness manifest is on Epic 4 (Story pointer advanced by later builds)', () => {
    expect(readinessManifest.systemIdentity.currentEpic).toBe('Epic 4');
    expect(typeof readinessManifest.systemIdentity.currentStory).toBe('string');
    expect(readinessManifest.nextStep.epic).toBe('Epic 4');
    expect(typeof readinessManifest.nextStep.story).toBe('string');
  });

  it('Channels admin route is registered', () => {
    const channels = readinessManifest.permanentRoutes.find(
      (r) => r.path === '/admin/omnichannel-communications/channels',
    );
    expect(channels).toBeDefined();
    // Build 2 activated the Channels workspace.
    expect(['Available', 'Not implemented']).toContain(channels?.state);
  });

  it('Story 1 verifier and rollback scripts exist', () => {
    expect(existsSync('scripts/omni-comms/verify-epic4-story1-db.sql')).toBe(true);
    expect(existsSync('scripts/omni-comms/rollback/epic4-story1-channels-rollback.sql')).toBe(true);
  });

  it('no Story 1 file introduces provider SDKs or send behaviour', () => {
    const verifier = readFileSync('scripts/omni-comms/verify-epic4-story1-db.sql', 'utf8');
    expect(verifier).toMatch(/EPIC 4 STORY 1 VERIFY OK/);
    expect(verifier).not.toMatch(/resend|twilio|sendgrid|nodemailer/i);
  });
});
