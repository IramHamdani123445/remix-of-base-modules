/**
 * BN Means-Test — EPIC 13 operational queues and reporting.
 *
 * Guards the governed contract: closed queue taxonomy, verbatim rendering of
 * backend-owned counts and actions, failures never presented as empty
 * success, and assignment routed through the governed RPC.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'actor-1' } } }) },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}));

import {
  BN_MEANS_OPERATIONAL_QUEUES,
  BN_MEANS_QUEUE_GROUPS,
  BN_MEANS_REPORT_CODES,
  meansQueueLabel,
} from '@/types/bn/meansTests/meansOperations';
import { meansOperationsService } from '@/services/bn/meansTests/meansOperationsService';
import BnMeansOperationalOverview from '@/components/bn/meansTests/operations/BnMeansOperationalOverview';
import BnMeansWorkQueue from '@/components/bn/meansTests/operations/BnMeansWorkQueue';
import BnMeansReports from '@/components/bn/meansTests/operations/BnMeansReports';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const ASSESSMENT_ROW = {
  row_kind: 'ASSESSMENT',
  record_id: 'a-1',
  record_reference: 'MT-2026-0001',
  queue_code: 'MY_WORK',
  assessment_id: 'a-1',
  assessment_reference: 'MT-2026-0001',
  person_label: 'Jane Claimant',
  person_masked_identifier: '***-**-1234',
  benefit_programme: 'ASSISTANCE',
  assessment_status: 'SUBMITTED',
  status_label: 'Submitted',
  action_required: 'Verify declared facts',
  deep_link_section: 'verification',
  assigned_to: null,
  assigned_to_label: null,
  is_mine: false,
  age_days: 7,
  days_overdue: null,
  is_read_only: false,
};

beforeEach(() => {
  rpc.mockReset();
});

describe('Epic 13 — queue taxonomy', () => {
  it('publishes the closed queue taxonomy exactly once per code', () => {
    expect(BN_MEANS_OPERATIONAL_QUEUES.length).toBe(new Set(BN_MEANS_OPERATIONAL_QUEUES).size);
    expect(BN_MEANS_OPERATIONAL_QUEUES).toContain('SEARCH');
    expect(BN_MEANS_OPERATIONAL_QUEUES).toContain('ACTIVATION_INTEGRATION_FAILED');
  });

  it('groups every queue except SEARCH into an operational group', () => {
    const grouped = BN_MEANS_QUEUE_GROUPS.flatMap((g) => g.queues);
    const missing = BN_MEANS_OPERATIONAL_QUEUES.filter(
      (q) => q !== 'SEARCH' && !grouped.includes(q),
    );
    expect(missing).toEqual([]);
  });

  it('gives every queue a human label', () => {
    for (const code of BN_MEANS_OPERATIONAL_QUEUES) {
      expect(meansQueueLabel(code)).not.toBe(code);
    }
  });
});

describe('Epic 13 — operational service', () => {
  it('sends the actor, queue code, paging and sort to the governed RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { rows: [], total: 0 } }, error: null });
    await meansOperationsService.queue('TEAM_WORK', { search: 'MT' }, 25, 50, 'NEWEST');
    expect(rpc).toHaveBeenCalledWith('bn_means_operational_queue_v1', {
      p_actor_user_id: 'actor-1',
      p_queue_code: 'TEAM_WORK',
      p_filters: { search: 'MT' },
      p_limit: 25,
      p_offset: 50,
      p_sort: 'NEWEST',
    });
  });

  it('never turns a transport error into an empty successful queue', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const result = await meansOperationsService.queue('MY_WORK');
    expect(result.status).toBe('FAILED');
    expect(result.data).toBeNull();
  });

  it('preserves a DENIED envelope without data', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'FORBIDDEN' }, error: null });
    const result = await meansOperationsService.counts();
    expect(result.status).toBe('DENIED');
    expect(result.data).toBeNull();
    expect(result.code).toBe('FORBIDDEN');
  });

  it('routes assignment through the governed assign RPC', async () => {
    rpc.mockResolvedValue({ data: { status: 'OK', data: { action: 'CLAIM' } }, error: null });
    await meansOperationsService.assign('a-1', 'CLAIM');
    expect(rpc).toHaveBeenCalledWith('bn_means_operational_assign_v1', {
      p_actor_user_id: 'actor-1',
      p_assessment_id: 'a-1',
      p_action: 'CLAIM',
      p_target_user_id: null,
    });
  });
});

describe('Epic 13 — operational overview', () => {
  it('renders backend counts and configuration health', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: {
          counts: { MY_WORK: { status: 'OK', count: 4 } },
          configuration_health: {
            status: 'OK',
            active_policies: 1,
            draft_versions: 0,
            policies_without_active_version: 0,
          },
          generated_at: new Date().toISOString(),
        },
      },
      error: null,
    });
    wrap(<BnMeansOperationalOverview onOpenQueue={() => {}} />);
    expect(await screen.findByTestId('means-ops-tile-MY_WORK')).toHaveTextContent('4');
    expect(screen.getByTestId('means-ops-configuration-health')).toHaveTextContent('Healthy');
  });

  it('shows a failed count as unavailable rather than zero', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: {
          counts: { MY_WORK: { status: 'FAILED', count: null } },
          configuration_health: {
            status: 'OK',
            active_policies: 1,
            draft_versions: 0,
            policies_without_active_version: 0,
          },
          generated_at: new Date().toISOString(),
        },
      },
      error: null,
    });
    wrap(<BnMeansOperationalOverview onOpenQueue={() => {}} />);
    const tile = await screen.findByTestId('means-ops-tile-MY_WORK');
    expect(tile).toHaveTextContent('Unavailable');
    expect(tile).not.toHaveTextContent(/\b0\b/);
  });

  it('states access denial explicitly', async () => {
    rpc.mockResolvedValue({ data: { status: 'DENIED', code: 'FORBIDDEN' }, error: null });
    wrap(<BnMeansOperationalOverview onOpenQueue={() => {}} />);
    expect(await screen.findByTestId('means-ops-counts-denied')).toBeInTheDocument();
  });
});

describe('Epic 13 — work queue surface', () => {
  it('renders backend-owned action wording and deep-links with the backend section', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: { queue_code: 'MY_WORK', rows: [ASSESSMENT_ROW], total: 1, limit: 25, offset: 0, sort: 'OLDEST' },
      },
      error: null,
    });
    const onOpen = vi.fn();
    wrap(<BnMeansWorkQueue queueCode="MY_WORK" onOpen={onOpen} />);
    expect(await screen.findByText('Verify declared facts')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('a-1', 'verification');
  });

  it('offers claim only when the module permits write actions', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: { queue_code: 'MY_WORK', rows: [ASSESSMENT_ROW], total: 1, limit: 25, offset: 0, sort: 'OLDEST' },
      },
      error: null,
    });
    const { unmount } = wrap(<BnMeansWorkQueue queueCode="MY_WORK" onOpen={() => {}} />);
    await screen.findByText('Verify declared facts');
    expect(screen.queryByTestId('means-ops-assign-a-1')).toBeNull();
    unmount();

    wrap(<BnMeansWorkQueue queueCode="MY_WORK" onOpen={() => {}} canAssign actionsEnabled />);
    expect(await screen.findByTestId('means-ops-assign-a-1')).toHaveTextContent('Claim');
  });

  it('surfaces a rejected assignment instead of silently succeeding', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'bn_means_operational_assign_v1') {
        return Promise.resolve({ data: { status: 'INVALID', code: 'ALREADY_ASSIGNED' }, error: null });
      }
      return Promise.resolve({
        data: {
          status: 'OK',
          data: { queue_code: 'MY_WORK', rows: [ASSESSMENT_ROW], total: 1, limit: 25, offset: 0, sort: 'OLDEST' },
        },
        error: null,
      });
    });
    wrap(<BnMeansWorkQueue queueCode="MY_WORK" onOpen={() => {}} canAssign actionsEnabled />);
    await userEvent.click(await screen.findByTestId('means-ops-assign-a-1'));
    await waitFor(() => expect(screen.getByTestId('means-ops-assign-error')).toBeInTheDocument());
  });

  it('reports a queue failure rather than an empty queue', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'network down' } });
    wrap(<BnMeansWorkQueue queueCode="TEAM_WORK" onOpen={() => {}} />);
    expect(await screen.findByTestId('means-ops-queue-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('means-ops-queue-empty')).toBeNull();
  });

  it('renders information-request columns for the information family', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: {
          queue_code: 'INFORMATION_REQUEST_OVERDUE',
          rows: [
            {
              ...ASSESSMENT_ROW,
              row_kind: 'INFORMATION_REQUEST',
              record_id: 'ir-1',
              record_reference: 'IR-1',
              information_required: 'Bank statements',
              request_status_label: 'Open',
              due_date: '2026-01-01',
              days_overdue: 12,
              action_required: 'Obtain outstanding information',
            },
          ],
          total: 1,
          limit: 25,
          offset: 0,
          sort: 'DUE_SOONEST',
        },
      },
      error: null,
    });
    wrap(<BnMeansWorkQueue queueCode="INFORMATION_REQUEST_OVERDUE" onOpen={() => {}} />);
    expect(await screen.findByText('Bank statements')).toBeInTheDocument();
    expect(screen.getByText('12 day(s) overdue')).toBeInTheDocument();
  });
});

describe('Epic 13 — reporting', () => {
  it('exposes the closed report catalogue', () => {
    expect(BN_MEANS_REPORT_CODES).toContain('STAGE_DISTRIBUTION');
    expect(BN_MEANS_REPORT_CODES).toContain('OUTCOMES');
    expect(BN_MEANS_REPORT_CODES.length).toBe(new Set(BN_MEANS_REPORT_CODES).size);
  });

  it('renders backend rows and the period the backend applied', async () => {
    rpc.mockResolvedValue({
      data: {
        status: 'OK',
        data: {
          report_code: 'STAGE_DISTRIBUTION',
          rows: [{ key: 'ACTIVE', label: 'Active', count: 3 }],
          period_from: '2026-01-01',
          period_to: '2026-01-31',
          benefit_programme: null,
          generated_at: new Date().toISOString(),
        },
      },
      error: null,
    });
    wrap(<BnMeansReports />);
    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Period 2026-01-01 to 2026-01-31/)).toBeInTheDocument();
  });

  it('states a report failure explicitly', async () => {
    rpc.mockResolvedValue({ data: { status: 'INVALID', code: 'REPORT_UNKNOWN' }, error: null });
    wrap(<BnMeansReports />);
    expect(await screen.findByTestId('means-report-failed')).toBeInTheDocument();
  });
});
