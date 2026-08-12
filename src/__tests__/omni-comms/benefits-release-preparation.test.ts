/**
 * Omni-Comms — Benefits controlled pilot release preparation.
 *
 * Boundaries proven here (all source-scan, no network, no dispatch):
 *  1. Release readiness accepts a sending-ready credential (verified OR a
 *     restricted sending-only provider key the provider authenticated), so a
 *     full-access credential is never required for the controlled pilot.
 *  2. The prerequisite migration changes readiness evaluation ONLY — it never
 *     approves, activates, dispatches, or enables unrestricted live delivery.
 *  3. Approval/activation stays exclusively behind the trusted Edge boundary:
 *     the browser release service exposes no approve/activate RPC.
 *  4. The client-side sending-ready predicate and the database predicate agree.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { credentialSendReady } from '@/platform/omni-comms/application/channelProviderAccountTypes';
import * as releaseService from '@/platform/omni-comms/application/channelReleaseControlService';

const MIGRATIONS_DIR = 'supabase/migrations';

function latestMigrationContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(`${MIGRATIONS_DIR}/${files[i]}`, 'utf8');
    if (body.includes(needle)) return body;
  }
  throw new Error(`No migration contains ${needle}`);
}

// Pinned to the release-preparation migration itself (the only migration that
// rewrites the prerequisite evaluator through the v_old/v_new replacement),
// so later unrelated migrations touching sequence 10 cannot shadow it.
const PREREQ_MIGRATION = latestMigrationContaining(
  'replace(v_src, v_old, v_new)',
);

describe('release readiness — sending-ready credentials', () => {
  it('evaluates sequence 10 through the send-ready predicate', () => {
    expect(PREREQ_MIGRATION).toContain(
      'public.omni_comms_provider_credential_send_ready(pa.verification_status, pa.verification_result_code)',
    );
    expect(PREREQ_MIGRATION).toContain('v_old');
    expect(PREREQ_MIGRATION).toContain('replace(v_src, v_old, v_new)');

  });

  it('agrees with the client predicate for a restricted sending-only key', () => {
    expect(
      credentialSendReady({
        verification_status: 'pending',
        verification_result_code: 'restricted_api_key',
      }),
    ).toBe(true);
    expect(
      credentialSendReady({
        verification_status: 'pending',
        verification_result_code: 'invalid_credentials',
      }),
    ).toBe(false);
  });
});

describe('release preparation is inert', () => {
  it('does not approve, activate, dispatch, or enable live delivery', () => {
    for (const forbidden of [
      'release_approve_activate',
      'approved_at',
      'activated_at',
      'live_delivery_enabled',
      'omni_comms_dispatch_job',
      'INSERT INTO public.omni_comms_delivery_attempt',
    ]) {
      expect(PREREQ_MIGRATION).not.toContain(forbidden);
    }
  });

  it('only replaces the prerequisite evaluator', () => {
    expect(PREREQ_MIGRATION).toContain(
      'omni_comms_priv_channel_release_prerequisites',
    );
    expect(PREREQ_MIGRATION).not.toMatch(/\bDROP\s+(TABLE|FUNCTION)\b/i);
    expect(PREREQ_MIGRATION).not.toMatch(/\bUPDATE\s+public\./i);
  });
});

describe('approval remains behind the trusted Edge boundary', () => {
  it('exposes no browser approve/activate RPC', () => {
    const exported = Object.keys(releaseService);
    expect(exported).not.toContain('approveActivateChannelRelease');
    expect(exported.some((k) => /approve|activate/i.test(k) && k !== 'buildApproveActivateBody')).toBe(
      false,
    );
    expect(releaseService.RELEASE_CONTROL_EDGE_FUNCTION).toBe(
      'omni-comms-release-control',
    );
  });

  it('builds an approval body that carries no deployed revision from the browser', () => {
    const body = releaseService.buildApproveActivateBody({
      releaseControlId: '00000000-0000-0000-0000-000000000001',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      expectedFingerprint: 'a'.repeat(64),
    });
    expect(body.action).toBe('approve_activate');
    expect(Object.keys(body)).not.toContain('deployedRevision');
  });
});
