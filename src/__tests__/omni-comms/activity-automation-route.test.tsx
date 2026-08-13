/**
 * Route-level proof that the operator can REACH automation from the main
 * Omni-Comms menu.
 *
 * Renders the real shell (breadcrumbs + module header + navigation) around the
 * real /operations page and asserts the rendered application, not a source
 * string or a navigation array.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// ── trusted context / transport mocks ────────────────────────────────────
vi.mock('@/platform/omni-comms/context/OmniCommsTenantContext', () => ({
  OmniCommsTenantProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useOmniCommsTenant: () => ({
    organizationId: 'org-1',
    organizationName: 'SSB',
    departmentId: null,
    departmentName: null,
    departmentOverrideActive: false,
    availableOrganizations: [{ id: 'org-1', name: 'SSB' }],
    availableDepartments: [],
    loading: false,
    error: null,
    setOrganizationId: () => {},
    setDepartmentId: () => {},
    clearDepartmentOverride: () => {},
  }),
}));

vi.mock('@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient', () => ({
  useOmniCommsRpcClient: () => ({ rpc: async () => ({ data: null, error: null }) }),
}));

const automation = {
  business_event_processor: {
    worker: 'omni-comms-business-event-ingest',
    installed: true, active: true, schedule: '* * * * *',
    frequency_label: 'Runs every minute',
    last_run_at: '2026-08-13T13:00:00Z', last_success_at: '2026-08-13T13:00:00Z',
    last_cron_success_at: '2026-08-13T13:00:00Z', last_result: 'success',
    last_run_found: 0, last_run_handled: 0, last_blocker: null,
    run_fresh: true, healthy: true,
    pending_events: 0, processing_events: 0, retry_events: 0, blocked_events: 0,
    needs_review_events: 0, oldest_pending_at: null, oldest_retry_at: null,
    last_run_detail: null,
  },
  delivery_processor: {
    worker: 'omni-comms-dispatch',
    installed: true, active: true, schedule: '* * * * *',
    frequency_label: 'Runs every minute',
    last_run_at: '2026-08-13T13:01:00Z', last_success_at: '2026-08-13T13:01:00Z',
    last_cron_success_at: '2026-08-13T13:01:00Z', last_result: 'success',
    last_run_found: 0, last_run_handled: 0, last_blocker: null,
    run_fresh: true, healthy: true,
    waiting_jobs: 0, ready_jobs: 0, held_jobs: 0, retry_wait_jobs: 0,
    currently_claimed: 0, oldest_waiting_at: null, last_attempt_at: null,
    last_provider_accepted_at: null, last_delivered_at: null,
    last_outcome_unknown_at: null,
  },
  callback_receiver: {
    healthy: true, callback_endpoint_ready: true,
    last_callback_at: null, last_delivered_callback_at: null,
    last_bounce_at: null, last_complaint_at: null,
    recent_invalid_signature_count: 0,
  },
  recent_runs: [
    { at: '2026-08-13T13:01:00Z', stage: 'dispatch', found: 0, handled: 0, result: 'success', blocker: null },
    { at: '2026-08-13T13:00:00Z', stage: 'business_event_ingest', found: 1, handled: 1, result: 'success', blocker: null },
  ],
  thresholds: { stale_run_seconds: 180, backlog_seconds: 300 },
  generated_at: '2026-08-13T13:01:30Z',
};

vi.mock('@/platform/omni-comms/application/automationStatusService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/platform/omni-comms/application/automationStatusService',
  );
  return { ...actual, getAutomationStatus: async () => automation };
});

vi.mock('@/platform/omni-comms/application/operationsService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/platform/omni-comms/application/operationsService',
  );
  return {
    ...actual,
    getOpsSummary: async () => ({
      organization_id: 'org-1', department_id: null, since: '', requests: 0,
      recipients: 0, messages: 0, held_jobs: 0, runnable_jobs: 0,
      delivery_attempts: 0, blocked_requests: 0, completed_dry_runs: 0,
      processing_requests: 0, failed_requests: 0, requests_by_status: {},
      requests_by_mode: {}, last_request_at: null, generated_at: '',
    }),
    listOpsRequests: async () => ({ items: [], total: 0, limit: 25, offset: 0, generated_at: '' }),
  };
});

import OmniCommsShell from '@/platform/omni-comms/admin/components/OmniCommsShell';
import OmniCommsOperationsPage from '@/platform/omni-comms/admin/views/OmniCommsOperationsPage';

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/admin/omnichannel-communications/operations']}>
      <Routes>
        <Route
          path="/admin/omnichannel-communications/operations"
          element={
            <OmniCommsShell>
              <OmniCommsOperationsPage />
            </OmniCommsShell>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Activity & Automation route', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the four normal destinations in the rendered main navigation', () => {
    renderRoute();
    const nav = screen.getByRole('navigation', {
      name: /Omnichannel Communications sections/i,
    });
    for (const label of ['Overview', 'Providers', 'Communications', 'Activity & Automation']) {
      expect(within(nav).getByText(label)).toBeTruthy();
    }
  });

  it('marks Activity & Automation as the active destination', () => {
    renderRoute();
    const link = screen.getByTestId('omni-comms-nav-activity');
    expect(link.textContent).toContain('Activity & Automation');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('renders the page title and the automation dashboard cards', async () => {
    renderRoute();
    expect((await screen.findAllByText('Activity & Automation')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Automation')).toBeTruthy();
    expect(await screen.findByText('Business event processing')).toBeTruthy();
    expect(await screen.findByText('Email delivery')).toBeTruthy();
    expect(await screen.findByText('Delivery callbacks')).toBeTruthy();
    expect(await screen.findByText('Communication activity')).toBeTruthy();
  });

  it('shows both queues separately and never calls claimed jobs "sent"', async () => {
    renderRoute();
    expect(await screen.findByText('Events waiting to process')).toBeTruthy();
    expect(await screen.findByText('Emails waiting to send')).toBeTruthy();
    expect(screen.queryByText(/Jobs sent in last run/i)).toBeNull();
    expect(await screen.findByText('Jobs picked up in last run')).toBeTruthy();
  });

  it('shows recent automation runs with a zero-work run as Success', async () => {
    renderRoute();
    const runs = await screen.findByTestId('omni-comms-automation-runs');
    expect(within(runs).getAllByText('Success').length).toBeGreaterThan(0);
  });

  it('exposes a bounded needs-attention control', async () => {
    renderRoute();
    expect(await screen.findByTestId('omni-comms-needs-attention')).toBeTruthy();
  });
});
