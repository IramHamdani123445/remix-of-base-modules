import { describe, expect, it } from 'vitest';
import {
  availablePrintBatchActions,
  batchCanCompleteNormally,
  computeBatchReconciliation,
  OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED,
  printBatchImmutable,
  printBatchMembershipEditable,
  printBatchTransitionAllowed,
  printProfileSignature,
  type OmniCommsBatchAccountingState,
} from '../printBatchTypes';

const item = (
  accounting_state: OmniCommsBatchAccountingState,
  expected_pages = 2,
  expected_copies = 1,
) => ({ accounting_state, expected_pages, expected_copies });

describe('print batch lifecycle (client mirror)', () => {
  it('allows only the governed transitions', () => {
    expect(printBatchTransitionAllowed('draft', 'ready')).toBe(true);
    expect(printBatchTransitionAllowed('ready', 'locked')).toBe(true);
    expect(printBatchTransitionAllowed('locked', 'in_production')).toBe(true);
    expect(printBatchTransitionAllowed('in_production', 'reconciling')).toBe(true);
    expect(printBatchTransitionAllowed('reconciling', 'completed')).toBe(true);
  });

  it('rejects shortcuts around reconciliation and cancellation', () => {
    expect(printBatchTransitionAllowed('draft', 'in_production')).toBe(false);
    expect(printBatchTransitionAllowed('in_production', 'completed')).toBe(false);
    expect(printBatchTransitionAllowed('locked', 'cancelled')).toBe(false);
    expect(printBatchTransitionAllowed('in_production', 'cancelled')).toBe(false);
  });

  it('treats completed and cancelled batches as immutable', () => {
    expect(printBatchImmutable('completed')).toBe(true);
    expect(printBatchImmutable('cancelled')).toBe(true);
    expect(availablePrintBatchActions('completed')).toEqual([]);
    expect(availablePrintBatchActions('cancelled')).toEqual([]);
  });

  it('permits membership edits only while editable', () => {
    expect(printBatchMembershipEditable('draft')).toBe(true);
    expect(printBatchMembershipEditable('ready')).toBe(true);
    expect(printBatchMembershipEditable('locked')).toBe(false);
    expect(printBatchMembershipEditable('in_production')).toBe(false);
  });

  it('requires a reason for unlock and cancel', () => {
    expect(OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED).toContain('unlock');
    expect(OMNI_COMMS_PRINT_BATCH_REASON_REQUIRED).toContain('cancel');
  });

  it('offers start production only from a locked batch', () => {
    expect(availablePrintBatchActions('locked')).toContain('start_production');
    expect(availablePrintBatchActions('ready')).not.toContain('start_production');
  });
});

describe('production profile compatibility', () => {
  const account = '11111111-1111-1111-1111-111111111111';

  it('is deterministic and order independent for inserts', () => {
    const a = printProfileSignature(
      { paper_size: 'A4', sides: 'simplex', inserts: ['reply', 'leaflet'] },
      account,
    );
    const b = printProfileSignature(
      { paper_size: 'A4', sides: 'simplex', inserts: ['leaflet', 'reply'] },
      account,
    );
    expect(a).toBe(b);
  });

  it('separates incompatible production profiles', () => {
    const simplex = printProfileSignature({ sides: 'simplex' }, account);
    const duplex = printProfileSignature({ sides: 'duplex' }, account);
    expect(simplex).not.toBe(duplex);
    expect(printProfileSignature({ paper_size: 'A4' }, account)).not.toBe(
      printProfileSignature({ paper_size: 'A5' }, account),
    );
  });

  it('separates different production accounts', () => {
    expect(printProfileSignature({}, account)).not.toBe(
      printProfileSignature({}, '22222222-2222-2222-2222-222222222222'),
    );
  });
});

describe('reconciliation is derived from evidence', () => {
  it('derives expected items, pages and copies excluding pre-lock removals', () => {
    const r = computeBatchReconciliation([
      item('printed', 2, 1),
      item('printed', 3, 2),
      item('removed_before_lock', 9, 9),
    ]);
    expect(r.expected_items).toBe(2);
    expect(r.expected_pages).toBe(2 + 6);
    expect(r.expected_copies).toBe(3);
    expect(r.removed_before_lock).toBe(1);
  });

  it('models the 48 letter batch with a spoil, a hold and a failure', () => {
    const items = [
      ...Array.from({ length: 46 }, () => item('printed', 2)),
      item('spoiled', 1),
      item('held', 1),
    ];
    const r = computeBatchReconciliation(items);
    expect(r.expected_items).toBe(48);
    expect(r.expected_pages).toBe(46 * 2 + 1 + 1);
    expect(r.printed_satisfied).toBe(46);
    expect(r.spoiled).toBe(1);
    expect(r.held).toBe(1);
    expect(r.reconciled).toBe(false);
    expect(batchCanCompleteNormally(r)).toBe(false);
  });

  it('counts a spoil followed by a successful reprint as satisfied', () => {
    const r = computeBatchReconciliation([
      ...Array.from({ length: 46 }, () => item('printed')),
      item('reprinted_successfully'),
      item('held'),
    ]);
    expect(r.printed_satisfied).toBe(47);
    expect(r.reprinted_successfully).toBe(1);
    expect(r.reprint_required).toBe(0);
    expect(r.held).toBe(1);
    expect(r.reconciled).toBe(false);
  });

  it('reconciles once the held letter is deliberately deferred', () => {
    const r = computeBatchReconciliation([
      ...Array.from({ length: 46 }, () => item('printed')),
      item('reprinted_successfully'),
      item('deferred'),
    ]);
    expect(r.deferred).toBe(1);
    expect(r.unaccounted).toBe(0);
    expect(r.reconciled).toBe(true);
    expect(batchCanCompleteNormally(r)).toBe(true);
  });

  it('blocks completion while any letter is failed, pending or mid attempt', () => {
    expect(computeBatchReconciliation([item('printed'), item('failed')]).reconciled).toBe(false);
    expect(computeBatchReconciliation([item('printed'), item('pending')]).reconciled).toBe(false);
    expect(computeBatchReconciliation([item('printed'), item('in_progress')]).reconciled).toBe(false);
    expect(
      computeBatchReconciliation([item('printed'), item('reprint_required')]).reconciled,
    ).toBe(false);
  });

  it('never reports dispatched or delivered outcomes', () => {
    const r = computeBatchReconciliation([item('printed')]);
    const keys = Object.keys(r).join(' ');
    expect(keys).not.toMatch(/dispatch|deliver|posted/i);
  });
});
