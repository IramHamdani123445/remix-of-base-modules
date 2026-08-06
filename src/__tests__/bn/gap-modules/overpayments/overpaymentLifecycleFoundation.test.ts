/**
 * Slice 1 — Overpayment Recovery lifecycle foundation tests.
 *
 * Covers:
 *  - Command → capability map completeness
 *  - State-machine reachability (canonical closure paths reach CLOSED)
 *  - Recovery plan lifecycle guards
 *  - Legacy status mapping
 *  - Outstanding balance calculator invariants
 *  - Finance contract guard rejects malformed payloads
 */

import { describe, expect, it } from 'vitest';

import {
  BN_OVERPAYMENT_COMMANDS,
  getOverpaymentCommandSpec,
  type BnOverpaymentCanonicalCommandName,
} from '@/types/bn/overpayments/overpaymentCommands';
import {
  BN_OVERPAYMENT_TRANSITIONS,
  BN_RECOVERY_PLAN_TRANSITIONS,
  canPlanTransition,
  canTransition,
  isPlanTerminal,
  isTerminal,
  mapLegacyStatus,
  reachableStates,
} from '@/types/bn/overpayments/overpaymentStateMachine';
import {
  BN_GAP_COMMAND_CAPABILITY,
  requiredCapabilityFor,
} from '@/services/bn/commands/benefitsCapabilityRegistry';
import { computeOverpaymentBalance } from '@/services/bn/overpayments/overpaymentOutstandingCalculator';
import {
  assertFinanceOutboundPayload,
  FINANCE_OWNED_TABLES,
} from '@/services/bn/finance/overpaymentFinanceContract';

const CANONICAL_COMMANDS: readonly BnOverpaymentCanonicalCommandName[] = [
  'BN_OVP_CREATE_CANDIDATE',
  'BN_OVP_CALCULATE_LIABILITY',
  'BN_OVP_VERIFY',
  'BN_OVP_ISSUE_NOTICE',
  'BN_OVP_RECORD_REPRESENTATION',
  'BN_OVP_CONFIRM_LIABILITY',
  'BN_OVP_PROPOSE_RECOVERY_PLAN',
  'BN_OVP_APPROVE_RECOVERY_PLAN',
  'BN_OVP_REJECT_RECOVERY_PLAN',
  'BN_OVP_REVISE_RECOVERY_PLAN',
  'BN_OVP_ACTIVATE_BENEFIT_DEDUCTION',
  'BN_OVP_RECORD_RECEIPT',
  'BN_OVP_ALLOCATE_RECEIPT',
  'BN_OVP_REQUEST_WAIVER',
  'BN_OVP_APPROVE_WAIVER',
  'BN_OVP_REJECT_WAIVER',
  'BN_OVP_REQUEST_WRITEOFF',
  'BN_OVP_APPROVE_WRITEOFF',
  'BN_OVP_REJECT_WRITEOFF',
  'BN_OVP_REFER_LEGAL',
  'BN_OVP_REFER_ESTATE',
  'BN_OVP_REVERSE_TRANSACTION',
  'BN_OVP_RECONCILE',
  'BN_OVP_CLOSE',
  'BN_OVP_REOPEN',
];

