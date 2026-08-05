/**
 * BN-UI — Responsive Suspension Proposal dialog.
 *
 * Verifies the header / scrollable body / footer shell, progressive
 * validation, reason-loading states and dark-launch gating. Business rules
 * (maker-checker, narrative minimum, action gating) must remain enforced.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SuspensionProposalDialog } from '@/pages/bn/servicing/award-suspension/SuspensionProposalDialog';

const mocks = vi.hoisted(() => ({
  listSuspensionReasonCodesMock: vi.fn(),
}));

vi.mock('@/services/bn/awardSuspensionViewService', () => ({
  listSuspensionReasonCodes: mocks.listSuspensionReasonCodesMock,
}));

const award = {
  awardId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  awardNumber: 'AWD-2026-000000000000-LONG-REFERENCE',
  claimantName: 'Maximiliana Consuela Rodriguez-Fitzgerald-Bartholomew',
  benefitCode: 'INVALIDITY-LONG-TERM-SUPPLEMENTARY-CODE',
  awardStatus: 'ACTIVE',
  baseAmount: 1234.56,
  currency: 'XCD',
  startDate: '2024-01-01',
  openRequestId: null,
};

const okReasons = [
  { code: 'MEDICAL', label: 'Medical review outstanding', requiresNarrative: true },
  { code: 'LIFE_CERT', label: 'Life certificate overdue', requiresNarrative: true },
];

function renderDialog(props: Partial<React.ComponentProps<typeof SuspensionProposalDialog>> = {}) {
  return render(
    <SuspensionProposalDialog
      open
      onOpenChange={() => {}}
      award={award as never}
      actionsEnabled={false}
      {...props}
    />
  );
}

beforeEach(() => {
  mocks.listSuspensionReasonCodesMock.mockReset();
  mocks.listSuspensionReasonCodesMock.mockResolvedValue(okReasons);
});

describe('SuspensionProposalDialog — responsive shell', () => {
  it('renders header, scrollable body and footer regions', async () => {
    renderDialog();
    expect(await screen.findByText('New Suspension Request')).toBeInTheDocument();
    const body = screen.getByTestId('suspension-proposal-body');
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(body.className).toMatch(/flex-1/);
    expect(body.className).toMatch(/min-h-0/);
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeInTheDocument();
  });

  it('caps the panel to the viewport and never scrolls horizontally', async () => {
    renderDialog();
    const panel = (await screen.findByRole('dialog')) as HTMLElement;
    expect(panel.className).toMatch(/max-h-\[calc\(100dvh/);
    expect(panel.className).toMatch(/overflow-hidden/);
    expect(panel.className).toMatch(/flex-col/);
  });

  it('keeps the footer outside the scrollable body', async () => {
    renderDialog();
    const body = await screen.findByTestId('suspension-proposal-body');
    const submit = screen.getByRole('button', { name: /submit for approval/i });
    expect(body.contains(submit)).toBe(false);
  });

  it('wraps long award identifiers safely', async () => {
    renderDialog();
    const claimant = await screen.findByText(award.claimantName);
    expect(claimant.className).toMatch(/break-words/);
    expect(claimant.className).toMatch(/min-w-0/);
  });
});

describe('SuspensionProposalDialog — progressive validation', () => {
  it('does not show the validation summary before a submit attempt', async () => {
    renderDialog({ actionsEnabled: true });
    await screen.findByText('New Suspension Request');
    expect(screen.queryByTestId('suspension-validation-summary')).toBeNull();
  });

  it('shows a compact summary and inline errors after a submit attempt', async () => {
    renderDialog({ actionsEnabled: true });
    await screen.findByText('New Suspension Request');
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));
    const summary = await screen.findByTestId('suspension-validation-summary');
    expect(summary.textContent).toMatch(/fields require attention/i);
    expect(screen.getByText(/A suspension reason is required\./i)).toBeInTheDocument();
    expect(
      screen.getByText(/Acknowledge maker-checker responsibilities to continue\./i)
    ).toBeInTheDocument();
  });

  it('updates the narrative character count', async () => {
    renderDialog({ actionsEnabled: true, narrativeMinLength: 20 });
    const narrative = await screen.findByLabelText(/narrative/i);
    expect(screen.getByText('0/20 characters minimum')).toBeInTheDocument();
    fireEvent.change(narrative, { target: { value: 'abcde' } });
    expect(screen.getByText('5/20 characters minimum')).toBeInTheDocument();
  });

  it('still enforces maker-checker acknowledgement and narrative minimum', async () => {
    renderDialog({ actionsEnabled: true, narrativeMinLength: 20 });
    await screen.findByText('New Suspension Request');
    fireEvent.click(screen.getByRole('button', { name: /submit for approval/i }));
    expect(await screen.findByText(/Narrative must be at least 20 characters/i)).toBeInTheDocument();
  });
});

describe('SuspensionProposalDialog — submit accessibility state', () => {
  it('does not expose an invalid but actionable submit as disabled', async () => {
    renderDialog({ actionsEnabled: true });
    const submit = await screen.findByRole('button', { name: /submit for approval/i });
    expect(submit).not.toBeDisabled();
    expect(submit).not.toHaveAttribute('aria-disabled');
  });

  it('associates the validation summary with the submit button after an attempt', async () => {
    renderDialog({ actionsEnabled: true });
    const submit = await screen.findByRole('button', { name: /submit for approval/i });
    expect(submit).not.toHaveAttribute('aria-describedby');
    fireEvent.click(submit);
    const summary = await screen.findByTestId('suspension-validation-summary');
    expect(summary).toHaveAttribute('id', 'suspension-validation-summary');
    expect(submit).toHaveAttribute('aria-describedby', 'suspension-validation-summary');
  });

  it('marks the dark-launch submit natively and semantically disabled', async () => {
    renderDialog({ actionsEnabled: false });
    const submit = await screen.findByRole('button', { name: /submit for approval/i });
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('SuspensionProposalDialog — header close clearance', () => {
  it('reserves right-side clearance at both mobile and sm breakpoints', async () => {
    renderDialog();
    const title = await screen.findByText('New Suspension Request');
    const header = title.closest('div')!;
    expect(header.className).toMatch(/(^|\s)pr-12(\s|$)/);
    expect(header.className).toMatch(/(^|\s)sm:pr-12(\s|$)/);
    expect(header.className).toMatch(/(^|\s)px-4(\s|$)/);
    expect(header.className).toMatch(/(^|\s)sm:px-6(\s|$)/);
  });

  it('wraps long headings and descriptions safely', async () => {
    renderDialog();
    const title = await screen.findByText('New Suspension Request');
    expect(title.className).toMatch(/break-words/);
    expect(title.className).toMatch(/min-w-0/);
    const description = screen.getByText(/Propose a temporary suspension/i);
    expect(description.className).toMatch(/break-words/);
  });
});

describe('SuspensionProposalDialog — error disclosure', () => {
  it('shows a controlled message and never the thrown error text', async () => {
    mocks.listSuspensionReasonCodesMock.mockRejectedValue(
      new Error('relation "public.bn_suspension_reason" does not exist at db-prod-01')
    );
    const { container } = renderDialog();
    expect(
      await screen.findByText(/Suspension reasons could not be loaded\./i)
    ).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/relation "public/);
    expect(container.textContent).not.toMatch(/db-prod-01/);
    expect(container.textContent).not.toMatch(/does not exist/);
  });
});


describe('SuspensionProposalDialog — dark launch', () => {
  it('shows one compact read-only banner and keeps submit disabled', async () => {
    renderDialog({ actionsEnabled: false });
    const banners = await screen.findAllByTestId('suspension-dark-launch-banner');
    expect(banners).toHaveLength(1);
    expect(screen.getByRole('button', { name: /submit for approval/i })).toBeDisabled();
  });

  it('executes no business command while actions are disabled', async () => {
    renderDialog({ actionsEnabled: false });
    const submit = await screen.findByRole('button', { name: /submit for approval/i });
    fireEvent.click(submit);
    expect(screen.queryByTestId('suspension-validation-summary')).toBeNull();
  });
});

describe('SuspensionProposalDialog — reason loading states', () => {
  it('shows a loading state and disables the selector', async () => {
    let resolve!: (v: typeof okReasons) => void;
    mocks.listSuspensionReasonCodesMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderDialog();
    expect(await screen.findByText(/Loading suspension reasons/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/suspension reason/i)).toBeDisabled();
    resolve(okReasons);
    await waitFor(() =>
      expect(screen.queryByText(/Loading suspension reasons/i)).toBeNull()
    );
  });

  it('distinguishes an empty configuration from a failure', async () => {
    mocks.listSuspensionReasonCodesMock.mockResolvedValue([]);
    renderDialog();
    expect(
      await screen.findByText(/No active Award Suspension reasons are configured\./i)
    ).toBeInTheDocument();
  });

  it('shows a failure state with retry, not a false configuration error', async () => {
    mocks.listSuspensionReasonCodesMock.mockRejectedValue(new Error('network down'));
    renderDialog();
    expect(
      await screen.findByText(/Suspension reasons could not be loaded\./i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/No active Award Suspension reasons are configured/i)).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('retries the reason lookup', async () => {
    mocks.listSuspensionReasonCodesMock.mockRejectedValueOnce(new Error('network down'));
    mocks.listSuspensionReasonCodesMock.mockResolvedValueOnce(okReasons);
    renderDialog();
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByLabelText(/suspension reason/i)).not.toBeDisabled());
    expect(mocks.listSuspensionReasonCodesMock).toHaveBeenCalledTimes(2);
  });
});
