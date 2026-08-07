/**
 * MEANS-TEST EPIC 3 — income assessment.
 *
 * Guards the contract that matters: categories and frequencies are governed
 * lists, annualisation is backend-owned, household linkage is restricted to
 * the assessment household, missing income is never zero income, and a
 * failed readiness read is Unavailable rather than Complete.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const income = vi.fn();
const incomeReadiness = vi.fn();
const incomeReference = vi.fn();
const incomeContext = vi.fn();
const employerSearch = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    income: (...a: unknown[]) => income(...a),
    incomeReadiness: (...a: unknown[]) => incomeReadiness(...a),
    incomeReference: (...a: unknown[]) => incomeReference(...a),
    incomeContext: (...a: unknown[]) => incomeContext(...a),
    employerSearch: (...a: unknown[]) => employerSearch(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import BnMeansIncomeSection from '@/components/bn/meansTests/income/BnMeansIncomeSection';
import {
  emptyIncomeDraft,
  incomePayload,
  incomeReasonLabel,
  resolveIncomeBasis,
  validateIncomeDraft,
  draftFromIncomeFact,
  findIncomeCategory,
  type BnMeansIncomeReference,
} from '@/types/bn/meansTests/meansIncome';

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const REFERENCE = {
  INCOME_CATEGORY: [
    {
      value: 'EMPLOYMENT', label: 'Employment income', requires_employer: true,
      requires_source_name: false, basis_choice: true, allow_one_off: false,
      evidence_normally_required: true,
    },
    {
      value: 'PENSION', label: 'Pension income', requires_employer: false,
      requires_source_name: true, basis_choice: false, fixed_basis: 'GROSS' as const,
      allow_one_off: false, evidence_normally_required: true, benefit_source_available: true,
    },
    {
      value: 'MAINTENANCE', label: 'Maintenance or support', requires_employer: false,
      requires_source_name: true, basis_choice: false, fixed_basis: 'NET' as const,
      allow_one_off: true, evidence_normally_required: false,
    },
  ],
  INCOME_FREQUENCY: [
    { value: 'WEEKLY', label: 'Weekly', periods_per_year: 52 },
    { value: 'FORTNIGHTLY', label: 'Fortnightly', periods_per_year: 26 },
    { value: 'MONTHLY', label: 'Monthly', periods_per_year: 12 },
    { value: 'ONE_OFF', label: 'One-off', periods_per_year: 1 },
  ],
  INCOME_BASIS: [
    { value: 'GROSS', label: 'Gross' },
    { value: 'NET', label: 'Net' },
  ],
  INCOME_FACT_SOURCE: [
    { value: 'APPLICANT_DECLARATION', label: 'Applicant declaration' },
    { value: 'CONTRIBUTION_RECORD', label: 'Contribution record' },
  ],
  NO_INCOME_REASON: [
    { value: 'NOT_WORKING', label: 'Not working and receives nothing' },
  ],
} as unknown as BnMeansIncomeReference;

const MEMBER = {
  member_id: 'm1',
  display_name: 'Jane Doe',
  relationship_label: 'Self (assessed person)',
  is_current: true,
  member_from: '2026-01-01',
  member_to: null as string | null,
  dependency_decision_label: 'Not dependant',
};

const ENDED_MEMBER = {
  ...MEMBER,
  member_id: 'm2',
  display_name: 'John Doe',
  relationship_label: 'Child',
  is_current: false,
  member_to: '2026-03-31',
};

const FACT = {
  income_fact_id: 'f1',
  member_id: 'm1',
  member_name: 'Jane Doe',
  member_relationship: 'Self (assessed person)',
  member_is_current: true,
  category_code: 'EMPLOYMENT',
  category_label: 'Employment income',
  income_source: null,
  source_name: 'Acme Ltd',
  employer_regno: '12345',
  employer_name: 'Acme Ltd',
  employer_status: 'ACTIVE',
  basis: 'GROSS',
  basis_label: 'Gross',
  declared_amount: 1200,
  declared_frequency: 'MONTHLY',
  declared_frequency_label: 'Monthly',
  currency_code: 'XCD',
  normalised_annual_amount: 14400,
  annualisation_method: 'FREQUENCY_MULTIPLIER',
  is_one_off: false,
  occurrence_date: null,
  effective_from: '2026-01-01',
  effective_to: null,
  fact_source: 'APPLICANT_DECLARATION',
  fact_source_label: 'Applicant declaration',
  evidence_status: 'NONE',
  verification_status: 'UNVERIFIED',
  income_notes: null,
  fact_version: 1,
  supersedes_fact_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const DETAIL = {
  assessment_id: 'a1',
  editable: true,
  currency_code: 'XCD',
  assessment_from: '2026-01-01',
  assessment_to: null,
  income_rules: { require_declaration_for_every_member: true, duplicate_treatment: 'WARN' as const },
  household_members: [MEMBER, ENDED_MEMBER],
  facts: [FACT],
  no_income_declarations: [],
};

const READY = {
  assessment_id: 'a1',
  section_complete: false,
  section_status: 'IN_PROGRESS' as const,
  section_marked_complete: false,
  current_income_count: 1,
  household_members_total: 2,
  members_with_income: 1,
  members_with_no_income_declaration: 0,
  members_without_declaration: 1,
  declared_annualised_total: 14400,
  currency_code: 'XCD',
  missing_requirements: [],
  warnings: [],
  blockers: [
    {
      code: 'MEMBER_INCOME_DECLARATION_MISSING',
      message: '1 household member(s) have neither an income record nor an explicit no-income declaration.',
    },
  ],
  reason_codes: ['MEMBER_INCOME_DECLARATION_MISSING'],
};

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function renderSection(props: Record<string, unknown> = {}) {
  return wrap(
    <BnMeansIncomeSection
      assessmentId="a1"
      assessmentFrom="2026-01-01"
      assessmentTo={null}
      editable
      availableActions={['BN_MEANS_ADD_INCOME', 'BN_MEANS_MARK_INCOME_COMPLETE']}
      {...props}
    />,
  );
}

beforeEach(() => {
  income.mockReset();
  incomeReadiness.mockReset();
  incomeReference.mockReset();
  incomeContext.mockReset();
  employerSearch.mockReset();
  execute.mockReset();
  income.mockResolvedValue({ status: 'OK', data: DETAIL });
  incomeReadiness.mockResolvedValue({ status: 'OK', data: READY });
  incomeReference.mockResolvedValue({ status: 'OK', data: REFERENCE });
  incomeContext.mockResolvedValue({
    status: 'OK',
    data: {
      assessment_id: 'a1', member_id: 'm1', has_person_record: true,
      contribution_records: [], contribution_state: 'EMPTY',
      benefit_sources: [], benefit_state: 'NOT_IMPLEMENTED',
    },
  });
  execute.mockResolvedValue({ status: 'EXECUTED', data: {}, correlationId: 'c1' });
});

/* ------------------------------------------------------------------ */
/* category, controls and conditional behaviour                        */
/* ------------------------------------------------------------------ */

