/**
 * DEF-E2E-05 regression — payment-arrangement lifecycle must be server-governed.
 * Submit / approve / reject must call the governed RPCs, never write the
 * ce_payment_arrangements table directly from the browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
const from = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...a: any[]) => rpc(...a), from: (...a: any[]) => from(...a) },
}));
vi.mock('@/lib/compliance/featureToggles', () => ({
  isComplianceDbFlagEnabled: () => true,
  isComplianceFeatureEnabled: () => true,
}));

import {
  submitForApproval,
  approveArrangement,
  rejectArrangement,
  activateArrangement,
} from '@/services/arrangementWorkflowService';

describe('Payment arrangement governed lifecycle', () => {
  beforeEach(() => {
    rpc.mockClear();
    from.mockClear();
  });

  it('submits through ce_arrangement_submit_v1 without touching the table', async () => {
    await submitForApproval('arr-1');
    expect(rpc).toHaveBeenCalledWith('ce_arrangement_submit_v1', {
      p_arrangement_id: 'arr-1',
      p_note: null,
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('approves through ce_arrangement_approve_v1 without touching the table', async () => {
    await approveArrangement('arr-1', 'CI-01', 'approved');
    expect(rpc).toHaveBeenCalledWith('ce_arrangement_approve_v1', {
      p_arrangement_id: 'arr-1',
      p_comments: 'approved',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('always sends a rejection reason', async () => {
    await rejectArrangement('arr-1', 'CI-01', '   ');
    expect(rpc).toHaveBeenCalledWith('ce_arrangement_reject_v1', {
      p_arrangement_id: 'arr-1',
      p_reason: 'Rejected by approver',
    });
  });

  it('activation still passes through submit then approve (no one-step bypass)', async () => {
    await activateArrangement('arr-1');
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      'ce_arrangement_submit_v1',
      'ce_arrangement_approve_v1',
    ]);
  });
});
