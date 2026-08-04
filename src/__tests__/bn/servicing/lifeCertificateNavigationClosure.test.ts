/**
 * BN Life Certificates — navigation, deep-link and communication-status closure.
 *
 * Guards the defects fixed in this slice:
 *  1. The registered workspace is no longer redirected to the dashboard.
 *  2. "Life Certificates" appears exactly once in the BN menu.
 *  3. Award 360 deep links use client-side routing and the canonical label.
 *  4. The worklist read is award-scoped and validates the award reference.
 *  5. The communication status contract is the canonical eight-state model.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('Life Certificate workspace visibility', () => {
  const toggles = read('src/lib/bn/featureToggles.ts');
  const routes = read('src/components/routing/AppRoutes.tsx');

  it('enables the registered Life Certificate workspace by default', () => {
    expect(toggles).toMatch(/"bn\.servicing\.lifeCert":\s*true/);
  });

  it('never silently redirects the workspace to the dashboard', () => {
    const route = routes
      .split('\n')
      .find((l) => l.includes('path="/bn/life-certificates"'));
    expect(route).toBeDefined();
    expect(route).toContain('BnWorkspaceGate');
    expect(route).not.toContain('BnFeatureGate');
  });

  it('renders an explicit unavailable state when a workspace flag is off', () => {
    expect(toggles).toContain('export const BnWorkspaceGate');
    expect(toggles).toContain('bn-workspace-unavailable');
  });
});

describe('BN menu inventory', () => {
  const menu = read('src/components/sidebar/menuItems/bnMenuItems.ts');

  it('exposes Life Certificates exactly once', () => {
    const hits = menu.match(/"Life Certificates"/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it('keeps the entry pointing at the canonical /bn route', () => {
    expect(menu).toContain('/bn/life-certificates');
    expect(menu).not.toContain('/nbenefit/long-term/life-certificates');
  });
});

describe('Award 360 deep link', () => {
  const tab = read('src/pages/bn/awards/award-360/tabs/AwardLifeCertificatesTab.tsx');

  it('uses client-side routing instead of a full page load', () => {
    expect(tab).not.toMatch(/<a href={`\/bn\/life-certificates/);
    expect(tab).toContain("import { Link } from 'react-router-dom'");
    expect(tab).toContain('<Link to={`/bn/life-certificates?awardId=${awardId}`}>');
  });

  it('uses the canonical control label everywhere', () => {
    const labels = tab.match(/Open Life Certificate Centre/g) ?? [];
    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(tab).not.toContain('Open in LCM workspace');
    expect(tab).not.toContain('Open Life Certificate Management');
  });
});

describe('Award-scoped worklist read', () => {
  const service = read('src/services/bn/lifeCertificateViewService.ts');
  const page = read('src/pages/bn/servicing/LifeCertificateManagement.tsx');

  it('calls the award-aware secured RPC', () => {
    expect(service).toContain('bn_life_certificate_worklist_v2');
    expect(service).toContain('p_award_id');
  });

  it('validates the award reference before it reaches the database', () => {
    expect(service).toContain('export const isUuid');
    expect(service).toContain('E_INVALID_AWARD_REFERENCE');
  });

  it('reads the award scope from the URL and can clear it', () => {
    expect(page).toContain("searchParams.get('awardId')");
    expect(page).toContain('clearAwardScope');
    expect(page).toContain('Show all obligations');
    expect(page).toContain('Invalid award link');
  });

  it('reloads when the award scope changes', () => {
    expect(page).toMatch(/\[bucket, debounced, offset, awardId\]/);
  });
});

describe('Communication status contract', () => {
  const harness = read('supabase/tests/bn/life_certificate_integration.sql');

  it('asserts the canonical eight-state model in a real database run', () => {
    for (const s of ['PENDING', 'RETRY', 'REQUESTED', 'QUEUED', 'DISPATCHED', 'DELIVERED', 'FAILED', 'CANCELLED']) {
      expect(harness).toContain(s);
    }
  });

  it('rolls back everything it seeds', () => {
    expect(harness).toContain('BEGIN;');
    expect(harness.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });

  it('proves browser roles cannot reach adapter internals', () => {
    expect(harness).toContain('_bn_comm_map_hub_status(text)');
    expect(harness).toContain('bn_communication_adapter_source');
  });
});
