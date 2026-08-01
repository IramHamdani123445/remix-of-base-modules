/**
 * UI Stabilization gate — verifies:
 *   1. Exactly 7 permanent Omni-Comms admin routes with the required states.
 *   2. Every route page wrapper composes the shared OmniCommsShell
 *      (error boundary + tenant provider).
 *   3. Channels page no longer relies on the `omni_comms.active_org_id`
 *      localStorage workaround or on `window.location.reload()`.
 *   4. Landing page no longer advertises "shell only" / "not operational".
 *   5. Shared tenant context exposes the required contract.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';

const REPO = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

describe('Omni-Comms UI Stabilization', () => {
  it('registry exposes exactly 7 permanent admin routes', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
  });

  it('route states match the stabilization contract', () => {
    const byPath = new Map(OMNI_COMMS_ROUTE_REGISTRY.map((r) => [r.path, r.state]));
    expect(byPath.get('/admin/omnichannel-communications')).toBe('Available');
    expect(byPath.get('/admin/omnichannel-communications/events')).not.toBe(
      'Placeholder',
    );
    expect(byPath.get('/admin/omnichannel-communications/templates')).toBe(
      'Available',
    );
    expect(byPath.get('/admin/omnichannel-communications/channels')).toBe(
      'Available',
    );
    expect(byPath.get('/admin/omnichannel-communications/health')).toBe(
      'Available',
    );
    expect(byPath.get('/admin/omnichannel-communications/operations')).toBe(
      'Available',
    );
    expect(byPath.get('/admin/omnichannel-communications/preferences')).toBe(
      'Not implemented',
    );
  });

  it('every page wrapper mounts the shared OmniCommsShell', () => {
    const dir = 'src/pages/admin/omnichannel-communications';
    const files = fs.readdirSync(path.join(REPO, dir)).filter((f) => f.endsWith('.tsx'));
    expect(files.length).toBe(7);
    for (const file of files) {
      const src = read(`${dir}/${file}`);
      expect(src, `${file} must import OmniCommsShell`).toContain(
        'OmniCommsShell',
      );
      expect(src, `${file} must render <OmniCommsShell>`).toMatch(
        /<OmniCommsShell>/,
      );
    }
  });

  it('channels page no longer depends on localStorage workaround', () => {
    const src = read(
      'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx',
    );
    expect(src).not.toContain('omni_comms.active_org_id');
    expect(src).not.toContain('window.location.reload');
    expect(src).toContain('useOmniCommsTenant');
    // C1: the duplicate tenant selector was removed; the module header owns it.
    expect(src).not.toContain('OmniCommsTenantSelector');
  });

  it('landing page no longer advertises "shell only" or "not operational"', () => {
    const src = read(
      'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
    );
    expect(src.toLowerCase()).not.toContain('shell only');
    expect(src.toLowerCase()).not.toContain('not operational');
  });

  it('shared tenant context exposes the required contract keys', () => {
    const src = read(
      'src/platform/omni-comms/context/OmniCommsTenantContext.tsx',
    );
    for (const key of [
      'organizationId',
      'organizationName',
      'departmentId',
      'departmentName',
      'availableOrganizations',
      'availableDepartments',
      'loading',
      'error',
    ]) {
      expect(src, `context contract must include ${key}`).toContain(key);
    }
  });

  it('error boundary and shell files exist', () => {
    expect(
      fs.existsSync(
        path.join(
          REPO,
          'src/platform/omni-comms/admin/components/OmniCommsErrorBoundary.tsx',
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          REPO,
          'src/platform/omni-comms/admin/components/OmniCommsShell.tsx',
        ),
      ),
    ).toBe(true);
  });
});
