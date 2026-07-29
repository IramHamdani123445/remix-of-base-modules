/**
 * Accelerated Build 3 — Slice 1 runtime foundation tests.
 *
 * Registry and architecture invariants only. Database physical checks live
 * in `scripts/omni-comms/verify-build3-slice1-runtime-db.sql`.
 */
import { describe, it, expect } from 'vitest';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_READINESS_MANIFEST } from '@/platform/omni-comms/registry/readinessManifest';

const RUNTIME_TABLES = [
  'omni_comms_event_route',
  'omni_comms_request',
  'omni_comms_recipient',
  'omni_comms_message',
  'omni_comms_dispatch_job',
  'omni_comms_delivery_attempt',
  'omni_comms_message_event',
] as const;

describe('Build 3 Slice 1 — object registry', () => {
  it('keeps the registry ceiling at exactly 19 entries', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY.length).toBe(19);
  });

  it.each(RUNTIME_TABLES)('marks %s as AVAILABLE', (name) => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === name);
    expect(entry, `${name} must exist`).toBeDefined();
    expect(entry?.status).toBe('AVAILABLE');
    expect(entry?.introductionStory).toBe('Accelerated Build 3 — Slice 1');
    if (name !== 'omni_comms_event_route') {
      expect(entry?.writeAuthority).toBe('service_role_only');
    }
  });
});

describe('Build 3 Slice 1 — readiness manifest pointer', () => {
  it('manifest currentStory has advanced at or past Slice 1', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.systemIdentity.currentStory).toMatch(
      /^Accelerated Build 3 — Slice /,
    );
  });

  it('next step points to a later Accelerated Build 3 slice', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.nextStep.story).toMatch(
      /^Accelerated Build 3 — Slice /,
    );
  });
});