describe('Overpayment lifecycle — command catalogue', () => {
  it('declares all 25 canonical commands', () => {
    for (const name of CANONICAL_COMMANDS) {
      expect(getOverpaymentCommandSpec(name), `spec missing: ${name}`).toBeDefined();
    }
  });

  it('maps every command to a capability in the gap registry', () => {
    for (const spec of BN_OVERPAYMENT_COMMANDS) {
      const cap = requiredCapabilityFor(spec.command);
      expect(cap, `capability missing for ${spec.command}`).toBeTruthy();
      expect(cap).toBe(BN_GAP_COMMAND_CAPABILITY[spec.command]);
    }
  });

  it('marks approval commands as maker-checker + self-approval forbidden', () => {
    const approvals: BnOverpaymentCanonicalCommandName[] = [
      'BN_OVP_APPROVE_WAIVER',
      'BN_OVP_REJECT_WAIVER',
      'BN_OVP_APPROVE_WRITEOFF',
      'BN_OVP_REJECT_WRITEOFF',
      'BN_OVP_APPROVE_RECOVERY_PLAN',
      'BN_OVP_REJECT_RECOVERY_PLAN',
      'BN_OVP_CONFIRM_LIABILITY',
      'BN_OVP_VERIFY',
      'BN_OVP_REVERSE_TRANSACTION',
    ];
    for (const name of approvals) {
      const spec = getOverpaymentCommandSpec(name)!;
      expect(spec.requiresMakerChecker, `${name} must be maker-checker`).toBe(true);
      expect(spec.forbidsSelfApproval, `${name} must forbid self-approval`).toBe(true);
    }
  });

  it('flags ledger-writing commands', () => {
    const ledger = BN_OVERPAYMENT_COMMANDS.filter((c) => c.writesLedger).map((c) => c.command);
    expect(ledger).toEqual(
      expect.arrayContaining([
        'BN_OVP_CONFIRM_LIABILITY',
        'BN_OVP_RECORD_RECEIPT',
        'BN_OVP_ALLOCATE_RECEIPT',
        'BN_OVP_APPROVE_WAIVER',
        'BN_OVP_APPROVE_WRITEOFF',
        'BN_OVP_REVERSE_TRANSACTION',
      ]),
    );
  });
});

