/**
 * BN-SUSP-ACT-1 — decision surface behaviour.
 *
 * Journeys covered:
 *   A  proposer sees Withdraw, never Approve/Reject (maker-checker)
 *   B  approver approves through the versioned command with the real task id
 *   C  rejection requires a reason before the command can be sent
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const approveSuspension = vi.fn();
const rejectSuspension = vi.fn();
const withdrawSuspension = vi.fn();

vi.mock('@/services/bn/awardSuspensionCommandService', async () => {
  const actual: any = await vi.importActual('@/services/bn/awardSuspensionCommandService');
  return {
    ...actual,
    approveSuspension: (...a: unknown[]) => approveSuspension(...a),
    rejectSuspension: (...a: unknown[]) => rejectSuspension(...a),
    withdrawSuspension: (...a: unknown[]) => withdrawSuspension(...a),
  };
});

vi.mock('@/services/bn/awardSuspensionViewService', () => ({
  listSuspensionRejectionReasonCodes: vi.fn().mockResolvedValue([
    { code: 'INSUFFICIENT_EVIDENCE', label: 'Insufficient evidence', requiresNarrative: false },
  ]),
}));

import { SuspensionDecisionPanel, isTaskOpen } from '@/pages/bn/servicing/award-suspension/SuspensionDecisionPanel';

const details = (over: Record<string, unknown> = {}) =>
  ({
    request: {
      requestId: 'req-1',
      status: 'PROPOSED',
      rowVersion: 4,
      proposedByUserId: 'user-proposer',
      currentTaskId: 'task-1',
      taskStatus: 'OPEN',
      ...over,
    },
  }) as any;

beforeEach(() => {
  approveSuspension.mockReset().mockResolvedValue({});
  rejectSuspension.mockReset().mockResolvedValue({});
  withdrawSuspension.mockReset().mockResolvedValue({});
});

describe('Journey A — maker-checker', () => {
  it('hides approve and reject from the proposer and offers withdraw', () => {
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-proposer"
        canApprove
        canPropose
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.queryByTestId('approve-button')).toBeNull();
    expect(screen.queryByTestId('reject-button')).toBeNull();
    expect(screen.getByTestId('maker-checker-notice')).toBeInTheDocument();
    expect(screen.getByTestId('withdraw-button')).toBeEnabled();
  });

  it('sends the withdrawal with the current row version', async () => {
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-proposer"
        canApprove={false}
        canPropose
        actionsEnabled
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('withdraw-button'));
    await waitFor(() =>
      expect(withdrawSuspension).toHaveBeenCalledWith(
        expect.objectContaining({ suspensionId: 'req-1', expectedRowVersion: 4 })
      )
    );
  });
});

describe('Journey B — approval', () => {
  it('approves using the assigned task id and row version', async () => {
    const onChanged = vi.fn();
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={onChanged}
      />
    );
    fireEvent.click(screen.getByTestId('approve-button'));
    await waitFor(() =>
      expect(approveSuspension).toHaveBeenCalledWith(
        expect.objectContaining({ suspensionId: 'req-1', taskId: 'task-1', expectedRowVersion: 4 })
      )
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('disables decisions when the approval task is no longer open', () => {
    render(
      <SuspensionDecisionPanel
        details={details({ taskStatus: 'COMPLETED' })}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeDisabled();
    expect(screen.getByTestId('reject-button')).toBeDisabled();
  });

  it('disables decisions while the module actions gate is off', () => {
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled={false}
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeDisabled();
  });

  it('surfaces a masked error and does not claim success', async () => {
    approveSuspension.mockRejectedValue(new Error('relation "bn_award" does not exist'));
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('approve-button'));
    const alert = await screen.findByTestId('decision-error');
    expect(alert.textContent).not.toContain('bn_award');
    expect(screen.queryByTestId('decision-success')).toBeNull();
  });
});

describe('Journey C — rejection', () => {
  it('requires a rejection reason before the command can be sent', async () => {
    render(
      <SuspensionDecisionPanel
        details={details()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('reject-button'));
    const confirm = await screen.findByTestId('confirm-reject');
    expect(confirm).toBeDisabled();
    expect(rejectSuspension).not.toHaveBeenCalled();
  });
});

describe('task openness', () => {
  it.each(['OPEN', 'PENDING', 'in_progress'])('treats %s as actionable', (s) => {
    expect(isTaskOpen(s)).toBe(true);
  });
  it.each(['COMPLETED', 'CANCELLED', null, undefined])('treats %s as closed', (s) => {
    expect(isTaskOpen(s as string | null)).toBe(false);
  });
});
