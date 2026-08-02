/**
 * Epic 2 — Story 1 verification.
 *
 * Verifies the source-controlled artefacts that record the introduction of
 * omni_comms_event_definition and omni_comms_event_contract. Physical DB
 * assertions live in the psql harness run during the migration; this suite
 * asserts registry, manifest, and UI-visible invariants.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';

const REPO_ROOT = process.cwd();

describe('Omni-Comms Epic 2 — Story 1 (event tables)', () => {
  it('the two Story 1 event tables are AVAILABLE with correct introduction story', () => {
    const story1 = OMNI_COMMS_OBJECT_REGISTRY.filter(
      (o) => o.introductionStory === 'Epic 2 — Story 1',
    );
    expect(story1.map((o) => o.name).sort()).toEqual([
      'omni_comms_event_contract',
      'omni_comms_event_definition',
    ]);
    for (const o of story1) {
      expect(o.epic).toBe(2);
      expect(o.status).toBe('AVAILABLE');
    }
  });

  it('object registry still enumerates exactly 25 approved objects', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(25);
  });

  it('object registry marks both Story 1 event tables as AVAILABLE', () => {
    const def = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_definition');
    const con = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_contract');
    expect(def?.status).toBe('AVAILABLE');
    expect(con?.status).toBe('AVAILABLE');
    expect(def?.introductionStory).toBe('Epic 2 — Story 1');
    expect(con?.introductionStory).toBe('Epic 2 — Story 1');
  });

  it('readiness nextStep has advanced beyond Epic 2 — Story 1', () => {
    // Story 1 introduced the tables; nextStep must have moved on.
    const isStill = M.nextStep.epic === 'Epic 2' && M.nextStep.story === 'Story 1';
    expect(isStill).toBe(false);
  });

  it('a migration file exists that creates both event tables', () => {
    const dir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql'));
    const withBoth = files.filter((f) => {
      const c = fs.readFileSync(path.join(dir, f), 'utf8');
      return /create\s+table[^;]*omni_comms_event_definition/i.test(c)
        && /create\s+table[^;]*omni_comms_event_contract/i.test(c);
    });
    expect(withBoth.length).toBeGreaterThanOrEqual(1);
  });
});
