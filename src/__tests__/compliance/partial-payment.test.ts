import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  authorityIsLive,
  buildDefaultAllocation,
  CePartialPaymentConfigError,
  evaluatePartialPaymentObligation,
  isPartialPaymentViolation,
  partialPaymentSuppressesNonPayment,
  validateAllocation,
  type CePartialPaymentAuthority,
  type CePartialPaymentLiability,
} from '@/lib/compliance/partialPaymentAllocation';

const liability: CePartialPaymentLiability = {
  total_outstanding: 10000,
  buckets: [
    { payment_code: 'SSC', bucket_label: 'Social Security Contributions', fund_code: 'SS', outstanding_amount: 6000 },
    { payment_code: 'LVC', bucket_label: 'Severance Levy Contributions', fund_code: 'LV', outstanding_amount: 1500 },
    { payment_code: 'SSF', bucket_label: 'Social Security Fines', fund_code: 'SS', outstanding_amount: 2000 },
    { payment_code: 'SLF', bucket_label: 'Legal Fees', fund_code: 'SS', outstanding_amount: 500 },
  ],
};
const ORDER = ['SSC', 'LVC', 'PEC', 'SSF', 'LVF', 'PEF', 'SLF'];

const approved = (over: Partial<CePartialPaymentAuthority> = {}): CePartialPaymentAuthority => ({
  status: 'APPROVED',
  approved_amount: 4000,
  settled_amount: 0,
  authority_expires_on: '2026-09-30',
  grace_extended_to: null,
  ...over,
});

describe('allocation waterfall', () => {
  it('applies contributions before penalties and legal fees', () => {
    const lines = buildDefaultAllocation(liability, 8000, ORDER);
    expect(lines.map((l) => [l.payment_code, l.amount])).toEqual([
      ['SSC', 6000],
      ['LVC', 1500],
      ['SSF', 500],
    ]);
  });

  it('never allocates beyond the money offered or a bucket balance', () => {
    const lines = buildDefaultAllocation(liability, 12000, ORDER);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(10000);
    for (const line of lines) expect(line.amount).toBeLessThanOrEqual(line.outstanding_amount);
  });

  it('handles fractional amounts without floating point drift', () => {
    const lines = buildDefaultAllocation(
      { total_outstanding: 0.3, buckets: [{ payment_code: 'SSC', outstanding_amount: 0.3 }] },
      0.1 + 0.2,
      ORDER,
    );
    expect(lines[0].amount).toBe(0.3);
  });

  it('refuses to guess when no allocation order is configured', () => {
    expect(() => buildDefaultAllocation(liability, 100, [])).toThrow(CePartialPaymentConfigError);
  });
});

describe('allocation validation', () => {
  it('accepts a well-formed allocation', () => {
    expect(validateAllocation(buildDefaultAllocation(liability, 5000, ORDER), 5000, liability).ok).toBe(true);
  });

  it('rejects an allocation that does not sum to the payment amount', () => {
    const res = validateAllocation([{ payment_code: 'SSC', outstanding_amount: 6000, amount: 100 }], 200, liability);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toContain('does not equal the payment amount');
  });

  it('rejects over-allocation of a bucket, duplicates and negatives', () => {
    expect(validateAllocation([{ payment_code: 'LVC', outstanding_amount: 1500, amount: 5000 }], 5000, liability).ok).toBe(false);
    expect(
      validateAllocation(
        [
          { payment_code: 'SSC', outstanding_amount: 6000, amount: 100 },
          { payment_code: 'SSC', outstanding_amount: 6000, amount: 100 },
        ],
        200,
        liability,
      ).errors.join(' '),
    ).toContain('more than once');
    expect(validateAllocation([{ payment_code: 'SSC', outstanding_amount: 6000, amount: -5 }], -5, liability).ok).toBe(false);
  });

  it('rejects a bucket with no outstanding balance for the period', () => {
    const res = validateAllocation([{ payment_code: 'ZZZ', outstanding_amount: 0, amount: 10 }], 10, liability);
    expect(res.errors.join(' ')).toContain('no outstanding balance');
  });
});

