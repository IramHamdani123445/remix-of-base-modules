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
  mandatoryActionsOutstanding: 0,
  handoffsOutstanding: 0,
  handoffsFailed: 0,
  evidenceOutstanding: 0,
  padExposureMinor: 0,
  currencyCode: 'XCD',
  awardsAffected: 0,
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
    expect(screen.getByTestId('mort-indicators-error')).toBeInTheDocument();
  });

  it('renders a blocking chip when mandatory actions are outstanding', () => {
    render(
      <BnMortalityWorklistIndicators
        indicator={{ ...baseIndicator, mandatoryActionsOutstanding: 2 }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByTestId('mort-chip-mandatory')).toHaveTextContent('2');
  });

  it('renders a failed-handoff chip distinctly from outstanding handoffs', () => {
    render(
      <BnMortalityWorklistIndicators
        indicator={{ ...baseIndicator, handoffsFailed: 1, handoffsOutstanding: 3 }}
        isLoading={false}
        isError={false}
      />,
    );
    expect(screen.getByTestId('mort-chip-handoff-failed')).toBeInTheDocument();
    expect(screen.getByTestId('mort-chip-handoff-outstanding')).toHaveTextContent('3');
  });

  it('renders nothing loud when every signal is clear', () => {
    render(<BnMortalityWorklistIndicators indicator={baseIndicator} isLoading={false} isError={false} />);
    expect(screen.getByTestId('mort-indicators-clear')).toBeInTheDocument();
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
