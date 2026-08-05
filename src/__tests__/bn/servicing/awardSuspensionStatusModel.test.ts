import { describe, it, expect } from 'vitest';
import {
  normaliseEventStatus,
  resolveDisplayStatus,
} from '@/services/bn/awardSuspensionViewService';

const openTask = { task_status: 'OPEN', metadata: { approval_level: 2 } };

describe('BN award suspension — raw event status', () => {
  it('keeps canonical suspension and reinstatement statuses', () => {
    expect(normaliseEventStatus('PROPOSED')).toBe('PROPOSED');
    expect(normaliseEventStatus('execution_failed')).toBe('EXECUTION_FAILED');
    expect(normaliseEventStatus('REINSTATEMENT_PROPOSED')).toBe('REINSTATEMENT_PROPOSED');
  });

  it('fails closed to UNKNOWN instead of pretending a case is proposed', () => {
    expect(normaliseEventStatus('PENDING_APPROVAL')).toBe('UNKNOWN');
    expect(normaliseEventStatus(null)).toBe('UNKNOWN');
  });
});

describe('BN award suspension — display status', () => {
  it('derives approval levels only while a task is open', () => {
    expect(resolveDisplayStatus('PROPOSED', openTask)).toBe('PENDING_LEVEL_2');
    expect(resolveDisplayStatus('PROPOSED', null)).toBe('PROPOSED');
  });

  it('surfaces execution failure explicitly', () => {
    expect(resolveDisplayStatus('EXECUTION_FAILED', null)).toBe('EXECUTION_FAILED');
  });

  it('never presents an unknown status as actionable', () => {
    expect(resolveDisplayStatus('UNKNOWN', openTask)).toBe('UNKNOWN');
  });

  it('maps reinstatement lifecycle values to reinstatement display values', () => {
    expect(resolveDisplayStatus('REINSTATEMENT_PROPOSED', null)).toBe('REINSTATEMENT_PENDING');
    expect(resolveDisplayStatus('REINSTATEMENT_APPROVED', null)).toBe('REINSTATEMENT_APPROVED');
    expect(resolveDisplayStatus('RESUMED', null)).toBe('APPLIED');
  });
});
