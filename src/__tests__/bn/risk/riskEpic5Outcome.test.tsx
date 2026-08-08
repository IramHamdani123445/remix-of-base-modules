/**
 * BN Risk / Fraud — EPIC 5 certification suite.
 *
 * Outcome recording, completion, closure and exceptional reopening. Every test
 * proves a governed property of the delivered Epic 5 boundary:
 *
 *  - readiness, blockers, catalogue and available actions come from the
 *    backend; the browser never derives them
 *  - a failed readiness read fails closed and never offers an action
 *  - an outcome is never inferred from a score, band, recommendation or control
 *  - a recorded outcome is immutable; a correction supersedes and the previous
 *    outcome stays visible with its author
 *  - closure needs a current outcome and reopening is exceptional, justified
 *    and audited
 *  - reopening reverses nothing in an owning domain
 *  - every mutation goes through `bn_risk_outcome_command_v1`; Risk never
 *    writes a table directly from the browser
 *  - the operational queue is backend-bucketed and privacy-safe
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import {
  findingClassificationLabel,
  type BnRiskClosureReadiness,
  type BnRiskOutcomeQueue,
  type BnRiskOutcomeReadinessV1,
} from '@/types/bn/risk/riskOutcome';

/* ------------------------------------------------------------------ */
/* Supabase boundary mock — the only route Epic 5 may take            */
/* ------------------------------------------------------------------ */

const rpc = vi.fn();
const from = vi.fn((..._args: unknown[]) => {
  throw new Error('Epic 5 must never touch a table directly from the browser');
});
const getUser = vi.fn(async () => ({ data: { user: { id: 'officer-1', email: 'o@ssb.kn' } } }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(args[0], args[1]),
    from: (...args: unknown[]) => from(args[0]),
    auth: { getUser: () => getUser() },
  },
}));

import { BnRiskOutcomeSection } from '@/components/bn/risk/BnRiskOutcomeSection';
import { BnRiskClosureSection } from '@/components/bn/risk/BnRiskClosureSection';
import { BnRiskOutcomeQueue as OutcomeQueueView } from '@/components/bn/risk/BnRiskOutcomeQueue';
import { riskOutcomeService } from '@/services/bn/risk/riskOutcomeService';

const SRC = path.resolve(__dirname, '../../../');
const ROOT = path.resolve(SRC, '..');
const readSrc = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
/** The live Epic 5 backend, as delivered. */
const BACKEND_SQL = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
  .filter((sql) => sql.includes('bn_risk_outcome'))
  .join('\n');

const EPIC5_SOURCES = [
  'types/bn/risk/riskOutcome.ts',
  'services/bn/risk/riskOutcomeService.ts',
  'components/bn/risk/BnRiskOutcomeSection.tsx',
  'components/bn/risk/BnRiskOutcomeDialog.tsx',
  'components/bn/risk/BnRiskClosureSection.tsx',
  'components/bn/risk/BnRiskClosureDialog.tsx',
  'components/bn/risk/BnRiskReopenDialog.tsx',
  'components/bn/risk/BnRiskOutcomeQueue.tsx',
];

/* ------------------------------------------------------------------ */
/* Fixtures — shaped exactly like the governed contracts              */
/* ------------------------------------------------------------------ */

const CURRENT_OUTCOME = {
  outcome_id: 'out-1',
  outcome_reference: 'RSK-OUT-0001',
  outcome_code: 'IRREGULARITY_CONFIRMED',
  outcome_label: 'Irregularity confirmed',
  outcome_class: 'ADVERSE',
  finding_classification: 'CONTROL_APPLIED',
  is_fraud_related: false,
  disposition_code: 'RECOVERY_RAISED',
  disposition_label: 'Recovery raised',
  reason_code: 'UNDECLARED_EARNINGS',
  reason_label: 'Undeclared earnings',
  justification: 'Earnings were not declared for three payment periods.',
  unresolved_control_disposition: null,
  financial_impact_module: 'bn_overpayment',
  financial_impact_reference: 'OVP-4410',
  external_outcome_reference: null,
  external_outcome_summary: null,
  control_execution_summary: [],
  referral_summary: [],
  supporting_factor_ids: [],
  supporting_evidence_ids: [],
  recorded_by_name: 'Officer One',
  recorded_at: '2026-08-10T09:00:00Z',
  sequence_no: 1,
  phase_no: 1,
  status: 'CURRENT',
  supersedes_outcome_id: null,
  assessment_row_version: 9,
  row_version: 1,
} as unknown as NonNullable<BnRiskOutcomeReadinessV1['current_outcome']>;

