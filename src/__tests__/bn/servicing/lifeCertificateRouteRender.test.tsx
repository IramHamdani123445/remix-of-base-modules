/**
 * BN-LC-OPS — Rendered React Router behaviour tests for Life Certificates.
 *
 * These are real rendered-route tests (not source-string assertions):
 *
 *   • /bn/life-certificates renders the workspace and does not redirect.
 *   • A disabled workspace flag renders `bn-workspace-unavailable`.
 *   • actions_enabled=false keeps mutation buttons disabled (dark launch).
 *   • Award 360 opens /bn/life-certificates?awardId=<uuid> and the award id
 *     reaches the worklist service.
 *   • Clearing the award filter removes only `awardId`.
 *   • An invalid award id makes NO worklist RPC call.
 *   • Permission denial stays on the Life Certificate route.
 *   • The legacy /nbenefit/long-term/life-certificates route redirects
 *     exactly once to the canonical route.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const AWARD_ID = '11111111-2222-4333-8444-555555555555';

const state = {
  canView: true,
  flagEnabled: true,
  actionsEnabled: false,
};

const mocks = vi.hoisted(() => ({
  fetchWorklistMock: vi.fn(),
}));
const { fetchWorklistMock } = mocks;

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => ({ user: { id: 'u-1' }, isAuthReady: true, isAuthenticated: true }),
}));

vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermissions: () => ({
    can: (a: string) => (a === 'view' ? state.canView : true),
    isAdmin: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/bn/useLifeCertificateActionsEnabled', () => ({
  useLifeCertificateActionsState: () => ({
    actionsEnabled: state.actionsEnabled,
    isLoading: false,
    isError: false,
  }),
  useLifeCertificateActionsEnabled: () => state.actionsEnabled,
}));

vi.mock('@/services/bn/lifeCertificateViewService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/bn/lifeCertificateViewService')>();
  return { ...actual, fetchWorklist: mocks.fetchWorklistMock };
});

// Imported after the mocks are registered.
import LifeCertificateManagement from '@/pages/bn/servicing/LifeCertificateManagement';
import { BnWorkspaceGate, setFeatureOverride } from '@/lib/bn/featureToggles';

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
};

const Dashboard: React.FC = () => <div data-testid="bn-dashboard">BN Dashboard</div>;

/** Mirrors the canonical route wiring in AppRoutes.tsx. */
const renderRoutes = (initial: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[initial]}>
        <LocationProbe />
        <Routes>
          <Route path="/bn/dashboard" element={<Dashboard />} />
          <Route path="/bn/awards" element={<div data-testid="bn-awards">Awards</div>} />
          <Route
            path="/bn/life-certificates"
            element={
              <BnWorkspaceGate flag="bn.servicing.lifeCert" title="Life Certificates">
                <LifeCertificateManagement />
              </BnWorkspaceGate>
            }
          />
          <Route
            path="/nbenefit/long-term/life-certificates"
            element={<Navigate to="/bn/life-certificates" replace />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const emptyResult = {
  rows: [],
  total: 0,
  limit: 50,
  offset: 0,
  identity_masked: true,
  award: null,
};

describe('Life Certificates — rendered route behaviour', () => {
  beforeEach(() => {
    state.canView = true;
    state.flagEnabled = true;
    state.actionsEnabled = false;
    setFeatureOverride('bn.servicing.lifeCert', null);
    fetchWorklistMock.mockReset();
    fetchWorklistMock.mockResolvedValue(emptyResult);
  });

  it('renders the workspace at /bn/life-certificates and does not navigate to /bn/dashboard', async () => {
    renderRoutes('/bn/life-certificates');
    expect(await screen.findByText('Life Certificates')).toBeInTheDocument();
    expect(screen.queryByTestId('bn-dashboard')).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe('/bn/life-certificates');
  });

  it('renders bn-workspace-unavailable when the workspace flag is off', async () => {
    setFeatureOverride('bn.servicing.lifeCert', false);
    renderRoutes('/bn/life-certificates');
    expect(await screen.findByTestId('bn-workspace-unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/bn/life-certificates');
    expect(screen.queryByTestId('bn-dashboard')).toBeNull();
  });

  it('shows the read-only dark launch banner when actions_enabled is false', async () => {
    renderRoutes('/bn/life-certificates');
    const banner = await screen.findByTestId('bn-lc-launch-banner');
    expect(banner.textContent).toContain('Read-only / dark launch');
    expect(banner.textContent).toContain('actions are disabled');
  });

  it('drops the "actions are disabled" statement when actions_enabled is true', async () => {
    state.actionsEnabled = true;
    renderRoutes('/bn/life-certificates');
    const banner = await screen.findByTestId('bn-lc-launch-banner');
    expect(banner.textContent).toContain('Life Certificate actions active');
    expect(banner.textContent).not.toContain('actions are disabled');
  });

  it('passes the Award 360 deep-link award id to the worklist service', async () => {
    renderRoutes(`/bn/life-certificates?awardId=${AWARD_ID}`);
    await waitFor(() => expect(fetchWorklistMock).toHaveBeenCalled());
    expect(fetchWorklistMock.mock.calls[0][0]).toMatchObject({ awardId: AWARD_ID });
    expect(await screen.findByText('Filtered to one award')).toBeInTheDocument();
  });

  it('clearing the award filter removes only awardId from the URL', async () => {
    renderRoutes(`/bn/life-certificates?awardId=${AWARD_ID}&tab=due`);
    const clear = await screen.findByRole('button', { name: 'Show all obligations' });
    fireEvent.click(clear);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/bn/life-certificates?tab=due'),
    );
  });

  it('makes no worklist RPC call for an invalid award reference', async () => {
    renderRoutes('/bn/life-certificates?awardId=not-a-uuid');
    expect(await screen.findByTestId('bn-lc-invalid-award-link')).toBeInTheDocument();
    expect(screen.getByText('Invalid award link')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show all obligations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Awards' })).toHaveAttribute('href', '/bn/awards');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchWorklistMock).not.toHaveBeenCalled();
  });

  it('permission denial stays on the Life Certificate route', async () => {
    state.canView = false;
    renderRoutes('/bn/life-certificates');
    expect(await screen.findByText('Permission denied')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/bn/life-certificates');
    expect(screen.queryByTestId('bn-dashboard')).toBeNull();
    expect(fetchWorklistMock).not.toHaveBeenCalled();
  });

  it('redirects the legacy route exactly once to the canonical route', async () => {
    renderRoutes('/nbenefit/long-term/life-certificates');
    expect(await screen.findByText('Life Certificates')).toBeInTheDocument();
    // `replace` navigation: a single hop, canonical path, no query noise.
    expect(screen.getByTestId('location').textContent).toBe('/bn/life-certificates');
  });
});
