/**
 * Omni-Comms administration UI redesign — source-level gate.
 *
 * Verifies the presentation contract only: shared shell/header composition,
 * the multi-facet posture model, centralised navigation (7 permanent routes,
 * Preferences marked as planned), the Safe test surface wording, and the
 * three Health views. No runtime, database or security behaviour is asserted
 * here — those remain covered by their own suites.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

const REPO = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

const SHELL = 'src/platform/omni-comms/admin/components/OmniCommsShell.tsx';
const HEADER = 'src/platform/omni-comms/admin/components/OmniCommsModuleHeader.tsx';
const POSTURE = 'src/platform/omni-comms/admin/posture/omniCommsPosture.ts';
const NAV = 'src/platform/omni-comms/admin/navigation/omniCommsNavigation.ts';
const DRY_RUN = 'src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx';
const HEALTH = 'src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx';

describe('Omni-Comms admin UI redesign', () => {
  it('shell composes the shared module header', () => {
    expect(fs.existsSync(path.join(REPO, HEADER))).toBe(true);
    const src = read(SHELL);
    expect(src).toContain('OmniCommsModuleHeader');
    expect(src).toContain('<OmniCommsModuleHeader');
  });

  it('posture model replaces the binary status badge', () => {
    const src = read(POSTURE);
    for (const facet of ['runtime', 'certification', 'delivery', 'legacy']) {
      expect(src.toLowerCase()).toContain(facet);
    }
  });

  it('navigation is centralised and matches the 7 permanent routes', () => {
    const src = read(NAV);
    for (const entry of OMNI_COMMS_ROUTE_REGISTRY) {
      expect(src, `nav must reference ${entry.path}`).toContain(entry.path);
    }
    expect(src).toMatch(/Planned|planned/);
  });

  it('safe test surface uses staged, plain-language wording', () => {
    const src = read(DRY_RUN);
    expect(src).toContain('Safe test');
    expect(src).toContain('Step 1 · Test scope');
    expect(src).toContain('Step 2 · Synthetic payload');
    expect(src).toContain('Step 3 · Run the safe test');
    expect(src).toContain('Step 4 · Result');
    // Tenant selection is owned by the shared header, not duplicated here.
    expect(src).not.toContain('<OmniCommsTenantSelector');
  });

  it('health page exposes operational, certification and engineering views', () => {
    const src = read(HEALTH);
    for (const view of ['operational', 'certification', 'engineering']) {
      expect(src).toContain(view);
    }
    expect(src).toContain('useOmniCommsViewParam');
  });

  it('module views do not re-declare their own page container', () => {
    const dir = 'src/platform/omni-comms/admin/views';
    for (const file of fs.readdirSync(path.join(REPO, dir)).filter((f) => f.endsWith('.tsx'))) {
      expect(read(`${dir}/${file}`), `${file} must rely on the shell layout`)
        .not.toContain('container mx-auto p-6');
    }
  });
});
