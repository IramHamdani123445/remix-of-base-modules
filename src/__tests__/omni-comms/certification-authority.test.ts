/**
 * Omni-Comms — database health posture is the SOLE runtime certification
 * authority, and every server gate requires a COMPLETE certification record.
 *
 * Static, read-only assertions. No provider, no dispatch, no cutover.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  deriveCertificationPosture,
  type CertificationPostureInput,
} from '@/platform/omni-comms/admin/posture/omniCommsPosture';
import { revisionMatch } from '@/platform/omni-comms/registry/certificationEvidence';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const MIGRATION = 'supabase/migrations/20260801074854_07ff4334-5b8a-49cf-87ff-5ce940fd30cc.sql';
const POSTURE = 'src/platform/omni-comms/admin/posture/omniCommsPosture.ts';
const HOOK = 'src/platform/omni-comms/admin/hooks/useOmniCommsCertificationPosture.ts';
const EVIDENCE = 'src/platform/omni-comms/registry/certificationEvidence.ts';

/** Fully healthy server posture: the only shape that may permit Safe test. */
const certified: CertificationPostureInput = {
  certifiedCommit: SHA,
  deployedRevision: SHA,
  edgeCertificationState: 'certified',
  edgeAvailable: true,
  edgeRevisionVerified: true,
  edgeRevisionMatch: 'match',
  edgeSafeTestPermitted: true,
  edgeSafeTestBlockedReason: null,
  environment: 'non_production',
};

describe('database health posture is the only runtime certification authority', () => {
  it('permits Safe test only for a complete, certified, matching server posture', () => {
    const p = deriveCertificationPosture(certified);
    expect(p.state).toBe('certified');
    expect(p.safeTestPermitted).toBe(true);
  });

  it('never reads the source-controlled evidence record when deciding execution', () => {
    const hook = read(HOOK);
    expect(hook).not.toContain('OMNI_COMMS_CERTIFICATION_EVIDENCE');
    expect(read(POSTURE)).not.toContain('OMNI_COMMS_CERTIFICATION_EVIDENCE');
    expect(read(POSTURE)).not.toContain('recordedState');
  });

  it('source evidence pending cannot override a certified, matching server posture', () => {
    // The evidence record is `pending` in source control; the derived posture
    // takes no input from it and still permits the safe test.
    const evidence = read(EVIDENCE);
    expect(evidence).toContain("state: 'pending'");
    expect(deriveCertificationPosture(certified).safeTestPermitted).toBe(true);
  });

  it('source evidence certified cannot override a pending, failed or unavailable server posture', () => {
    for (const override of [
      { edgeCertificationState: 'pending', edgeSafeTestPermitted: false },
      { edgeCertificationState: 'failed', edgeSafeTestPermitted: false },
      { edgeAvailable: false, edgeSafeTestPermitted: false },
    ] as Partial<CertificationPostureInput>[]) {
      const p = deriveCertificationPosture({ ...certified, ...override });
      expect(p.safeTestPermitted).toBe(false);
      expect(p.state).not.toBe('certified');
    }
  });

  it('blocks when the Edge probe is unavailable', () => {
    const p = deriveCertificationPosture({ ...certified, edgeAvailable: false });
    expect(p.state).toBe('unknown');
    expect(p.safeTestPermitted).toBe(false);
  });

  it('blocks when health fields are missing', () => {
    for (const override of [
      { certifiedCommit: null },
      { deployedRevision: null },
      { edgeCertificationState: null },
      { edgeRevisionVerified: null },
      { edgeRevisionMatch: null },
      { edgeSafeTestPermitted: null },
      { edgeAvailable: null },
    ] as Partial<CertificationPostureInput>[]) {
      expect(
        deriveCertificationPosture({ ...certified, ...override }).safeTestPermitted,
      ).toBe(false);
    }
  });

  it('blocks pending, failed, unknown environment and production', () => {
    expect(
      deriveCertificationPosture({
        ...certified,
        edgeCertificationState: 'pending',
      }).safeTestPermitted,
    ).toBe(false);
    expect(
      deriveCertificationPosture({ ...certified, edgeCertificationState: 'failed' })
        .state,
    ).toBe('failed');
    for (const environment of ['production', 'unknown'] as const) {
      expect(
        deriveCertificationPosture({ ...certified, environment }).safeTestPermitted,
      ).toBe(false);
    }
  });

  it('requires exact full-SHA equality everywhere', () => {
    for (const override of [
      { certifiedCommit: OTHER },
      { deployedRevision: OTHER },
      { certifiedCommit: SHA.slice(0, 39) },
      { deployedRevision: SHA.slice(0, 12) },
      { certifiedCommit: 'zzzz' },
      { edgeRevisionMatch: 'mismatch' as const },
      { edgeRevisionVerified: false },
    ] as Partial<CertificationPostureInput>[]) {
      expect(
        deriveCertificationPosture({ ...certified, ...override }).safeTestPermitted,
      ).toBe(false);
    }
    // Shortened SHAs are never a match, in either direction.
    expect(revisionMatch(SHA, SHA.slice(0, 12))).toBe('unknown');
    expect(revisionMatch(SHA.slice(0, 12), SHA)).toBe('unknown');
    expect(revisionMatch(SHA, SHA)).toBe('match');
    expect(revisionMatch(SHA, OTHER)).toBe('mismatch');
  });

  it('leaves no prefix comparison in any certification surface', () => {
    for (const file of [POSTURE, HOOK, EVIDENCE]) {
      expect(read(file)).not.toMatch(/startsWith\s*\(/);
    }
  });
});

describe('server gate requires a complete certification record', () => {
  const sql = read(MIGRATION);

  it('updates the three server functions', () => {
    for (const fn of [
      'omni_comms_priv_runtime_health_posture',
      'omni_comms_controlled_dry_run_gate',
      'omni_comms_priv_admin_dry_run_guard',
    ]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`);
    }
  });

  it('requires effective_certified in each of them', () => {
    const parts = sql.split('CREATE OR REPLACE FUNCTION public.').slice(1);
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toContain("'effective_certified'");
      expect(part).toContain('NOT v_effective');
      expect(part).toContain('runtime_certification_record_incomplete');
    }
  });

  it('keeps exact full-SHA equality in the trusted guard', () => {
    expect(sql).toContain("v_rev !~ '^[0-9a-f]{40}$'");
    expect(sql).toContain('v_rev <> v_commit');
    expect(sql).not.toContain('starts_with');
    expect(sql).not.toMatch(/left\s*\(\s*v_(rev|commit)/i);
  });

  it('keeps the environment requirement exactly non_production', () => {
    expect(sql).toContain("v_env <> 'non_production'");
  });

  it('introduces no provider, shadow-mode or Legacy cutover capability', () => {
    expect(sql).not.toMatch(
      /resend|twilio|sendgrid|pg_net|net\.http|shadow_mode|cutover|notification_queue|notification_logs|comm_hub_/i,
    );
  });

  it('leaves live delivery disabled and creates no dispatch state', () => {
    expect(sql).toContain("'live_delivery_enabled', false");
    expect(sql).not.toMatch(/insert\s+into\s+public\.omni_comms_(dispatch_job|delivery_attempt)/i);
  });
});
