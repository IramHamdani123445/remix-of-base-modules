/**
 * Epic 1 — Story 4: Architecture boundary and CI enforcement tests.
 *
 * All negative cases use in-memory fixtures — no violating file is committed
 * to the repository. The final "canonical repository run" verifies the real
 * repo state.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';

import type {
  ArchitectureBaselineEntry,
  RepositoryScan,
  ScannedFile,
} from '@/platform/omni-comms/architecture/architectureCheck.types';
import {
  runArchitectureChecks,
  validateBaseline,
  checkLegacyImports,
  checkLegacyTableReferences,
  checkProviderImports,
  checkReactRuntimeWrites,
  checkMigrationRegistry,
  checkRouteRegistry,
  checkIntegrationRegistry,
  checkQueueRegistry,
  checkFacadeBoundary,
  checkPermanentNames,
  OMNI_COMMS_ARCHITECTURE_BASELINE,
} from '@/platform/omni-comms/architecture';

/**
 * A full repository architecture scan reads ~6k source files. It is
 * inherently expensive and fully deterministic, so these specific tests get an
 * explicit generous budget instead of the 5s default. Assertions are unchanged.
 */
const REPO_SCAN_TIMEOUT_MS = 60_000;


// ─── helpers ────────────────────────────────────────────────────────────
function makeScan(files: ScannedFile[], extras: Partial<RepositoryScan> = {}): RepositoryScan {
  return {
    files,
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
    dependencies: {},
    ...extras,
  };
}

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 1 — OMNI_LEGACY_IMPORT', () => {
  it('rejects direct Legacy alias import', () => {
    const v = checkLegacyImports(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/example.ts',
          content: `import { x } from '@/platform/communication-hub/foo';`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('OMNI_LEGACY_IMPORT');
  });

  it('rejects relative Legacy import resolved into legacy roots', () => {
    const v = checkLegacyImports(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/admin/example.ts',
          content: `import x from '../../../pages/admin/communicationHub/Foo';`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('rejects dynamic import', () => {
    const v = checkLegacyImports(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/x.ts',
          content: `const m = import('@/platform/communication-hub/foo');`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('rejects re-export', () => {
    const v = checkLegacyImports(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/x.ts',
          content: `export * from '@/platform/communication-hub/foo';`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('accepts shared organization import', () => {
    const v = checkLegacyImports(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `import { org } from '@/services/organization';` }]),
    );
    expect(v).toHaveLength(0);
  });

  it('accepts shared department import', () => {
    const v = checkLegacyImports(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `import { d } from '@/services/department';` }]),
    );
    expect(v).toHaveLength(0);
  });

  it('accepts shared audit import', () => {
    const v = checkLegacyImports(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `import { audit } from '@/services/audit';` }]),
    );
    expect(v).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 2 — OMNI_LEGACY_TABLE_REFERENCE', () => {
  it('rejects .from("notification_logs")', () => {
    const v = checkLegacyTableReferences(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `supabase.from('notification_logs').select('*')` }]),
    );
    expect(v).toHaveLength(1);
  });

  it('rejects SQL reference to communication_message', () => {
    const v = checkLegacyTableReferences(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `const q = 'SELECT * FROM communication_message'` }]),
    );
    expect(v.length).toBeGreaterThanOrEqual(1);
  });

  it('passes for shared ERP table (core_department)', () => {
    const v = checkLegacyTableReferences(
      makeScan([{ filePath: 'src/platform/omni-comms/x.ts', content: `supabase.from('core_department')` }]),
    );
    expect(v).toHaveLength(0);
  });

  it('ignores README prose', () => {
    const v = checkLegacyTableReferences(
      makeScan([{ filePath: 'src/platform/omni-comms/README.md', content: `Do not use notification_logs.` }]),
    );
    expect(v).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 3 — OMNI_PROVIDER_IMPORT_BOUNDARY', () => {
  it('passes for provider import inside adapters/providers', () => {
    const v = checkProviderImports(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/adapters/providers/resend.ts',
          content: `import { Resend } from 'resend';`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });

  it('fails for provider import in application service', () => {
    const v = checkProviderImports(
      makeScan([{ filePath: 'src/services/mail.ts', content: `import { Resend } from 'resend';` }]),
    );
    expect(v).toHaveLength(1);
  });

  it('fails for provider import in business module', () => {
    const v = checkProviderImports(
      makeScan([{ filePath: 'src/modules/benefits/mail.ts', content: `import twilio from 'twilio';` }]),
    );
    expect(v).toHaveLength(1);
  });

  it('exact baseline suppresses only exact violation', () => {
    const scan = makeScan([{ filePath: 'src/services/mail.ts', content: `import { Resend } from 'resend';` }]);
    const evidence = `import { Resend } from 'resend'`;
    const baseline: ArchitectureBaselineEntry[] = [
      {
        ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
        filePath: 'src/services/mail.ts',
        evidence,
        reason: 'Pre-existing debt; will move to adapter under Epic 9.',
      },
    ];
    const summary = runArchitectureChecks({ scan, baseline });
    expect(summary.passed).toBe(true);
    expect(summary.activeBaselineEntries).toBe(1);
  });

  it('wildcard baseline entry rejected by validator', () => {
    const r = validateBaseline([
      {
        ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
        filePath: 'src/services/*.ts',
        evidence: 'x',
        reason: 'y',
      },
    ]);
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 4 — OMNI_REACT_RUNTIME_WRITE', () => {
  it('rejects TSX insert to omni_comms_message', () => {
    const v = checkReactRuntimeWrites(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/admin/views/Foo.tsx',
          content: `await supabase.from('omni_comms_message').insert({ id: 1 });`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('rejects TSX update to omni_comms_request', () => {
    const v = checkReactRuntimeWrites(
      makeScan([
        {
          filePath: 'src/components/Foo.tsx',
          content: `supabase.from('omni_comms_request').update({ x: 1 }).eq('id', 1)`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('rejects TSX delete on omni_comms_dispatch_job', () => {
    const v = checkReactRuntimeWrites(
      makeScan([
        {
          filePath: 'src/hooks/useJobs.ts',
          content: `supabase.from('omni_comms_dispatch_job').delete().eq('id', 1)`,
        },
      ]),
    );
    expect(v).toHaveLength(1);
  });

  it('passes for read-only server-response display', () => {
    const v = checkReactRuntimeWrites(
      makeScan([
        {
          filePath: 'src/components/Foo.tsx',
          content: `const rows = data.map(r => r.omni_comms_message);`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });

  it('passes for plain object-name text', () => {
    const v = checkReactRuntimeWrites(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/admin/views/Foo.tsx',
          content: `<code>omni_comms_message</code>`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 5 — OMNI_MIGRATION_OBJECT_REGISTRY', () => {
  it('passes for approved active object', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE public.omni_comms_request (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(0);
  });

  it('fails for unregistered object', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE omni_comms_zzz (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(1);
  });

  it('fails for misspelled object', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE omni_comms_requst (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(1);
  });

  it('fails for creating deferred object', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE public.omni_comms_audit (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/deferred/);
  });

  it('detects schema-qualified object', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE public.omni_comms_request (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(0);
  });

  it('detects IF NOT EXISTS form', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [
          { filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE IF NOT EXISTS omni_comms_bogus (id uuid);` },
        ],
      }),
    );
    expect(v).toHaveLength(1);
  });

  it('is inert when no migrations reference omni_comms_*', () => {
    const v = checkMigrationRegistry(
      makeScan([], {
        migrations: [{ filePath: 'supabase/migrations/x.sql', content: `CREATE TABLE public.other (id uuid);` }],
      }),
    );
    expect(v).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 6 — OMNI_ROUTE_REGISTRY', () => {
  const APPROVED_ROUTES = [
    '/admin/omnichannel-communications',
    '/admin/omnichannel-communications/operations',
    '/admin/omnichannel-communications/events',
    '/admin/omnichannel-communications/templates',
    '/admin/omnichannel-communications/channels',
    '/admin/omnichannel-communications/preferences',
    '/admin/omnichannel-communications/health',
  ];

  function fakeAppRoutes(paths: string[]): string {
    return paths
      .map(
        (p) =>
          `<Route path="${p}" element={<OmniCommsAdminRoute><Foo /></OmniCommsAdminRoute>} />`,
      )
      .join('\n');
  }

  it('passes when all seven approved routes present + guarded', () => {
    const v = checkRouteRegistry(
      makeScan([], {
        routeSource: { filePath: 'src/components/routing/AppRoutes.tsx', content: fakeAppRoutes(APPROVED_ROUTES) },
      }),
    );
    expect(v).toHaveLength(0);
  });

  it('fails for unregistered top-level route', () => {
    const v = checkRouteRegistry(
      makeScan([], {
        routeSource: {
          filePath: 'src/components/routing/AppRoutes.tsx',
          content: fakeAppRoutes([...APPROVED_ROUTES, '/admin/omnichannel-communications/bogus']),
        },
      }),
    );
    expect(v.some((x) => /Unregistered/.test(x.message))).toBe(true);
  });

  it('fails when a tab is promoted to top-level route', () => {
    const v = checkRouteRegistry(
      makeScan([], {
        routeSource: {
          filePath: 'src/components/routing/AppRoutes.tsx',
          content: fakeAppRoutes([...APPROVED_ROUTES, '/admin/omnichannel-communications/operations/queue']),
        },
      }),
    );
    expect(v.some((x) => x.evidence?.includes('/operations/queue'))).toBe(true);
  });

  it('ignores Legacy communication-hub routes', () => {
    const v = checkRouteRegistry(
      makeScan([], {
        routeSource: {
          filePath: 'src/components/routing/AppRoutes.tsx',
          content: fakeAppRoutes(APPROVED_ROUTES) +
            `\n<Route path="/admin/communication-hub" element={<Legacy />} />`,
        },
      }),
    );
    expect(v).toHaveLength(0);
  });

  it('fails when guard is missing on an omni-comms route', () => {
    const bad = APPROVED_ROUTES.map((p) => `<Route path="${p}" element={<Foo />} />`).join('\n');
    const v = checkRouteRegistry(
      makeScan([], { routeSource: { filePath: 'src/components/routing/AppRoutes.tsx', content: bad } }),
    );
    expect(v.some((x) => /not wrapped/.test(x.message))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 7 — OMNI_INTEGRATION_REGISTRY', () => {
  it('passes when reserved name has no physical implementation', () => {
    const v = checkIntegrationRegistry(makeScan([], { edgeFunctionDirs: ['unrelated-fn'] }));
    expect(v).toHaveLength(0);
  });

  it('fails for unregistered name', () => {
    const v = checkIntegrationRegistry(makeScan([], { edgeFunctionDirs: ['omni-comms-bogus'] }));
    expect(v).toHaveLength(1);
    expect(v[0].message).toMatch(/Unregistered/);
  });

  it('fails when physical implementation exists for Reserved integration', () => {
    const v = checkIntegrationRegistry(makeScan([], { edgeFunctionDirs: ['omni-comms-dispatch'] }));
    expect(v.some((x) => /Physical implementation/.test(x.message))).toBe(true);
  });

  it('rejects omni-comms-render outright', () => {
    const v = checkIntegrationRegistry(makeScan([], { edgeFunctionDirs: ['omni-comms-render'] }));
    expect(v.some((x) => /Prohibited/.test(x.message))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 8 — OMNI_QUEUE_REGISTRY', () => {
  it('passes for reserved queue with no physical usage', () => {
    const v = checkQueueRegistry(makeScan([]));
    expect(v).toHaveLength(0);
  });

  it('fails for unregistered queue name', () => {
    const v = checkQueueRegistry(
      makeScan([
        {
          filePath: 'src/services/publisher.ts',
          content: `publish('omni-comms.bogus', {})`,
        },
      ]),
    );
    expect(v.some((x) => /Unregistered/.test(x.message))).toBe(true);
  });

  it('fails for physical usage of reserved queue', () => {
    const v = checkQueueRegistry(
      makeScan([
        {
          filePath: 'src/services/publisher.ts',
          content: `publish('omni-comms.transactional', {})`,
        },
      ]),
    );
    expect(v.some((x) => /Physical usage/.test(x.message))).toBe(true);
  });

  it('fails for rendering queue', () => {
    const v = checkQueueRegistry(
      makeScan([{ filePath: 'src/x.ts', content: `const q = 'omni-comms.render'` }]),
    );
    expect(v.some((x) => /Prohibited rendering queue/.test(x.message))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 9 — OMNI_SEND_FACADE_BOUNDARY (Slice 2a: exactly one canonical façade)', () => {
  it('canonical repo has zero unbaselined façade violations', () => {
    const summary = runArchitectureChecks();
    const facade = summary.violations.filter(
      (v) => v.ruleId === 'OMNI_SEND_FACADE_BOUNDARY' && v.baselineStatus !== 'existing_baseline',
    );
    expect(facade).toHaveLength(0);
  }, REPO_SCAN_TIMEOUT_MS);

  it('accepts the canonical façade path exporting sendCommunication', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/sendCommunication.ts',
          content: `export async function sendCommunication(input: any) { return null as any; }`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });

  it('rejects a second sendCommunication.ts file elsewhere in the new system', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/nested/sendCommunication.ts',
          content: `export async function sendCommunication() {}`,
        },
      ]),
    );
    // Both: duplicate file basename + duplicate exported symbol outside canonical.
    expect(v.length).toBeGreaterThanOrEqual(1);
    expect(v.some((x) => /Second sendCommunication/.test(x.message))).toBe(true);
  });

  it('rejects a second sendCommunication export in a non-canonical file', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/foo.ts',
          content: `export async function sendCommunication() {}`,
        },
      ]),
    );
    expect(v.some((x) => /Second sendCommunication export/.test(x.message))).toBe(true);
  });

  it.each(['sendOmniCommunication', 'dispatchCommunication', 'queueCommunication'])(
    'rejects forbidden alias export %s',
    (alias) => {
      const v = checkFacadeBoundary(
        makeScan([
          {
            filePath: 'src/platform/omni-comms/foo.ts',
            content: `export const ${alias} = () => null;`,
          },
        ]),
      );
      expect(v.some((x) => x.evidence?.includes(alias))).toBe(true);
    },
  );

  it('rejects provider SDK import inside the canonical façade file', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/platform/omni-comms/sendCommunication.ts',
          content: `import { Resend } from 'resend';\nexport async function sendCommunication() {}`,
        },
      ]),
    );
    expect(v.some((x) => /must not import provider SDKs/.test(x.message))).toBe(true);
  });

  it('rejects business-module import of runtime internals', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/modules/benefits/communication/x.ts',
          content: `import { runtime } from '@/platform/omni-comms/runtime/sendCommunicationRuntime';`,
        },
      ]),
    );
    expect(v.some((x) => /runtime internals/.test(x.message))).toBe(true);
  });

  it('permits business-module import of the canonical façade', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/modules/benefits/communication/x.ts',
          content: `import { sendCommunication } from '@/platform/omni-comms/sendCommunication';`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });

  it('Legacy façade is out of new-system scope', () => {
    const v = checkFacadeBoundary(
      makeScan([
        {
          filePath: 'src/platform/communication-hub/legacy.ts',
          content: `export const sendCommunication = () => null;`,
        },
      ]),
    );
    expect(v).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Rule 10 — OMNI_PERMANENT_NAME_POLICY', () => {
  it('approved registry names pass', () => {
    const v = checkPermanentNames(makeScan([]));
    expect(v).toHaveLength(0);
  });

  it('fails for physical edge function omni-comms-v2-dispatch', () => {
    const v = checkPermanentNames(makeScan([], { edgeFunctionDirs: ['omni-comms-v2-dispatch'] }));
    expect(v.some((x) => /v2/.test(x.evidence ?? ''))).toBe(true);
  });

  it('unrelated words containing "new" pass', () => {
    // The registry has no forbidden segments; simulate by scanning name directly.
    // Verify SEG_RE-equivalent behaviour: "renewable" must not fire.
    const v = checkPermanentNames(makeScan([], { edgeFunctionDirs: ['omni-comms-renewable'] }));
    expect(v).toHaveLength(0);
  });

  it('README prose is not scanned', () => {
    const v = checkPermanentNames(
      makeScan([{ filePath: 'docs/notes.md', content: `next phase pilot rehearsal v2` }]),
    );
    expect(v).toHaveLength(0);
  });

  it('pilot as a segment in an integration is flagged', () => {
    const v = checkPermanentNames(makeScan([], { edgeFunctionDirs: ['omni-comms-pilot-send'] }));
    expect(v.some((x) => /pilot/.test(x.evidence ?? ''))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Baseline validation', () => {
  it('accepts an exact entry', () => {
    const r = validateBaseline([
      {
        ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
        filePath: 'src/services/mail.ts',
        evidence: `import { Resend } from 'resend'`,
        reason: 'pre-existing debt',
      },
    ]);
    expect(r.ok).toBe(true);
  });

  it('different violation in the same file is not suppressed', () => {
    const scan = makeScan([
      { filePath: 'src/services/mail.ts', content: `import twilio from 'twilio';` },
    ]);
    const baseline: ArchitectureBaselineEntry[] = [
      {
        ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
        filePath: 'src/services/mail.ts',
        evidence: `import { Resend } from 'resend'`,
        reason: 'x',
      },
    ];
    const summary = runArchitectureChecks({ scan, baseline });
    expect(summary.passed).toBe(false);
    expect(summary.staleBaselineEntries).toBe(1);
  });

  it('rejects duplicate entries', () => {
    const e = {
      ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY' as const,
      filePath: 'src/x.ts',
      evidence: 'y',
      reason: 'z',
    };
    const r = validateBaseline([e, e]);
    expect(r.ok).toBe(false);
  });

  it('rejects wildcard path', () => {
    const r = validateBaseline([
      { ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY', filePath: 'src/**/*.ts', evidence: 'x', reason: 'y' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects missing reason', () => {
    const r = validateBaseline([
      { ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY', filePath: 'src/x.ts', evidence: 'x', reason: '' },
    ]);
    expect(r.ok).toBe(false);
  });

  it('rejects new-system baseline entry', () => {
    const r = validateBaseline([
      {
        ruleId: 'OMNI_LEGACY_IMPORT',
        filePath: 'src/platform/omni-comms/x.ts',
        evidence: 'y',
        reason: 'z',
      },
    ]);
    expect(r.ok).toBe(false);
  });

  it('stale baseline entry is reported', () => {
    const scan = makeScan([]);
    const baseline: ArchitectureBaselineEntry[] = [
      {
        ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',
        filePath: 'src/services/mail.ts',
        evidence: `import { Resend } from 'resend'`,
        reason: 'x',
      },
    ];
    const summary = runArchitectureChecks({ scan, baseline });
    expect(summary.staleBaselineEntries).toBe(1);
    expect(summary.passed).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('Canonical repository run', () => {
  it('starts with an empty committed baseline', () => {
    expect(OMNI_COMMS_ARCHITECTURE_BASELINE).toEqual([]);
  });

  it('has no unbaselined new-system architecture violations and no stale entries', () => {
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const summary = runArchitectureChecks({ repoRoot });
    const unbaselined = summary.violations.filter(
      (v) => v.baselineStatus === 'not_baselined',
    );
    if (unbaselined.length) {
      // Surface details so a real regression is easy to debug.
      // eslint-disable-next-line no-console
      console.error(unbaselined);
    }
    expect(unbaselined).toEqual([]);
    expect(summary.staleBaselineEntries).toBe(0);
    expect(summary.passed).toBe(true);
  }, REPO_SCAN_TIMEOUT_MS);

});
