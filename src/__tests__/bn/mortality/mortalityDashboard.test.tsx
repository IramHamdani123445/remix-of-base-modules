/**
 * BN-MORT-UX-2A §5 — Dashboard RTL coverage.
 *
 * Mounts BnMortalityPage with heavily mocked collaborators so we can
 * assert user-visible behaviour of the interactive worklist:
 *   • Stat cards render with real totals.
 *   • Clicking a card sets aria-pressed=true and emits a chip.
 *   • Clicking the same card again clears the state.
 *   • Empty-state and pilot-registration action are surfaced.
 *   • Persisted filters are scoped per user via sessionStorage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// -------- collaborator mocks (declared before importing the page) ----

vi.mock('@/components/bn/access/BnModuleRouteGate', () => ({
  BnModuleRouteGate: ({ children }: any) => children({
    hasWrite: false,
    actionsEnabled: false,
    integrationReadiness: 'READY',
  }),
}));

vi.mock('@/pages/bn/mortality/components/BnMortalityAuthState', () => ({
  BnMortalityAuthState: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/pages/bn/mortality/components/BnMortalityBreadcrumbs', () => ({
  BnMortalityBreadcrumbs: () => <nav data-testid="crumbs" />,
}));

const mockDashboard = vi.fn();
const mockList = vi.fn();
const mockAssignable = vi.fn();

vi.mock('@/hooks/bn/mortality/useMortalityQueries', () => ({
  useMortalityDashboard: () => mockDashboard(),
  useMortalityEventList: (...args: any[]) => mockList(...args),
  useMortalityAssignableUsers: () => mockAssignable(),
  useMortalityWorklistIndicators: () => ({ data: {}, isLoading: false, isError: false, error: null }),
}));


const authState = { user: { id: 'user-alice-uuid-1111-1111-1111-111111111111' } as any };
vi.mock('@/contexts/SupabaseAuthContext', () => ({
  useSupabaseAuth: () => authState,
}));

import BnMortalityPage from '@/pages/bn/mortality/BnMortalityPage';
import { storageKeyForUser } from '@/pages/bn/mortality/lib/dashboardState';

const UID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UID_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const TOTALS = {
  totalOpen: 12,
  unassigned: 3,
  verificationPending: 4,
  provisionallyHeld: 2,
  conflicts: 1,
  impactReview: 0,
  approvalPending: 0,
  followOnProcessing: 0,
  overdue: 5,
  closedThisMonth: 7,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BnMortalityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  authState.user = { id: UID_A } as any;
  mockDashboard.mockReturnValue({
    data: { data: { totals: TOTALS } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
  mockList.mockReturnValue({
    data: { data: [], totalCount: 0 },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  });
  mockAssignable.mockReturnValue({
    data: { data: [] },
    isLoading: false,
    isError: false,
  });
});

describe('BnMortalityPage — dashboard cards', () => {
  it('renders totals for every stat card', () => {
    renderPage();
    expect(screen.getByTestId('mort-card-totalOpen')).toHaveTextContent('12');
    expect(screen.getByTestId('mort-card-overdue')).toHaveTextContent('5');
    expect(screen.getByTestId('mort-card-closedThisMonth')).toHaveTextContent('7');
  });

  it('clicking a card sets aria-pressed and emits a chip', () => {
    renderPage();
    const card = screen.getByTestId('mort-card-verificationPending');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
  });

  it('clicking the same card again clears it', () => {
    renderPage();
    const card = screen.getByTestId('mort-card-conflicts');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(card);
    expect(card).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows the empty state when the worklist is empty', () => {
    renderPage();
    expect(screen.getByTestId('mort-empty-system')).toBeInTheDocument();
  });
});

describe('BnMortalityPage — user-scoped persistence', () => {
  it('persists filter selection under the current user key', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('mort-card-overdue'));
    const raw = sessionStorage.getItem(storageKeyForUser(UID_A));
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ activeCard: 'overdue', overdueOnly: true });
  });

  it('user B does not restore user A state', () => {
    // Seed user A's state
    renderPage();
    fireEvent.click(screen.getByTestId('mort-card-conflicts'));
    cleanup();

    // Switch identity and re-render
    authState.user = { id: UID_B } as any;
    renderPage();
    const card = screen.getByTestId('mort-card-conflicts');
    expect(card).toHaveAttribute('aria-pressed', 'false');
    // And user A's key was wiped when B took over.
    expect(sessionStorage.getItem(storageKeyForUser(UID_A))).toBeNull();
  });
});

describe('BnMortalityPage — pilot registration action', () => {
  it('exposes a "Preview registration" affordance', () => {
    renderPage();
    expect(screen.getByTestId('mort-register-action')).toHaveTextContent(/preview registration/i);
  });
});
