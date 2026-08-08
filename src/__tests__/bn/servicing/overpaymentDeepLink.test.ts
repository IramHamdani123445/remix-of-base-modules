import { describe, it, expect } from 'vitest';
import { toWorklistRow } from '@/pages/bn/servicing/OverpaymentRecovery';

describe('overpayment deep-link case resolution', () => {
  it('maps a secured case-detail payload onto the record workspace shape', () => {
    const row = toWorklistRow('case-1', {
      case_id: 'case-1',
      case_reference: 'OVP-2026-0001',
      claimant_display: 'A. Claimant',
      status: 'IN_RECOVERY',
      gross_amount: 1200,
      outstanding_amount: 800,
      recovered_amount: 400,
      currency: 'XCD',
      row_version: 3,
    });

    expect(row).not.toBeNull();
    expect(row?.case_reference).toBe('OVP-2026-0001');
    expect(row?.outstanding_amount).toBe(800);
    expect(row?.row_version).toBe(3);
  });

  it('returns null when the case cannot be resolved', () => {
    expect(toWorklistRow('case-1', null)).toBeNull();
    expect(toWorklistRow('case-1', {})).toBeNull();
  });

  it('falls back to the addressed id and a default currency', () => {
    const row = toWorklistRow('case-9', { status: 'RAISED' });
    expect(row?.case_id).toBe('case-9');
    expect(row?.case_reference).toBe('case-9');
    expect(row?.currency).toBe('XCD');
    expect(row?.claimant_display).toBeNull();
  });
});