describe('DR-004 outcome', () => {
  const base = { graceEndDate: '2026-09-15', declaredAmount: 1000, paidAmount: 400 };

  it('is not applicable when nothing or everything was paid', () => {
    expect(evaluatePartialPaymentObligation({ ...base, paidAmount: 0, asOf: '2026-10-01' })).toBe('NOT_APPLICABLE');
    expect(evaluatePartialPaymentObligation({ ...base, paidAmount: 1000, asOf: '2026-10-01' })).toBe('NOT_APPLICABLE');
  });

  it('does not fire before the resolved deadline', () => {
    expect(evaluatePartialPaymentObligation({ ...base, asOf: '2026-09-10' })).toBe('WITHIN_DEADLINE');
  });

  it('fires for an unauthorised shortfall after the deadline, regardless of size', () => {
    const tiny = evaluatePartialPaymentObligation({ ...base, declaredAmount: 1000, paidAmount: 999, asOf: '2026-10-01' });
    expect(tiny).toBe('UNAUTHORISED_PARTIAL');
    expect(isPartialPaymentViolation(tiny)).toBe(true);
  });

  it('is suppressed by a live approved authority', () => {
    const outcome = evaluatePartialPaymentObligation({ ...base, asOf: '2026-09-20', authority: approved() });
    expect(outcome).toBe('AUTHORISED_PARTIAL');
    expect(isPartialPaymentViolation(outcome)).toBe(false);
  });

  it('re-fires once the authority expires', () => {
    const outcome = evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-05', authority: approved() });
    expect(outcome).toBe('AUTHORITY_EXPIRED');
    expect(isPartialPaymentViolation(outcome)).toBe(true);
  });

  it('honours a grace extension granted at approval', () => {
    expect(
      evaluatePartialPaymentObligation({
        ...base,
        asOf: '2026-09-25',
        authority: approved({ grace_extended_to: '2026-09-30' }),
      }),
    ).toBe('AUTHORISED_PARTIAL');
  });

  it('holds enforcement while a decision is pending', () => {
    const pending = approved({ status: 'PENDING_APPROVAL', approved_amount: null, authority_expires_on: null });
    const outcome = evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01', authority: pending });
    expect(outcome).toBe('PENDING_DECISION');
    expect(isPartialPaymentViolation(outcome)).toBe(false);
  });

  it('treats a rejected or cancelled request as no authority at all', () => {
    for (const status of ['REJECTED', 'CANCELLED'] as const) {
      expect(
        evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01', authority: approved({ status }) }),
      ).toBe('UNAUTHORISED_PARTIAL');
    }
  });
});

describe('DR-003 / DR-004 mutual exclusivity', () => {
  it('suspends non-payment enforcement while an authority is live or pending', () => {
    expect(partialPaymentSuppressesNonPayment(approved(), '2026-09-20')).toBe(true);
    expect(partialPaymentSuppressesNonPayment(approved({ status: 'PENDING_APPROVAL' }), '2026-12-01')).toBe(true);
  });

  it('restores non-payment enforcement when there is no live authority', () => {
    expect(partialPaymentSuppressesNonPayment(null, '2026-09-20')).toBe(false);
    expect(partialPaymentSuppressesNonPayment(approved({ status: 'REJECTED' }), '2026-09-20')).toBe(false);
    expect(partialPaymentSuppressesNonPayment(approved(), '2026-10-05')).toBe(false);
  });

  it('never lets DR-003 and DR-004 both stand for the same period', () => {
    const asOf = '2026-09-20';
    const authority = approved();
    const dr004 = evaluatePartialPaymentObligation({
      graceEndDate: '2026-09-15',
      declaredAmount: 1000,
      paidAmount: 400,
      asOf,
      authority,
    });
    const dr003Suppressed = partialPaymentSuppressesNonPayment(authority, asOf);
    expect(isPartialPaymentViolation(dr004) && !dr003Suppressed).toBe(false);
  });

  it('marks an authority live only while approved or settled and unexpired', () => {
    expect(authorityIsLive(approved({ status: 'SETTLED' }), '2026-09-20')).toBe(true);
    expect(authorityIsLive(approved({ status: 'EXPIRED' }), '2026-09-20')).toBe(false);
  });
});

describe('shared module parity', () => {
  it('keeps the edge copy byte-identical to the application copy', () => {
    const app = readFileSync(resolve('src/lib/compliance/partialPaymentAllocation.ts'), 'utf8');
    const edge = readFileSync(
      resolve('supabase/functions/_shared/compliance/partialPaymentAllocation.ts'),
      'utf8',
    );
    expect(edge).toBe(app);
  });
});

describe('retired legacy semantics', () => {
  it('no longer carries 5% / EC$50 thresholds in the DR-004 scanner path', () => {
    const scanner = readFileSync(resolve('supabase/functions/ce-violation-scan/index.ts'), 'utf8');
    const block = scanner.slice(
      scanner.indexOf('case "payment_partial"'),
      scanner.indexOf('case "repeat_violation_check"'),
    );
    expect(block).not.toContain('min_shortfall_amount_xcd');
    expect(block).not.toContain('min_shortfall_percent');
    expect(block).toContain('evaluatePartialPaymentObligation');
  });

  it('suppresses DR-003 where a partial payment authority applies', () => {
    const scanner = readFileSync(resolve('supabase/functions/ce-violation-scan/index.ts'), 'utf8');
    const block = scanner.slice(
      scanner.indexOf('case "payment_not_received"'),
      scanner.indexOf('case "payment_partial"'),
    );
    expect(block).toContain('partialPaymentSuppressesNonPayment');
  });
});