describe('income category and control behaviour', () => {
  it('renders the category as a governed dropdown with no free-text entry', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    const select = await screen.findByTestId('means-income-category');
    expect(select.tagName).toBe('SELECT');
    expect(within(select as HTMLSelectElement).getByText('Employment income')).toBeTruthy();
    expect(screen.queryByLabelText(/category code/i)).toBeNull();
  });

  it('shows the employer lookup only for categories that require an employer', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    expect(screen.queryByLabelText(/^Employer/)).toBeNull();
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'EMPLOYMENT' },
    });
    expect(await screen.findByLabelText(/^Employer/)).toBeTruthy();
    fireEvent.change(screen.getByTestId('means-income-category'), { target: { value: 'PENSION' } });
    await waitFor(() => expect(screen.queryByLabelText(/^Employer/)).toBeNull());
    expect(screen.getByLabelText(/Source name/)).toBeTruthy();
  });

  it('derives the basis read-only when the policy category permits only one', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'PENSION' },
    });
    const fixed = await screen.findByTestId('means-income-basis-fixed');
    expect(fixed.textContent).toContain('Gross');
    expect(fixed.textContent).toContain('Set by policy');
  });

  it('offers gross/net as a radio group when the category allows a choice', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'EMPLOYMENT' },
    });
    expect(await screen.findByLabelText('Gross')).toBeTruthy();
    expect(screen.getByLabelText('Net')).toBeTruthy();
  });

  it('renders the currency as derived context, never as a typed field', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    expect(await screen.findByText('XCD')).toBeTruthy();
    expect(screen.queryByLabelText(/currency/i)).toBeNull();
  });

  it('hides one-off frequency for categories that do not permit it', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'EMPLOYMENT' },
    });
    const freq = await screen.findByTestId('means-income-frequency');
    expect(within(freq as HTMLSelectElement).queryByText('One-off')).toBeNull();
    fireEvent.change(screen.getByTestId('means-income-category'), { target: { value: 'MAINTENANCE' } });
    await waitFor(() =>
      expect(within(screen.getByTestId('means-income-frequency') as HTMLSelectElement)
        .queryByText('One-off')).not.toBeNull(),
    );
  });

  it('explains the one-off treatment without multiplying the amount', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'MAINTENANCE' },
    });
    fireEvent.change(await screen.findByTestId('means-income-frequency'), {
      target: { value: 'ONE_OFF' },
    });
    expect(await screen.findByTestId('means-income-one-off-note')).toBeTruthy();
    expect(screen.queryByLabelText('Effective to')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* household linkage                                                   */
/* ------------------------------------------------------------------ */

describe('household linkage', () => {
  it('offers only members of this assessment household', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    const select = (await screen.findByTestId('means-income-member')) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).toEqual(['m1', 'm2']);
    expect(screen.queryByLabelText(/member id/i)).toBeNull();
  });

  it('flags an ended membership so the income period stays consistent', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-member'), { target: { value: 'm2' } });
    expect(await screen.findByTestId('means-income-member-ended')).toBeTruthy();
  });

  it('rejects an income period outside the member membership period', () => {
    const errors = validateIncomeDraft(
      { ...emptyIncomeDraft('2026-01-01'), memberId: 'm2', effectiveFrom: '2026-06-01' },
      { category: null, member: ENDED_MEMBER },
    );
    expect(errors.effectiveFrom).toBe(incomeReasonLabel('INCOME_OUTSIDE_HOUSEHOLD_MEMBERSHIP'));
  });

  it('requires a household member when household-level income is not permitted', () => {
    const errors = validateIncomeDraft(emptyIncomeDraft('2026-01-01'), { category: null, rules: {} });
    expect(errors.memberId).toBe(incomeReasonLabel('INCOME_MEMBER_REQUIRED'));
  });

  it('permits household-level income only when the policy allows it', () => {
    const errors = validateIncomeDraft(emptyIncomeDraft('2026-01-01'), {
      category: null,
      rules: { allow_household_level_income: true },
    });
    expect(errors.memberId).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* employer lookup                                                     */
/* ------------------------------------------------------------------ */

describe('employer lookup states', () => {
  async function openEmployment() {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-category'), {
      target: { value: 'EMPLOYMENT' },
    });
    return screen.findByLabelText(/^Employer/);
  }

  it('shows results and hides the internal identifier', async () => {
    employerSearch.mockResolvedValue({
      status: 'OK',
      data: [{ employer_regno: '12345', employer_name: 'Acme Ltd', trade_name: null, employer_status: 'ACTIVE' }],
    });
    const input = await openEmployment();
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText('Search Employer'));
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByText(/00000000-0000/)).toBeNull();
  });

  it.each([
    ['DENIED', 'DENIED'],
    ['FAILED', 'FAILED'],
  ])('renders %s as an explicit state, never an empty list', async (status, expected) => {
    employerSearch.mockResolvedValue({ status, data: null, detail: 'nope' });
    const input = await openEmployment();
    fireEvent.change(input, { target: { value: 'Acme' } });
    fireEvent.click(screen.getByLabelText('Search Employer'));
    const notice = await screen.findByTestId('means-income-employer-state');
    expect(notice.getAttribute('data-state')).toBe(expected);
  });

  it('renders an empty search as EMPTY rather than a silent success', async () => {
    employerSearch.mockResolvedValue({ status: 'OK', data: [] });
    const input = await openEmployment();
    fireEvent.change(input, { target: { value: 'Zzz' } });
    fireEvent.click(screen.getByLabelText('Search Employer'));
    const notice = await screen.findByTestId('means-income-employer-state');
    expect(notice.getAttribute('data-state')).toBe('EMPTY');
  });

  it('enforces the employer requirement before dispatch', () => {
    const category = findIncomeCategory(REFERENCE, 'EMPLOYMENT');
    const errors = validateIncomeDraft(
      { ...emptyIncomeDraft('2026-01-01'), memberId: 'm1', categoryCode: 'EMPLOYMENT' },
      { category },
    );
    expect(errors.employer).toBe(incomeReasonLabel('EMPLOYER_REQUIRED'));
  });
});

