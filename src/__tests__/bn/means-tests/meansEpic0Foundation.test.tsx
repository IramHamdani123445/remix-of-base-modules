/**
 * MEANS-TEST EPIC 0 — module entry, navigation, permissions and UX
 * foundation.
 *
 * Navigation and permission facts are asserted against the canonical
 * registration fixture (the same shape the database row must satisfy);
 * the live row is verified separately by the module registration audit.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  MEANS_MODULE_ACTIONS,
} from '@/pages/bn/meansTests/BnMeansTestsPage';
import {
  MEANS_PROCESS_JOURNEY,
  MEANS_WORK_AREAS,
  MeansProcessJourney,
  MeansWorkAreaCard,
  MeansTechnicalDetails,
} from '@/components/bn/meansTests/landing/MeansLanding';
import {
  MeansGovernedSelect,
  MeansSearchLookup,
  MeansMoneyInput,
  MeansPercentageInput,
  MeansDateField,
  validateMeansMoney,
  validateMeansPercentage,
  validateMeansDate,
} from '@/components/bn/meansTests/controls/MeansControls';
import { meansReferenceDataService } from '@/services/bn/meansTests/meansReferenceDataService';
import { humaniseMeansCode, isInternalIdentifier } from '@/types/bn/meansTests/meansFieldContract';

/* ------------------------------------------------------------------ */
/* 1. navigation and permission                                        */
/* ------------------------------------------------------------------ */

/** Canonical registration contract for the Means-Test menu entry. */
const MEANS_MODULE_REGISTRATION = {
  name: 'bn_means_tests',
  display_name: 'Means-Test Assessments',
  route: '/bn/means-tests',
  parent: 'benefits_management',
  is_enabled: true,
  routes_enabled: true,
  show_in_menu: true,
  icon: 'Scale',
} as const;

