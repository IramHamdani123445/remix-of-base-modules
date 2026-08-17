import { describe, expect, it } from 'vitest';
import {
  availablePrintActions,
  OMNI_COMMS_PRINT_REASON_REQUIRED,
  printTransitionAllowed,
} from '../printProductionTypes';

describe('print physical state machine (client mirror)', () => {
  it('allows only the approved forward transitions', () => {
    expect(printTransitionAllowed('artefact_produced', 'queued_for_print')).toBe(true);
    expect(printTransitionAllowed('queued_for_print', 'printing')).toBe(true);
    expect(printTransitionAllowed('printing', 'printed')).toBe(true);
    expect(printTransitionAllowed('printing', 'print_failed')).toBe(true);
  });

  it('rejects illegal jumps', () => {
    expect(printTransitionAllowed('artefact_produced', 'printed')).toBe(false);
    expect(printTransitionAllowed('printed', 'printing')).toBe(false);
    expect(printTransitionAllowed('spoiled', 'printed')).toBe(false);
  });

  it('offers no queue action once an item is printed', () => {
    expect(availablePrintActions('printed')).toEqual(['mark_spoiled', 'confirm_dispatched']);
  });

  it('offers recovery actions after a failure', () => {
    expect(availablePrintActions('print_failed')).toEqual(
      expect.arrayContaining(['mark_spoiled', 'hold', 'requeue']),
    );
  });

  it('requires a reason for hold, failure and spoil', () => {
    expect([...OMNI_COMMS_PRINT_REASON_REQUIRED].sort()).toEqual([
      'hold',
      'mark_failed',
      'mark_returned',
      'mark_spoiled',
    ]);
  });

  it('tracks dispatch and return as physical states', () => {
    expect(availablePrintActions('dispatched')).toEqual(['mark_returned']);
    expect(availablePrintActions('returned_undelivered')).toEqual(
      expect.arrayContaining(['hold', 'requeue']),
    );
  });
});
