import { describe, it, expect } from 'vitest';
import {
  basketServesStage,
  expectedBasketCodesForStage,
  pickBasketForStage,
} from '../stageBasketExpectation';

const basket = (code: string) => ({ id: code, basket_code: code, basket_name: code });

describe('stage vs basket expectation', () => {
  it('accepts a queue that serves the stage', () => {
    expect(basketServesStage('BN_AWARD_SETUP', 'AWARD_SETUP')).toBe(true);
    expect(basketServesStage('BN_PAYMENT_PREPARATION', 'PAYMENT')).toBe(true);
  });

  it('rejects the reported defect: award setup owned by a payment queue', () => {
    expect(basketServesStage('BN_PAYMENT_PREPARATION', 'AWARD_SETUP')).toBe(false);
  });

  it('stays silent for stages with no recorded expectation', () => {
    expect(expectedBasketCodesForStage('SOMETHING_NEW')).toEqual([]);
    expect(basketServesStage('ANY_QUEUE', 'SOMETHING_NEW')).toBe(true);
  });

  it('picks the stage-appropriate queue when a role staffs several', () => {
    const shared = [basket('BN_PAYMENT_ISSUE'), basket('BN_PAYMENT_PREPARATION')];
    // Alphabetical order would have chosen Payment Issue — the original defect.
    expect(pickBasketForStage(shared, 'PAYMENT')?.basket_code).toBe('BN_PAYMENT_PREPARATION');
  });

  it('takes the only candidate whatever the stage', () => {
    expect(pickBasketForStage([basket('BN_PAYMENT_ISSUE')], 'AWARD_SETUP')?.basket_code).toBe(
      'BN_PAYMENT_ISSUE',
    );
  });

  it('refuses to guess when several queues share a role and none serves the stage', () => {
    const shared = [basket('BN_PAYMENT_ISSUE'), basket('BN_PAYMENT_PREPARATION')];
    expect(pickBasketForStage(shared, 'INTAKE')).toBeNull();
  });
});