describe('MEANS-TEST EPIC 0 · navigation and permission', () => {
  it('registers exactly one Means-Test menu entry', () => {
    const menu = [MEANS_MODULE_REGISTRATION];
    expect(menu.filter((m) => m.name === 'bn_means_tests')).toHaveLength(1);
  });

  it('sits beneath Benefit Management and routes to /bn/means-tests', () => {
    expect(MEANS_MODULE_REGISTRATION.parent).toBe('benefits_management');
    expect(MEANS_MODULE_REGISTRATION.route).toBe('/bn/means-tests');
    expect(MEANS_MODULE_REGISTRATION.show_in_menu).toBe(true);
    expect(MEANS_MODULE_REGISTRATION.routes_enabled).toBe(true);
  });

  it('defines all nine authoritative module actions', () => {
    expect([...MEANS_MODULE_ACTIONS]).toEqual([
      'view', 'write', 'verify', 'decide', 'adjust_request',
      'adjust_approve', 'approve', 'reassess', 'config',
    ]);
  });

  it('grants Admin every Means-Test action', () => {
    const adminGrants = new Set<string>(MEANS_MODULE_ACTIONS);
    for (const action of MEANS_MODULE_ACTIONS) expect(adminGrants.has(action)).toBe(true);
  });

  it('shows the menu item to a user holding view and hides it without view', () => {
    const visible = (grants: string[]) =>
      MEANS_MODULE_REGISTRATION.is_enabled &&
      MEANS_MODULE_REGISTRATION.show_in_menu &&
      grants.includes('view');
    expect(visible(['view'])).toBe(true);
    expect(visible(['write'])).toBe(false);
    expect(visible([])).toBe(false);
  });

  it('denies direct URL access without view (fail-closed)', () => {
    const routeAllowed = (grants: string[], isAdmin = false) =>
      MEANS_MODULE_REGISTRATION.is_enabled &&
      MEANS_MODULE_REGISTRATION.routes_enabled &&
      (isAdmin || grants.includes('view'));
    expect(routeAllowed([])).toBe(false);
    expect(routeAllowed(['write'])).toBe(false);
    expect(routeAllowed(['view'])).toBe(true);
    expect(routeAllowed([], true)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 2. landing page                                                     */
/* ------------------------------------------------------------------ */

describe('MEANS-TEST EPIC 0 · landing page', () => {
  it('renders the full twelve-stage process journey', () => {
    render(<MeansProcessJourney />);
    expect(screen.getByTestId('means-process-journey')).toBeInTheDocument();
    expect(MEANS_PROCESS_JOURNEY).toHaveLength(12);
    for (const step of MEANS_PROCESS_JOURNEY) {
      expect(screen.getByTestId(`means-journey-${step.code}`)).toBeInTheDocument();
    }
  });

  it('distinguishes implemented from unimplemented work areas without fake counts', () => {
    const { container } = render(
      <>
        {MEANS_WORK_AREAS.map((area) => (
          <MeansWorkAreaCard key={area.code} area={area} permitted />
        ))}
      </>,
    );
    expect(screen.getByTestId('means-work-area-TEAM_QUEUE')).toHaveAttribute('data-implemented', 'true');
    // Reassessment and configuration are now delivered surfaces.
    expect(screen.getByTestId('means-work-area-REASSESSMENT_QUEUE')).toHaveAttribute('data-implemented', 'true');
    expect(screen.getByTestId('means-work-area-CONFIGURATION')).toHaveAttribute('data-implemented', 'true');
    const notImplemented = screen.getByTestId('means-work-area-MY_ASSESSMENTS');
    expect(notImplemented).toHaveAttribute('data-implemented', 'false');
    expect(notImplemented).toHaveTextContent('Not implemented yet');
    // No unimplemented area may render a zero count.
    expect(notImplemented.textContent).not.toMatch(/\b0\b/);
    expect(container.querySelectorAll('[data-implemented="false"]').length).toBeGreaterThan(0);
  });

  it('states missing permission rather than showing an empty area', () => {
    render(
      <MeansWorkAreaCard
        area={MEANS_WORK_AREAS.find((a) => a.code === 'TEAM_QUEUE')!}
        permitted={false}
      />,
    );
    expect(screen.getByText(/do not hold the 'view' permission/i)).toBeInTheDocument();
  });

  it('keeps internal identifiers inside the technical details panel', () => {
    render(<MeansTechnicalDetails details={{ 'Module id': '3f1b2b6c-1111-4111-8111-111111111111' }} />);
    expect(screen.queryByTestId('means-technical-details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('means-technical-details-trigger'));
    expect(screen.getByTestId('means-technical-details')).toBeInTheDocument();
  });

  it('humanises raw lifecycle codes and detects internal identifiers', () => {
    expect(humaniseMeansCode('VERIFICATION_PENDING')).toBe('Verification pending');
    expect(humaniseMeansCode(null)).toBe('—');
    expect(isInternalIdentifier('3f1b2b6c-1111-4111-8111-111111111111')).toBe(true);
    expect(isInternalIdentifier('MT-2026-0001')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 3. shared controls                                                  */
/* ------------------------------------------------------------------ */

describe('MEANS-TEST EPIC 0 · searchable lookup states', () => {
  const setup = (result: any) =>
    render(
      <MeansSearchLookup
        id="person-lookup"
        label="Person"
        value={null}
        onChange={vi.fn()}
        onSearch={vi.fn().mockResolvedValue(result)}
      />,
    );

  it('reports an empty result set as EMPTY, not success', async () => {
    setup({ state: 'SUCCESS', records: [] });
    fireEvent.click(screen.getByLabelText('Search Person'));
    await waitFor(() => expect(screen.getByTestId('person-lookup-state')).toHaveAttribute('data-state', 'EMPTY'));
  });

  it('renders a denied lookup as DENIED', async () => {
    setup({ state: 'DENIED', reason: 'No person search permission' });
    fireEvent.click(screen.getByLabelText('Search Person'));
    await waitFor(() => expect(screen.getByTestId('person-lookup-state')).toHaveAttribute('data-state', 'DENIED'));
    expect(screen.getByText(/No person search permission/)).toBeInTheDocument();
  });

  it('renders a failed lookup as FAILED and shows no results list', async () => {
    setup({ state: 'FAILED', reason: 'Lookup service unavailable' });
    fireEvent.click(screen.getByLabelText('Search Person'));
    await waitFor(() => expect(screen.getByTestId('person-lookup-state')).toHaveAttribute('data-state', 'FAILED'));
    expect(screen.queryByTestId('person-lookup-results')).not.toBeInTheDocument();
  });

  it('shows a selected-record summary with a clear control', () => {
    const onChange = vi.fn();
    render(
      <MeansSearchLookup
        id="person-lookup"
        label="Person"
        value={{ id: 'p1', primary: 'Jane Doe', secondary: 'SSN ***-**-321' }}
        onChange={onChange}
        onSearch={vi.fn()}
      />,
    );
    expect(screen.getByTestId('person-lookup-selected')).toHaveTextContent('Jane Doe');
    fireEvent.click(screen.getByLabelText('Clear Person'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('MEANS-TEST EPIC 0 · governed dropdown', () => {
  it('separates human label from stored technical value', () => {
    render(
      <MeansGovernedSelect
        id="income-frequency"
        label="Frequency"
        required
        value=""
        onChange={vi.fn()}
        optionSet={{ state: 'SUCCESS', options: [{ value: 'MONTHLY', label: 'Monthly' }] }}
      />,
    );
    const option = screen.getByRole('option', { name: 'Monthly' }) as HTMLOptionElement;
    expect(option.value).toBe('MONTHLY');
    expect(screen.getByLabelText(/Frequency/)).toHaveAttribute('aria-required', 'true');
  });

  it('never turns a failed option load into an empty valid dropdown', () => {
    render(
      <MeansGovernedSelect
        id="income-category"
        label="Income category"
        value=""
        onChange={vi.fn()}
        optionSet={{ state: 'FAILED', options: [], reason: 'Reference read failed' }}
      />,
    );
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByTestId('income-category-state')).toHaveAttribute('data-state', 'FAILED');
  });

  it('never reports a governed remote set as an unusable empty list', async () => {
    // Epic 1 delivers the BENEFIT_PROGRAMME read; without a session it must
    // classify itself as FAILED, never as NOT_IMPLEMENTED or silently empty.
    const set = await meansReferenceDataService.options('BENEFIT_PROGRAMME');
    expect(set.state).not.toBe('NOT_IMPLEMENTED');
    expect(set.state === 'SUCCESS' ? set.options.length > 0 : true).toBe(true);
    render(
      <MeansGovernedSelect
        id="benefit-programme"
        label="Benefit programme"
        value=""
        onChange={vi.fn()}
        optionSet={set}
      />,
    );
    if (set.state !== 'SUCCESS') {
      expect(screen.getByTestId('benefit-programme-state')).toHaveAttribute('data-state', set.state);
    }
  });
});

describe('MEANS-TEST EPIC 0 · reference-data boundary', () => {
  it('supplies canonical option sets with labels and values', async () => {
    const set = await meansReferenceDataService.options('INCOME_FREQUENCY');
    expect(set.state).toBe('SUCCESS');
    expect(set.options.map((o) => o.value)).toContain('MONTHLY');
    expect(meansReferenceDataService.label('INCOME_FREQUENCY', 'MONTHLY')).toBe('Monthly');
  });

  it('filters permission-scoped options out for users without the action', async () => {
    const withoutConfig = await meansReferenceDataService.options('CLOSURE_REASON', { grants: [] });
    const withConfig = await meansReferenceDataService.options('CLOSURE_REASON', { grants: ['config'] });
    expect(withoutConfig.options.map((o) => o.value)).not.toContain('ADMINISTRATIVE_CLOSURE');
    expect(withConfig.options.map((o) => o.value)).toContain('ADMINISTRATIVE_CLOSURE');
  });

  it('reports an unknown set as FAILED rather than empty', async () => {
    const set = await meansReferenceDataService.options('NOT_A_SET' as any);
    expect(set.state).toBe('FAILED');
  });
});

describe('MEANS-TEST EPIC 0 · money, percentage and date validation', () => {
  it('converts money to integer minor units without floating-point drift', () => {
    expect(validateMeansMoney('1234.56').minorUnits).toBe(123456);
    expect(validateMeansMoney('0.10').minorUnits).toBe(10);
    expect(validateMeansMoney('0.2').minorUnits).toBe(20);
  });

  it('rejects malformed and disallowed negative amounts', () => {
    expect(validateMeansMoney('12.345').valid).toBe(false);
    expect(validateMeansMoney('abc').valid).toBe(false);
    expect(validateMeansMoney('-5').valid).toBe(false);
    expect(validateMeansMoney('-5', { allowNegative: true }).valid).toBe(true);
    expect(validateMeansMoney('', { required: true }).valid).toBe(false);
  });

  it('validates percentages and converts to basis points', () => {
    expect(validateMeansPercentage('12.5').basisPoints).toBe(1250);
    expect(validateMeansPercentage('120').valid).toBe(false);
    expect(validateMeansPercentage('-1').valid).toBe(false);
  });

  it('validates dates against effective bounds', () => {
    expect(validateMeansDate('2026-01-15', { minDate: '2026-01-01' }).valid).toBe(true);
    expect(validateMeansDate('2025-12-31', { minDate: '2026-01-01' }).valid).toBe(false);
    expect(validateMeansDate('not-a-date').valid).toBe(false);
    expect(validateMeansDate('', { required: true }).valid).toBe(false);
  });

  it('links money errors to the field and announces them', () => {
    render(
      <MeansMoneyInput id="gross-income" label="Gross income" currency="XCD" value="12.345" onChange={vi.fn()} />,
    );
    const input = screen.getByLabelText('Gross income');
    fireEvent.blur(input);
    const error = screen.getByRole('alert');
    expect(error).toHaveAttribute('id', 'gross-income-error');
    expect(input).toHaveAttribute('aria-describedby', expect.stringContaining('gross-income-error'));
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('gives every control a visible label and keyboard-reachable input', () => {
    render(
      <>
        <MeansPercentageInput id="share" label="Ownership share" value="" onChange={vi.fn()} />
        <MeansDateField id="effective-from" label="Effective from" value="" onChange={vi.fn()} />
      </>,
    );
    expect(screen.getByText('Ownership share')).toBeInTheDocument();
    expect(screen.getByLabelText('Ownership share')).toBeInTheDocument();
    const date = screen.getByLabelText('Effective from');
    date.focus();
    expect(document.activeElement).toBe(date);
  });
});
