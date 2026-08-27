import { describe, it, expect, vi, beforeEach } from 'vitest';

// Queue of canned { data, error } responses, consumed in call order by
// whichever terminal method (`.single()`, `.maybeSingle()`, or awaiting the
// builder directly) the code under test hits next.
let responses: Array<{ data: unknown; error: unknown }> = [];
let callIndex = 0;
let orCalls: string[] = [];
let updatePayloads: Record<string, unknown>[] = [];

function makeChain(table: string) {
  const chain: any = {};
  const passthrough = ['select', 'eq', 'order', 'limit', 'is', 'in'];
  passthrough.forEach((m) => {
    chain[m] = vi.fn(() => chain);
  });
  chain.or = vi.fn((arg: string) => {
    orCalls.push(arg);
    return chain;
  });
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    if (table === 'bn_payment_profile') updatePayloads.push(payload);
    return chain;
  });
  chain.insert = vi.fn(() => chain);
  const next = () => Promise.resolve(responses[callIndex++]);
  chain.single = vi.fn(() => next());
  chain.maybeSingle = vi.fn(() => next());
  chain.then = (resolve: any, reject: any) => next().then(resolve, reject);
  return chain;
}

const fromMock = vi.fn((table: string) => makeChain(table));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: (...args: [string]) => fromMock(...args) },
}));

import { submitChangeRequest } from '@/services/bn/payment/paymentProfileService';
import { DEFAULT_PAYMENT_POLICY } from '@/types/bnPaymentProfile';

beforeEach(() => {
  responses = [];
  callIndex = 0;
  orCalls = [];
  updatePayloads = [];
  fromMock.mockClear();
});

describe('BUG-35: editing a claimant\'s existing bank details', () => {
  it('deactivates the current active profile even when it is the one being edited', async () => {
    const oldProfile = {
      id: 'profile-1',
      person_ssn: '000004',
      payee_id: null,
      payment_method: 'EFT',
      payment_currency: 'XCD',
      active: true,
    };
    const changeRequestRow = {
      id: 'req-1',
      profile_id: 'profile-1',
      person_ssn: '000004',
      new_profile_snapshot: {
        payment_method: 'EFT',
        payment_currency: 'XCD',
        bank_code: 'CIBC',
        branch_code: '001',
        account_number_masked: '••••0999',
        account_holder_name: 'Donna Huggins',
      },
      status: 'APPROVED',
    };
    const insertedProfile = { id: 'profile-2', ...changeRequestRow.new_profile_snapshot, active: true };

    responses = [
      { data: oldProfile, error: null }, // getActiveProfile lookup
      { data: changeRequestRow, error: null }, // insert change_request row
      { data: changeRequestRow, error: null }, // re-fetch change_request in applyApprovedRequest
      { data: [{ id: 'profile-1' }], error: null }, // deactivate update
      { data: insertedProfile, error: null }, // insert new active profile
    ];

    const result = await submitChangeRequest({
      personSsn: '000004',
      channel: 'STAFF_OFFLINE',
      draft: changeRequestRow.new_profile_snapshot as any,
      policy: { ...DEFAULT_PAYMENT_POLICY, require_supervisor_approval_for_change: false },
      userCode: 'officer1',
    });

    // The old bug excluded the record being edited from deactivation via
    // `.or('id.neq.<profile_id>')`. That must never happen again.
    expect(orCalls).toEqual([]);
    expect(updatePayloads[0]).toMatchObject({ active: false });
    expect(result.status).toBe('APPROVED');
  });

  it('restores the deactivated profile if the insert still fails, and throws a plain-English message', async () => {
    const oldProfile = {
      id: 'profile-1',
      person_ssn: '000004',
      payee_id: null,
      payment_method: 'EFT',
      payment_currency: 'XCD',
      active: true,
    };
    const changeRequestRow = {
      id: 'req-1',
      profile_id: 'profile-1',
      person_ssn: '000004',
      new_profile_snapshot: { payment_method: 'EFT', payment_currency: 'XCD' },
      status: 'APPROVED',
    };

    responses = [
      { data: oldProfile, error: null },
      { data: changeRequestRow, error: null },
      { data: changeRequestRow, error: null },
      { data: [{ id: 'profile-1' }], error: null }, // deactivate succeeds
      { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "ux_bn_pp_active"' } }, // insert fails
      { data: null, error: null }, // compensating reactivation
    ];

    await expect(
      submitChangeRequest({
        personSsn: '000004',
        channel: 'STAFF_OFFLINE',
        draft: changeRequestRow.new_profile_snapshot as any,
        policy: { ...DEFAULT_PAYMENT_POLICY, require_supervisor_approval_for_change: false },
        userCode: 'officer1',
      }),
    ).rejects.toThrow(/already has active bank details/i);

    // Second update call is the compensating reactivation.
    expect(updatePayloads[1]).toMatchObject({ active: true, effective_to: null });
  });
});
