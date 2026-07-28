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
  it('registers exactly 19 active logical objects, all PLANNED', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(19);
    for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
      expect(o.status).toBe('PLANNED');
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
      expect(i.status).toBe('reserved');
    }
  });

  it('registers exactly five reserved queues', () => {
    expect(OMNI_COMMS_QUEUE_REGISTRY).toHaveLength(5);
    for (const q of OMNI_COMMS_QUEUE_REGISTRY) {
      expect(q.status).toBe('reserved');
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

  it('Readiness manifest marks Epic 1 as Verified and Epic 2 — Story 1 as next', () => {
    expect(M.systemIdentity.currentEpic).toBe('Epic 1');
    expect(M.systemIdentity.currentStory).toBe('Story 5');
    expect(M.systemIdentity.overallStatus).toBe('Verified');
    expect(M.nextStep.epic).toBe('Epic 2');
    expect(M.nextStep.story).toBe('Story 1');
    expect(M.nextStep.title).toMatch(/Event Definition and Contract Database Design/);
  });

  it('Readiness foundation rows for shell/guard/permissions/nav/registries/CI are all Verified', () => {
    const required = [
      'Isolated source namespace',
      'Permanent route shell',
      'Route guard',
      'Permission capability registration',
      'DB-driven navigation',
      'Architecture README',
      'Readiness page',
      'Object registry',
      'Architecture-boundary CI tests',
    ];
    for (const item of required) {
      const row = M.foundationStatus.find((r) => r.item === item);
      expect(row, `missing foundation row: ${item}`).toBeDefined();
      expect(row!.state).toBe('Verified');
    }
    // Future capabilities stay planned/blocked.
    const facade = M.foundationStatus.find((r) => r.item === 'sendCommunication façade');
    expect(facade?.state).toBe('Planned');
    expect(facade?.note).toMatch(/Epic 7/);
    const providers = M.foundationStatus.find((r) => r.item === 'Provider integrations');
    expect(providers?.note).toMatch(/Epic 9/);
    const worker = M.foundationStatus.find((r) => r.item === 'Runtime worker');
    expect(worker?.note).toMatch(/Epic 8/);
    const firstEvent = M.foundationStatus.find((r) => r.item === 'First business event');
    expect(firstEvent?.state).toBe('Blocked');
    expect(firstEvent?.note).toMatch(/Epic 11/);
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

  it('has no Omni-Comms communication-business migration files (only the Story 1 nav seed)', () => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    if (!fs.existsSync(migrationsDir)) return;
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    for (const f of files) {
      const contents = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
      // omni_comms_ business tables must not appear (only the nav seed which references 'omni_comms' module).
      expect(/CREATE\s+TABLE\s+(public\.)?omni_comms_/i.test(contents), `communication table found in ${f}`).toBe(false);
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