function outcomeReadiness(
  over: Partial<BnRiskOutcomeReadinessV1> = {},
): BnRiskOutcomeReadinessV1 {
  return {
    assessment_id: 'as-1',
    assessment_reference: 'RSK-ASM-0001',
    assessment_status: 'CONTROL_ACTION',
    assessment_row_version: 9,
    phase_no: 1,
    state: 'READY',
    can_record_outcome: true,
    can_correct_outcome: false,
    available_actions: ['RECORD_OUTCOME'],
    blockers: [],
    warnings: [],
    outstanding_controls: [],
    outstanding_referrals: [],
    execution_summary: [],
    failed_executions: 0,
    pending_attempts: 0,
    requires_unresolved_control_disposition: false,
    all_controls_executed: true,
    all_referrals_settled: true,
    ready_for_outcome: true,
    outcome_catalogue: [
      {
        outcome_code: 'NO_IRREGULARITY',
        outcome_label: 'No irregularity found',
        outcome_class: 'CLEARED',
        finding_classification: 'CONCERN_NOT_SUBSTANTIATED',
        is_fraud_related: false,
        requires_reason: true,
        requires_justification: true,
        requires_disposition: false,
        requires_external_reference: false,
        reason_domain: 'OUTCOME_REASON',
        disposition_domain: null,
        guidance: null,
      },
    ] as unknown as BnRiskOutcomeReadinessV1['outcome_catalogue'],
    current_outcome: null,
    outcome_history: [],
    closure: null,
    restricted_detail_visible: true,
    ...over,
  } as BnRiskOutcomeReadinessV1;
}

function closureReadiness(
  over: Partial<BnRiskClosureReadiness> = {},
): BnRiskClosureReadiness {
  return {
    assessment_id: 'as-1',
    assessment_status: 'COMPLETED',
    assessment_row_version: 10,
    state: 'READY_FOR_CLOSURE',
    can_close: true,
    can_reopen: false,
    reopen_requires_capability: 'bn.risk.admin',
    blockers: [],
    warnings: [],
    outcome: {
      outcome_id: 'out-1',
      outcome_code: 'IRREGULARITY_CONFIRMED',
      outcome_label: 'Irregularity confirmed',
      finding_classification: 'CONTROL_APPLIED',
      recorded_by_name: 'Officer One',
      recorded_at: '2026-08-10T09:00:00Z',
    },
    closure: null,
    reopen_count: 0,
    available_actions: ['CLOSE'],
    ...over,
  } as BnRiskClosureReadiness;
}

function queue(over: Partial<BnRiskOutcomeQueue> = {}): BnRiskOutcomeQueue {
  return {
    rows: [
      {
        assessment_id: 'as-1',
        assessment_reference: 'RSK-ASM-0001',
        person_name: 'A. Person',
        person_masked_identifier: '***-**-1234',
        assessment_status: 'CONTROL_ACTION',
        bucket: 'READY_FOR_OUTCOME',
        stage_label: 'Awaiting outcome',
        action_required: 'Record the governed outcome',
        outcome_code: null,
        outcome_label: null,
        finding_classification: null,
        outcome_recorded_at: null,
        closed_at: null,
        closed_by_name: null,
        reopen_count: 0,
        assigned_owner_name: 'Officer One',
        assigned_team_code: null,
        age_days: 4,
      },
      {
        assessment_id: 'as-2',
        assessment_reference: 'RSK-ASM-0002',
        person_name: 'B. Person',
        person_masked_identifier: null,
        assessment_status: 'COMPLETED',
        bucket: 'READY_TO_CLOSE',
        stage_label: 'Ready to close',
        action_required: 'Close the assessment',
        outcome_code: 'NO_IRREGULARITY',
        outcome_label: 'No irregularity found',
        finding_classification: 'CONCERN_NOT_SUBSTANTIATED',
        outcome_recorded_at: '2026-08-11T09:00:00Z',
        closed_at: null,
        closed_by_name: null,
        reopen_count: 0,
        assigned_owner_name: null,
        assigned_team_code: 'RISK_OPS',
        age_days: 11,
      },
    ],
    total: 2,
    page: 1,
    page_size: 20,
    bucket_counts: {
      READY_FOR_OUTCOME: 1,
      OUTCOME_BLOCKED: 0,
      READY_TO_CLOSE: 1,
      CLOSED: 0,
      REOPENED: 0,
    },
    restricted_detail_visible: true,
    ...over,
  } as BnRiskOutcomeQueue;
}