describe('Overpayment lifecycle — state machine', () => {
  it('has DETECTED as the entry state with a path to CLOSED', () => {
    const reachable = reachableStates('DETECTED');
    expect(reachable.has('CLOSED')).toBe(true);
    expect(reachable.has('RECOVERED')).toBe(true);
    expect(reachable.has('RECONCILED')).toBe(true);
  });

  it('permits waiver-path and write-off-path closures', () => {
    const r = reachableStates('CONFIRMED');
    expect(r.has('WAIVED')).toBe(true);
    expect(r.has('WRITTEN_OFF')).toBe(true);
    expect(r.has('RECONCILED')).toBe(true);
  });

  it('rejects skipping notice/representation before confirm', () => {
    expect(canTransition('VERIFIED', 'CONFIRMED')).toBe(false);
    expect(canTransition('VERIFIED', 'NOTICE_PENDING')).toBe(true);
  });

  it('treats CLOSED and CANCELLED as terminal (but CLOSED may reopen)', () => {
    expect(isTerminal('CLOSED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(canTransition('CLOSED', 'REOPENED')).toBe(true);
    // CANCELLED is a hard terminal
    expect(BN_OVERPAYMENT_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('maps every legacy status to a canonical state', () => {
    expect(mapLegacyStatus('DRAFT')).toBe('DETECTED');
    expect(mapLegacyStatus('ASSESSED')).toBe('UNDER_REVIEW');
    expect(mapLegacyStatus('NOTIFIED')).toBe('REPRESENTATION_PERIOD');
    expect(mapLegacyStatus('ARRANGEMENT_ACTIVE')).toBe('RECOVERING');
    expect(mapLegacyStatus('ARRANGEMENT_BREACHED')).toBe('RECOVERING');
    expect(mapLegacyStatus('REFERRED_TO_LEGAL')).toBe('LEGAL_RECOVERY');
    expect(mapLegacyStatus('PARTIALLY_RECOVERED_WRITE_OFF')).toBe('PARTIALLY_WRITTEN_OFF');
  });
});

describe('Recovery plan lifecycle', () => {
  it('rejects direct DRAFT → ACTIVE (must be approved first)', () => {
    expect(canPlanTransition('DRAFT', 'ACTIVE')).toBe(false);
    expect(canPlanTransition('APPROVED', 'ACTIVE')).toBe(true);
  });

  it('flags terminal states', () => {
    expect(isPlanTerminal('COMPLETED')).toBe(true);
    expect(isPlanTerminal('REJECTED')).toBe(true);
    expect(isPlanTerminal('CANCELLED')).toBe(true);
    expect(isPlanTerminal('ACTIVE')).toBe(false);
  });

  it('supports revision cycle from ACTIVE → REVISED → PROPOSED', () => {
    expect(canPlanTransition('ACTIVE', 'REVISED')).toBe(true);
    expect(canPlanTransition('REVISED', 'PROPOSED')).toBe(true);
    expect(BN_RECOVERY_PLAN_TRANSITIONS.REVISED).toContain('APPROVAL_PENDING');
  });
});

describe('Outstanding balance calculator', () => {
  const txn = (kind: string, amount: number, extras: Record<string, unknown> = {}) =>
    ({ kind, amount, approved: true, ...extras }) as any;

  it('outstanding = confirmed − waived − writtenOff − recovered + reversed', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 1000,
      transactions: [
        txn('RECEIPT', 200),
        txn('DEDUCTION', 100),
        txn('WAIVER', 150),
        txn('WRITE_OFF', 50),
      ],
    });
    expect(b.recovered).toBe(300);
    expect(b.waived).toBe(150);
    expect(b.writtenOff).toBe(50);
    expect(b.outstanding).toBe(500);
    expect(b.hasOverAllocation).toBe(false);
  });

  it('ignores unapproved rows', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 500,
      transactions: [{ kind: 'RECEIPT', amount: 500, approved: false }],
    });
    expect(b.outstanding).toBe(500);
    expect(b.recovered).toBe(0);
  });

  it('nets out a reversed receipt via the legacy reversedByTxnId alias', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 400,
      transactions: [
        txn('RECEIPT', 300, { txnId: 't1' }),
        txn('REVERSAL', 300, { reversedByTxnId: 't1' }),
      ],
    });
    expect(b.recovered).toBe(0);
    expect(b.reversed).toBe(300);
    // MODEL A: the receipt stays in `recovered` and the reversal is an equal
    // and opposite contra event on that same category. The reversed amount is
    // owed again exactly once — 400, never 700 (double count).
    expect(b.outstanding).toBe(400);
  });


  it('clamps negative outstanding and flags over-allocation', () => {
    const b = computeOverpaymentBalance({
      confirmedLiability: 100,
      transactions: [txn('RECEIPT', 500)],
    });
    expect(b.outstanding).toBe(0);
    expect(b.hasOverAllocation).toBe(true);
  });

  it('marks fully-waived and fully-written-off states', () => {
    const w = computeOverpaymentBalance({
      confirmedLiability: 200,
      transactions: [txn('WAIVER', 200)],
    });
    expect(w.isFullyWaived).toBe(true);
    expect(w.outstanding).toBe(0);

    const o = computeOverpaymentBalance({
      confirmedLiability: 200,
      transactions: [txn('WRITE_OFF', 200)],
    });
    expect(o.isFullyWrittenOff).toBe(true);
  });
});

describe('Finance boundary contract', () => {
  it('rejects payloads missing required boundary fields', () => {
    expect(() =>
      assertFinanceOutboundPayload({
        kind: 'RECEIPT_RECORDED',
        overpaymentId: '',
        receiptRef: 'r1',
        amount: 10,
        currency: 'XCD',
        receivedAt: '',
        channel: 'CASH',
      } as any),
    ).toThrow(/overpaymentId/);
  });

  it('rejects negative amounts', () => {
    expect(() =>
      assertFinanceOutboundPayload({
        kind: 'WAIVER_APPROVED',
        overpaymentId: 'o1',
        waiverRequestId: 'w1',
        amount: -1,
        currency: 'XCD',
        reasonCode: 'HARDSHIP',
        approvedAt: 'now',
        approvedBy: 's1',
      }),
    ).toThrow(/non-negative/);
  });

  it('lists finance-owned tables benefits must not write to', () => {
    expect(FINANCE_OWNED_TABLES).toContain('cn_payments_journal');
    expect(FINANCE_OWNED_TABLES).toContain('core_ledger_head');
  });
});
