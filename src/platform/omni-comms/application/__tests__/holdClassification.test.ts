import { describe, expect, it } from 'vitest';
import {
  attentionTotal,
  classifyHold,
  jobHoldStatus,
} from '../holdClassification';

describe('Omni-Comms hold classification', () => {
  it('treats an absent reason as ready and not actionable', () => {
    const c = classifyHold(null);
    expect(c.bucket).toBe('READY');
    expect(c.actionable).toBe(false);
  });

  it('never makes a historical pre-activation hold actionable', () => {
    const c = classifyHold('historical_job_not_authorized');
    expect(c.bucket).toBe('PERMANENT_HISTORICAL');
    expect(c.actionable).toBe(false);
    expect(c.label).toContain('historical');
  });

  it('treats superseded records as archived, not attention', () => {
    for (const r of ['superseded_release_snapshot', 'superseded_pre_production_pilot_job']) {
      expect(classifyHold(r)).toMatchObject({ bucket: 'PERMANENT_HISTORICAL', actionable: false });
    }
  });

  it('classifies recipient allowlist holds as actionable governance work', () => {
    expect(classifyHold('recipient_not_allowlisted')).toMatchObject({
      bucket: 'GOVERNANCE_BLOCKED',
      actionable: true,
    });
  });

  it('separates governance from configuration blockers', () => {
    expect(classifyHold('release_snapshot_missing').bucket).toBe('GOVERNANCE_BLOCKED');
    expect(classifyHold('sender_not_verified').bucket).toBe('CONFIGURATION_BLOCKED');
  });

  it('treats volume limits as a temporary, non-actionable hold', () => {
    expect(classifyHold('release_limit_exceeded')).toMatchObject({
      bucket: 'TEMPORARY_HOLD',
      actionable: false,
    });
  });

  it('treats retry exhaustion as actionable failure', () => {
    expect(classifyHold('retry_exhausted')).toMatchObject({
      bucket: 'FAILED_RETRY_REQUIRED',
      actionable: true,
    });
  });

  it('defaults an unknown reason to actionable governance review', () => {
    expect(classifyHold('some_new_reason')).toMatchObject({
      bucket: 'GOVERNANCE_BLOCKED',
      actionable: true,
    });
  });

  it('prefers the current authorization outcome over the stored claim blocker', () => {
    const s = jobHoldStatus({
      status: 'held',
      hold_reason: 'release_snapshot_missing',
      authorization_outcome: 'historical_job_not_authorized',
    });
    expect(s.bucket).toBe('PERMANENT_HISTORICAL');
    expect(s.actionable).toBe(false);
    expect(s.technicalReason).toBe('historical_job_not_authorized');
  });

  it('falls back to the stored blocker when no outcome has been computed', () => {
    const s = jobHoldStatus({ status: 'held', hold_reason: 'release_snapshot_missing' });
    expect(s.technicalReason).toBe('release_snapshot_missing');
    expect(s.actionable).toBe(true);
  });

  it('counts only actionable work in the attention total', () => {
    expect(
      attentionTotal({
        actionable_held: 3,
        failed_jobs: 1,
        retry_exhausted_jobs: 0,
        attention_total: 4,
        held_by_bucket: { PERMANENT_HISTORICAL: 30, GOVERNANCE_BLOCKED: 3 },
      }),
    ).toBe(4);
  });

  it('returns zero attention when nothing is supplied', () => {
    expect(attentionTotal(null)).toBe(0);
  });
});
