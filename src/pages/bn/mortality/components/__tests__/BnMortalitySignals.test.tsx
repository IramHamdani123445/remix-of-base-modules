/**
 * BN-MORT-M3/M4 — surface tests for the operational signal chips and the
 * Award 360 mortality card.
 *
 * The rule under test: an unavailable read must never render as "clear".
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockSnapshot = vi.fn();
vi.mock('@/hooks/bn/mortality/useMortalityQueries', () => ({
  useMortalityAwardSnapshot: (...a: unknown[]) => mockSnapshot(...a),
}));

import { BnMortalityWorklistIndicators } from '../BnMortalityWorklistIndicators';
import { Benefit360MortalityCard } from '@/components/bn/mortality/Benefit360MortalityCard';

const baseIndicator = {
  eventId: 'e1',
  openMandatoryActions: 0,
  outstandingHandoffs: 0,
  failedHandoffs: 0,
  evidenceCount: 0,
  impactCount: 0,
  awaitingApprovalImpacts: 0,
  activeHolds: 0,
  padExposureMinor: 0,
  currencyCode: 'XCD',
};

function renderCard() {
  return render(
    <MemoryRouter>
      <Benefit360MortalityCard awardId="a1" />
    </MemoryRouter>,
  );
}

describe('BnMortalityWorklistIndicators', () => {
  it('shows an unknown state rather than "clear" when the read failed', () => {
    render(<BnMortalityWorklistIndicators indicator={undefined} isLoading={false} isError />);
    expect(screen.getByTestId('mort-signals-unavailable')).toBeInTheDocument();
  });

  it('renders a blocking chip when mandatory actions are outstanding', () => {
    render(
      <BnMortalityWorklistIndicators
        indicator={{ ...baseIndicator, openMandatoryActions: 2 }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByText('2 actions')).toBeInTheDocument();
  });

  it('renders a failed-handoff chip distinctly from outstanding handoffs', () => {
    render(
      <BnMortalityWorklistIndicators
        indicator={{ ...baseIndicator, failedHandoffs: 1, outstandingHandoffs: 3 }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('3 handoffs')).toBeInTheDocument();
  });

  it('marks PAD exposure as indicative currency, not a debt figure', () => {
    render(
      <BnMortalityWorklistIndicators
        indicator={{ ...baseIndicator, padExposureMinor: 125000 }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByText('XCD 1250.00')).toBeInTheDocument();
  });

  it('renders a clear state when every signal is clear', () => {
    render(<BnMortalityWorklistIndicators indicator={baseIndicator} isLoading={false} isError={false} />);
    expect(screen.getByTestId('mort-signals-clear')).toBeInTheDocument();
  });
});

describe('Benefit360MortalityCard', () => {
  it('states that access is denied instead of showing "no event"', () => {
    mockSnapshot.mockReturnValue({ isLoading: false, isError: false, data: { status: 'DENIED' } });
    renderCard();
    expect(screen.getByTestId('award360-mortality-unavailable')).toBeInTheDocument();
  });

  it('states the read failed instead of showing "no event"', () => {
    mockSnapshot.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    renderCard();
    expect(screen.getByTestId('award360-mortality-unavailable')).toBeInTheDocument();
  });

  it('shows an explicit no-event state when the award is clean', () => {
    mockSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { status: 'OK', data: { hasMortalityEvent: false, event: null, impact: null } },
    });
    renderCard();
    expect(screen.getByTestId('award360-mortality-none')).toBeInTheDocument();
  });

  it('renders PAD exposure as indicative, not as a confirmed debt', () => {
    mockSnapshot.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        status: 'OK',
        data: {
          hasMortalityEvent: true,
          event: {
            eventId: 'e1',
            eventReference: 'MORT-1',
            status: 'VERIFIED',
            deathDate: '2026-01-04',
            route: '/bn/mortality/e1',
          },
          impact: {
            action: 'TERMINATE',
            holdStatus: 'APPLIED',
            terminationStatus: 'PENDING',
            approvalState: 'AWAITING',
            estimatedPadMinor: 125000,
            currencyCode: 'XCD',
            overpaymentReference: null,
          },
        },
      },
    });
    renderCard();
    expect(screen.getByTestId('award360-mortality-card')).toBeInTheDocument();
    expect(screen.getByText('XCD 1250.00')).toBeInTheDocument();
    expect(screen.getByText(/not a confirmed debt/i)).toBeInTheDocument();
  });
});
