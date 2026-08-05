import { describe, it, expect } from 'vitest';
import { computeOutstanding, EFFECTIVE_WAIVER_STATUSES } from '@/services/complianceWaiverAmounts';

describe('compliance waiver amount resolution', () => {
  it('counts approved and applied waivers as effective', () => {
    expect([...EFFECTIVE_WAIVER_STATUSES]).toEqual(['APPROVED', 'APPLIED']);
  });

  it('deducts the approved waiver from the outstanding balance', () => {
    expect(computeOutstanding(333.99, 0, 150)).toBe(183.99);
  });

  it('deducts collections and waivers together', () => {
    expect(computeOutstanding(1000, 250, 100)).toBe(650);
  });

  it('never returns a negative balance', () => {
    expect(computeOutstanding(100, 60, 80)).toBe(0);
  });

  it('treats missing values as zero', () => {
    expect(computeOutstanding(500, null, undefined)).toBe(500);
    expect(computeOutstanding(null, null, null)).toBe(0);
  });
});
