/**
 * MEANS-TEST EPIC 1 — assessment initiation.
 *
 * Proves: the wizard asks for context rather than identifiers, the
 * initiation decision always comes from the backend check, blockers land
 * on the step that can fix them, currency and policy version are derived
 * rather than typed, prefilled context is carried from other workspaces,
 * and creation is impossible while the backend says it is.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const personSearch = vi.fn();
const personContext = vi.fn();
const programmes = vi.fn();
const initiationCheck = vi.fn();
const execute = vi.fn();

vi.mock('@/services/bn/meansTests/meansInitiationService', () => ({
  meansInitiationService: {
    personSearch: (...a: unknown[]) => personSearch(...a),
    personContext: (...a: unknown[]) => personContext(...a),
    programmes: (...a: unknown[]) => programmes(...a),
    initiationCheck: (...a: unknown[]) => initiationCheck(...a),
  },
}));
vi.mock('@/services/bn/meansTests/meansCommandService', () => ({
  meansCommandService: { execute: (...a: unknown[]) => execute(...a) },
}));

import { BnMeansInitiationWizard } from '@/components/bn/meansTests/initiation/BnMeansInitiationWizard';
import { personIdFromSsn } from '@/components/bn/meansTests/initiation/MeansStartAssessmentAction';
import {
  MEANS_ENTRY_CONTEXTS,
  blockersForStep,
  buildInitiationContext,
  emptyInitiationDraft,
  firstIncompleteStep,
  reasonCodesForContext,
  stepComplete,
  stepForReasonCode,
  visibleInitiationSteps,
  type BnMeansInitiationCheck,
} from '@/types/bn/meansTests/meansInitiation';
import { meansReferenceDataService } from '@/services/bn/meansTests/meansReferenceDataService';

const POLICY = {
  state: 'RESOLVED' as const,
  policy_id: 'p1',
  policy_code: 'MT-SKN-NCP',
  policy_name: 'Non-Contributory Pension means test',
  policy_version_id: 'v1',
  version_label: '2024.1',
  effective_from: '2024-01-01',
  effective_to: null,
  currency_code: 'XCD',
  authority_reference: 'SSB Board resolution 2024-03',
  validity_months: 12,
};

function okCheck(overrides: Partial<BnMeansInitiationCheck> = {}): BnMeansInitiationCheck {
  return {
    can_create: true,
    reason_codes: [],
    blockers: [],
    warnings: [],
    existing_open_assessments: [],
    existing_active_assessment: null,
    overlapping_assessments: [],
    reassessment_due: null,
    policy_resolution: POLICY,
    ...overrides,
  };
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  programmes.mockResolvedValue({
    status: 'OK',
    data: [{ value: 'NCP', label: 'Non-Contributory Pension', description: null, is_active: true }],
  });
  personSearch.mockResolvedValue({
    status: 'OK',
    data: [
      {
        person_id: 123456,
        full_name: 'Marcia Joseph',
        masked_identifier: '***456',
        date_of_birth: '1958-02-14',
        address_summary: 'Basseterre',
        person_status: 'ACTIVE',
        is_deceased: false,
        open_claim_count: 1,
        active_award_count: 0,
      },
    ],
  });
  personContext.mockResolvedValue({
    status: 'OK',
    data: {
      person: {
        person_id: 123456,
        full_name: 'Marcia Joseph',
        masked_identifier: '***456',
        date_of_birth: '1958-02-14',
        address_summary: 'Basseterre',
        person_status: 'ACTIVE',
        is_deceased: false,
      },
      claims: [
        {
          claim_id: 'c1',
          claim_reference: 'CLM-2026-001',
          benefit_programme: 'NCP',
          programme_label: 'Non-Contributory Pension',
          claim_status: 'SUBMITTED',
          claim_date: '2026-01-05',
          effective_date: '2026-01-05',
          existing_assessment_reference: null,
        },
      ],
      awards: [],
      assessments: [],
    },
  });
  initiationCheck.mockResolvedValue({ status: 'OK', data: okCheck() });
  execute.mockResolvedValue({ status: 'EXECUTED', assessmentId: 'a1' });
});

/* ------------------------------------------------------------------ */
/* 1. initiation contract                                              */
/* ------------------------------------------------------------------ */