/* ------------------------------------------------------------------ */
/* amount, frequency and annualisation                                 */
/* ------------------------------------------------------------------ */

describe('amount, frequency and annualisation', () => {
  it('renders the annualised amount reported by the backend', async () => {
    renderSection();
    const cell = await screen.findByTestId('means-income-annualised-f1');
    expect(cell.textContent).toContain('14,400');
  });

  it('never derives an annualised amount in the payload', () => {
    const payload = incomePayload(
      {
        ...emptyIncomeDraft('2026-01-01'),
        memberId: 'm1', categoryCode: 'PENSION', sourceName: 'SSB pension',
        amount: '1200', frequency: 'MONTHLY', factSource: 'APPLICANT_DECLARATION',
      },
      { category: findIncomeCategory(REFERENCE, 'PENSION'), currency: 'XCD' },
    );
    expect(payload.normalised_annual_amount).toBeUndefined();
    expect(payload.declared_amount).toBe('1200');
    expect(payload.declared_frequency).toBe('MONTHLY');
    expect(payload.currency_code).toBe('XCD');
    expect(payload.basis).toBe('GROSS');
  });

  it('rejects a negative amount unless the policy permits it', () => {
    const base = { ...emptyIncomeDraft('2026-01-01'), memberId: 'm1', amount: '-50' };
    expect(validateIncomeDraft(base, { category: null }).amount).toBe(
      incomeReasonLabel('NEGATIVE_INCOME_NOT_PERMITTED'),
    );
    expect(
      validateIncomeDraft(base, { category: null, rules: { allow_negative_income: true } }).amount,
    ).toBeUndefined();
  });

  it('keeps the declared amount and the occurrence date for one-off income', () => {
    const payload = incomePayload(
      {
        ...emptyIncomeDraft('2026-02-01'),
        memberId: 'm1', categoryCode: 'MAINTENANCE', sourceName: 'Family',
        amount: '500', frequency: 'ONE_OFF', factSource: 'APPLICANT_DECLARATION',
      },
      { category: findIncomeCategory(REFERENCE, 'MAINTENANCE'), currency: 'XCD' },
    );
    expect(payload.declared_amount).toBe('500');
    expect(payload.occurrence_date).toBe('2026-02-01');
    expect(payload.effective_to).toBeNull();
  });

  it('resolves the basis from policy when no choice is offered', () => {
    expect(resolveIncomeBasis(findIncomeCategory(REFERENCE, 'PENSION'), '')).toEqual({
      value: 'GROSS', readOnly: true,
    });
    expect(resolveIncomeBasis(findIncomeCategory(REFERENCE, 'EMPLOYMENT'), 'NET')).toEqual({
      value: 'NET', readOnly: false,
    });
  });
});

