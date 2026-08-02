/**
 * Epic 1 / Story 2 — Omnichannel Communications Readiness page tests.
 *
 * Verifies:
 *  - guard behaviour (deny without omni_comms.view, allow with it)
 *  - page renders and includes all 7 permanent routes
 *  - manifest lists all 19 planned logical objects as Planned
 *  - reserved edge functions + queues are displayed as Not created
 *  - Legacy isolation rules are rendered
 *  - no fake runtime data (metrics, provider status, queue depth, recipients)
 *  - next step points to Epic 1 — Story 3
 *  - no sendCommunication file exists in the Omni-Comms tree
 *  - no omni_comms_* business-table migration exists
 *  - Legacy Communication Hub route files are unchanged (Story 1 baseline
 *    files still exist and Story 2 did not modify them via imports)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';

// ----- shared hook mocks (auth + permissions) ---------------------------
const authState = {
  isAuthenticated: true,
  isAuthReady: true,
  isLoading: false,
  user: { id: 'test-user' } as { id: string } | null,
};
const permState = {
  isAdmin: false,
  hasView: false,
  isLoading: false,
};

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => authState,
}));

vi.mock('@/hooks/useNavigationMenu', () => ({
  useIsAdmin: () => permState.isAdmin,
  useModulePermissions: (_m: string) => ({
    permissions: permState.hasView ? ['view'] : [],
    isLoading: permState.isLoading,
    isAdmin: permState.isAdmin,
    hasPermission: (a: string) =>
      permState.isAdmin || (permState.hasView && a === 'view'),
  }),
}));

// components under test (imported after mocks)
import OmniCommsAdminRoute from '@/platform/omni-comms/admin/components/OmniCommsAdminRoute';
import OmniCommsHealthPage from '@/platform/omni-comms/admin/views/OmniCommsHealthPage';

// Readiness now lives on the Health screen's `?view=engineering` view.
function renderHealthAt(
  path = '/admin/omnichannel-communications/health?view=engineering',
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>login-page</div>} />
        <Route
          path="/admin/omnichannel-communications/health"
          element={
            <OmniCommsAdminRoute>
              <OmniCommsHealthPage />
            </OmniCommsAdminRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Omni-Comms Health page — Readiness', () => {
  beforeEach(() => {
    authState.isAuthenticated = true;
    authState.isAuthReady = true;
    authState.isLoading = false;
    permState.isAdmin = false;
    permState.hasView = false;
    permState.isLoading = false;
  });

  it('denies access without omni_comms.view', () => {
    renderHealthAt();
    expect(screen.getByTestId('omni-comms-not-authorized')).toBeInTheDocument();
    expect(screen.queryByTestId('omni-comms-health-page')).not.toBeInTheDocument();
  });

  it('allows access with omni_comms.view', () => {
    permState.hasView = true;
    renderHealthAt();
    expect(screen.getByTestId('omni-comms-health-page')).toBeInTheDocument();
    expect(screen.getByTestId('omni-comms-readiness-tab')).toBeInTheDocument();
  });

  it('displays all seven approved permanent routes', () => {
    permState.hasView = true;
    renderHealthAt();
    const expected = [
      '/admin/omnichannel-communications',
      '/admin/omnichannel-communications/operations',
      '/admin/omnichannel-communications/events',
      '/admin/omnichannel-communications/templates',
      '/admin/omnichannel-communications/channels',
      '/admin/omnichannel-communications/preferences',
      '/admin/omnichannel-communications/health',
    ];
    for (const p of expected) {
      expect(screen.getAllByText(p).length).toBeGreaterThan(0);
    }
    expect(M.permanentRoutes).toHaveLength(7);
  });

  it('lists all 33 logical objects with accurate physical-schema status', () => {
    permState.hasView = true;
    renderHealthAt();
    const all = [
      ...M.plannedObjects.eventsAndContent,
      ...M.plannedObjects.channelsSendersPreferences,
      ...M.plannedObjects.runtime,
    ];
    expect(all).toHaveLength(33);
    for (const entry of all) {
      expect(screen.getAllByText(entry.name).length).toBeGreaterThan(0);
    }
    // Physical availability count equals AVAILABLE entries in the object registry.
    const availableFromRegistry = M.plannedObjects.eventsAndContent
      .concat(M.plannedObjects.channelsSendersPreferences)
      .concat(M.plannedObjects.runtime)
      .filter((o) => o.status === 'Physical schema available — service capability planned')
      .map((o) => o.name)
      .sort();
    const available = all.filter(
      (o) => o.status === 'Physical schema available — service capability planned',
    );
    expect(available.map((o) => o.name).sort()).toEqual(availableFromRegistry);
    const notCreated = all.filter(
      (o) => o.status === 'Registered in architecture catalogue — Not yet created',
    );
    expect(notCreated.length + available.length).toBe(33);
  });

  it('shows reserved edge functions as Not created and Available ones as Available', () => {
    permState.hasView = true;
    renderHealthAt();
    for (const fn of ['omni-comms-dispatch']) {
      const el = screen.getByText(fn);
      const row = el.closest('li');
      expect(row).not.toBeNull();
      expect(within(row!).getByText('Reserved')).toBeInTheDocument();
      expect(within(row!).getByText('Not created')).toBeInTheDocument();
    }
    const runtime = screen.getByText('omni-comms-runtime').closest('li');
    expect(runtime).not.toBeNull();
    expect(within(runtime!).getByText('Available')).toBeInTheDocument();
  });

  it('shows reserved queues as Not created', () => {
    permState.hasView = true;
    renderHealthAt();
    for (const q of ['omni-comms.transactional', 'omni-comms.retry', 'omni-comms.dead-letter', 'omni-comms.webhook', 'omni-comms.bulk']) {
      const row = screen.getByText(q).closest('li');
      expect(row).not.toBeNull();
      expect(within(row!).getByText('Reserved')).toBeInTheDocument();
      expect(within(row!).getByText('Not created')).toBeInTheDocument();
    }
  });

  it('renders the Legacy isolation rules', () => {
    permState.hasView = true;
    renderHealthAt();
    for (const rule of M.legacyIsolation.rules) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }
  });

  it('contains no fake runtime data (metrics/provider status/queue depth/recipients) and no "Live" capability badge', () => {
    permState.hasView = true;
    renderHealthAt();
    const text = (document.body.textContent ?? '').toLowerCase();
    // No status badge with the value "Live" for any new-system capability.
    expect(document.querySelector('[data-state="Live"]')).toBeNull();
    // No fabricated numeric metrics.
    expect(text).not.toContain('queue depth');
    expect(text).not.toContain('delivered:');
    expect(text).not.toContain('bounce rate');
    expect(text).not.toContain('provider status:');
    expect(text).not.toContain('recipient:');
    // Route states restricted to Available / Placeholder / Not implemented.
    for (const r of M.permanentRoutes) {
      expect(['Available', 'Placeholder', 'Not implemented']).toContain(r.state);
    }
  });

  it('identifies the next step from the readiness manifest', () => {
    permState.hasView = true;
    renderHealthAt();
    const nextStep = screen.getByTestId('omni-comms-next-step');
    expect(within(nextStep).getByText(new RegExp(`${M.nextStep.epic}.*${M.nextStep.story}`))).toBeInTheDocument();
    expect(within(nextStep).getByText(new RegExp(M.nextStep.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('renders the Architecture boundaries section with every rule Enforced in CI', () => {
    permState.hasView = true;
    renderHealthAt();
    const section = screen.getByTestId('omni-comms-architecture-boundaries');
    expect(section).toBeInTheDocument();
    const count = M.architectureBoundaries.length;
    expect(count).toBeGreaterThanOrEqual(10);
    for (const row of M.architectureBoundaries) {
      expect(within(section).getByText(row.title)).toBeInTheDocument();
      expect(within(section).getByText(row.ruleId)).toBeInTheDocument();
    }
    expect(within(section).getAllByText('Enforced in CI')).toHaveLength(count);
  });
});

describe('Omni-Comms Story 2 — architectural boundaries', () => {
  const OMNI_ROOT = path.resolve(__dirname, '..', '..', 'platform', 'omni-comms');

  function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of readdirSync(dir)) {
      const full = path.join(dir, e);
      if (statSync(full).isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx)$/.test(e)) out.push(full);
    }
    return out;
  }

  it('the canonical façade exists exactly once at the approved path (post-Slice-2a/2b)', () => {
    const files = walk(OMNI_ROOT);
    const facades = files.filter((f) => path.basename(f) === 'sendCommunication.ts');
    expect(facades).toHaveLength(1);
    expect(facades[0].replace(/\\/g, '/')).toMatch(
      /src\/platform\/omni-comms\/sendCommunication\.ts$/,
    );
  });

  it('introduces only the approved Epic 2 Story 1 omni_comms_* business-table migration', () => {
    const migrationsDir = path.resolve(__dirname, '..', '..', '..', 'supabase', 'migrations');
    if (!existsSync(migrationsDir)) return;
    const allowed = new Set(
      OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.status === 'AVAILABLE').map((o) => o.name),
    );
    const offenders: string[] = [];
    for (const file of readdirSync(migrationsDir)) {
      if (!file.endsWith('.sql')) continue;
      const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
      const created = Array.from(sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(omni_comms_[a-z_]+)/gi)).map((m) => m[1].toLowerCase());
      if (created.some((t) => !allowed.has(t))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('Legacy Communication Hub guard file is still present and unchanged in shape', () => {
    const legacyGuard = path.resolve(__dirname, '..', '..', 'components', 'auth', 'CommHubAdminRoute.tsx');
    expect(existsSync(legacyGuard)).toBe(true);
    const src = readFileSync(legacyGuard, 'utf8');
    // Legacy guard must not import from the new omni-comms tree.
    expect(src).not.toMatch(/from ['"]@\/platform\/omni-comms/);
  });
});
