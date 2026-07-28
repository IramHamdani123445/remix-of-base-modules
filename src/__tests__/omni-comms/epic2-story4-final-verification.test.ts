/**
 * Epic 2 — Story 4 final source verification.
 *
 * These invariants prove source-controlled expectations only.
 * Deployed database security is proven by scripts/omni-comms/verify-story4-db.sql.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import * as svc from '@/platform/omni-comms/application/eventCatalogueService';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const EVIDENCE = path.join(
  REPO_ROOT,
  'src',
  'platform',
  'omni-comms',
  'registry',
  'evidence',
  'epic-02-event-catalogue.md',
);
const ADMIN_ROOT = path.join(REPO_ROOT, 'src', 'platform', 'omni-comms', 'admin');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir)) {
    const full = path.join(dir, e);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
};

describe('Omni-Comms Epic 2 — Story 4 (final source verification)', () => {
  it('platform status remains In progress', () => {
    expect(M.systemIdentity.overallStatus).toBe('In progress');
  });

  it('next approved step exists and is informational-only', () => {
    expect(M.nextStep.epic).toMatch(/Epic \d+/);
    expect(M.nextStep.story).toMatch(/Story \d+/);
    expect(M.nextStep.informationalOnly).toBe(true);
  });

  it('Story 4 verified capability rows remain Verified', () => {
    const expectedVerified = [
      'Event Definition schema',
      'Event Contract schema',
      'Event Catalogue application services',
      'Contract schema validation',
      'Contract sample validation',
      'Contract checksum generation',
      'Event Catalogue administration UI',
      'Event Definition administration',
      'Event Contract administration',
      'Authorised RPC integration',
      'Sensitive sample-payload protection',
      'Event lifecycle audit',
      'Contract lifecycle audit',
    ];
    const expectedPlanned = ['Event Routes administration', 'Event Simulator'];

    for (const item of expectedVerified) {
      const row = M.foundationStatus.find((r) => r.item === item);
      expect(row, `missing row: ${item}`).toBeDefined();
      expect(row!.state).toBe('Verified');
    }
    for (const item of expectedPlanned) {
      const row = M.foundationStatus.find((r) => r.item === item);
      expect(row, `missing row: ${item}`).toBeDefined();
      expect(row!.state).toBe('Planned');
    }
  });

  it('physical event tables remain registered and AVAILABLE (not "verified")', () => {
    const def = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_definition');
    const con = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_contract');
    expect(def?.status).toBe('AVAILABLE');
    expect(con?.status).toBe('AVAILABLE');
    // No new Epic 2 business table introduced.
    const others = OMNI_COMMS_OBJECT_REGISTRY.filter(
      (o) =>
        o.introductionStory === 'Epic 2 — Story 1' &&
        o.name !== 'omni_comms_event_definition' &&
        o.name !== 'omni_comms_event_contract',
    );
    expect(others).toEqual([]);
  });

  it('registered capability keys are exactly the six approved omni_comms.* actions', () => {
    const keys = M.capabilities.map((c) => c.key).sort();
    expect(keys).toEqual([
      'omni_comms.approve_templates',
      'omni_comms.author_templates',
      'omni_comms.configure',
      'omni_comms.operate',
      'omni_comms.view',
      'omni_comms.view_sensitive_content',
    ]);
  });

  it('the seven permanent routes still exist and no new route was added by Story 4', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
    const events = OMNI_COMMS_ROUTE_REGISTRY.find(
      (r) => r.path === '/admin/omnichannel-communications/events',
    );
    expect(events).toBeDefined();
  });

  it('adapter surface exposes exactly the 13 approved Event Catalogue operations', () => {
    const expected = [
      'createEventDefinition',
      'updateEventDefinitionDraft',
      'activateEventDefinition',
      'suspendEventDefinition',
      'retireEventDefinition',
      'listEventDefinitions',
      'getEventDefinition',
      'createEventContract',
      'updateEventContractDraft',
      'publishEventContract',
      'retireEventContract',
      'listEventContracts',
      'getEventContract',
    ];
    for (const name of expected) {
      expect(typeof (svc as unknown as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('admin source contains no direct table access or service-role client', () => {
    const files = walk(ADMIN_ROOT);
    const offenders: string[] = [];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      if (/\.from\(\s*['"]omni_comms_event_(definition|contract)['"]/.test(src)) offenders.push(`${f}: direct .from`);
      if (/SUPABASE_SERVICE_ROLE_KEY|createClient\([^)]*service_role/.test(src)) offenders.push(`${f}: service-role client`);
    }
    expect(offenders).toEqual([]);
  });

  it('evidence document exists and covers required Epic 2 sections', () => {
    expect(fs.existsSync(EVIDENCE)).toBe(true);
    const md = fs.readFileSync(EVIDENCE, 'utf8');
    for (const heading of [
      'Database Objects',
      'RPC Inventory',
      'Private Helper Inventory',
      'Permission Model',
      'RLS and Grants',
      'SECURITY DEFINER Controls',
      'Lifecycle Rules',
      'JSON Schema Behavior',
      'Checksum Definition',
      'Sensitive-Content Behavior',
      'Audit Behavior',
      'Search and Pagination Behavior',
      'UI Capabilities',
      'Test Commands',
      'Actual Results',
      'Rollback Plan',
      'Next Approved Epic',
    ]) {
      expect(md).toMatch(new RegExp(heading));
    }
    // Rollback sections for all three prior stories.
    expect(md).toMatch(/Story 1 rollback/i);
    expect(md).toMatch(/Story 2 rollback/i);
    expect(md).toMatch(/Story 3 rollback/i);
  });

  it('final DB verification script exists', () => {
    const script = path.join(REPO_ROOT, 'scripts', 'omni-comms', 'verify-story4-db.sql');
    expect(fs.existsSync(script)).toBe(true);
  });
});