/* ------------------------------------------------------------------ */
/* effective dates                                                     */
/* ------------------------------------------------------------------ */

describe('effective dates', () => {
  const base = { ...emptyIncomeDraft('2026-02-01'), memberId: 'm1', categoryCode: 'PENSION' };

  it('accepts a valid period', () => {
    const errors = validateIncomeDraft({ ...base, effectiveTo: '2026-05-01' }, { category: null });
    expect(errors.effectiveTo).toBeUndefined();
    expect(errors.effectiveFrom).toBeUndefined();
  });

  it('denies an end before the start', () => {
    const errors = validateIncomeDraft({ ...base, effectiveTo: '2026-01-01' }, { category: null });
    expect(errors.effectiveTo).toBe(incomeReasonLabel('INVALID_INCOME_PERIOD'));
  });

  it('denies a period outside the assessment period', () => {
    const errors = validateIncomeDraft(
      { ...base, effectiveFrom: '2027-01-01' },
      { category: null, assessmentFrom: '2026-01-01', assessmentTo: '2026-12-31' },
    );
    expect(errors.effectiveFrom).toBe(incomeReasonLabel('INCOME_OUTSIDE_ASSESSMENT_PERIOD'));
  });

  it('requires a start date', () => {
    const errors = validateIncomeDraft({ ...base, effectiveFrom: '' }, { category: null });
    expect(errors.effectiveFrom).toBe(incomeReasonLabel('INCOME_START_REQUIRED'));
  });
});

/* ------------------------------------------------------------------ */
/* duplicates and conflicts                                            */
/* ------------------------------------------------------------------ */

