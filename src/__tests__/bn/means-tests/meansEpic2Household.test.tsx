/**
 * MEANS-TEST EPIC 2 — household composition intake.
 *
 * Guards the contract that matters: completeness is backend-owned, a
 * declared member never receives a fabricated person identifier, and
 * blockers are shown in officer language.
 */
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const household = vi.fn();
const householdReadiness = vi.fn();
const householdCandidates = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansQueryService', () => ({
  meansQueryService: {
    household: (...a: unknown[]) => household(...a),
    householdReadiness: (...a: unknown[]) => householdReadiness(...a),
    householdCandidates: (...a: unknown[]) => householdCandidates(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import BnMeansHouseholdSection from '@/components/bn/meansTests/household/BnMeansHouseholdSection';
import {
  emptyHouseholdDraft,
  householdPayload,
  validateHouseholdDraft,
} from '@/types/bn/meansTests/meansHousehold';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const MEMBER = {
  member_id: 'm1',
  person_id: 42,
  is_self: true,
  display_name: 'Jane Doe',
  masked_identifier: '***-**-1234',
  date_of_birth: '1980-01-01',
  source_kind: 'KNOWN_PERSON' as const,
  relationship_code: 'SELF',
  relationship_label: 'Self (assessed person)',
  member_from: '2026-01-01',
  member_to: null,
  is_current: true,
  shares_residence: true,
  residence_inclusion_reason: null,
  residence_inclusion_reason_label: null,
  dependency_decision: 'NOT_DEPENDANT' as const,
  dependency_decision_label: 'Not dependant',
  dependency_basis: null,
  dependency_basis_label: null,
  fact_source: 'PERSON_RECORD',
  fact_source_label: 'Person record',
  verification_status: 'UNVERIFIED',
  evidence_status: 'NONE',
  member_notes: null,
  member_version: 1,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const READY = {
  assessment_id: 'a1',
  section_complete: false,
  section_status: 'IN_PROGRESS' as const,
  household_size: 1,
  current_members: 1,
  total_members: 1,
  current_dependants: 0,
  members_requiring_evidence: 0,
  missing_requirements: [],
  warnings: [],
  blockers: [{ code: 'DEPENDENCY_BASIS_REQUIRED', message: 'A dependency basis is required for John Doe.' }],
  reason_codes: ['DEPENDENCY_BASIS_REQUIRED'],
};

function renderSection(overrides: Record<string, unknown> = {}) {
  return wrap(
    <BnMeansHouseholdSection
      assessmentId="a1"
      assessmentFrom="2026-01-01"
      assessmentTo={null}
      assessedPersonId={42}
      editable
      availableActions={['BN_MEANS_ADD_HOUSEHOLD_MEMBER', 'BN_MEANS_MARK_HOUSEHOLD_COMPLETE']}
      {...overrides}
    />,
  );
}

describe('EPIC 2 — household draft contract', () => {
  it('never fabricates a person identifier for a declared member', () => {
    const draft = {
      ...emptyHouseholdDraft('2026-01-01'),
      sourceKind: 'DECLARED' as const,
      declaredFullName: 'John Doe',
      relationshipCode: 'CHILD',
      dependencyDecision: 'DEPENDANT' as const,
      dependencyBasis: 'AGE',
      factSource: 'APPLICANT_DECLARATION',
    };
    const payload = householdPayload(draft);
    expect(payload.person_id).toBeUndefined();
    expect(payload.declared_person).toEqual({ full_name: 'John Doe', date_of_birth: null });
  });

  it('requires an explicit dependency decision and a basis for a dependant', () => {
    const base = { ...emptyHouseholdDraft('2026-01-01'), personId: 7, relationshipCode: 'CHILD', factSource: 'PERSON_RECORD' };
    expect(validateHouseholdDraft(base, {}).dependencyDecision).toBeTruthy();
    const dependant = { ...base, dependencyDecision: 'DEPENDANT' as const };
    expect(validateHouseholdDraft(dependant, {}).dependencyBasis).toBeTruthy();
    const complete = { ...dependant, dependencyBasis: 'AGE' };
    expect(validateHouseholdDraft(complete, {})).toEqual({});
  });

  it('rejects a membership that ends before it starts', () => {
    const draft = {
      ...emptyHouseholdDraft('2026-06-01'),
      personId: 7,
      relationshipCode: 'CHILD',
      factSource: 'PERSON_RECORD',
      dependencyDecision: 'NOT_DEPENDANT' as const,
      memberTo: '2026-02-01',
    };
    expect(validateHouseholdDraft(draft, {}).memberTo).toContain('cannot be before');
  });

  it('requires an inclusion reason when the member does not share the residence', () => {
    const draft = {
      ...emptyHouseholdDraft('2026-01-01'),
      personId: 7,
      relationshipCode: 'CHILD',
      factSource: 'PERSON_RECORD',
      dependencyDecision: 'NOT_DEPENDANT' as const,
      sharesResidence: false,
    };
    expect(validateHouseholdDraft(draft, {}).residenceInclusionReason).toBeTruthy();
  });
});

describe('EPIC 2 — household section', () => {
  beforeEach(() => {
    [household, householdReadiness, householdCandidates, execute].forEach((m) => m.mockReset());
    householdCandidates.mockResolvedValue({ status: 'OK', data: [] });
  });

  it('shows backend blockers and refuses local completion', async () => {
    household.mockResolvedValue({
      status: 'OK',
      data: { assessment_id: 'a1', editable: true, household_rules: {}, members: [MEMBER] },
    });
    householdReadiness.mockResolvedValue({ status: 'OK', data: READY });

    renderSection();

    expect(await screen.findByTestId('means-household-blockers')).toHaveTextContent(
      'A dependency basis is required for John Doe.',
    );
    expect(screen.getByTestId('means-household-mark-complete')).toBeDisabled();
  });

  it('enables completion only when the backend reports the section complete', async () => {
    household.mockResolvedValue({
      status: 'OK',
      data: { assessment_id: 'a1', editable: true, household_rules: {}, members: [MEMBER] },
    });
    householdReadiness.mockResolvedValue({
      status: 'OK',
      data: { ...READY, section_complete: true, section_status: 'COMPLETE', blockers: [] },
    });
    execute.mockResolvedValue({ status: 'EXECUTED', data: {}, correlationId: 'c1' });

    renderSection();

    const complete = await screen.findByTestId('means-household-mark-complete');
    await waitFor(() => expect(complete).toBeEnabled());
    fireEvent.click(complete);
    await waitFor(() =>
      expect(execute).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'BN_MEANS_MARK_HOUSEHOLD_COMPLETE', assessmentId: 'a1' }),
      ),
    );
  });

  it('states an explicit failure instead of an empty household', async () => {
    household.mockResolvedValue({ status: 'FAILED', data: null, detail: 'connection reset' });
    householdReadiness.mockResolvedValue({ status: 'FAILED', data: null });

    renderSection();

    expect(await screen.findByTestId('means-household-section-state')).toHaveTextContent('connection reset');
  });

  it('states an explicit denial rather than an editable empty section', async () => {
    household.mockResolvedValue({ status: 'DENIED', data: null, detail: 'not permitted' });
    householdReadiness.mockResolvedValue({ status: 'DENIED', data: null });

    renderSection();

    const notice = await screen.findByTestId('means-household-section-state');
    expect(notice).toHaveAttribute('data-state', 'DENIED');
  });

  it('hides editing affordances when the backend says the assessment is not editable', async () => {
    household.mockResolvedValue({
      status: 'OK',
      data: { assessment_id: 'a1', editable: false, household_rules: {}, members: [MEMBER] },
    });
    householdReadiness.mockResolvedValue({ status: 'OK', data: { ...READY, blockers: [] } });

    renderSection({ editable: false });

    await screen.findByTestId('means-household-section');
    expect(screen.queryByTestId('means-household-add')).not.toBeInTheDocument();
  });

  it('guides the officer when no members are recorded yet', async () => {
    household.mockResolvedValue({
      status: 'OK',
      data: { assessment_id: 'a1', editable: true, household_rules: {}, members: [] },
    });
    householdReadiness.mockResolvedValue({
      status: 'OK',
      data: { ...READY, household_size: 0, current_members: 0, total_members: 0, blockers: [] },
    });

    renderSection();

    expect(await screen.findByTestId('means-household-empty')).toHaveTextContent(
      'No household members recorded yet',
    );
  });
});
