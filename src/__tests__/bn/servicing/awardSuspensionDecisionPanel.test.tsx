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
const approveReinstatement = vi.fn();
const rejectReinstatement = vi.fn();
const withdrawReinstatement = vi.fn();

vi.mock('@/services/bn/awardSuspensionCommandService', async () => {
  const actual: any = await vi.importActual('@/services/bn/awardSuspensionCommandService');
  return {
    ...actual,
    approveSuspension: (...a: unknown[]) => approveSuspension(...a),
    rejectSuspension: (...a: unknown[]) => rejectSuspension(...a),
    withdrawSuspension: (...a: unknown[]) => withdrawSuspension(...a),
    approveReinstatement: (...a: unknown[]) => approveReinstatement(...a),
    rejectReinstatement: (...a: unknown[]) => rejectReinstatement(...a),
    withdrawReinstatement: (...a: unknown[]) => withdrawReinstatement(...a),
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
      caseKind: 'SUSPENSION',
      eventStatus: 'PROPOSED',
      displayStatus: 'PENDING_APPROVAL',
      status: 'PENDING_APPROVAL',
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

/**
 * BN-SUSP-REINST — reinstatement decision routing.
 * Suspension permissions must never authorise reinstatement decisions, and the
 * real open task id from the secured read contract must be forwarded.
 */
const reinstatement = (over: Record<string, unknown> = {}) =>
  details({
    caseKind: 'REINSTATEMENT',
    eventStatus: 'REINSTATEMENT_PROPOSED',
    currentTaskId: 'task-r1',
    ...over,
  });

describe('Journey D — reinstatement decisions', () => {
  it('approves with the reinstatement id, real task id and row version', async () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('approve-button'));
    await waitFor(() =>
      expect(approveReinstatement).toHaveBeenCalledWith(
        expect.objectContaining({
          reinstatementId: 'req-1',
          taskId: 'task-r1',
          expectedRowVersion: 4,
        })
      )
    );
    expect(approveSuspension).not.toHaveBeenCalled();
  });

  it('rejects with the real task id and the selected reason', async () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    fireEvent.click(screen.getByTestId('reject-button'));
    const trigger = await screen.findByLabelText(/Rejection reason/i);
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const option = await screen.findByText('Insufficient evidence');
    fireEvent.click(option);
    await waitFor(() => expect(screen.getByTestId('confirm-reject')).toBeEnabled());
    fireEvent.click(screen.getByTestId('confirm-reject'));
    await waitFor(() =>
      expect(rejectReinstatement).toHaveBeenCalledWith(
        expect.objectContaining({
          reinstatementId: 'req-1',
          taskId: 'task-r1',
          reasonCode: 'INSUFFICIENT_EVIDENCE',
          expectedRowVersion: 4,
        })
      )
    );
    expect(rejectSuspension).not.toHaveBeenCalled();
  });

  it('lets the reinstatement proposer withdraw but never approve or reject', async () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement()}
        currentUserId="user-proposer"
        canApprove
        canPropose
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.queryByTestId('approve-button')).toBeNull();
    expect(screen.queryByTestId('reject-button')).toBeNull();
    fireEvent.click(screen.getByTestId('withdraw-button'));
    await waitFor(() =>
      expect(withdrawReinstatement).toHaveBeenCalledWith(
        expect.objectContaining({ reinstatementId: 'req-1', expectedRowVersion: 4 })
      )
    );
    expect(withdrawSuspension).not.toHaveBeenCalled();
  });

  it('never calls reinstatement commands for a suspension case', async () => {
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
    await waitFor(() => expect(approveSuspension).toHaveBeenCalled());
    expect(approveReinstatement).not.toHaveBeenCalled();
  });

  it('shows no controls when the caller only holds suspension approval', () => {
    // The drawer passes resume permissions for a reinstatement; a
    // suspension-only approver therefore arrives with canApprove=false.
    const { container } = render(
      <SuspensionDecisionPanel
        details={reinstatement()}
        currentUserId="user-approver"
        canApprove={false}
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows reinstatement controls for a resume_approve holder', () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement()}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeEnabled();
  });

  it('disables decisions when the reinstatement task is closed', () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement({ taskStatus: 'COMPLETED' })}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeDisabled();
  });

  it('fails closed when no task id was supplied', () => {
    render(
      <SuspensionDecisionPanel
        details={reinstatement({ currentTaskId: null })}
        currentUserId="user-approver"
        canApprove
        canPropose={false}
        actionsEnabled
        onChanged={() => {}}
      />
    );
    expect(screen.getByTestId('approve-button')).toBeDisabled();
    expect(screen.getByTestId('reject-button')).toBeDisabled();
    expect(approveReinstatement).not.toHaveBeenCalled();
  });
});
