import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  authorityIsLive,
  buildDefaultAllocation,
  CePartialPaymentConfigError,
  evaluatePartialPaymentObligation,
  isPartialPaymentViolation,
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

describe('DR-004 outcome — the statutory deadline is immutable', () => {
  const base = { graceEndDate: '2026-09-15', declaredAmount: 1000, paidAmount: 400 };

  it('is not applicable when nothing or everything was paid', () => {
    expect(evaluatePartialPaymentObligation({ ...base, paidAmount: 0, asOf: '2026-10-01' })).toBe('NOT_APPLICABLE');
    expect(evaluatePartialPaymentObligation({ ...base, paidAmount: 1000, asOf: '2026-10-01' })).toBe('NOT_APPLICABLE');
  });

  it('does not fire before the resolved statutory deadline', () => {
    expect(evaluatePartialPaymentObligation({ ...base, asOf: '2026-09-10' })).toBe('WITHIN_DEADLINE');
  });

  it('fires for any shortfall after the deadline, regardless of size', () => {
    const tiny = evaluatePartialPaymentObligation({ ...base, declaredAmount: 1000, paidAmount: 999, asOf: '2026-10-01' });
    expect(tiny).toBe('PARTIAL_OUTSTANDING');
    expect(isPartialPaymentViolation(tiny)).toBe(true);
  });

  it('B1-C1 — an approved payment authority does NOT postpone the deadline', () => {
    const outcome = evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01', authority: approved() });
    expect(outcome).toBe('PARTIAL_OUTSTANDING');
    expect(isPartialPaymentViolation(outcome)).toBe(true);
  });

  it('B1-C2 — a pending request does NOT suspend enforcement', () => {
    const pending = approved({ status: 'PENDING_APPROVAL', approved_amount: null, authority_expires_on: null });
    const outcome = evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01', authority: pending });
    expect(outcome).toBe('PARTIAL_OUTSTANDING');
    expect(isPartialPaymentViolation(outcome)).toBe(true);
  });

  it('produces the same outcome with and without an authority of any status', () => {
    const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED', 'SETTLED', 'EXPIRED'] as const;
    const none = evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01' });
    for (const status of statuses) {
      expect(
        evaluatePartialPaymentObligation({ ...base, asOf: '2026-10-01', authority: approved({ status }) }),
      ).toBe(none);
    }
  });

  it('marks an authority live only while approved or settled and unexpired', () => {
    expect(authorityIsLive(approved({ status: 'SETTLED' }), '2026-09-20')).toBe(true);
    expect(authorityIsLive(approved({ status: 'EXPIRED' }), '2026-09-20')).toBe(false);
    expect(authorityIsLive(approved(), '2026-10-05')).toBe(false);
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

  it('B1-C2 — DR-003 is never suppressed by a partial payment request', () => {
    const scanner = readFileSync(resolve('supabase/functions/ce-violation-scan/index.ts'), 'utf8');
    expect(scanner).not.toContain('partialPaymentSuppressesNonPayment');
  });

  it('B1-C1 — no grace-extension vocabulary survives anywhere in the slice', () => {
    for (const f of [
      'src/lib/compliance/partialPaymentAllocation.ts',
      'src/services/partialPaymentService.ts',
      'src/components/compliance/payments/PartialPaymentApprovalDialog.tsx',
      'src/components/compliance/settings/PartialPaymentPolicyCard.tsx',
    ]) {
      const src = readFileSync(resolve(f), 'utf8');
      expect(src).not.toContain('grace_extended_to');
      expect(src).not.toContain('grace_extension_days');
      expect(src).not.toContain('extends_payment_grace');
      expect(src).not.toContain('max_grace_extension_days');
    }
  });
});