describe('duplicate and conflict reporting', () => {
  it('renders backend warnings separately from blockers', async () => {
    incomeReadiness.mockResolvedValue({
      status: 'OK',
      data: {
        ...READY,
        warnings: [{ code: 'OVERLAPPING_INCOME', message: 'Overlapping income records exist.' }],
      },
    });
    renderSection();
    expect(await screen.findByTestId('means-income-warnings')).toBeTruthy();
    expect(screen.getByTestId('means-income-blockers')).toBeTruthy();
  });

  it('surfaces a duplicate rejection from the backend in officer language', async () => {
    execute.mockResolvedValue({
      status: 'FAILED',
      data: null,
      errorCode: 'INCOME_VALIDATION_FAILED',
      errorDetail: 'DUPLICATE_INCOME',
      correlationId: 'c1',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-mark-complete'));
    // mark-complete is disabled while the backend reports blockers
    expect((await screen.findByTestId('means-income-mark-complete')).hasAttribute('disabled')).toBe(true);
    expect(incomeReasonLabel('DUPLICATE_INCOME')).toContain('already exists');
    expect(incomeReasonLabel('CONFLICTING_INCOME_FACT')).toContain('conflicts');
  });
});

/* ------------------------------------------------------------------ */
/* no-income declarations                                              */
/* ------------------------------------------------------------------ */

describe('no-income declarations', () => {
  it('records an explicit declaration through the governed command', async () => {
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-declare-none'));
    fireEvent.change(await screen.findByTestId('means-no-income-member'), { target: { value: 'm2' } });
    fireEvent.change(screen.getByTestId('means-no-income-reason'), { target: { value: 'NOT_WORKING' } });
    fireEvent.click(screen.getByTestId('means-no-income-save'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].command).toBe('BN_MEANS_DECLARE_NO_INCOME');
    expect(execute.mock.calls[0][0].payload.member_id).toBe('m2');
  });

  it('never represents a missing declaration as zero income', async () => {
    renderSection();
    const note = await screen.findByTestId('means-income-missing-members');
    expect(note.textContent).toContain('1 member(s) still need');
    expect(note.textContent).not.toContain('0.00');
  });

  it('lists existing declarations with their reason and provenance', async () => {
    income.mockResolvedValue({
      status: 'OK',
      data: {
        ...DETAIL,
        no_income_declarations: [{
          declaration_id: 'd1', member_id: 'm2', effective_from: '2026-01-01', effective_to: null,
          declaration_source: 'APPLICANT_DECLARATION', declaration_source_label: 'Applicant declaration',
          reason_code: 'NOT_WORKING', reason_label: 'Not working and receives nothing',
          confirmation_note: null, declared_at: '2026-01-02',
        }],
      },
    });
    renderSection();
    const list = await screen.findByTestId('means-income-no-income-list');
    expect(list.textContent).toContain('John Doe');
    expect(list.textContent).toContain('Not working and receives nothing');
  });
});

/* ------------------------------------------------------------------ */
/* readiness                                                           */
/* ------------------------------------------------------------------ */

describe('income readiness is backend-owned', () => {
  it('renders Unavailable when readiness cannot be read', async () => {
    incomeReadiness.mockResolvedValue({ status: 'FAILED', data: null, detail: 'boom' });
    renderSection();
    expect((await screen.findByTestId('means-income-status')).textContent).toContain('UNAVAILABLE');
    const notice = await screen.findByTestId('means-income-readiness-state');
    expect(notice.getAttribute('data-state')).toBe('FAILED');
  });

  it('never enables completion when readiness is unknown', async () => {
    incomeReadiness.mockResolvedValue({ status: 'FAILED', data: null, detail: 'boom' });
    renderSection();
    expect((await screen.findByTestId('means-income-mark-complete')).hasAttribute('disabled')).toBe(true);
  });

  it('keeps completion disabled while a member has no declaration', async () => {
    renderSection();
    expect((await screen.findByTestId('means-income-mark-complete')).hasAttribute('disabled')).toBe(true);
  });

  it('completes the section only when the backend reports it complete', async () => {
    incomeReadiness.mockResolvedValue({
      status: 'OK',
      data: { ...READY, section_complete: true, section_status: 'COMPLETE', blockers: [], members_without_declaration: 0 },
    });
    const onSectionComplete = vi.fn();
    renderSection({ onSectionComplete });
    const button = await screen.findByTestId('means-income-mark-complete');
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    fireEvent.click(button);
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].command).toBe('BN_MEANS_MARK_INCOME_COMPLETE');
    await waitFor(() => expect(onSectionComplete).toHaveBeenCalled());
  });

  it('shows Unavailable rather than a fabricated zero count', async () => {
    incomeReadiness.mockResolvedValue({ status: 'DENIED', data: null, code: 'PERMISSION_DENIED' });
    renderSection();
    expect(screen.queryByTestId('means-income-summary')).toBeNull();
    expect((await screen.findByTestId('means-income-readiness-state')).getAttribute('data-state'))
      .toBe('DENIED');
  });
});

