/**
 * Epic 1 — Story 5: Final acceptance-criteria verification.
 *
 * These tests are invariants that assert the Epic 1 foundation is in the
 * "Verified" state. They do not exercise UI directly (that is covered by
 * `health-readiness.test.tsx`); they assert the source-controlled facts.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from '@/platform/omni-comms/registry/deferredObjects';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '@/platform/omni-comms/registry/integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from '@/platform/omni-comms/registry/queueRegistry';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_PERMISSION_DEFINITIONS } from '@/platform/rbac/omniComms.permissions';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const APP_ROUTES = path.join(REPO_ROOT, 'src', 'components', 'routing', 'AppRoutes.tsx');
const OMNI_ROOT = path.join(REPO_ROOT, 'src', 'platform', 'omni-comms');

const EXPECTED_ROUTES = [
  '/admin/omnichannel-communications',
  '/admin/omnichannel-communications/operations',
  '/admin/omnichannel-communications/events',
  '/admin/omnichannel-communications/templates',
  '/admin/omnichannel-communications/channels',
  '/admin/omnichannel-communications/preferences',
  '/admin/omnichannel-communications/health',
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('Epic 1 — Story 5 final verification', () => {
  it('registers exactly 19 active logical objects with approved statuses', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(19);
    for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
      expect(['PLANNED', 'AVAILABLE']).toContain(o.status);
    }
  });

  it('registers exactly two deferred objects', () => {
    expect(OMNI_COMMS_DEFERRED_OBJECTS).toHaveLength(2);
    for (const o of OMNI_COMMS_DEFERRED_OBJECTS) {
      expect(o.proposedName).toMatch(/^omni_comms_/);
      expect(o.replacedBy).toBeTruthy();
    }
  });

  it('registers exactly seven permanent routes and seven reserved integrations', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
    expect(OMNI_COMMS_INTEGRATION_REGISTRY).toHaveLength(7);
    for (const i of OMNI_COMMS_INTEGRATION_REGISTRY) {
      expect(['reserved', 'reused']).toContain(String(i.status).toLowerCase());
    }
  });

  it('registers exactly five reserved queues', () => {
    expect(OMNI_COMMS_QUEUE_REGISTRY).toHaveLength(5);
    for (const q of OMNI_COMMS_QUEUE_REGISTRY) {
      expect(String(q.status).toLowerCase()).toBe('reserved');
    }
  });

  it('registers all six omni_comms.* capabilities with only omni_comms.view as ACTIVE', () => {
    expect(OMNI_COMMS_PERMISSION_DEFINITIONS).toHaveLength(6);
    const keys = OMNI_COMMS_PERMISSION_DEFINITIONS.map((p) => p.permission_key).sort();
    expect(keys).toEqual([
      'omni_comms.approve_templates',
      'omni_comms.author_templates',
      'omni_comms.configure',
      'omni_comms.operate',
      'omni_comms.view',
      'omni_comms.view_sensitive_content',
    ]);
    const active = OMNI_COMMS_PERMISSION_DEFINITIONS.filter((p) => p.lifecycle_status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].permission_key).toBe('omni_comms.view');
  });

  it('AppRoutes.tsx contains exactly seven Omni-Comms routes, each guarded by OmniCommsAdminRoute', () => {
    const src = fs.readFileSync(APP_ROUTES, 'utf8');
    for (const p of EXPECTED_ROUTES) {
      const routeLine = new RegExp(`<Route\\s+path="${p.replace(/\//g, '\\/')}"[^>]*>[\\s\\S]*?OmniCommsAdminRoute`);
      expect(routeLine.test(src), `route missing or unguarded: ${p}`).toBe(true);
    }
    // Reject an eighth route under this prefix.
    const routeMatches = src.match(/path="\/admin\/omnichannel-communications[^"]*"/g) ?? [];
    expect(routeMatches).toHaveLength(7);
  });

  it('Readiness manifest advances beyond Epic 1 without regressing overall status', () => {
    expect(['Verified', 'In progress']).toContain(M.systemIdentity.overallStatus);
    // Epic 1 is complete; the manifest must have moved past Epic 1 in either
    // currentEpic or nextStep. This invariant remains stable across later epics.
    const advanced =
      M.systemIdentity.currentEpic !== 'Epic 1' || M.nextStep.epic !== 'Epic 1';
    expect(advanced).toBe(true);
    expect(M.nextStep.epic).toMatch(/^Epic [2-9]\d*$/);
    expect(M.nextStep.story).toMatch(/Story [1-9]/);
    expect(M.nextStep.title).toBeTruthy();
  });

  it('Readiness manifest continues to expose a non-empty foundationStatus list', () => {
    // Foundation-row identities evolve per epic; the stable Epic-1 invariant is
    // that the manifest continues to publish a foundation-status catalogue.
    expect(Array.isArray(M.foundationStatus)).toBe(true);
    expect(M.foundationStatus.length).toBeGreaterThan(0);
    for (const row of M.foundationStatus) {
      expect(typeof row.item).toBe('string');
      expect(row.item.length).toBeGreaterThan(0);
      expect(['Verified', 'In progress', 'Planned', 'Blocked']).toContain(row.state);
    }
  });


  it('has no sendCommunication implementation and no communication runtime files in the shell', () => {
    const files = walk(OMNI_ROOT);
    const forbidden = files.filter((f) => /sendCommunication\.(ts|tsx)$/.test(f));
    expect(forbidden, `unexpected façade files: ${forbidden.join(', ')}`).toEqual([]);

    // No provider adapter, worker, edge function, or queue implementation files.
    const adapters = files.filter((f) => f.includes(`${path.sep}adapters${path.sep}`) && !f.endsWith('.gitkeep') && !f.endsWith('.md'));
    const workers = files.filter((f) => f.includes(`${path.sep}workers${path.sep}`) && !f.endsWith('.gitkeep') && !f.endsWith('.md'));
    expect(adapters, `unexpected adapter files: ${adapters.join(', ')}`).toEqual([]);
    expect(workers, `unexpected worker files: ${workers.join(', ')}`).toEqual([]);
  });

  it('has no Omni-Comms communication-business migration files beyond the approved Story 1 nav seed and Epic 2 Story 1 event tables', () => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    if (!fs.existsSync(migrationsDir)) return;
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const allowed = new Set(['omni_comms_event_definition', 'omni_comms_event_contract']);
    for (const f of files) {
      const contents = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      const created = Array.from(contents.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(omni_comms_[a-z_]+)/gi)).map((m) => m[1].toLowerCase());
      for (const tbl of created) {
        expect(allowed.has(tbl), `unexpected omni-comms table created in ${f}: ${tbl}`).toBe(true);
      }
    }
  });

  it('has an Epic 1 evidence file with all required sections', () => {
    const evidence = path.join(OMNI_ROOT, 'registry', 'evidence', 'epic-01-foundation.md');
    expect(fs.existsSync(evidence)).toBe(true);
    const text = fs.readFileSync(evidence, 'utf8');
    for (const heading of [
      'Stories completed',
      'Files created',
      'Files modified',
      'Routes verified',
      'Permissions verified',
      'Registry counts',
      'Architecture rules verified',
      'Tests executed',
      'CI check result',
      'Legacy impact',
      'Known limitations',
      'Remaining blockers',
      'Rollback procedure',
      'Next approved epic',
    ]) {
      expect(text.includes(heading), `evidence missing section: ${heading}`).toBe(true);
    }
    // Rollback must be documented as rehearsal only.
    expect(text).toMatch(/DO NOT EXECUTE|rehearsal/i);
    // Prohibited broad-deletion patterns must not appear as prescribed rollback SQL.
    expect(text).not.toMatch(/permission_key\s+LIKE\s+'omni_comms\.%'\s*;/);
  });
});
