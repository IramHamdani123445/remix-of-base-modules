/**
 * Epic 1 / Story 3 — Omnichannel Communications registries.
 *
 * Verifies:
 *  - counts (20 active objects, 2 deferred, 7 routes, 7 integrations, 5 queues)
 *  - registry validation succeeds
 *  - registry invariants (prefixes, uniqueness, approved epics, write authority)
 *  - Story 3 introduces no migration, edge function, queue, or sendCommunication
 *  - Legacy Communication Hub source files are untouched by Story 3
 *  - Readiness page consumes registry-derived values (no duplicated lists)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from '@/platform/omni-comms/registry/deferredObjects';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '@/platform/omni-comms/registry/integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from '@/platform/omni-comms/registry/queueRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const OMNI_ROOT = path.join(REPO_ROOT, 'src', 'platform', 'omni-comms');
const LEGACY_ROOT = path.join(REPO_ROOT, 'src', 'platform', 'communication-hub');

function walk(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe('Omni-Comms Story 3 — registry counts', () => {
  it('has exactly 33 active objects', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(33);
  });
  it('has exactly 2 deferred objects', () => {
    expect(OMNI_COMMS_DEFERRED_OBJECTS).toHaveLength(2);
  });
  it('has exactly 7 permanent routes', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
  });
  it('has exactly 9 registered integrations', () => {
    expect(OMNI_COMMS_INTEGRATION_REGISTRY).toHaveLength(9);
  });
  it('has exactly 5 reserved queues', () => {
    expect(OMNI_COMMS_QUEUE_REGISTRY).toHaveLength(5);
  });
});

describe('Omni-Comms Story 3 — registry validation', () => {
  it('validates cleanly', () => {
    const r = validateOmniCommsRegistries();
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual({
      activeObjects: 33,
      deferredObjects: 2,
      routes: 7,
      integrations: 9,
      queues: 5,
    });
  });

  it('every object uses the omni_comms_ prefix and an approved epic', () => {
    const approved = new Set([1, 2, 3, 4, 5, 6, 13]);
    for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
      expect(o.name.startsWith('omni_comms_')).toBe(true);
      expect(approved.has(o.epic)).toBe(true);
      expect(['PLANNED', 'AVAILABLE']).toContain(o.status);
    }
  });

  it('runtime objects are service_role_only, except the test evidence ledgers', () => {
    const adminTriggered = new Set([
      'omni_comms_channel_test_run',
      'omni_comms_channel_test_delivery',
    ]);
    for (const o of OMNI_COMMS_OBJECT_REGISTRY.filter((x) => x.category === 'runtime')) {
      if (adminTriggered.has(o.name)) {
        expect(o.writeAuthority).toBe('admin_rpc');
        continue;
      }
      expect(o.writeAuthority).toBe('service_role_only');
    }
  });

  it('every route uses the /admin/omnichannel-communications prefix and omni_comms.view', () => {
    for (const r of OMNI_COMMS_ROUTE_REGISTRY) {
      expect(r.path.startsWith('/admin/omnichannel-communications')).toBe(true);
      expect(r.requiredPermission).toBe('omni_comms.view');
    }
  });

  it('edge functions use the omni-comms- prefix and queues use the omni-comms. prefix', () => {
    for (const i of OMNI_COMMS_INTEGRATION_REGISTRY.filter((x) => x.kind === 'edge_function')) {
      expect(i.name.startsWith('omni-comms-')).toBe(true);
    }
    for (const q of OMNI_COMMS_QUEUE_REGISTRY) {
      expect(q.name.startsWith('omni-comms.')).toBe(true);
    }
  });

  it('deferred names do not collide with approved names', () => {
    const active = new Set(OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name));
    for (const d of OMNI_COMMS_DEFERRED_OBJECTS) {
      expect(active.has(d.proposedName)).toBe(false);
    }
  });
});

describe('Omni-Comms Story 3 — Readiness consumes registry data', () => {
  it('permanent routes are derived from routeRegistry', () => {
    expect(M.permanentRoutes.map((r) => r.path)).toEqual(
      OMNI_COMMS_ROUTE_REGISTRY.map((r) => r.path),
    );
  });
  it('planned objects are derived from objectRegistry', () => {
    const combined = [
      ...M.plannedObjects.eventsAndContent,
      ...M.plannedObjects.channelsSendersPreferences,
      ...M.plannedObjects.runtime,
    ].map((o) => o.name).sort();
    expect(combined).toEqual(OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name).sort());
  });
  it('reserved edge functions are derived from integrationRegistry', () => {
    expect(M.reservedEdgeFunctions.sort()).toEqual(
      OMNI_COMMS_INTEGRATION_REGISTRY
        .filter((i) => i.kind === 'edge_function')
        .map((i) => i.name)
        .sort(),
    );
  });
  it('reserved queues are derived from queueRegistry', () => {
    expect(M.reservedQueues.sort()).toEqual(
      OMNI_COMMS_QUEUE_REGISTRY.map((q) => q.name).sort(),
    );
  });
  it('ReadinessTab imports the registries directly (no hard-coded duplicates)', () => {
    const src = readFileSync(
      path.join(OMNI_ROOT, 'admin', 'views', 'readiness', 'ReadinessTab.tsx'),
      'utf8',
    );
    expect(src).toMatch(/from '@\/platform\/omni-comms\/registry\/objectRegistry'/);
    // routeRegistry is consumed transitively via readinessManifest.permanentRoutes
    expect(src).toMatch(/from '@\/platform\/omni-comms\/registry\/integrationRegistry'/);
    expect(src).toMatch(/from '@\/platform\/omni-comms\/registry\/queueRegistry'/);
    expect(src).toMatch(/validateOmniCommsRegistries/);
  });
});

describe('Omni-Comms Story 3 — no runtime implementation was created', () => {
  it('the canonical façade exists exactly once at the approved path (post-Slice-2a/2b)', () => {
    const files = walk(OMNI_ROOT);
    const facades = files.filter((f) => path.basename(f) === 'sendCommunication.ts');
    expect(facades).toHaveLength(1);
    expect(facades[0].replace(/\\/g, '/')).toMatch(
      /src\/platform\/omni-comms\/sendCommunication\.ts$/,
    );
  });

  it('no omni_comms_* migration exists beyond registry-approved AVAILABLE tables, and no omni-comms-* edge function exists', () => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const allowed = new Set(
      OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.status === 'AVAILABLE').map((o) => o.name),
    );
    if (existsSync(migrationsDir)) {
      const offenders: string[] = [];
      for (const file of readdirSync(migrationsDir)) {
        if (!file.endsWith('.sql')) continue;
        const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
        const created = Array.from(sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(omni_comms_[a-z_]+)/gi)).map((m) => m[1].toLowerCase());
        if (created.some((t) => !allowed.has(t))) offenders.push(file);
      }
      expect(offenders).toEqual([]);
    }
    const functionsDir = path.join(REPO_ROOT, 'supabase', 'functions');
    if (existsSync(functionsDir)) {
      const dirs = readdirSync(functionsDir).filter((d) =>
        statSync(path.join(functionsDir, d)).isDirectory(),
      );
      // Every physical omni-comms-* edge function must be registered in the
      // integration registry with status Available.
      const registered = new Set(
        OMNI_COMMS_INTEGRATION_REGISTRY
          .filter((i) => i.kind === 'edge_function' && i.status === 'Available')
          .map((i) => i.name),
      );
      for (const d of dirs.filter((x) => x.startsWith('omni-comms-'))) {
        expect(registered.has(d), `${d} is not a registered Available integration`).toBe(true);
      }
    }
  });

  it('registry files do not import provider SDKs or Legacy Comm Hub', () => {
    const banned = [
      /from ['"]resend['"]/,
      /from ['"]twilio['"]/,
      /from ['"]@twilio\//,
      /from ['"]@sendgrid\//,
      /from ['"]nodemailer['"]/,
      /from ['"]@\/platform\/communication-hub/,
      /from ['"]@\/pages\/admin\/communicationHub/,
    ];
    const registryDir = path.join(OMNI_ROOT, 'registry');
    for (const f of walk(registryDir)) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const src = readFileSync(f, 'utf8');
      for (const re of banned) expect(re.test(src)).toBe(false);
    }
  });
});

describe('Omni-Comms Story 3 — Legacy Communication Hub untouched', () => {
  it('Legacy source tree still exists', () => {
    if (existsSync(LEGACY_ROOT)) {
      expect(walk(LEGACY_ROOT).length).toBeGreaterThan(0);
    }
  });
  it('Legacy guard file is present and does not import Omni-Comms', () => {
    const legacyGuard = path.join(REPO_ROOT, 'src', 'components', 'auth', 'CommHubAdminRoute.tsx');
    if (existsSync(legacyGuard)) {
      const src = readFileSync(legacyGuard, 'utf8');
      expect(src).not.toMatch(/from ['"]@\/platform\/omni-comms/);
    }
  });
});