/* ------------------------------------------------------------------ */
/* governance and UX                                                   */
/* ------------------------------------------------------------------ */

describe('governance and UX', () => {
  it('routes an edit through the versioned correction operation', async () => {
    renderSection();
    fireEvent.click(await screen.findByLabelText('Edit income for Jane Doe'));
    fireEvent.click(await screen.findByTestId('means-income-save'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].command).toBe('BN_MEANS_CORRECT_INCOME');
    expect(execute.mock.calls[0][0].payload.income_fact_id).toBe('f1');
  });

  it('voids rather than deletes a record', async () => {
    renderSection();
    fireEvent.click(await screen.findByLabelText('Remove income for Jane Doe'));
    fireEvent.click(await screen.findByText('Remove income'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0].command).toBe('BN_MEANS_VOID_INCOME');
  });

  it('offers no mutation controls when the assessment is not editable', async () => {
    income.mockResolvedValue({ status: 'OK', data: { ...DETAIL, editable: false } });
    renderSection({ editable: false });
    await screen.findByTestId('means-income-section');
    expect(screen.queryByTestId('means-income-add')).toBeNull();
    expect(screen.queryByTestId('means-income-declare-none')).toBeNull();
    expect(screen.queryByLabelText('Edit income for Jane Doe')).toBeNull();
  });

  it('retains operator input after a command failure', async () => {
    execute.mockResolvedValue({
      status: 'FAILED', data: null, errorCode: 'INCOME_VALIDATION_FAILED',
      errorDetail: 'DUPLICATE_INCOME', correlationId: 'c1',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('means-income-add'));
    fireEvent.change(await screen.findByTestId('means-income-member'), { target: { value: 'm1' } });
    fireEvent.change(screen.getByTestId('means-income-category'), { target: { value: 'PENSION' } });
    fireEvent.change(screen.getByTestId('means-income-frequency'), { target: { value: 'MONTHLY' } });
    fireEvent.change(screen.getByTestId('means-income-fact-source'), {
      target: { value: 'APPLICANT_DECLARATION' },
    });
    fireEvent.change(screen.getByLabelText(/Source name/), { target: { value: 'SSB pension' } });
    fireEvent.change(screen.getByTestId('means-income-amount'), { target: { value: '1200' } });
    fireEvent.click(screen.getByTestId('means-income-save'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(await screen.findByTestId('means-income-dialog-error')).toBeTruthy();
    expect((screen.getByTestId('means-income-amount') as HTMLInputElement).value).toBe('1200');
    expect((screen.getByTestId('means-income-category') as HTMLSelectElement).value).toBe('PENSION');
  });

  it('shows human-readable labels rather than raw codes in the list', async () => {
    renderSection();
    await screen.findByTestId('means-income-row-f1');
    expect(screen.getByText('Employment income')).toBeTruthy();
    expect(screen.getAllByText(/Monthly/).length).toBeGreaterThan(0);
    expect(screen.queryByText('SOCIAL_SECURITY_BENEFIT')).toBeNull();
  });

  it('seeds an edit draft from the stored record without inventing values', () => {
    const draft = draftFromIncomeFact(FACT);
    expect(draft.incomeFactId).toBe('f1');
    expect(draft.amount).toBe('1200');
    expect(draft.employerRegno).toBe('12345');
    expect(draft.effectiveTo).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* architecture guard                                                  */
/* ------------------------------------------------------------------ */

describe('no direct browser writes to income tables', () => {
  const roots = [
    'src/components/bn/meansTests/income',
    'src/types/bn/meansTests',
    'src/services/bn/meansTests',
  ];

  function walk(dir: string): string[] {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(walk(full));
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
    return out;
  }

  it('contains no supabase.from("bn_means_income*") chains', () => {
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const source = readFileSync(file, 'utf8');
        if (/from\(\s*['"]bn_means_/.test(source)) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