function ok(data: unknown) {
  return { data: { status: 'OK', data }, error: null };
}

function renderWith(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  rpc.mockReset();
  from.mockClear();
});

/* ================================================================== */
/* 1. Backend exists behind the frontend contracts                    */
/* ================================================================== */

describe('Epic 5 — governed backend', () => {
  it('delivers the outcome, closure, queue and command boundary', () => {
    for (const fn of [
      'bn_risk_outcome_readiness_v1',
      'bn_risk_closure_readiness_v1',
      'bn_risk_outcome_queue_v1',
      'bn_risk_outcome_command_v1',
    ]) {
      expect(BACKEND_SQL).toContain(fn);
    }
  });

  it('retains outcome and closure records rather than deleting them', () => {
    expect(BACKEND_SQL).toContain('bn_risk_outcome');
    expect(BACKEND_SQL).toContain('bn_risk_assessment_closure');
    expect(BACKEND_SQL).not.toMatch(/delete\s+from\s+public\.bn_risk_outcome/i);
    expect(BACKEND_SQL).not.toMatch(/delete\s+from\s+public\.bn_risk_assessment_closure/i);
  });
});

/* ================================================================== */
/* 2. The frontend never derives a governed answer                    */
/* ================================================================== */

describe('Epic 5 — no client-side governance', () => {
  it('never queries a table directly and never uses a service-role key', () => {
    for (const rel of EPIC5_SOURCES) {
      const source = readSrc(rel);
      expect(source).not.toMatch(/supabase\s*\.\s*from\s*\(/);
      expect(source).not.toMatch(/SERVICE_ROLE/i);
    }
  });

  it('routes every mutation through the single outcome command RPC', () => {
    const service = readSrc('services/bn/risk/riskOutcomeService.ts');
    const commandCalls = service.match(/supabase\.rpc\(\s*'([a-z0-9_]+)'/g) ?? [];
    for (const call of commandCalls) {
      expect(call).toContain('bn_risk_outcome_command_v1');
    }
    for (const command of [
      'BN_RISK_RECORD_OUTCOME',
      'BN_RISK_OP_CORRECT_OUTCOME',
      'BN_RISK_CLOSE_ASSESSMENT',
      'BN_RISK_REOPEN_ASSESSMENT',
    ]) {
      expect(service).toContain(command);
    }
  });

  it('never reverses an owning-domain effect from the Risk surfaces', () => {
    for (const rel of EPIC5_SOURCES) {
      const source = readSrc(rel);
      expect(source).not.toMatch(/bn_payment|bn_award|bn_claim|bn_overpayment_command/i);
    }
  });
});

/* ================================================================== */
/* 3. Outcome section — readiness, blockers and immutability          */
/* ================================================================== */

describe('Epic 5 — outcome section', () => {
  it('fails closed when readiness cannot be answered', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    renderWith(<BnRiskOutcomeSection assessmentId="as-1" onChanged={() => {}} />);

    const section = await screen.findByTestId('bn-risk-outcome-section');
    expect(section.getAttribute('data-state')).toBe('FAILED_TO_LOAD');
    expect(screen.queryByTestId('bn-risk-outcome-record')).toBeNull();
  });

  it('offers the record action only when the backend permits it', async () => {
    rpc.mockResolvedValue(ok(outcomeReadiness()));
    renderWith(<BnRiskOutcomeSection assessmentId="as-1" onChanged={() => {}} />);

    expect(await screen.findByTestId('bn-risk-outcome-record')).toBeTruthy();
    expect(screen.queryByTestId('bn-risk-outcome-correct')).toBeNull();
  });

  it('withholds the action and shows the backend blockers when work is outstanding', async () => {
    rpc.mockResolvedValue(ok(outcomeReadiness({
      state: 'BLOCKED',
      can_record_outcome: false,
      ready_for_outcome: false,
      available_actions: [],
      all_controls_executed: false,
      blockers: ['A payment hold request is still awaiting confirmation from Payments.'],
    })));
    renderWith(<BnRiskOutcomeSection assessmentId="as-1" onChanged={() => {}} />);

    const blockers = await screen.findByTestId('bn-risk-outcome-blockers');
    expect(blockers.textContent).toContain('awaiting confirmation from Payments');
    expect(screen.queryByTestId('bn-risk-outcome-record')).toBeNull();
  });

  it('presents a recorded outcome as immutable, with correction as a supersession', async () => {
    rpc.mockResolvedValue(ok(outcomeReadiness({
      state: 'OUTCOME_RECORDED',
      can_record_outcome: false,
      can_correct_outcome: true,
      available_actions: ['CORRECT_OUTCOME'],
      current_outcome: CURRENT_OUTCOME,
      outcome_history: [
        {
          outcome_id: 'out-0',
          outcome_reference: 'RSK-OUT-0000',
          outcome_code: 'NO_IRREGULARITY',
          outcome_label: 'No irregularity found',
          finding_classification: 'CONCERN_NOT_SUBSTANTIATED',
          status: 'SUPERSEDED',
          sequence_no: 0,
          phase_no: 1,
          recorded_by_name: 'Officer Zero',
          recorded_at: '2026-08-09T09:00:00Z',
          correction_reason_label: 'New evidence received',
          superseded_at: '2026-08-10T09:00:00Z',
        },
      ],
    })));
    renderWith(<BnRiskOutcomeSection assessmentId="as-1" onChanged={() => {}} />);

    expect(await screen.findByTestId('bn-risk-outcome-summary')).toBeTruthy();
    expect(screen.queryByTestId('bn-risk-outcome-record')).toBeNull();
    expect(screen.getByTestId('bn-risk-outcome-correct')).toBeTruthy();

    const history = screen.getByTestId('bn-risk-outcome-history');
    expect(history.textContent).toContain('Officer Zero');
  });

  it('suppresses restricted justification when the backend withholds it', async () => {
    rpc.mockResolvedValue(ok(outcomeReadiness({
      state: 'OUTCOME_RECORDED',
      can_record_outcome: false,
      available_actions: [],
      restricted_detail_visible: false,
      current_outcome: { ...CURRENT_OUTCOME, justification: null },
    })));
    renderWith(<BnRiskOutcomeSection assessmentId="as-1" onChanged={() => {}} />);

    await screen.findByTestId('bn-risk-outcome-summary');
    expect(screen.queryByTestId('bn-risk-outcome-justification-text')).toBeNull();
  });

  it('never states a proven fraud finding in business wording', () => {
    expect(findingClassificationLabel('SUSPECTED_FRAUD_REFERRED').toLowerCase())
      .not.toContain('proven');
    expect(findingClassificationLabel('CONCERN_NOT_SUBSTANTIATED').toLowerCase())
      .not.toContain('fraud');
  });
});

/* ================================================================== */
/* 4. Closure and exceptional reopening                               */
/* ================================================================== */

describe('Epic 5 — closure and reopening', () => {
  it('offers closure only when the backend says the assessment may be closed', async () => {
    rpc.mockResolvedValue(ok(closureReadiness()));
    renderWith(
      <BnRiskClosureSection
        assessmentId="as-1"
        assessmentReference="RSK-ASM-0001"
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId('bn-risk-close')).toBeTruthy();
    expect(screen.queryByTestId('bn-risk-reopen')).toBeNull();
  });

  it('withholds closure and explains why when no outcome has been recorded', async () => {
    rpc.mockResolvedValue(ok(closureReadiness({
      assessment_status: 'CONTROL_ACTION',
      state: 'OUTCOME_NOT_READY',
      can_close: false,
      available_actions: [],
      outcome: null,
      blockers: ['A governed outcome must be recorded before the assessment can be closed.'],
    })));
    renderWith(
      <BnRiskClosureSection
        assessmentId="as-1"
        assessmentReference="RSK-ASM-0001"
        onChanged={() => {}}
      />,
    );

    const blockers = await screen.findByTestId('bn-risk-closure-blockers');
    expect(blockers.textContent).toContain('must be recorded');
    expect(screen.queryByTestId('bn-risk-close')).toBeNull();
  });

  it('treats reopening as exceptional and capability-gated', async () => {
    rpc.mockResolvedValue(ok(closureReadiness({
      assessment_status: 'CLOSED',
      state: 'ALREADY_CLOSED',
      can_close: false,
      can_reopen: false,
      available_actions: [],
      reopen_count: 0,
      closure: {
        closure_id: 'cls-1',
        phase_no: 1,
        outcome_code: 'IRREGULARITY_CONFIRMED',
        outcome_label: 'Irregularity confirmed',
        closure_reason_code: 'CONCLUDED',
        closure_reason_label: 'Assessment concluded',
        closure_note: null,
        closed_by_name: 'Officer One',
        closed_at: '2026-08-12T09:00:00Z',
        status: 'CLOSED',
        reopened_at: null,
        reopened_by_name: null,
        reopen_reason_label: null,
        reopen_destination_status: null,
      },
    })));
    renderWith(
      <BnRiskClosureSection
        assessmentId="as-1"
        assessmentReference="RSK-ASM-0001"
        onChanged={() => {}}
      />,
    );

    expect(await screen.findByTestId('bn-risk-closure-record')).toBeTruthy();
    expect(screen.queryByTestId('bn-risk-reopen')).toBeNull();
    expect(screen.getByTestId('bn-risk-closed-posture')).toBeTruthy();
  });

  it('shows a reopening as an audited event that retains the closure record', async () => {
    rpc.mockResolvedValue(ok(closureReadiness({
      assessment_status: 'REVIEW',
      state: 'OUTCOME_NOT_READY',
      can_close: false,
      can_reopen: false,
      available_actions: [],
      reopen_count: 1,
      closure: {
        closure_id: 'cls-1',
        phase_no: 1,
        outcome_code: 'IRREGULARITY_CONFIRMED',
        outcome_label: 'Irregularity confirmed',
        closure_reason_code: 'CONCLUDED',
        closure_reason_label: 'Assessment concluded',
        closure_note: null,
        closed_by_name: 'Officer One',
        closed_at: '2026-08-12T09:00:00Z',
        status: 'REOPENED',
        reopened_at: '2026-08-20T09:00:00Z',
        reopened_by_name: 'Risk Administrator',
        reopen_reason_label: 'Material new evidence',
        reopen_destination_status: 'REVIEW',
      },
    })));
    renderWith(
      <BnRiskClosureSection
        assessmentId="as-1"
        assessmentReference="RSK-ASM-0001"
        onChanged={() => {}}
      />,
    );

    const record = await screen.findByTestId('bn-risk-closure-reopen-record');
    expect(record.textContent).toContain('Risk Administrator');
    expect(screen.getByTestId('bn-risk-closure-reopen-count').textContent).toBe('1');
  });
});

/* ================================================================== */
/* 5. Commands — payload, idempotency and optimistic concurrency      */
/* ================================================================== */

describe('Epic 5 — governed commands', () => {
  it('sends closure through the command RPC with an idempotency key and row version', async () => {
    rpc.mockResolvedValue({
      data: { status: 'EXECUTED', closure_id: 'cls-1', assessment_status: 'CLOSED' },
      error: null,
    });

    const result = await riskOutcomeService.closeAssessment({
      assessmentId: 'as-1',
      closureReasonCode: 'CONCLUDED',
      expectedRowVersion: 10,
    });

    expect(result.status).toBe('EXECUTED');
    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(name).toBe('bn_risk_outcome_command_v1');
    expect(args.p_command_name).toBe('BN_RISK_CLOSE_ASSESSMENT');
    expect(args.p_expected_row_version).toBe(10);
    expect(args.p_idempotency_key).toBeTruthy();
    expect(args.p_payload_hash).toBeTruthy();
  });

  it('requires a justification on the reopen command payload', async () => {
    rpc.mockResolvedValue({ data: { status: 'EXECUTED' }, error: null });

    await riskOutcomeService.reopenAssessment({
      assessmentId: 'as-1',
      reopenReasonCode: 'NEW_EVIDENCE',
      justification: 'Material new evidence was received from the employer.',
      expectedRowVersion: 12,
    });

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_command_name).toBe('BN_RISK_REOPEN_ASSESSMENT');
    expect((args.p_payload as Record<string, unknown>).justification)
      .toContain('Material new evidence');
  });

  it('surfaces a version conflict as a failure rather than a silent success', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'E_STALE_ROW_VERSION:stale' } });

    const result = await riskOutcomeService.closeAssessment({
      assessmentId: 'as-1',
      closureReasonCode: 'CONCLUDED',
      expectedRowVersion: 1,
    });

    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('STALE_ROW_VERSION');
  });

  it('never sends a command when the actor is not authenticated', async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } } as never);

    const result = await riskOutcomeService.recordOutcome({
      assessmentId: 'as-1',
      outcomeCode: 'NO_IRREGULARITY',
      justification: 'Nothing found.',
    } as never);

    expect(result.status).toBe('FAILED');
    expect(rpc).not.toHaveBeenCalled();
  });
});

