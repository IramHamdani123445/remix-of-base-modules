/**
 * AW360-WAVE-1-C1 Stage D2 — Operational Complex Loader Certification.
 *
 * Final loader certification stage: proves the six remaining multi-table
 * and aggregate Award 360 query loaders against `AWARD360_SCHEMA_CONTRACT`
 * via `AwardQueryRecorder`:
 *
 *   1. getAward360OverviewCounts
 *   2. listAwardSuspensions
 *   3. getAwardOverpaymentDetail
 *   4. listAwardCommunicationsPaged
 *   5. getAwardCommunicationDetail
 *   6. listAwardAuditPaged
 *
 * Every scenario listed under the `operational-complex-certification`
 * suite of `AWARD360_CERTIFICATION_REGISTRY` is executed here against the
 * real production loader. The shared evidence reconciler enforces that
 *   - every registered scenario ran,
 *   - no unregistered scenario tagged to a suite-owned loader ran,
 *   - the observed table union per loader equals its manifest
 *     `expectedTables`,
 *   - every observed table is declared in the schema contract.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AwardQueryRecorder,
  type RecordedScenarioExecution,
} from '@/test/mocks/award360QueryRecorder';
import { assertLoaderCertificationEvidence } from '@/test/award360/assertLoaderCertificationEvidence';

const capturedExecutions: RecordedScenarioExecution[] = [];
const holder = vi.hoisted(() => ({ recorder: null as AwardQueryRecorder | null }));

vi.mock('@/integrations/supabase/client', () => {
  const supabase = {
    from(table: string) {
      if (!holder.recorder) throw new Error('AwardQueryRecorder not initialised');
      return holder.recorder.client().from(table);
    },
    rpc(name: string, args: Record<string, unknown>) {
      if (!holder.recorder) throw new Error('AwardQueryRecorder not initialised');
      return holder.recorder.client().rpc(name, args);
    },
  };
  return { supabase };
});

holder.recorder = new AwardQueryRecorder({
  onExecutionComplete: (evidence) => capturedExecutions.push(evidence),
});
const recorder = holder.recorder;

import {
  getAward360OverviewCounts,
  listAwardSuspensions,
  getAwardOverpaymentDetail,
  listAwardCommunicationsPaged,
  getAwardCommunicationDetail,
  listAwardAuditPaged,
} from '@/services/bn/awards/award360Service';

// ─── helpers ──────────────────────────────────────────────────────────────
type ScenarioResponse = {
  table: string;
  loaderName?: string;
  scenarioId?: string;
  occurrence?: number;
  data: unknown;
};
type ScenarioError = {
  table: string;
  loaderName?: string;
  scenarioId?: string;
  occurrence?: number;
  error: { message: string; code?: string };
};

function configure(opts: {
  responses?: Record<string, unknown>;
  errors?: Record<string, { message: string; code?: string }>;
  scenarioResponses?: ScenarioResponse[];
  scenarioErrors?: ScenarioError[];
}) {
  (recorder as any).opts.responses = opts.responses ?? {};
  (recorder as any).opts.errors = opts.errors ?? {};
  (recorder as any).opts.scenarioResponses = opts.scenarioResponses ?? [];
  (recorder as any).opts.scenarioErrors = opts.scenarioErrors ?? [];
}

beforeEach(() => {
  recorder.reset();
  configure({});
});

const AWARD_ID = 'a-1';
const CLAIM_ID = 'c-1';

// ─── shared fixtures ──────────────────────────────────────────────────────
const awardWithClaim = { bn_claim_id: CLAIM_ID };
const awardNoClaim = { bn_claim_id: null };

const beneficiaryRow = {
  id: 'b-1', full_name: 'Alice', beneficiary_ssn: 'SSN-1', relationship: 'SPOUSE',
  share_percent: 100, share_amount: 500, start_date: '2024-01-01', end_date: null,
  status: 'ACTIVE', bank_acct: '1', bank_code: 'BK', notes: null,
  entered_by: 'u1', entered_at: '2024-01-01', modified_by: null, modified_at: null,
};
const scheduleRow = {
  id: 's-1', schedule_period: '2026-01', due_date: '2026-01-01',
  gross_amount: 100, deductions: 10, net_amount: 90, status: 'PENDING',
  payment_method: 'EFT', payment_ref: 'R1', paid_at: null,
  bn_payment_instruction_id: null, notes: null,
};
const paymentRow = {
  id: 'p-1', amount: 100, currency: 'XCD', payment_method: 'EFT',
  bank_code: 'BK', account_number: '1', due_date: '2026-01-01',
  status: 'PAID', paid_date: '2026-01-01', payment_reference: 'PR', cancel_reason: null,
};
const lifeCertRow = {
  id: 'lc-1', required_for_period: '2026-Q1', due_date: '2026-01-31',
  submitted_date: null, verified_date: null, verification_method: null,
  status: 'PENDING', remarks: null,
};
const medicalRow = {
  id: 'm-1', review_type: 'ANNUAL', scheduled_date: '2026-02-01',
  status: 'SCHEDULED', completed_date: null, next_review_date: null,
  entered_at: '2026-01-01', entered_by: 'u1', modified_at: null, modified_by: null,
};
const overpaymentRow = {
  id: 'o-1', bn_award_id: AWARD_ID, detected_date: '2026-01-01',
  period_from: '2025-01-01', period_to: '2025-12-31',
  original_amount: 500, recovered_amount: 100, outstanding_amount: 400,
  recovery_method: 'DEDUCTION', recovery_status: 'IN_RECOVERY',
  reason_code: 'REASON', remarks: null,
  entered_by: 'u1', entered_at: '2026-01-01', modified_by: null, modified_at: null,
};
const suspensionRow = {
  id: 'sp-1', status: 'PROPOSED', suspension_type: 'ADMIN',
  suspended_from: '2026-02-01', suspended_to: null, resumed_at: null,
  reason_code: 'R', reason_text: null,
  proposed_by_user_id: 'u1', entered_by: 'u1', entered_at: '2026-01-01',
  workflow_instance_id: 'wf-1',
};
const suspensionRowNoWf = { ...suspensionRow, id: 'sp-2', workflow_instance_id: null };
const workflowTask = {
  workflow_instance_id: 'wf-1', task_status: 'PENDING',
  metadata: { approval_level: 1, workbasket_id: 'wb-1' },
};
const commLogRow = {
  id: 'cl-1', event_code: 'AWARD_START', channel: 'EMAIL',
  recipient_type: 'PENSIONER', recipient_address: 'x@y.com',
  template_id: 't-1', subject: 'hi', status: 'SENT',
  provider_message_id: 'pm-1', letter_id: null,
  error_message: null, retry_count: 0, last_retry_at: null,
  context: { correlation_id: 'cor-1' }, created_at: '2026-01-01T00:00:00Z',
};
const commLogRowWithLetter = { ...commLogRow, id: 'cl-2', letter_id: 'lt-1' };
const letterRow = {
  id: 'lt-1', status: 'DISPATCHED',
  generated_at: '2026-01-01', approved_at: '2026-01-01',
  printed_at: '2026-01-01', dispatched_at: '2026-01-01',
  delivered_at: null, returned_at: null, cancelled_at: null,
  reference_number: 'REF-1',
};

// Audit source fixtures
const statusEvt = {
  id: 'st-1', event_date: '2026-01-05T00:00:00Z', entered_at: '2026-01-05',
  entered_by: 'u1', from_status: 'ACTIVE', to_status: 'SUSPENDED',
  reason_code: 'R', remarks: null,
};
const rateEvt = {
  id: 'rt-1', effective_from: '2026-01-01', effective_to: null,
  entered_at: '2026-01-01', entered_by: 'u1', rate_amount: 100,
  currency: 'XCD', change_reason: 'ADJ', reference_doc: null,
};
const suspEvt = {
  id: 'sx-1', entered_at: '2026-01-03T00:00:00Z', entered_by: 'u1',
  proposed_by_user_id: 'u1', status: 'PROPOSED',
  suspension_type: 'ADMIN', suspended_from: '2026-01-04', suspended_to: null,
  resumed_at: null, resumed_by: null,
  reason_code: 'R', reason_text: null, correlation_id: null,
};
const centralEvt = {
  id: 'ca-1', event_time: '2026-01-06T00:00:00Z', created_at: '2026-01-06',
  action: 'UPDATE', event_code: 'AWARD_UPDATED', event_name: 'Award Updated',
  actor_user_id: 'u1', actor_name: 'Alice', actor_email: 'a@b.com',
  before_value: null, after_value: null, reason: 'x', correlation_id: null,
  severity: 'info', domain_code: 'AWARD',
  entity_type: 'bn_award', entity_id: AWARD_ID, changed_fields: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. getAward360OverviewCounts
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · getAward360OverviewCounts', () => {
  it('overview-counts-full — every source enabled; all count tables queried', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award_beneficiary', data: [beneficiaryRow] },
        { table: 'bn_payment_schedule', data: [scheduleRow] },
        { table: 'bn_payment_instruction', data: [paymentRow] },
        { table: 'bn_life_certificate', data: [lifeCertRow] },
        { table: 'bn_medical_review_schedule', data: [medicalRow] },
        { table: 'bn_award_suspension_event', data: [suspensionRow] },
        { table: 'core_workflow_task', data: [workflowTask] },
        { table: 'bn_overpayment', data: [overpaymentRow] },
        { table: 'bn_award', data: awardWithClaim },
        // Two comm branches: eq(claim_id) and contains(context)
        { table: 'bn_communication_log', occurrence: 1, data: [commLogRow] },
        { table: 'bn_communication_log', occurrence: 2, data: [] },
      ],
    });
    const res = await recorder.runAs(
      'getAward360OverviewCounts', 'overview-counts-full',
      () => getAward360OverviewCounts(AWARD_ID),
    );
    expect(res.beneficiaries).toHaveLength(1);
    expect(res.schedules).toHaveLength(1);
    expect(res.payments).toHaveLength(1);
    expect(res.lifeCertificates).toHaveLength(1);
    expect(res.medicalReviews).toHaveLength(1);
    expect(res.suspensions).toHaveLength(1);
    expect(res.overpayments).toHaveLength(1);
    expect(res.communications.length).toBeGreaterThanOrEqual(1);
    expect(res.warnings).toEqual([]);
    // Suspension enrichment consumed core_workflow_task.
    const wf = recorder.queries.filter((q) => q.table === 'core_workflow_task');
    expect(wf.length).toBeGreaterThan(0);
    // Payment-instruction canonical scope.
    const pi = recorder.queries.find((q) => q.table === 'bn_payment_instruction')!;
    expect(pi.filters.find((f) => f.column === 'award_id')?.value).toBe(AWARD_ID);
    // Award-native sources scope by bn_award_id.
    for (const t of ['bn_award_beneficiary', 'bn_payment_schedule', 'bn_life_certificate',
                     'bn_medical_review_schedule', 'bn_award_suspension_event', 'bn_overpayment']) {
      const q = recorder.queries.find((x) => x.table === t)!;
      expect(q.filters.find((f) => f.column === 'bn_award_id')?.value, `${t} scope`).toBe(AWARD_ID);
    }
    // Communications canonical Award→Claim + context strategy.
    const commQs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(commQs.some((q) => q.filters.some((f) => f.method === 'eq' && f.column === 'claim_id'))).toBe(true);
    expect(commQs.some((q) => q.filters.some((f) => f.method === 'contains' && f.column === 'context'))).toBe(true);
    // No full-row selection uses column='*'.
    for (const q of recorder.queries) {
      expect(q.selectedColumns).not.toContain('*');
    }
  });

  it('overview-counts-all-disabled — no include flags on, zero queries', async () => {
    configure({});
    const res = await recorder.runAs(
      'getAward360OverviewCounts', 'overview-counts-all-disabled',
      () => getAward360OverviewCounts(AWARD_ID, {
        includeBeneficiaries: false, includeSchedule: false, includePayments: false,
        includeLifeCertificates: false, includeMedical: false, includeSuspensions: false,
        includeOverpayments: false, includeCommunications: false,
      }),
    );
    expect(recorder.queries).toHaveLength(0);
    expect(res.beneficiaries).toEqual([]);
    expect(res.communications).toEqual([]);
  });

  it('overview-counts-one-source-error — one source fails, others survive', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award_beneficiary', data: [beneficiaryRow] },
        { table: 'bn_life_certificate', data: [lifeCertRow] },
        { table: 'bn_medical_review_schedule', data: [medicalRow] },
      ],
      scenarioErrors: [
        { table: 'bn_award_suspension_event', error: { message: 'boom' } },
      ],
    });
    const res = await recorder.runAs(
      'getAward360OverviewCounts', 'overview-counts-one-source-error',
      () => getAward360OverviewCounts(AWARD_ID, {
        includeBeneficiaries: true, includeLifeCertificates: true, includeMedical: true,
        includeSuspensions: true,
        includeSchedule: false, includePayments: false, includeOverpayments: false,
        includeCommunications: false,
      }),
    );
    expect(res.beneficiaries).toHaveLength(1);
    expect(res.lifeCertificates).toHaveLength(1);
    expect(res.medicalReviews).toHaveLength(1);
    expect(res.suspensions).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('overview-counts-communications-context-scope — award without claim → context-only', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award', data: awardNoClaim },
        { table: 'bn_communication_log', data: [commLogRow] },
      ],
    });
    const res = await recorder.runAs(
      'getAward360OverviewCounts', 'overview-counts-communications-context-scope',
      () => getAward360OverviewCounts(AWARD_ID, {
        includeBeneficiaries: false, includeSchedule: false, includePayments: false,
        includeLifeCertificates: false, includeMedical: false, includeSuspensions: false,
        includeOverpayments: false, includeCommunications: true,
      }),
    );
    expect(res.communications).toHaveLength(1);
    const commQs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(commQs).toHaveLength(1);
    expect(commQs[0].filters.some((f) => f.method === 'contains' && f.column === 'context')).toBe(true);
    expect(commQs[0].filters.some((f) => f.method === 'eq' && f.column === 'claim_id')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. listAwardSuspensions
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · listAwardSuspensions', () => {
  it('suspensions-with-workflow-tasks — workflow tasks queried by workflow_instance_id', async () => {
    configure({
      responses: {
        bn_award_suspension_event: [suspensionRow],
        core_workflow_task: [workflowTask],
      },
    });
    const rows = await recorder.runAs(
      'listAwardSuspensions', 'suspensions-with-workflow-tasks',
      () => listAwardSuspensions(AWARD_ID),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowInstanceId).toBe('wf-1');
    expect(rows[0].currentApprovalLevel).toBe(1);
    expect(rows[0].workbasketId).toBe('wb-1');
    const wf = recorder.queries.find((q) => q.table === 'core_workflow_task')!;
    expect(wf.filters.find((f) => f.column === 'workflow_instance_id')?.method).toBe('in');
    // Base scope enforced.
    const base = recorder.queries.find((q) => q.table === 'bn_award_suspension_event')!;
    expect(base.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
  });

  it('suspensions-without-workflow-instance — no workflow-task query issued', async () => {
    configure({ responses: { bn_award_suspension_event: [suspensionRowNoWf] } });
    const rows = await recorder.runAs(
      'listAwardSuspensions', 'suspensions-without-workflow-instance',
      () => listAwardSuspensions(AWARD_ID),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].workflowInstanceId).toBeNull();
    expect(recorder.queries.find((q) => q.table === 'core_workflow_task')).toBeUndefined();
  });

  it('suspensions-workflow-source-error — task failure rejects loader', async () => {
    configure({
      responses: { bn_award_suspension_event: [suspensionRow] },
      scenarioErrors: [{ table: 'core_workflow_task', error: { message: 'wf boom' } }],
    });
    await expect(recorder.runAs(
      'listAwardSuspensions', 'suspensions-workflow-source-error',
      () => listAwardSuspensions(AWARD_ID),
    )).rejects.toBeTruthy();
  });

  it('suspensions-base-source-error — base failure rejects loader', async () => {
    configure({ errors: { bn_award_suspension_event: { message: 'boom' } } });
    await expect(recorder.runAs(
      'listAwardSuspensions', 'suspensions-base-source-error',
      () => listAwardSuspensions(AWARD_ID),
    )).rejects.toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. getAwardOverpaymentDetail
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · getAwardOverpaymentDetail', () => {
  it('overpayment-detail-with-schedules — schedule rows scoped by bn_award_id', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_overpayment', data: overpaymentRow },
        { table: 'bn_payment_schedule', data: [{ ...scheduleRow, deductions: 25 }] },
      ],
    });
    const res = await recorder.runAs(
      'getAwardOverpaymentDetail', 'overpayment-detail-with-schedules',
      () => getAwardOverpaymentDetail('o-1'),
    );
    expect(res.row?.id).toBe('o-1');
    expect(res.scheduleDeductions).toHaveLength(1);
    expect(res.warnings).toEqual([]);
    const op = recorder.queries.find((q) => q.table === 'bn_overpayment')!;
    expect(op.filters.find((f) => f.column === 'id')?.value).toBe('o-1');
    const sched = recorder.queries.find((q) => q.table === 'bn_payment_schedule')!;
    expect(sched.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(sched.filters.find((f) => f.column === 'deductions' && f.method === 'gt')).toBeTruthy();
  });

  it('overpayment-detail-without-schedules — empty schedule set, no warning', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_overpayment', data: overpaymentRow },
        { table: 'bn_payment_schedule', data: [] },
      ],
    });
    const res = await recorder.runAs(
      'getAwardOverpaymentDetail', 'overpayment-detail-without-schedules',
      () => getAwardOverpaymentDetail('o-1'),
    );
    expect(res.row?.id).toBe('o-1');
    expect(res.scheduleDeductions).toEqual([]);
    expect(res.warnings).toEqual([]);
  });

  it('overpayment-detail-schedule-error — schedule failure preserved as warning', async () => {
    configure({
      scenarioResponses: [{ table: 'bn_overpayment', data: overpaymentRow }],
      scenarioErrors: [{ table: 'bn_payment_schedule', error: { message: 'boom' } }],
    });
    const res = await recorder.runAs(
      'getAwardOverpaymentDetail', 'overpayment-detail-schedule-error',
      () => getAwardOverpaymentDetail('o-1'),
    );
    expect(res.row?.id).toBe('o-1');
    expect(res.scheduleDeductions).toEqual([]);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('overpayment-detail-not-found — no schedule query issued', async () => {
    configure({ scenarioResponses: [{ table: 'bn_overpayment', data: null }] });
    const res = await recorder.runAs(
      'getAwardOverpaymentDetail', 'overpayment-detail-not-found',
      () => getAwardOverpaymentDetail('o-missing'),
    );
    expect(res.row).toBeNull();
    expect(recorder.queries.find((q) => q.table === 'bn_payment_schedule')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. listAwardCommunicationsPaged
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · listAwardCommunicationsPaged', () => {
  it('communications-paged-claim-and-context — both branches, letter enrichment', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award', data: awardWithClaim },
        { table: 'bn_communication_log', occurrence: 1, data: [commLogRow] },
        { table: 'bn_communication_log', occurrence: 2, data: [commLogRowWithLetter] },
        { table: 'bn_letter', data: [letterRow] },
      ],
    });
    const res = await recorder.runAs(
      'listAwardCommunicationsPaged', 'communications-paged-claim-and-context',
      () => listAwardCommunicationsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }),
    );
    expect(res.total).toBe(2);
    const commQs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(commQs.length).toBe(2);
    expect(commQs.some((q) => q.filters.some((f) => f.method === 'eq' && f.column === 'claim_id' && f.value === CLAIM_ID))).toBe(true);
    expect(commQs.some((q) => q.filters.some((f) => f.method === 'contains' && f.column === 'context'))).toBe(true);
    const letter = recorder.queries.find((q) => q.table === 'bn_letter')!;
    expect(letter.filters.find((f) => f.method === 'in' && f.column === 'id')).toBeTruthy();
    // No unrestricted award-id column on the communication log.
    for (const q of commQs) {
      expect(q.selectedColumns).not.toContain('award_id');
    }
  });

  it('communications-paged-context-only — no claim → only contains branch', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award', data: awardNoClaim },
        { table: 'bn_communication_log', data: [commLogRow] },
      ],
    });
    const res = await recorder.runAs(
      'listAwardCommunicationsPaged', 'communications-paged-context-only',
      () => listAwardCommunicationsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }),
    );
    expect(res.total).toBe(1);
    const commQs = recorder.queries.filter((q) => q.table === 'bn_communication_log');
    expect(commQs).toHaveLength(1);
    expect(commQs[0].filters.some((f) => f.method === 'contains' && f.column === 'context')).toBe(true);
    expect(commQs[0].filters.some((f) => f.method === 'eq' && f.column === 'claim_id')).toBe(false);
  });

  it('communications-paged-pagination-and-deduplication — overlapping rows deduplicated', async () => {
    // Two branches, overlapping ids → dedup to 3 unique rows.
    const rowA = { ...commLogRow, id: 'cl-A' };
    const rowB = { ...commLogRow, id: 'cl-B' };
    const rowC = { ...commLogRow, id: 'cl-C' };
    configure({
      scenarioResponses: [
        { table: 'bn_award', data: awardWithClaim },
        { table: 'bn_communication_log', occurrence: 1, data: [rowA, rowB] },
        { table: 'bn_communication_log', occurrence: 2, data: [rowB, rowC] },
      ],
    });
    const res = await recorder.runAs(
      'listAwardCommunicationsPaged', 'communications-paged-pagination-and-deduplication',
      () => listAwardCommunicationsPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }),
    );
    expect(res.total).toBe(3);
    expect(res.rows.length).toBe(1);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(2);
  });

  it('communications-paged-one-branch-error — claim branch fails, context rows survive', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_award', data: awardWithClaim },
        { table: 'bn_communication_log', occurrence: 2, data: [commLogRow] },
      ],
      scenarioErrors: [
        { table: 'bn_communication_log', occurrence: 1, error: { message: 'branch boom' } },
      ],
    });
    const res = await recorder.runAs(
      'listAwardCommunicationsPaged', 'communications-paged-one-branch-error',
      () => listAwardCommunicationsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }),
    );
    expect(res.total).toBe(1);
    expect(res.warnings.length).toBeGreaterThan(0);
    // Manifest completeness: at least one scenario must observe bn_letter — this
    // scenario deliberately has no letter_id so no bn_letter query is emitted;
    // the primary claim-and-context scenario above covers it.
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. getAwardCommunicationDetail
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · getAwardCommunicationDetail', () => {
  it('communication-detail-with-letter — bn_letter queried by primary key', async () => {
    configure({
      scenarioResponses: [
        { table: 'bn_communication_log', data: commLogRowWithLetter },
        { table: 'bn_letter', data: letterRow },
      ],
    });
    const res = await recorder.runAs(
      'getAwardCommunicationDetail', 'communication-detail-with-letter',
      () => getAwardCommunicationDetail('cl-2', { canViewContent: true }),
    );
    expect(res.row?.id).toBe('cl-2');
    expect(res.letter?.id).toBe('lt-1');
    const comm = recorder.queries.find((q) => q.table === 'bn_communication_log')!;
    expect(comm.filters.find((f) => f.method === 'eq' && f.column === 'id')?.value).toBe('cl-2');
    const letter = recorder.queries.find((q) => q.table === 'bn_letter')!;
    expect(letter.filters.find((f) => f.method === 'eq' && f.column === 'id')?.value).toBe('lt-1');
  });

  it('communication-detail-without-letter — no letter query when letter_id null', async () => {
    configure({ scenarioResponses: [{ table: 'bn_communication_log', data: commLogRow }] });
    const res = await recorder.runAs(
      'getAwardCommunicationDetail', 'communication-detail-without-letter',
      () => getAwardCommunicationDetail('cl-1'),
    );
    expect(res.row?.id).toBe('cl-1');
    expect(res.letter).toBeNull();
    expect(recorder.queries.find((q) => q.table === 'bn_letter')).toBeUndefined();
  });

  it('communication-detail-letter-error — letter failure preserved as warning', async () => {
    configure({
      scenarioResponses: [{ table: 'bn_communication_log', data: commLogRowWithLetter }],
      scenarioErrors: [{ table: 'bn_letter', error: { message: 'boom' } }],
    });
    const res = await recorder.runAs(
      'getAwardCommunicationDetail', 'communication-detail-letter-error',
      () => getAwardCommunicationDetail('cl-2'),
    );
    expect(res.row?.id).toBe('cl-2');
    expect(res.letter).toBeNull();
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('communication-detail-not-found — no letter query', async () => {
    configure({ scenarioResponses: [{ table: 'bn_communication_log', data: null }] });
    const res = await recorder.runAs(
      'getAwardCommunicationDetail', 'communication-detail-not-found',
      () => getAwardCommunicationDetail('cl-missing'),
    );
    expect(res.row).toBeNull();
    expect(recorder.queries.find((q) => q.table === 'bn_letter')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. listAwardAuditPaged
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · listAwardAuditPaged', () => {
  it('audit-paged-all-sources — includeCentralAudit=true queries all four sources', async () => {
    configure({
      responses: {
        bn_award_status_event: [statusEvt],
        bn_award_rate_history: [rateEvt],
        bn_award_suspension_event: [suspEvt],
        core_audit_log: [centralEvt],
      },
    });
    const res = await recorder.runAs(
      'listAwardAuditPaged', 'audit-paged-all-sources',
      () => listAwardAuditPaged({ awardId: AWARD_ID, page: 1, pageSize: 50 }, { includeCentralAudit: true }),
    );
    expect(res.total).toBe(4);
    // Central audit composite scope.
    const central = recorder.queries.find((q) => q.table === 'core_audit_log')!;
    expect(central.filters.some((f) => f.column === 'entity_type' && f.value === 'bn_award')).toBe(true);
    expect(central.filters.some((f) => f.column === 'entity_id' && f.value === AWARD_ID)).toBe(true);
    // All award-scoped sources use bn_award_id.
    for (const t of ['bn_award_status_event', 'bn_award_rate_history', 'bn_award_suspension_event']) {
      const q = recorder.queries.find((x) => x.table === t)!;
      expect(q.filters.find((f) => f.column === 'bn_award_id')?.value, `${t} scope`).toBe(AWARD_ID);
    }
  });

  it('audit-paged-without-central — includeCentralAudit=false skips core_audit_log', async () => {
    configure({
      responses: {
        bn_award_status_event: [statusEvt],
        bn_award_rate_history: [rateEvt],
        bn_award_suspension_event: [suspEvt],
      },
    });
    const res = await recorder.runAs(
      'listAwardAuditPaged', 'audit-paged-without-central',
      () => listAwardAuditPaged({ awardId: AWARD_ID, page: 1, pageSize: 50 }, { includeCentralAudit: false }),
    );
    expect(res.total).toBe(3);
    expect(recorder.queries.find((q) => q.table === 'core_audit_log')).toBeUndefined();
    const centralSource = res.sources.find((s) => s.key === 'central')!;
    expect(centralSource.restricted).toBe(true);
  });

  it('audit-paged-one-source-error — rate failure isolated; other sources contribute', async () => {
    configure({
      responses: {
        bn_award_status_event: [statusEvt],
        bn_award_suspension_event: [suspEvt],
      },
      scenarioErrors: [{ table: 'bn_award_rate_history', error: { message: 'boom' } }],
    });
    const res = await recorder.runAs(
      'listAwardAuditPaged', 'audit-paged-one-source-error',
      () => listAwardAuditPaged({ awardId: AWARD_ID, page: 1, pageSize: 50 }, { includeCentralAudit: false }),
    );
    expect(res.warnings.length).toBeGreaterThan(0);
    expect(res.rows.length).toBeGreaterThanOrEqual(2);
    const rateSource = res.sources.find((s) => s.key === 'rate')!;
    expect(rateSource.loaded).toBe(false);
    expect(rateSource.error).toBeTruthy();
  });

  it('audit-paged-date-and-page-boundary — date range + non-default page honoured', async () => {
    configure({
      responses: {
        bn_award_status_event: [statusEvt, { ...statusEvt, id: 'st-2', event_date: '2026-02-05T00:00:00Z' }],
        bn_award_rate_history: [],
        bn_award_suspension_event: [],
      },
    });
    const res = await recorder.runAs(
      'listAwardAuditPaged', 'audit-paged-date-and-page-boundary',
      () => listAwardAuditPaged(
        { awardId: AWARD_ID, page: 2, pageSize: 1, from: '2026-01-01', to: '2026-02-28' },
        { includeCentralAudit: false },
      ),
    );
    expect(res.total).toBe(2);
    expect(res.rows.length).toBe(1);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite-scoped evidence reconciliation
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D2 · certification evidence reconciliation', () => {
  it('every registered scenario ran; observed tables match manifest.expectedTables', () => {
    assertLoaderCertificationEvidence({
      suiteId: 'operational-complex-certification',
      capturedExecutions,
    });
  });

  it('no other-suite loader leaked into this collector', () => {
    const leaked = capturedExecutions.filter((e) => [
      'getAward360Header', 'getAwardProductDeep', 'listAwardBeneficiaries',
    ].includes(e.loaderName));
    expect(leaked, 'other-suite loaders must run in their own files').toEqual([]);
  });
});
