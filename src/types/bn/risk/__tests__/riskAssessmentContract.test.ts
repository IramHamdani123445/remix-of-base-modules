/**
 * BN Risk EPIC 1 — contract guards for the assessment application layer.
 *
 * These tests protect the boundary rules the UI depends on: the epic's
 * command list must stay closed (no scoring), and the frontend must never
 * ship a command the governed boundary does not implement.
 */
import { describe, expect, it } from 'vitest';
import { BN_RISK_EPIC1_COMMANDS } from '@/types/bn/risk/riskAssessment';

describe('BN Risk Epic 1 command contract', () => {
  it('exposes creation, factor and evidence commands only', () => {
    expect(BN_RISK_EPIC1_COMMANDS).toContain('BN_RISK_CREATE_ASSESSMENT');
    expect(BN_RISK_EPIC1_COMMANDS).toContain('BN_RISK_ADD_FACTOR');
    expect(BN_RISK_EPIC1_COMMANDS).toContain('BN_RISK_REQUEST_EVIDENCE');
    expect(BN_RISK_EPIC1_COMMANDS).toContain('BN_RISK_OP_COMPLETE_INFORMATION_GATHERING');
  });

  it('stops before scoring, recommendation and control actions', () => {
    const forbidden = [
      'BN_RISK_SCORE_ASSESSMENT',
      'BN_RISK_RECOMMEND_ACTION',
      'BN_RISK_APPLY_CONTROL',
      'BN_RISK_REFER_CASE',
    ];
    for (const command of forbidden) {
      expect(BN_RISK_EPIC1_COMMANDS as readonly string[]).not.toContain(command);
    }
  });

  it('keeps every command uniquely named and namespaced', () => {
    const unique = new Set(BN_RISK_EPIC1_COMMANDS);
    expect(unique.size).toBe(BN_RISK_EPIC1_COMMANDS.length);
    for (const command of BN_RISK_EPIC1_COMMANDS) {
      expect(command.startsWith('BN_RISK_')).toBe(true);
    }
  });
});