/* ================================================================== */
/* 6. Operational queue                                               */
/* ================================================================== */

describe('Epic 5 — outcome and closure queue', () => {
  it('renders backend buckets, counts and required actions', async () => {
    rpc.mockResolvedValue(ok(queue()));
    renderWith(<OutcomeQueueView onOpenAssessment={() => {}} />);

    expect(await screen.findByTestId('bn-risk-outcome-queue')).toBeTruthy();
    expect(screen.getByText('RSK-ASM-0001')).toBeTruthy();
    expect(screen.getByText('Record the governed outcome')).toBeTruthy();
    expect(screen.getByText('Close the assessment')).toBeTruthy();
  });

  it('deep links to the section that owns the outstanding work', async () => {
    rpc.mockResolvedValue(ok(queue()));
    const onOpen = vi.fn();
    renderWith(<OutcomeQueueView onOpenAssessment={onOpen} />);

    fireEvent.click(await screen.findByTestId('bn-risk-outcome-queue-open-as-1'));
    expect(onOpen).toHaveBeenCalledWith('as-1', 'outcome');

    fireEvent.click(screen.getByTestId('bn-risk-outcome-queue-open-as-2'));
    expect(onOpen).toHaveBeenCalledWith('as-2', 'closure');
  });

  it('hides outcome and finding detail when the caller is not permitted to see it', async () => {
    rpc.mockResolvedValue(ok(queue({
      restricted_detail_visible: false,
      rows: queue().rows.map((r) => ({
        ...r,
        outcome_code: null,
        outcome_label: null,
        finding_classification: null,
      })),
    })));
    renderWith(<OutcomeQueueView onOpenAssessment={() => {}} />);

    await screen.findByTestId('bn-risk-outcome-queue');
    expect(screen.queryByText('No irregularity found')).toBeNull();
  });

  it('never presents a failed queue read as an empty workload', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    renderWith(<OutcomeQueueView onOpenAssessment={() => {}} />);

    await waitFor(() => expect(screen.getByTestId('bn-risk-outcome-queue-error')).toBeTruthy());
    expect(screen.queryByTestId('bn-risk-outcome-queue')).toBeNull();
  });
});

/* ================================================================== */
/* 7. Navigation closure                                              */
/* ================================================================== */

describe('Epic 5 — navigation closure', () => {
  it('wires the outcome queue and sections into the Risk management surface', () => {
    const page = readSrc('pages/bn/risk/BnRiskManagementPage.tsx');
    expect(page).toContain('BnRiskOutcomeQueue');
    expect(page).toContain('path="outcomes"');

    const workspace = readSrc('components/bn/risk/BnRiskAssessmentWorkspace.tsx');
    expect(workspace).toContain('BnRiskOutcomeSection');
    expect(workspace).toContain('BnRiskClosureSection');
    expect(workspace).toContain("'outcome'");
    expect(workspace).toContain("'closure'");
  });
});
