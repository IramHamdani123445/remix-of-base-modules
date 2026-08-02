/**
 * Reference Seed Pack — surface + Rule 16 architecture boundary tests.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  runArchitectureChecks,
  isReferenceSeedFile,
  checkReferenceSeedBoundary,
  REFERENCE_SEED_ALLOWED_RPCS,
} from '@/platform/omni-comms/architecture';
import type { RepositoryScan } from '@/platform/omni-comms/architecture';

/**
 * A full repository architecture scan reads ~6k source files. It is
 * inherently expensive and fully deterministic, so these specific tests get an
 * explicit generous budget instead of the 5s default. Assertions are unchanged.
 */
const REPO_SCAN_TIMEOUT_MS = 60_000;


const REPO_ROOT = process.cwd();

function scanOf(filePath: string, content: string): RepositoryScan {
  return {
    files: [{ filePath, content }],
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
    dependencies: {},
  };
}

const SEED_FILE =
  'src/platform/omni-comms/application/referenceSeedService.ts';

describe('Reference Seed Pack — files exist', () => {
  const expected = [
    'src/platform/omni-comms/application/referenceSeedTypes.ts',
    'src/platform/omni-comms/application/referenceSeedService.ts',
    'src/platform/omni-comms/admin/views/seed/ReferenceSeedPanel.tsx',
  ];

  for (const rel of expected) {
    it(`has ${rel}`, () => {
      expect(fs.existsSync(path.join(REPO_ROOT, rel))).toBe(true);
    });
  }

  it('mounts the Reference Data tab on the landing page', () => {
    const src = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
      ),
      'utf8',
    );
    expect(src).toContain('omni-comms-landing-tab-reference-data');
    expect(src).toContain('<ReferenceSeedPanel />');
    expect(src).toContain('./seed/ReferenceSeedPanel');
  });
});

describe('Rule 16 — isReferenceSeedFile', () => {
  it('matches the seed panel folder', () => {
    expect(
      isReferenceSeedFile(
        'src/platform/omni-comms/admin/views/seed/ReferenceSeedPanel.tsx',
      ),
    ).toBe(true);
  });

  it('matches the seed service and types', () => {
    expect(isReferenceSeedFile(SEED_FILE)).toBe(true);
    expect(
      isReferenceSeedFile(
        'src/platform/omni-comms/application/referenceSeedTypes.ts',
      ),
    ).toBe(true);
  });

  it('does not match unrelated files', () => {
    expect(
      isReferenceSeedFile(
        'src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx',
      ),
    ).toBe(false);
    expect(isReferenceSeedFile('src/App.tsx')).toBe(false);
  });
});

describe('Rule 16 — OMNI_REFERENCE_SEED_BOUNDARY detections', () => {
  const cases: Array<[string, string]> = [
    ['private RPC', `rpc('omni_comms_priv_send_communication')`],
    ['non-approved RPC', `rpc('omni_comms_event_definition_list')`],
    ['direct table access', `supabase.from('omni_comms_request')`],
    ['supabase singleton', `import { supabase } from "@/integrations/supabase/client";`],
    ['edge invoke', `await supabase.functions.invoke('omni-comms-runtime')`],
    ['send façade import', `import x from "@/platform/omni-comms/sendCommunication";`],
    ['live delivery enable', `const c = { live_delivery_enabled: true };`],
    ['non-example recipient', `const to = "ops@secureserve.gov";`],
    ['escalation vocabulary', `createDispatchJob();`],
    ['secret material', `const k = SUPABASE_SERVICE_ROLE_KEY;`],
  ];

  for (const [label, snippet] of cases) {
    it(`flags ${label}`, () => {
      const v = checkReferenceSeedBoundary(scanOf(SEED_FILE, snippet));
      expect(v.length).toBeGreaterThan(0);
      expect(v[0].ruleId).toBe('OMNI_REFERENCE_SEED_BOUNDARY');
      expect(v[0].severity).toBe('error');
    });
  }

  it('allows the three approved seed RPCs', () => {
    const src = [...REFERENCE_SEED_ALLOWED_RPCS]
      .map((r) => `rpc('${r}')`)
      .join('\n');
    expect(checkReferenceSeedBoundary(scanOf(SEED_FILE, src))).toHaveLength(0);
  });

  it('allows example.com addresses', () => {
    expect(
      checkReferenceSeedBoundary(
        scanOf(SEED_FILE, `const to = "benefits@example.com";`),
      ),
    ).toHaveLength(0);
  });

  it('ignores files outside the seed surface', () => {
    expect(
      checkReferenceSeedBoundary(
        scanOf('src/other.ts', `supabase.from('omni_comms_request')`),
      ),
    ).toHaveLength(0);
  });
});

describe('Rule 16 — repository is clean', () => {
  it('reports no unbaselined reference-seed violations', () => {
    const summary = runArchitectureChecks({ repoRoot: REPO_ROOT });
    const failing = summary.violations.filter(
      (v) =>
        v.ruleId === 'OMNI_REFERENCE_SEED_BOUNDARY' &&
        v.baselineStatus !== 'existing_baseline',
    );
    expect(failing).toEqual([]);
  }, REPO_SCAN_TIMEOUT_MS);
});
