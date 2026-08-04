/**
 * BN-AWARD360-B1 — Service-level tests for paged queries.
 * Ensures Supabase errors surface (not silently converted to empty arrays),
 * and summaries + filters behave correctly on happy paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Chainable mock builder that returns configured data/error at await time.
function makeThenable(payload: { data: any; error: any; count?: number }) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    ilike: () => chain,
    contains: () => chain,
    or: () => chain,
    order: () => chain,
    range: () => chain,
    maybeSingle: () => Promise.resolve({ data: payload.data, error: payload.error }),
    then: (resolve: any) => resolve({ data: payload.data, error: payload.error, count: payload.count }),
  };
  return chain;
}

const fromMock = vi.fn();
// Life certificates are read through a secured RPC (table grants are revoked).
const rpcMock = vi.fn();
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (t: string) => fromMock(t),
    rpc: (n: string, a: Record<string, unknown>) => rpcMock(n, a),
  },
}));

import {
  listAwardSchedulesPaged,
  listAwardPaymentsPaged,
  listAwardLifeCertificatesPaged,
} from '@/services/bn/awards/award360Service';

beforeEach(() => {
  fromMock.mockReset();
  rpcMock.mockReset();
});

describe('BN-AWARD360-B1 · listAwardSchedulesPaged', () => {
  it('throws when Supabase returns an error (does not swallow into [])', async () => {
    fromMock.mockReturnValue(makeThenable({ data: null, error: { message: 'boom' } }));
    await expect(
      listAwardSchedulesPaged({ awardId: 'a', page: 1, pageSize: 10 }),
    ).rejects.toBeTruthy();
  });

  it('computes summary and applies filters', async () => {
    const rows = [
      { id: '1', schedule_period: '2026-01', due_date: '2020-01-01', gross_amount: 100, deductions: 10, net_amount: 90, status: 'PENDING', payment_method: 'EFT', payment_ref: 'R1', paid_at: null, bn_payment_instruction_id: null, notes: null },
      { id: '2', schedule_period: '2026-02', due_date: '2026-02-01', gross_amount: 100, deductions: 10, net_amount: 90, status: 'PAID', payment_method: 'EFT', payment_ref: 'R2', paid_at: '2026-02-05', bn_payment_instruction_id: 'pi', notes: null },
    ];
    fromMock.mockReturnValue(makeThenable({ data: rows, error: null }));
    const res = await listAwardSchedulesPaged({ awardId: 'a', page: 1, pageSize: 10 });
    expect(res.total).toBe(2);
    expect(res.summary.totalNet).toBe(180);
    expect(res.summary.paidAmount).toBe(90);
    expect(res.summary.overdueUnpaidAmount).toBe(90);

    const filtered = await listAwardSchedulesPaged({ awardId: 'a', page: 1, pageSize: 10, statuses: ['PAID'] });
    fromMock.mockReturnValue(makeThenable({ data: rows, error: null }));
    const filtered2 = await listAwardSchedulesPaged({ awardId: 'a', page: 1, pageSize: 10, statuses: ['PAID'] });
    expect(filtered2.rows.length).toBe(1);
    expect(filtered2.rows[0].status).toBe('PAID');
    // avoid unused variable warning
    void filtered;
  });
});

describe('BN-AWARD360-B1 · listAwardPaymentsPaged', () => {
  it('surfaces Supabase errors', async () => {
    fromMock.mockReturnValue(makeThenable({ data: null, error: { message: 'x' } }));
    await expect(
      listAwardPaymentsPaged({ awardId: 'a', page: 1, pageSize: 10 }),
    ).rejects.toBeTruthy();
  });

  it('classifies known statuses and counts "other"', async () => {
    const rows = [
      { id: '1', amount: 100, currency: 'XCD', payment_method: 'EFT', bank_code: null, account_number: '1234567890', due_date: '2026-01-01', status: 'PAID', paid_date: '2026-01-01', payment_reference: 'A', cancel_reason: null },
      { id: '2', amount: 50, currency: 'XCD', payment_method: 'EFT', bank_code: null, account_number: null, due_date: null, status: 'FAILED', paid_date: null, payment_reference: 'B', cancel_reason: 'x' },
      { id: '3', amount: 20, currency: 'XCD', payment_method: 'EFT', bank_code: null, account_number: null, due_date: null, status: 'WEIRD', paid_date: null, payment_reference: 'C', cancel_reason: null },
    ];
    fromMock.mockReturnValue(makeThenable({ data: rows, error: null }));
    const res = await listAwardPaymentsPaged({ awardId: 'a', page: 1, pageSize: 10 });
    expect(res.summary.paidCount).toBe(1);
    expect(res.summary.failedCount).toBe(1);
    expect(res.summary.otherCount).toBe(1);
    expect(res.rows[0].accountMasked).toContain('••••');
  });
});

describe('BN-AWARD360-B1 · listAwardLifeCertificatesPaged', () => {
  it('surfaces Supabase errors on the base query', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(
      listAwardLifeCertificatesPaged({ awardId: 'a', page: 1, pageSize: 10 }),
    ).rejects.toBeTruthy();
  });

  it('computes overdue and compliance without pretending payment is held', async () => {
    const rows = [
      { id: '1', required_for_period: '2020', due_date: '2020-01-01', submitted_date: null, verified_date: null, verification_method: null, status: 'PENDING', remarks: null },
    ];
    rpcMock.mockResolvedValue({ data: rows, error: null });
    const res = await listAwardLifeCertificatesPaged({ awardId: 'a', page: 1, pageSize: 10 });
    expect(res.summary.overdueCycles).toBe(1);
    expect(res.summary.compliance.state).toBe('OVERDUE');
    expect(res.summary.compliance.paymentImpact).not.toBe('PAYMENT_HELD');
  });
});
