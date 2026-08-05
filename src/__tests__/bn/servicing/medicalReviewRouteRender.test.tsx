/**
 * BN Medical Reviews — rendered React Router behaviour tests.
 *
 * Real rendered routes, not source-string assertions:
 *
 *   • /bn/medical-reviews renders the Medical Review Centre.
 *   • A disabled workspace flag renders `bn-workspace-unavailable`.
 *   • actions_enabled=false keeps every mutating control disabled and shows
 *     the authoritative dark-launch banner.
 *   • actions_enabled=true + permission enables the control.
 *   • Award 360 deep link ?awardId=<uuid> reaches the worklist service.
 *   • Clearing the award filter removes only `awardId`.
 *   • A malformed awardId makes NO worklist RPC call at all.
 *   • Missing `view` keeps the user on the route with a denial state.
 *   • The Board workspace and the provider portal are separate surfaces and
 *     do not leak each other's data.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const AWARD_ID = '11111111-2222-4333-8444-555555555555';

const state = {
  canView: true,
  grants: new Set<string>(['view', 'generate_obligations']),
  actionsEnabled: false,
  flagEnabled: true,
};

const mocks = vi.hoisted(() => ({
  worklist: vi.fn(),
  awardContext: vi.fn(),
  boardWorklist: vi.fn(),
  providerWorklist: vi.fn(),
}));

vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => ({ user: { id: 'u-1' }, isAuthReady: true, isAuthenticated: true }),
}));

vi.mock('@/hooks/useActionPermission', () => ({
  useActionPermissions: () => ({
    can: (a: string) => (a === 'view' ? state.canView : state.grants.has(a)),
    isAdmin: false,
    isLoading: false,
  }),
}));

vi.mock('@/hooks/bn/useMedicalReviewActionsState', () => ({
  MEDICAL_REVIEW_MODULE_NAME: 'bn_medical_review',
  useMedicalReviewActionsState: () => ({
    actionsEnabled: state.actionsEnabled,
    routesEnabled: true,
    moduleEnabled: true,
    rolloutState: 'internal_pilot',
    isLoading: false,
    isError: false,
  }),
  useMedicalReviewActionsEnabled: () => state.actionsEnabled,
}));

vi.mock('@/services/bn/medicalReviewQueryService', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/bn/medicalReviewQueryService')>();
  return {
    ...actual,
    medicalReviewQueryService: {
      ...actual.medicalReviewQueryService,
      worklist: mocks.worklist,
      awardContext: mocks.awardContext,
      boardWorklist: mocks.boardWorklist,
      providerWorklist: mocks.providerWorklist,
    },
  };
});

import MedicalReviewCentre from '@/pages/bn/servicing/MedicalReviewCentre';
import MedicalBoardWorkspace from '@/pages/bn/servicing/medical-reviews/MedicalBoardWorkspace';
import MedicalProviderReferralWorkspace from '@/portals/doctor/medical-reviews/MedicalProviderReferralWorkspace';
import { BnWorkspaceGate, setFeatureOverride } from '@/lib/bn/featureToggles';

const LocationProbe: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="location">{loc.pathname + loc.search}</div>;
};

function renderAt(path: string, element: React.ReactNode, routePath = path.split('?')[0]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <Routes>
          <Route path={routePath} element={element} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const emptyWorklist = { rows: [], total: 0, limit: 25, offset: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  state.canView = true;
  state.grants = new Set(['view', 'generate_obligations']);
  state.actionsEnabled = false;
  mocks.worklist.mockResolvedValue(emptyWorklist);
  mocks.awardContext.mockResolvedValue({
    awardId: AWARD_ID,
    awardNumber: 'AW-9001',
    awardStatus: 'ACTIVE',
    benefitCode: 'INV',
    startDate: null,
    endDate: null,
    nextReviewDate: null,
    claimId: null,
    claimNumber: null,
    maskedSsn: null,
    openReviews: 2,
    raw: {},
  });
  mocks.boardWorklist.mockResolvedValue(emptyWorklist);
  mocks.providerWorklist.mockResolvedValue({ ...emptyWorklist, providerId: 'prov-1' });
});

describe('Medical Review Centre route', () => {
  it('renders the workspace and stays on the canonical route', async () => {
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    expect(await screen.findByTestId('mr-centre')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/bn/medical-reviews');
  });

  it('renders the unavailable shell when the workspace flag is off', async () => {
    setFeatureOverride('bn.servicing.medicalReview', false);
    try {
      renderAt(
        '/bn/medical-reviews',
        <BnWorkspaceGate flag="bn.servicing.medicalReview" title="Medical Reviews">
          <MedicalReviewCentre />
        </BnWorkspaceGate>,
      );
      expect(await screen.findByTestId('bn-workspace-unavailable')).toBeInTheDocument();
      expect(screen.queryByTestId('mr-centre')).toBeNull();
    } finally {
      setFeatureOverride('bn.servicing.medicalReview', undefined);
    }
  });

  it('shows a denial state on the same route when `view` is missing', async () => {
    state.canView = false;
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    expect(await screen.findByTestId('mr-permission-denied')).toBeInTheDocument();
    expect(screen.getByTestId('location').textContent).toBe('/bn/medical-reviews');
    expect(mocks.worklist).not.toHaveBeenCalled();
  });
});

describe('Authoritative dark launch', () => {
  it('disables permitted actions and shows the banner when actions_enabled=false', async () => {
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    await screen.findByTestId('mr-centre');
    expect(screen.getByTestId('mr-dark-launch-banner')).toBeInTheDocument();
    expect(screen.getByTestId('mr-action-generate_obligations')).toBeDisabled();
  });

  // Obligation generation is additionally scoped to an award: the Centre only
  // enables it once a valid award context has loaded.
  it('enables a permitted action once actions_enabled=true', async () => {
    state.actionsEnabled = true;
    renderAt(
      `/bn/medical-reviews?awardId=${AWARD_ID}`,
      <MedicalReviewCentre />,
      '/bn/medical-reviews',
    );
    await screen.findByTestId('mr-centre');
    expect(screen.queryByTestId('mr-dark-launch-banner')).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('mr-action-generate_obligations')).not.toBeDisabled(),
    );
  });

  it('keeps obligation generation disabled when the Centre is not award-scoped', async () => {
    state.actionsEnabled = true;
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    await screen.findByTestId('mr-centre');
    expect(screen.getByTestId('mr-action-generate_obligations')).toBeDisabled();
  });

  it('keeps an unpermitted action disabled even when actions_enabled=true', async () => {
    state.actionsEnabled = true;
    state.grants = new Set(['view']);
    renderAt('/bn/medical-reviews', <MedicalReviewCentre />);
    await screen.findByTestId('mr-centre');
    expect(screen.getByTestId('mr-action-generate_obligations')).toBeDisabled();
  });
});

describe('Award 360 deep link', () => {
  it('passes a valid awardId through to the worklist RPC', async () => {
    renderAt(`/bn/medical-reviews?awardId=${AWARD_ID}`, <MedicalReviewCentre />, '/bn/medical-reviews');
    await waitFor(() => expect(mocks.worklist).toHaveBeenCalled());
    expect(mocks.worklist.mock.calls[0][0]).toMatchObject({ awardId: AWARD_ID });
    expect(await screen.findByTestId('mr-award-scope')).toBeInTheDocument();
  });

  it('clearing the award filter removes only awardId from the query string', async () => {
    renderAt(
      `/bn/medical-reviews?awardId=${AWARD_ID}&tab=open`,
      <MedicalReviewCentre />,
      '/bn/medical-reviews',
    );
    const clear = await screen.findByRole('button', { name: /clear filter/i });
    fireEvent.click(clear);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/bn/medical-reviews?tab=open'),
    );
  });

  it('renders an invalid-award-link state and makes NO RPC call for a malformed id', async () => {
    renderAt('/bn/medical-reviews?awardId=not-a-uuid', <MedicalReviewCentre />, '/bn/medical-reviews');
    expect(await screen.findByTestId('mr-invalid-award-link')).toBeInTheDocument();
    expect(mocks.worklist).not.toHaveBeenCalled();
    expect(mocks.awardContext).not.toHaveBeenCalled();
    expect(screen.queryByTestId('mr-centre')).toBeNull();
  });
});

describe('Actor surface separation', () => {
  it('the Board workspace loads only Board cases', async () => {
    renderAt('/bn/medical-reviews/board', <MedicalBoardWorkspace />);
    expect(await screen.findByTestId('mr-board-workspace')).toBeInTheDocument();
    await waitFor(() => expect(mocks.boardWorklist).toHaveBeenCalled());
    expect(mocks.worklist).not.toHaveBeenCalled();
    expect(mocks.providerWorklist).not.toHaveBeenCalled();
  });

  it('the provider portal loads only its own referrals', async () => {
    renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    expect(await screen.findByTestId('mr-provider-portal')).toBeInTheDocument();
    await waitFor(() => expect(mocks.providerWorklist).toHaveBeenCalled());
    expect(mocks.worklist).not.toHaveBeenCalled();
    expect(mocks.boardWorklist).not.toHaveBeenCalled();
    expect(mocks.awardContext).not.toHaveBeenCalled();
  });

  it('the provider portal honours the same authoritative dark launch', async () => {
    renderAt('/doctor/reviews', <MedicalProviderReferralWorkspace />);
    await screen.findByTestId('mr-provider-portal');
    expect(screen.getByTestId('mr-dark-launch-banner')).toBeInTheDocument();
  });
});
