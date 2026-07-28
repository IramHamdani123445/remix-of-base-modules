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
  it('registers exactly the two event tables as AVAILABLE and everything else as PLANNED', () => {
    const available = OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.status === 'AVAILABLE');
    expect(available.map((o) => o.name).sort()).toEqual([
      'omni_comms_event_contract',
      'omni_comms_event_definition',
    ]);
    for (const o of available) {
      expect(o.epic).toBe(2);
      expect(o.introductionStory).toBe('Epic 2 — Story 1');
    }
    const planned = OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.status === 'PLANNED');
    expect(planned).toHaveLength(17);
  });

  it('object registry still enumerates exactly 19 approved objects', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(19);
  });

  it('readiness foundation row for communication business tables reflects Story 1 progress', () => {
    const row = M.foundationStatus.find((r) => r.item === 'Communication business tables');
    expect(row).toBeDefined();
    expect(row!.state).toBe('In progress');
    expect(row!.note).toMatch(/omni_comms_event_definition/);
    expect(row!.note).toMatch(/omni_comms_event_contract/);
  });

  it('readiness nextStep advances beyond Epic 2 — Story 1', () => {
    expect(M.nextStep.epic).toBe('Epic 2');
    expect(M.nextStep.story).not.toBe('Story 1');
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