describe('MEANS-TEST EPIC 1 · initiation contract', () => {
  it('offers four entry contexts, each with its own permitted reasons', () => {
    expect(MEANS_ENTRY_CONTEXTS.map((c) => c.code)).toEqual([
      'NEW_CLAIM_ASSESSMENT', 'EXISTING_CLAIM_REVIEW', 'EXISTING_AWARD_REVIEW', 'STANDALONE_ASSESSMENT',
    ]);
    expect(reasonCodesForContext('NEW_CLAIM_ASSESSMENT')).toContain('NEW_CLAIM');
    expect(reasonCodesForContext('EXISTING_AWARD_REVIEW')).not.toContain('NEW_CLAIM');
  });

  it('hides the claim/award step for a standalone assessment', () => {
    const standalone = emptyInitiationDraft({ entryContext: 'STANDALONE_ASSESSMENT' });
    expect(visibleInitiationSteps(standalone).map((s) => s.step)).not.toContain('LINK');
    const claim = emptyInitiationDraft({ entryContext: 'NEW_CLAIM_ASSESSMENT' });
    expect(visibleInitiationSteps(claim).map((s) => s.step)).toContain('LINK');
  });

  it('never carries an award into a claim context, or a claim into an award context', () => {
    const claimDraft = emptyInitiationDraft({ entryContext: 'NEW_CLAIM_ASSESSMENT', claimId: 'c1', awardId: 'w1' });
    expect(buildInitiationContext(claimDraft).award_id).toBeNull();
    const awardDraft = emptyInitiationDraft({ entryContext: 'EXISTING_AWARD_REVIEW', claimId: 'c1', awardId: 'w1' });
    expect(buildInitiationContext(awardDraft).claim_id).toBeNull();
  });

  it('sends no currency or policy version — both are derived by the backend', () => {
    const ctx = buildInitiationContext(emptyInitiationDraft({ entryContext: 'STANDALONE_ASSESSMENT' }));
    expect(Object.keys(ctx)).not.toContain('currency_code');
    expect(Object.keys(ctx)).not.toContain('policy_version_id');
  });

  it('routes every backend reason code to the step that can resolve it', () => {
    expect(stepForReasonCode('PERSON_REQUIRED')).toBe('PERSON');
    expect(stepForReasonCode('CLAIM_REQUIRED')).toBe('LINK');
    expect(stepForReasonCode('CONTEXT_PERSON_MISMATCH')).toBe('LINK');
    expect(stepForReasonCode('EFFECTIVE_DATE_CONFLICT')).toBe('DETAILS');
    expect(stepForReasonCode('NO_EFFECTIVE_POLICY')).toBe('POLICY');
    expect(stepForReasonCode('OPEN_ASSESSMENT_EXISTS')).toBe('REVIEW');
    expect(stepForReasonCode('SOMETHING_NEW')).toBe('REVIEW');
  });

  it('groups blockers under their owning step', () => {
    const check = okCheck({
      can_create: false,
      blockers: [
        { code: 'PERSON_REQUIRED', message: 'Select the person to be assessed.' },
        { code: 'NO_EFFECTIVE_POLICY', message: 'No policy in force.' },
      ],
    });
    expect(blockersForStep(check, 'PERSON')).toHaveLength(1);
    expect(blockersForStep(check, 'POLICY')).toHaveLength(1);
    expect(blockersForStep(check, 'DETAILS')).toHaveLength(0);
  });

  it('treats policy resolution and creation as backend decisions only', () => {
    const draft = emptyInitiationDraft({
      entryContext: 'STANDALONE_ASSESSMENT',
      personId: 1,
      benefitProgramme: 'NCP',
      assessmentReason: 'INITIAL_ASSESSMENT',
      effectiveFrom: '2026-01-01',
    });
    expect(stepComplete('POLICY', draft, null)).toBe(false);
    expect(stepComplete('REVIEW', draft, null)).toBe(false);
    expect(stepComplete('POLICY', draft, okCheck())).toBe(true);
    expect(stepComplete('REVIEW', draft, okCheck({ can_create: false }))).toBe(false);
  });

  it('resumes a prefilled draft at the first incomplete step', () => {
    const draft = emptyInitiationDraft({
      entryContext: 'NEW_CLAIM_ASSESSMENT',
      personId: 123456,
      claimId: 'c1',
    });
    expect(firstIncompleteStep(draft)).toBe('DETAILS');
  });

  it('derives a person id from a formatted social security number', () => {
    expect(personIdFromSsn('123-456')).toBe(123456);
    expect(personIdFromSsn(null)).toBeNull();
    expect(personIdFromSsn('   ')).toBeNull();
  });

  it('scopes the governed reason list to the chosen entry context', async () => {
    const set = await meansReferenceDataService.options('ASSESSMENT_REASON', {
      entryContext: 'EXISTING_AWARD_REVIEW',
    });
    expect(set.state).toBe('SUCCESS');
    expect(set.options.map((o) => o.value)).toContain('AWARD_REVIEW');
    expect(set.options.map((o) => o.value)).not.toContain('NEW_CLAIM');
  });

  it('reports a denied programme read as denied, never as an empty list', async () => {
    programmes.mockResolvedValueOnce({ status: 'DENIED', data: null, code: 'PERMISSION_DENIED' });
    const set = await meansReferenceDataService.options('BENEFIT_PROGRAMME');
    expect(set.state).toBe('DENIED');
    expect(set.options).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 2. the guided wizard                                                */
/* ------------------------------------------------------------------ */

describe('MEANS-TEST EPIC 1 · guided initiation wizard', () => {
  it('opens on the context step and asks no identifier questions', async () => {
    wrap(<BnMeansInitiationWizard open onOpenChange={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByTestId('means-step-context-panel')).toBeInTheDocument();
    expect(screen.queryByLabelText(/person id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/claim id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/policy version/i)).not.toBeInTheDocument();
  });

  it('searches for a person and shows their masked identifier, never a raw one', async () => {
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        prefill={{ entryContext: 'STANDALONE_ASSESSMENT' }}
      />,
    );
    fireEvent.click(await screen.findByTestId('means-step-PERSON'));
    fireEvent.change(screen.getByLabelText(/person to be assessed/i), { target: { value: 'Joseph' } });
    fireEvent.click(screen.getByRole('button', { name: /search person to be assessed/i }));
    const hit = await screen.findByText('Marcia Joseph');
    expect(screen.getByText(/\*\*\*456/)).toBeInTheDocument();
    fireEvent.click(hit);
    expect(await screen.findByTestId('means-person-summary')).toBeInTheDocument();
    expect(personContext).toHaveBeenCalledWith(123456);
  });

  it('carries prefilled context from a claim workspace into the check', async () => {
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        prefill={{
          entryContext: 'NEW_CLAIM_ASSESSMENT',
          personId: 123456,
          claimId: 'c1',
          benefitProgramme: 'NCP',
          effectiveFrom: '2026-01-05',
          originSurface: 'CLAIM_WORKSPACE',
        }}
      />,
    );
    await waitFor(() => expect(initiationCheck).toHaveBeenCalled());
    expect(initiationCheck.mock.calls[0][0]).toMatchObject({
      entry_context: 'NEW_CLAIM_ASSESSMENT',
      person_id: 123456,
      claim_id: 'c1',
      award_id: null,
      benefit_programme: 'NCP',
      effective_from: '2026-01-05',
    });
  });

  it('shows the resolved policy version and currency without asking for them', async () => {
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        prefill={{
          entryContext: 'STANDALONE_ASSESSMENT', personId: 123456,
          benefitProgramme: 'NCP', effectiveFrom: '2026-01-05',
        }}
      />,
    );
    fireEvent.click(await screen.findByTestId('means-step-POLICY'));
    expect(await screen.findByTestId('means-policy-resolved')).toBeInTheDocument();
    expect(screen.getByText('2024.1')).toBeInTheDocument();
    expect(screen.getByText('XCD')).toBeInTheDocument();
  });

  it('refuses creation and explains why when the backend blocks it', async () => {
    initiationCheck.mockResolvedValue({
      status: 'OK',
      data: okCheck({
        can_create: false,
        blockers: [{ code: 'OPEN_ASSESSMENT_EXISTS', message: 'An assessment is already open for this person and programme.' }],
        existing_open_assessments: [
          {
            assessment_id: 'a9', assessment_reference: 'MT-2026-009', benefit_programme: 'NCP',
            assessment_reason: 'NEW_CLAIM', status: 'DRAFT', result: null,
            effective_from: '2026-01-01', valid_until: null, reassessment_due: null,
            claim_id: null, award_id: null,
          },
        ],
      }),
    });
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        prefill={{
          entryContext: 'STANDALONE_ASSESSMENT', personId: 123456,
          benefitProgramme: 'NCP', effectiveFrom: '2026-01-05',
        }}
      />,
    );
    fireEvent.click(await screen.findByTestId('means-step-REVIEW'));
    expect(await screen.findByTestId('means-step-blockers-REVIEW')).toHaveTextContent(/already open/i);
    expect(screen.getByTestId('means-existing-assessments')).toHaveTextContent('MT-2026-009');
    expect(screen.getByTestId('means-initiation-create')).toBeDisabled();
  });

  it('treats an unavailable initiation check as blocking, not as permission to create', async () => {
    initiationCheck.mockResolvedValue({ status: 'FAILED', data: null, code: 'QUERY_FAILED', detail: 'boom' });
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={vi.fn()}
        prefill={{
          entryContext: 'STANDALONE_ASSESSMENT', personId: 123456,
          benefitProgramme: 'NCP', effectiveFrom: '2026-01-05',
        }}
      />,
    );
    expect(await screen.findByTestId('means-initiation-check-unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('means-step-REVIEW'));
    expect(screen.getByTestId('means-initiation-create')).toBeDisabled();
  });

  it('creates through the governed command, recording the originating surface', async () => {
    const onCreated = vi.fn();
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        prefill={{
          entryContext: 'STANDALONE_ASSESSMENT', personId: 123456,
          benefitProgramme: 'NCP', assessmentReason: 'INITIAL_ASSESSMENT',
          effectiveFrom: '2026-01-05', originSurface: 'AWARD_360',
        }}
      />,
    );
    fireEvent.click(await screen.findByTestId('means-step-REVIEW'));
    await waitFor(() => expect(screen.getByTestId('means-initiation-create')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('means-initiation-create'));
    await waitFor(() => expect(execute).toHaveBeenCalled());
    expect(execute.mock.calls[0][0]).toMatchObject({
      command: 'BN_MEANS_CREATE_ASSESSMENT',
      payload: expect.objectContaining({
        entry_context: 'STANDALONE_ASSESSMENT',
        person_id: 123456,
        source_entry_point: 'AWARD_360',
      }),
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('a1'));
  });

  it('keeps the officer on the wizard and explains a rejected command', async () => {
    execute.mockResolvedValue({
      status: 'FAILED', errorCode: 'DUPLICATE_OPEN_ASSESSMENT',
      errorDetail: 'An assessment is already open for this person and programme.',
    });
    const onCreated = vi.fn();
    wrap(
      <BnMeansInitiationWizard
        open
        onOpenChange={vi.fn()}
        onCreated={onCreated}
        prefill={{
          entryContext: 'STANDALONE_ASSESSMENT', personId: 123456,
          benefitProgramme: 'NCP', effectiveFrom: '2026-01-05',
        }}
      />,
    );
    fireEvent.click(await screen.findByTestId('means-step-REVIEW'));
    await waitFor(() => expect(screen.getByTestId('means-initiation-create')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('means-initiation-create'));
    expect(await screen.findByTestId('means-initiation-command-error')).toHaveTextContent(/already open/i);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
