/**
 * Epic 3 — Story 1: Template Family and Template Version foundation
 *
 * Source-side invariants only. DB behaviour is verified separately via
 * scripts/omni-comms/verify-epic3-story1-db.sql on a local/test database.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { OMNI_COMMS_READINESS_MANIFEST } from '@/platform/omni-comms/registry/readinessManifest';

const SRC_ROOT = join(process.cwd(), 'src');
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

const findFiles = (root: string, pred: (p: string) => boolean): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (pred(p)) out.push(p);
    }
  };
  walk(root);
  return out;
};

describe('Epic 3 Story 1 — object registry', () => {
  it('keeps the 20-object ceiling', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY.length).toBe(20);
  });

  it('marks template_family and template_version as AVAILABLE', () => {
    const family = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_template_family');
    const version = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_template_version');
    expect(family?.status).toBe('AVAILABLE');
    expect(family?.introductionStory).toBe('Epic 3 — Story 1');
    expect(version?.status).toBe('AVAILABLE');
    expect(version?.introductionStory).toBe('Epic 3 — Story 1');
  });

  it('leaves unrelated object entries registered and preserves event catalogue availability', () => {
    // Story 1 asserts identity/ownership invariants only; downstream Stories may
    // advance additional entries to AVAILABLE. Registry entries themselves must
    // continue to exist under their Epic 3 introduction ownership.
    for (const name of [
      'omni_comms_event_route',
      'omni_comms_provider',
      'omni_comms_provider_account',
      'omni_comms_sender_identity',
    ]) {
      const o = OMNI_COMMS_OBJECT_REGISTRY.find((x) => x.name === name);
      expect(o, `${name} must remain registered`).toBeDefined();
    }
    const eventDef = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_definition');
    const eventCon = OMNI_COMMS_OBJECT_REGISTRY.find((o) => o.name === 'omni_comms_event_contract');
    expect(eventDef?.status).toBe('AVAILABLE');
    expect(eventCon?.status).toBe('AVAILABLE');
  });
});

describe('Epic 3 Story 1 — readiness manifest', () => {
  const items = OMNI_COMMS_READINESS_MANIFEST.foundationStatus;
  const byItem = (label: string) => items.find((i) => i.item === label);

  it('overall status remains In progress', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.systemIdentity.overallStatus).toBe('In progress');
  });

  it('reports both template schemas as Verified', () => {
    expect(byItem('Template Family schema')?.state).toBe('Verified');
    expect(byItem('Template Version schema')?.state).toBe('Verified');
  });

  it('records a Template administration UI row (later stories may promote its state)', () => {
    expect(byItem('Template administration UI')).toBeDefined();
  });

  it('surfaces both physical tables in plannedObjects with availability status', () => {
    const eac = OMNI_COMMS_READINESS_MANIFEST.plannedObjects.eventsAndContent;
    const family = eac.find((o) => o.name === 'omni_comms_template_family');
    const version = eac.find((o) => o.name === 'omni_comms_template_version');
    expect(family?.status).toBe('Physical schema available — service capability planned');
    expect(version?.status).toBe('Physical schema available — service capability planned');
  });

  it('nextStep stays within Omni-Comms and is informational', () => {
    expect(OMNI_COMMS_READINESS_MANIFEST.nextStep.epic).toMatch(/^Epic /);
    expect(OMNI_COMMS_READINESS_MANIFEST.nextStep.informationalOnly).toBe(true);
  });
});


describe('Epic 3 Story 1 — routes untouched', () => {
  it('templates route is registered (state managed by later stories)', () => {
    const templates = OMNI_COMMS_ROUTE_REGISTRY.find(
      (r) => r.path === '/admin/omnichannel-communications/templates',
    );
    expect(templates).toBeDefined();
  });

  it('no new permanent omni-comms route was added', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY.length).toBe(7);
  });
});

describe('Epic 3 Story 1 — Story 1 stays a schema-only story', () => {
  it('sendCommunication is defined only in the canonical façade path (post-Slice-2a/2b)', () => {
    const omniSources = findFiles(join(SRC_ROOT, 'platform', 'omni-comms'), (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('__tests__'),
    );
    const canonical = join(SRC_ROOT, 'platform', 'omni-comms', 'sendCommunication.ts');
    for (const f of omniSources) {
      if (f === canonical) continue;
      const src = readFileSync(f, 'utf8');
      // Function/const/let/var/class definitions of the identifier are forbidden
      // outside the canonical file. Referencing the exported symbol is allowed.
      expect(
        src.match(/\b(function|const|let|var|class)\s+sendCommunication\b/),
        `sendCommunication must not be redefined in ${f}`,
      ).toBeNull();
    }
  });


  it('has no direct React access to the new template tables', () => {
    const allSrc = findFiles(SRC_ROOT, (p) =>
      (p.endsWith('.ts') || p.endsWith('.tsx')) &&
      !p.includes('__tests__') &&
      !p.includes('integrations/supabase/types'),
    );
    const forbidden = /\.from\(\s*['"]omni_comms_template_(family|version)['"]/;
    for (const f of allSrc) {
      const src = readFileSync(f, 'utf8');
      expect(forbidden.test(src), `Direct .from('omni_comms_template_*') in ${f}`).toBe(false);
    }
  });
});

describe('Epic 3 Story 1 — migration invariants', () => {
  const migrationFile = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => join(MIGRATIONS_DIR, f))
    .map((f) => ({ path: f, body: readFileSync(f, 'utf8') }))
    .find((m) =>
      m.body.includes('CREATE TABLE public.omni_comms_template_family') &&
      m.body.includes('CREATE TABLE public.omni_comms_template_version'),
    );

  it('exists as a single Story 1 migration', () => {
    expect(migrationFile, 'Story 1 migration must exist').toBeTruthy();
    expect(existsSync(migrationFile!.path)).toBe(true);
  });

  it('creates only the two approved tables (no other omni_comms table)', () => {
    const body = migrationFile!.body;
    const created = [...body.matchAll(/CREATE TABLE public\.(omni_comms_\w+)/g)].map((m) => m[1]);
    expect(created.sort()).toEqual(['omni_comms_template_family', 'omni_comms_template_version']);
  });

  it('enables RLS on both tables', () => {
    const body = migrationFile!.body;
    expect(body).toMatch(/ALTER TABLE public\.omni_comms_template_family\s+ENABLE ROW LEVEL SECURITY/);
    expect(body).toMatch(/ALTER TABLE public\.omni_comms_template_version\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('revokes access from anon and authenticated on both tables', () => {
    const body = migrationFile!.body;
    expect(body).toMatch(/REVOKE ALL ON public\.omni_comms_template_family\s+FROM PUBLIC, anon, authenticated/);
    expect(body).toMatch(/REVOKE ALL ON public\.omni_comms_template_version FROM PUBLIC, anon, authenticated/);
  });

  it('grants only service_role', () => {
    const body = migrationFile!.body;
    const grants = [...body.matchAll(/GRANT [^;]+ ON public\.omni_comms_template_\w+ TO (\w+)/g)].map((m) => m[1]);
    expect(new Set(grants)).toEqual(new Set(['service_role']));
  });

  it('does not seed any template data', () => {
    const body = migrationFile!.body;
    expect(body).not.toMatch(/INSERT\s+INTO\s+public\.omni_comms_template_/i);
  });

  it('uses SECURITY INVOKER (not DEFINER) on Story 1 trigger functions', () => {
    const body = migrationFile!.body;
    expect(body).toMatch(/omni_comms_enforce_template_family_rules[\s\S]*?SECURITY INVOKER/);
    expect(body).toMatch(/omni_comms_enforce_template_version_rules[\s\S]*?SECURITY INVOKER/);
  });
});
