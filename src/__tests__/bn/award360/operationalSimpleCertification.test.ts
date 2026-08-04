/**
 * AW360-WAVE-1-C1 Stage D1 — Operational Simple Loader Certification.
 *
 * Matrix-driven certification of the 16 simple one-table operational
 * loaders (Beneficiaries, Schedules, Payments, Life Certificates, Medical
 * Reviews, Overpayments). Every scenario listed in the
 * `operational-simple-certification` suite of
 * `AWARD360_CERTIFICATION_REGISTRY` is executed here against the real
 * production loader through `AwardQueryRecorder`. The recorder validates
 * every query against `AWARD360_SCHEMA_CONTRACT`:
 *
 *   • unknown table                  → reject
 *   • unknown column / select('*')   → reject
 *   • missing / wrong scope filter   → reject
 *   • disallowed order column        → reject
 *   • unsupported query verb         → reject
 *
 * Reconciliation at the end of the suite proves — via the shared
 * `assertLoaderCertificationEvidence` helper — that:
 *
 *   1. every registered scenario was executed at least once,
 *   2. no unregistered scenario tagged to a suite-owned loader appeared,
 *   3. the observed table union per loader equals its manifest
 *      `expectedTables`,
 *   4. every observed table is declared in the schema contract.
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
  listAwardBeneficiaries,
  listAwardBeneficiariesPaged,
  getAwardBeneficiaryDetail,
  listAwardSchedules,
  listAwardSchedulesPaged,
  getAwardScheduleDetail,
  listAwardPayments,
  listAwardPaymentsPaged,
  listAwardLifeCertificates,
  listAwardLifeCertificatesPaged,
  getAwardLifeCertificateReminders,
  listAwardMedicalReviews,
  listAwardMedicalReviewsPaged,
  getAwardMedicalReviewDetail,
  listAwardOverpayments,
  listAwardOverpaymentsPaged,
} from '@/services/bn/awards/award360Service';

// ─── helpers ──────────────────────────────────────────────────────────────
function setResponses(map: Record<string, unknown>) {
  (recorder as any).opts.responses = map;
  (recorder as any).opts.errors = {};
  (recorder as any).opts.scenarioErrors = [];
  (recorder as any).opts.scenarioResponses = [];
}
function setErrors(map: Record<string, { message: string; code?: string }>) {
  (recorder as any).opts.errors = map;
  (recorder as any).opts.responses = {};
  (recorder as any).opts.scenarioResponses = [];
}
function setScenarioResponses(rules: Array<{
  table: string;
  loaderName?: string;
  scenarioId?: string;
  occurrence?: number;
  data: unknown;
}>) {
  (recorder as any).opts.scenarioResponses = rules;
}

beforeEach(() => {
  recorder.reset();
  (recorder as any).opts.responses = {};
  (recorder as any).opts.errors = {};
  (recorder as any).opts.scenarioErrors = [];
  (recorder as any).opts.scenarioResponses = [];
});

const AWARD_ID = 'a-1';

// ─── fixtures ─────────────────────────────────────────────────────────────
const beneficiaryRow = {
  id: 'b-1', full_name: 'Alice', beneficiary_ssn: 'SSN-1', relationship: 'SPOUSE',
  share_percent: 100, share_amount: 500, start_date: '2024-01-01', end_date: null,
  status: 'ACTIVE', bank_acct: '1234567890', bank_code: 'BK1', notes: null,
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
  bank_code: 'BK1', account_number: '1234567890', due_date: '2026-01-01',
  status: 'PAID', paid_date: '2026-01-01', payment_reference: 'PR1', cancel_reason: null,
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
  id: 'o-1', detected_date: '2026-01-01', period_from: '2025-01-01',
  period_to: '2025-12-31', original_amount: 500, recovered_amount: 100,
  outstanding_amount: 400, recovery_method: 'DEDUCTION', recovery_status: 'IN_RECOVERY',
  reason_code: 'REASON', remarks: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// Beneficiaries
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Beneficiaries', () => {
  it('listAwardBeneficiaries — populated, empty, error', async () => {
    setResponses({ bn_award_beneficiary: [beneficiaryRow] });
    const rows = await recorder.runAs('listAwardBeneficiaries', 'list-beneficiaries-populated',
      () => listAwardBeneficiaries(AWARD_ID));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('start_date');
    expect(q.selectedColumns).toEqual(expect.arrayContaining(['id', 'full_name', 'share_percent']));

    setResponses({ bn_award_beneficiary: [] });
    const empty = await recorder.runAs('listAwardBeneficiaries', 'list-beneficiaries-empty',
      () => listAwardBeneficiaries(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_award_beneficiary: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardBeneficiaries', 'list-beneficiaries-error',
      () => listAwardBeneficiaries(AWARD_ID));
    expect(errRes).toEqual([]); // loader swallows destructured undefined
  });

  it('listAwardBeneficiariesPaged — populated, empty, error, pagination', async () => {
    setResponses({ bn_award_beneficiary: [beneficiaryRow] });
    const res = await recorder.runAs('listAwardBeneficiariesPaged', 'list-beneficiaries-paged-populated',
      () => listAwardBeneficiariesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(res.total).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.page).toBe(1);

    setResponses({ bn_award_beneficiary: [] });
    const empty = await recorder.runAs('listAwardBeneficiariesPaged', 'list-beneficiaries-paged-empty',
      () => listAwardBeneficiariesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_award_beneficiary: { message: 'boom' } });
    await expect(recorder.runAs('listAwardBeneficiariesPaged', 'list-beneficiaries-paged-error',
      () => listAwardBeneficiariesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    // pagination: 5 rows, page 2 of pageSize 2 → rows.length=2, total=5
    const many = Array.from({ length: 5 }, (_, i) => ({ ...beneficiaryRow, id: `b-${i}` }));
    setResponses({ bn_award_beneficiary: many });
    const pg = await recorder.runAs('listAwardBeneficiariesPaged', 'list-beneficiaries-paged-pagination',
      () => listAwardBeneficiariesPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });

  it('getAwardBeneficiaryDetail — populated, not-found, error', async () => {
    setResponses({ bn_award_beneficiary: beneficiaryRow });
    const ok = await recorder.runAs('getAwardBeneficiaryDetail', 'beneficiary-detail-populated',
      () => getAwardBeneficiaryDetail('b-1'));
    expect(ok.row?.id).toBe('b-1');
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'id')?.value).toBe('b-1');

    setResponses({ bn_award_beneficiary: null });
    const nf = await recorder.runAs('getAwardBeneficiaryDetail', 'beneficiary-detail-not-found',
      () => getAwardBeneficiaryDetail('b-missing'));
    expect(nf.row).toBeNull();

    setErrors({ bn_award_beneficiary: { message: 'boom' } });
    await expect(recorder.runAs('getAwardBeneficiaryDetail', 'beneficiary-detail-error',
      () => getAwardBeneficiaryDetail('b-1'))).rejects.toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Schedules
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Schedules', () => {
  it('listAwardSchedules — populated, empty, error', async () => {
    setResponses({ bn_payment_schedule: [scheduleRow] });
    const rows = await recorder.runAs('listAwardSchedules', 'list-schedules-populated',
      () => listAwardSchedules(AWARD_ID));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('due_date');

    setResponses({ bn_payment_schedule: [] });
    const empty = await recorder.runAs('listAwardSchedules', 'list-schedules-empty',
      () => listAwardSchedules(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_payment_schedule: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardSchedules', 'list-schedules-error',
      () => listAwardSchedules(AWARD_ID));
    expect(errRes).toEqual([]);
  });

  it('listAwardSchedulesPaged — populated, empty, error, pagination', async () => {
    setResponses({ bn_payment_schedule: [scheduleRow] });
    const ok = await recorder.runAs('listAwardSchedulesPaged', 'list-schedules-paged-populated',
      () => listAwardSchedulesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(ok.total).toBe(1);

    setResponses({ bn_payment_schedule: [] });
    const empty = await recorder.runAs('listAwardSchedulesPaged', 'list-schedules-paged-empty',
      () => listAwardSchedulesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_payment_schedule: { message: 'boom' } });
    await expect(recorder.runAs('listAwardSchedulesPaged', 'list-schedules-paged-error',
      () => listAwardSchedulesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    const many = Array.from({ length: 5 }, (_, i) => ({ ...scheduleRow, id: `s-${i}` }));
    setResponses({ bn_payment_schedule: many });
    const pg = await recorder.runAs('listAwardSchedulesPaged', 'list-schedules-paged-pagination',
      () => listAwardSchedulesPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });

  it('getAwardScheduleDetail — populated (with instruction), not-found, error', async () => {
    setScenarioResponses([
      { table: 'bn_payment_schedule', loaderName: 'getAwardScheduleDetail', scenarioId: 'schedule-detail-populated',
        data: { ...scheduleRow, bn_payment_instruction_id: 'pi-1' } },
      { table: 'bn_payment_instruction', loaderName: 'getAwardScheduleDetail', scenarioId: 'schedule-detail-populated',
        data: paymentRow },
    ]);
    const ok = await recorder.runAs('getAwardScheduleDetail', 'schedule-detail-populated',
      () => getAwardScheduleDetail('s-1'));
    expect(ok.row?.id).toBe('s-1');
    expect(ok.instruction?.id).toBe('p-1');

    setResponses({ bn_payment_schedule: null });
    const nf = await recorder.runAs('getAwardScheduleDetail', 'schedule-detail-not-found',
      () => getAwardScheduleDetail('s-missing'));
    expect(nf.row).toBeNull();

    setErrors({ bn_payment_schedule: { message: 'boom' } });
    await expect(recorder.runAs('getAwardScheduleDetail', 'schedule-detail-error',
      () => getAwardScheduleDetail('s-1'))).rejects.toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payments
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Payments', () => {
  it('listAwardPayments — populated, empty, error', async () => {
    setResponses({ bn_payment_instruction: [paymentRow] });
    const rows = await recorder.runAs('listAwardPayments', 'list-payments-populated',
      () => listAwardPayments(AWARD_ID, 50));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('due_date');
    expect(q.range).toEqual([0, 49]);

    setResponses({ bn_payment_instruction: [] });
    const empty = await recorder.runAs('listAwardPayments', 'list-payments-empty',
      () => listAwardPayments(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_payment_instruction: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardPayments', 'list-payments-error',
      () => listAwardPayments(AWARD_ID));
    expect(errRes).toEqual([]);
  });

  it('listAwardPaymentsPaged — populated, empty, error, pagination', async () => {
    setResponses({ bn_payment_instruction: [paymentRow] });
    const ok = await recorder.runAs('listAwardPaymentsPaged', 'list-payments-paged-populated',
      () => listAwardPaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(ok.total).toBe(1);

    setResponses({ bn_payment_instruction: [] });
    const empty = await recorder.runAs('listAwardPaymentsPaged', 'list-payments-paged-empty',
      () => listAwardPaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_payment_instruction: { message: 'boom' } });
    await expect(recorder.runAs('listAwardPaymentsPaged', 'list-payments-paged-error',
      () => listAwardPaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    const many = Array.from({ length: 5 }, (_, i) => ({ ...paymentRow, id: `p-${i}` }));
    setResponses({ bn_payment_instruction: many });
    const pg = await recorder.runAs('listAwardPaymentsPaged', 'list-payments-paged-pagination',
      () => listAwardPaymentsPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Life Certificates
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Life Certificates', () => {
  it('listAwardLifeCertificates — populated, empty, error', async () => {
    setResponses({ bn_life_certificate: [lifeCertRow] });
    const rows = await recorder.runAs('listAwardLifeCertificates', 'list-life-cert-populated',
      () => listAwardLifeCertificates(AWARD_ID));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('due_date');

    setResponses({ bn_life_certificate: [] });
    const empty = await recorder.runAs('listAwardLifeCertificates', 'list-life-cert-empty',
      () => listAwardLifeCertificates(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_life_certificate: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardLifeCertificates', 'list-life-cert-error',
      () => listAwardLifeCertificates(AWARD_ID));
    expect(errRes).toEqual([]);
  });

  it('listAwardLifeCertificatesPaged — populated (with reminder chain), empty, error, pagination', async () => {
    setScenarioResponses([
      { table: 'bn_life_certificate', loaderName: 'listAwardLifeCertificatesPaged',
        scenarioId: 'list-life-cert-paged-populated', data: [lifeCertRow] },
      { table: 'bn_award', loaderName: 'listAwardLifeCertificatesPaged',
        scenarioId: 'list-life-cert-paged-populated', data: { bn_claim_id: 'c-1' } },
      { table: 'bn_communication_log', loaderName: 'listAwardLifeCertificatesPaged',
        scenarioId: 'list-life-cert-paged-populated', data: [{ id: 'log-1' }, { id: 'log-2' }] },
    ]);
    const ok = await recorder.runAs('listAwardLifeCertificatesPaged', 'list-life-cert-paged-populated',
      () => listAwardLifeCertificatesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(ok.total).toBe(1);
    expect(ok.summary.reminderCount).toBe(2);

    setResponses({ bn_life_certificate: [], bn_award: { bn_claim_id: null } });
    const empty = await recorder.runAs('listAwardLifeCertificatesPaged', 'list-life-cert-paged-empty',
      () => listAwardLifeCertificatesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_life_certificate: { message: 'boom' } });
    await expect(recorder.runAs('listAwardLifeCertificatesPaged', 'list-life-cert-paged-error',
      () => listAwardLifeCertificatesPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    const many = Array.from({ length: 5 }, (_, i) => ({ ...lifeCertRow, id: `lc-${i}` }));
    setResponses({ bn_life_certificate: many, bn_award: { bn_claim_id: null } });
    const pg = await recorder.runAs('listAwardLifeCertificatesPaged', 'list-life-cert-paged-pagination',
      () => listAwardLifeCertificatesPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });

  it('getAwardLifeCertificateReminders — populated (award has claim), no-claim', async () => {
    setResponses({
      bn_award: { bn_claim_id: 'c-1' },
      bn_communication_log: [
        { id: 'log-1', event_code: 'LIFE_CERT_REMINDER', created_at: '2026-01-05' },
        { id: 'log-2', event_code: 'OTHER', created_at: '2026-01-04' },
      ],
    });
    const ok = await recorder.runAs('getAwardLifeCertificateReminders', 'life-cert-reminders-populated',
      () => getAwardLifeCertificateReminders(AWARD_ID, 20));
    // Only the LIFE_CERT_REMINDER row is retained.
    expect(ok.items.some((i) => i.eventCode === 'LIFE_CERT_REMINDER')).toBe(true);

    setResponses({ bn_award: { bn_claim_id: null }, bn_communication_log: [] });
    const noClaim = await recorder.runAs('getAwardLifeCertificateReminders', 'life-cert-reminders-no-claim',
      () => getAwardLifeCertificateReminders(AWARD_ID, 20));
    expect(noClaim.items).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Medical Reviews
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Medical Reviews', () => {
  it('listAwardMedicalReviews — populated, empty, error', async () => {
    setResponses({ bn_medical_review_schedule: [medicalRow] });
    const rows = await recorder.runAs('listAwardMedicalReviews', 'list-medical-populated',
      () => listAwardMedicalReviews(AWARD_ID));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('scheduled_date');

    setResponses({ bn_medical_review_schedule: [] });
    const empty = await recorder.runAs('listAwardMedicalReviews', 'list-medical-empty',
      () => listAwardMedicalReviews(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_medical_review_schedule: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardMedicalReviews', 'list-medical-error',
      () => listAwardMedicalReviews(AWARD_ID));
    expect(errRes).toEqual([]);
  });

  it('listAwardMedicalReviewsPaged — populated (masked sensitive), empty, error, pagination', async () => {
    setResponses({ bn_medical_review_schedule: [medicalRow] });
    const ok = await recorder.runAs('listAwardMedicalReviewsPaged', 'list-medical-paged-populated',
      () => listAwardMedicalReviewsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(ok.total).toBe(1);
    expect(ok.rows[0].provider).toBeNull(); // sensitive masked

    setResponses({ bn_medical_review_schedule: [] });
    const empty = await recorder.runAs('listAwardMedicalReviewsPaged', 'list-medical-paged-empty',
      () => listAwardMedicalReviewsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_medical_review_schedule: { message: 'boom' } });
    await expect(recorder.runAs('listAwardMedicalReviewsPaged', 'list-medical-paged-error',
      () => listAwardMedicalReviewsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    const many = Array.from({ length: 5 }, (_, i) => ({ ...medicalRow, id: `m-${i}` }));
    setResponses({ bn_medical_review_schedule: many });
    const pg = await recorder.runAs('listAwardMedicalReviewsPaged', 'list-medical-paged-pagination',
      () => listAwardMedicalReviewsPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });

  it('getAwardMedicalReviewDetail — populated, not-found, error (captured to warnings)', async () => {
    setResponses({ bn_medical_review_schedule: medicalRow });
    const ok = await recorder.runAs('getAwardMedicalReviewDetail', 'medical-detail-populated',
      () => getAwardMedicalReviewDetail('m-1'));
    expect(ok.row?.id).toBe('m-1');
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'id')?.value).toBe('m-1');

    setResponses({ bn_medical_review_schedule: null });
    const nf = await recorder.runAs('getAwardMedicalReviewDetail', 'medical-detail-not-found',
      () => getAwardMedicalReviewDetail('m-missing'));
    expect(nf.row).toBeNull();

    setErrors({ bn_medical_review_schedule: { message: 'boom' } });
    const errRes = await recorder.runAs('getAwardMedicalReviewDetail', 'medical-detail-error',
      () => getAwardMedicalReviewDetail('m-1'));
    expect(errRes.row).toBeNull();
    expect(errRes.warnings.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Overpayments
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · Overpayments', () => {
  it('listAwardOverpayments — populated, empty, error', async () => {
    setResponses({ bn_overpayment: [overpaymentRow] });
    const rows = await recorder.runAs('listAwardOverpayments', 'list-overpayments-populated',
      () => listAwardOverpayments(AWARD_ID));
    expect(rows).toHaveLength(1);
    const q = recorder.queries.at(-1)!;
    expect(q.filters.find((f) => f.column === 'bn_award_id')?.value).toBe(AWARD_ID);
    expect(q.orderColumns).toContain('detected_date');

    setResponses({ bn_overpayment: [] });
    const empty = await recorder.runAs('listAwardOverpayments', 'list-overpayments-empty',
      () => listAwardOverpayments(AWARD_ID));
    expect(empty).toEqual([]);

    setErrors({ bn_overpayment: { message: 'boom' } });
    const errRes = await recorder.runAs('listAwardOverpayments', 'list-overpayments-error',
      () => listAwardOverpayments(AWARD_ID));
    expect(errRes).toEqual([]);
  });

  it('listAwardOverpaymentsPaged — populated, empty, error, pagination', async () => {
    setResponses({ bn_overpayment: [overpaymentRow] });
    const ok = await recorder.runAs('listAwardOverpaymentsPaged', 'list-overpayments-paged-populated',
      () => listAwardOverpaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(ok.total).toBe(1);

    setResponses({ bn_overpayment: [] });
    const empty = await recorder.runAs('listAwardOverpaymentsPaged', 'list-overpayments-paged-empty',
      () => listAwardOverpaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }));
    expect(empty.total).toBe(0);

    setErrors({ bn_overpayment: { message: 'boom' } });
    await expect(recorder.runAs('listAwardOverpaymentsPaged', 'list-overpayments-paged-error',
      () => listAwardOverpaymentsPaged({ awardId: AWARD_ID, page: 1, pageSize: 10 }))).rejects.toBeTruthy();

    const many = Array.from({ length: 5 }, (_, i) => ({ ...overpaymentRow, id: `o-${i}` }));
    setResponses({ bn_overpayment: many });
    const pg = await recorder.runAs('listAwardOverpaymentsPaged', 'list-overpayments-paged-pagination',
      () => listAwardOverpaymentsPaged({ awardId: AWARD_ID, page: 2, pageSize: 2 }));
    expect(pg.total).toBe(5);
    expect(pg.rows.length).toBe(2);
    expect(pg.page).toBe(2);
    expect(pg.pageSize).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Suite-scoped evidence reconciliation
// ═══════════════════════════════════════════════════════════════════════════
describe('AW360 Stage D1 · certification evidence reconciliation', () => {
  it('every registered scenario was executed and observed tables match the manifest', () => {
    assertLoaderCertificationEvidence({
      suiteId: 'operational-simple-certification',
      capturedExecutions,
    });
  });

  it('no main-suite or product-deep execution leaked into this collector', () => {
    const leaked = capturedExecutions.filter(
      (e) => e.loaderName === 'getAwardProductDeep' || e.loaderName === 'getAward360Header',
    );
    expect(leaked, 'main-suite / product-deep loaders must run in their own files').toEqual([]);
  });
});
