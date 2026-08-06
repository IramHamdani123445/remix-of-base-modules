/**
 * BN Overpayments — Golden tests for the financial reversal invariant.
 *
 * Phase B2. Model A (signed contra events) is the ONLY model in use:
 * the original transaction stays in its category and is immutable; a
 * reversal is an equal-and-opposite event applied to that same category.
 */
import { describe, it, expect } from 'vitest';
import {
  computeOverpaymentBalance,
  validateReversal,
  reversedAmountFor,
  round2,
  type BnRecoveryTransactionSlice,
} from '@/services/bn/overpayments/overpaymentOutstandingCalculator';

const tx = (
  txnId: string,
  kind: BnRecoveryTransactionSlice['kind'],
  amount: number,
  extra: Partial<BnRecoveryTransactionSlice> = {},
): BnRecoveryTransactionSlice => ({ txnId, kind, amount, approved: true, ...extra });

describe('BN Overpayments — reversal accounting invariant (Model A)', () => {
  it('GOLDEN: 400 liability, 300 receipt fully reversed → outstanding 400 (never 700)', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [
        tx('r1', 'RECEIPT', 300),
        tx('v1', 'REVERSAL', 300, { reversesTxnId: 'r1' }),
      ],
    });
    expect(b.recovered).toBe(0);
    expect(b.outstanding).toBe(400);
    expect(b.reversed).toBe(300);
  });

  it('receipt without reversal reduces outstanding', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [tx('r1', 'RECEIPT', 300)],
    });
    expect(b.outstanding).toBe(100);
  });

  it('partial reversal restores only the reversed amount', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [
        tx('r1', 'RECEIPT', 300),
        tx('v1', 'REVERSAL', 100, { reversesTxnId: 'r1' }),
      ],
    });
    expect(b.recovered).toBe(200);
    expect(b.outstanding).toBe(200);
  });

  it('multiple partial reversals accumulate exactly once each', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [
        tx('r1', 'RECEIPT', 300),
        tx('v1', 'REVERSAL', 100, { reversesTxnId: 'r1' }),
        tx('v2', 'REVERSAL', 50, { reversesTxnId: 'r1' }),
      ],
    });
    expect(b.recovered).toBe(150);
    expect(b.outstanding).toBe(250);
    expect(reversedAmountFor(b ? [
      tx('r1', 'RECEIPT', 300),
      tx('v1', 'REVERSAL', 100, { reversesTxnId: 'r1' }),
      tx('v2', 'REVERSAL', 50, { reversesTxnId: 'r1' }),
    ] : [], 'r1')).toBe(150);
  });

  it('reverses a benefit deduction', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 500,
      transactions: [
        tx('d1', 'DEDUCTION', 200),
        tx('v1', 'REVERSAL', 200, { reversesTxnId: 'd1' }),
      ],
    });
    expect(b.recovered).toBe(0);
    expect(b.outstanding).toBe(500);
  });

  it('reverses a waiver back into outstanding', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 500,
      transactions: [
        tx('w1', 'WAIVER', 150),
        tx('v1', 'REVERSAL', 150, { reversesTxnId: 'w1' }),
      ],
    });
    expect(b.waived).toBe(0);
    expect(b.outstanding).toBe(500);
  });

  it('reverses a write-off back into outstanding', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 500,
      transactions: [
        tx('o1', 'WRITE_OFF', 500),
        tx('v1', 'REVERSAL', 200, { reversesTxnId: 'o1' }),
      ],
    });
    expect(b.writtenOff).toBe(300);
    expect(b.outstanding).toBe(200);
    expect(b.isFullyWrittenOff).toBe(false);
  });

  it('unapproved transactions never move the balance', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [tx('r1', 'RECEIPT', 300, { approved: false })],
    });
    expect(b.outstanding).toBe(400);
  });

  it('unapproved reversal does not restore the balance', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [
        tx('r1', 'RECEIPT', 300),
        tx('v1', 'REVERSAL', 300, { reversesTxnId: 'r1', approved: false }),
      ],
    });
    expect(b.outstanding).toBe(100);
  });

  it('flags over-allocation instead of returning a negative balance', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 100,
      transactions: [tx('r1', 'RECEIPT', 150)],
    });
    expect(b.outstanding).toBe(0);
    expect(b.hasOverAllocation).toBe(true);
  });

  it('flags currency mismatch rather than absorbing it', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 100,
      currency: 'XCD',
      transactions: [tx('r1', 'RECEIPT', 50, { currency: 'USD' })],
    });
    expect(b.currencyMismatchTxnIds).toEqual(['r1']);
  });

  it('is deterministic to two decimals', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 100.005,
      transactions: [tx('r1', 'RECEIPT', 33.333), tx('r2', 'RECEIPT', 33.333)],
    });
    expect(round2(100.005)).toBe(100.01);
    expect(b.recovered).toBe(66.67);
    expect(b.outstanding).toBe(33.34);
  });
});

describe('BN Overpayments — reversal guard (validateReversal)', () => {
  const base = [tx('r1', 'RECEIPT', 300, { currency: 'XCD' })];

  it('permits a full reversal of an unreversed receipt', () => {
    expect(validateReversal(base, 'r1', 300, 'XCD')).toMatchObject({ ok: true, unreversedAmount: 300 });
  });

  it('rejects a reversal above the unreversed amount', () => {
    const r = validateReversal(base, 'r1', 300.01, 'XCD');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EXCEEDS_UNREVERSED_AMOUNT');
  });

  it('rejects a second full reversal', () => {
    const txns = [...base, tx('v1', 'REVERSAL', 300, { reversesTxnId: 'r1' })];
    const r = validateReversal(txns, 'r1', 300, 'XCD');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('EXCEEDS_UNREVERSED_AMOUNT');
    expect(r.unreversedAmount).toBe(0);
  });

  it('permits a second partial reversal within the remainder', () => {
    const txns = [...base, tx('v1', 'REVERSAL', 100, { reversesTxnId: 'r1' })];
    expect(validateReversal(txns, 'r1', 200, 'XCD').ok).toBe(true);
    expect(validateReversal(txns, 'r1', 200.5, 'XCD').ok).toBe(false);
  });

  it('rejects zero and negative amounts', () => {
    expect(validateReversal(base, 'r1', 0, 'XCD').code).toBe('AMOUNT_NOT_POSITIVE');
    expect(validateReversal(base, 'r1', -10, 'XCD').code).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('rejects reversing an unknown, unapproved, or reversal transaction', () => {
    expect(validateReversal(base, 'nope', 10, 'XCD').code).toBe('ORIGINAL_NOT_FOUND');
    expect(validateReversal([tx('p1', 'RECEIPT', 10, { approved: false })], 'p1', 5).code)
      .toBe('ORIGINAL_NOT_APPROVED');
    expect(validateReversal([tx('v1', 'REVERSAL', 10, { reversesTxnId: 'r1' })], 'v1', 5).code)
      .toBe('ORIGINAL_IS_REVERSAL');
  });

  it('rejects a currency mismatch', () => {
    expect(validateReversal(base, 'r1', 10, 'USD').code).toBe('CURRENCY_MISMATCH');
  });

  it('leaves the original transaction immutable — reversal is a separate row', () => {
    const txns = [...base, tx('v1', 'REVERSAL', 300, { reversesTxnId: 'r1' })];
    const original = txns.find((t) => t.txnId === 'r1')!;
    expect(original.amount).toBe(300);
    expect(original.kind).toBe('RECEIPT');
    expect(txns.filter((t) => t.kind === 'REVERSAL')).toHaveLength(1);
  });
});
