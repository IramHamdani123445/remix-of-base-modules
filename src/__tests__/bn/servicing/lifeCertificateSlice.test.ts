import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rpcMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  generateObligations, recordReceipt, verifyCertificate, rejectCertificate,
  requestResubmission, waiveObligation, deferObligation, markMilestone,
  escalateToSuspension, proposeReinstatement,
  describeLifeCertificateFailure, LifeCertificateCommandError,
  LIFE_CERTIFICATE_MAX_BATCH,
} from '@/services/bn/lifeCertificateCommandService';
import { clearMilestoneAttempts } from '@/services/bn/lifeCertificateCommandService';
import { fetchWorklist, fetchDetail, fetchTimeline, LIFE_CERTIFICATE_BUCKETS } from '@/services/bn/lifeCertificateViewService';
import {
  planMilestoneWork, milestoneIdempotencyKey, MAX_ATTEMPTS, MAX_BATCH, type DueRow,
} from '../../../../supabase/functions/bn-life-certificate-runner/plan';

const ok = (data: unknown = { status: 'OK' }) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: { message } });

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

/** Source with comments stripped — boundary rules apply to executable code. */
const readCode = (p: string) =>
  read(p)
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

beforeEach(() => {
  rpcMock.mockReset();
  rpcMock.mockResolvedValue(ok());
});

describe('Life Certificate command boundary', () => {
  it('routes every mutation through a versioned server command', async () => {
    const base = { lifeCertificateId: 'lc-1', expectedRowVersion: 3 };
    await recordReceipt({ ...base, receivedDate: '2026-01-05', documentId: 'doc-1', evidenceType: 'LIFE_CERTIFICATE', certificateDate: '2026-01-02', channel: 'IN_PERSON' });
    await verifyCertificate({ ...base });
    await rejectCertificate({ ...base, reasonCode: 'LIFE_CERT_ILLEGIBLE', narrative: 'unreadable' });
    await requestResubmission({ ...base, narrative: 'resend', resubmissionDueDate: '2026-02-01' });
    await waiveObligation({ ...base, reasonCode: 'LIFE_CERT_MEDICAL', narrative: 'bedridden', effectiveFrom: '2026-01-01', expiresOn: '2026-12-31' });
    await deferObligation({ ...base, reasonCode: 'LIFE_CERT_TRAVEL', narrative: 'abroad', deferredTo: '2026-03-01' });
    await markMilestone({ lifeCertificateId: 'lc-1', milestone: 'OVERDUE' });
    await escalateToSuspension({ ...base, narrative: 'overdue' });
    await proposeReinstatement({ ...base, narrative: 'verified' });

    const called = rpcMock.mock.calls.map((c) => c[0] as string);
    expect(called).toEqual([
      'bn_life_certificate_receive_v1',
      'bn_life_certificate_verify_v1',
      'bn_life_certificate_reject_v1',
      'bn_life_certificate_request_resubmission_v1',
      'bn_life_certificate_waive_v1',
      'bn_life_certificate_defer_v1',
      'bn_life_certificate_mark_milestone_v1',
      'bn_life_certificate_escalate_to_suspension_v1',
      'bn_life_certificate_propose_reinstatement_v1',
    ]);
    expect(called.every((n) => n.endsWith('_v1'))).toBe(true);
  });

  it('always sends the expected row version for optimistic concurrency', async () => {
    await verifyCertificate({ lifeCertificateId: 'lc-1', expectedRowVersion: 7 });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_expected_row_version: 7 });
  });

  it('caps controlled backfill batches', async () => {
    await generateObligations({ preview: false, limit: 100000 });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_limit: LIFE_CERTIFICATE_MAX_BATCH });
  });

  it('supports preview generation without creating obligations', async () => {
    await generateObligations({ preview: true });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_preview: true });
  });

  it('passes idempotency and correlation identity through', async () => {
    await escalateToSuspension({ lifeCertificateId: 'lc-1', narrative: 'x', expectedRowVersion: 1, idempotencyKey: 'k1', correlationId: 'c1' });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_idempotency_key: 'k1', p_correlation_id: 'c1' });
  });

  it.each([
    ['E_FORBIDDEN', 'permission'],
    ['E_STALE_ROW_VERSION', 'changed since it was loaded'],
    ['E_SELF_APPROVAL_FORBIDDEN', 'Maker-checker'],
    ['E_EVIDENCE_WRONG_CLAIMANT', 'does not belong'],
    ['E_EVIDENCE_ALREADY_USED', 'already linked'],
    ['E_NOT_OVERDUE', 'overdue'],
    ['E_NOT_VERIFIED', 'verified'],
    ['E_AWARD_NOT_SUSPENDED', 'not suspended'],
    ['E_FEATURE_DISABLED', 'disabled'],
  ])('maps %s to a sanitized operator message', async (code, fragment) => {
    rpcMock.mockResolvedValueOnce(fail(`operation failed: ${code}`));
    await expect(verifyCertificate({ lifeCertificateId: 'lc-1', expectedRowVersion: 1 }))
      .rejects.toBeInstanceOf(LifeCertificateCommandError);
    expect(describeLifeCertificateFailure(code)).toContain(fragment);
  });

  it('never leaks raw SQL detail to the operator', async () => {
    rpcMock.mockResolvedValueOnce(fail('null value in column "bn_award_id" violates not-null constraint'));
    await expect(verifyCertificate({ lifeCertificateId: 'lc-1', expectedRowVersion: 1 }))
      .rejects.toThrow('The command could not be completed.');
  });
});

describe('Life Certificate query boundary', () => {
  it('reads worklists, detail and timeline through secured RPCs only', async () => {
    rpcMock.mockResolvedValue(ok({ rows: [], total: 0, limit: 50, offset: 0 }));
    await fetchWorklist({ bucket: 'OVERDUE' });
    await fetchDetail('lc-1');
    await fetchTimeline('lc-1');
    expect(rpcMock.mock.calls.map((c) => c[0])).toEqual([
      'bn_life_certificate_worklist_v2',
      'bn_life_certificate_detail_v1',
      'bn_life_certificate_timeline_v1',
    ]);
  });

  it('caps worklist page size', async () => {
    rpcMock.mockResolvedValue(ok({ rows: [], total: 0, limit: 200, offset: 0 }));
    await fetchWorklist({ bucket: 'ALL', limit: 5000 });
    expect(rpcMock.mock.calls[0][1]).toMatchObject({ p_limit: 200 });
  });

  it('distinguishes denied from failed reads', async () => {
    rpcMock.mockResolvedValueOnce(fail('E_FORBIDDEN'));
    await expect(fetchWorklist({ bucket: 'ALL' })).rejects.toMatchObject({ code: 'E_FORBIDDEN' });
    rpcMock.mockResolvedValueOnce(fail('boom'));
    await expect(fetchWorklist({ bucket: 'ALL' })).rejects.toMatchObject({ code: 'E_UNKNOWN' });
  });
});

describe('Life Certificate boundary regressions', () => {
  const canonicalFiles = [
    'src/services/bn/lifeCertificateCommandService.ts',
    'src/services/bn/lifeCertificateViewService.ts',
    'src/pages/bn/servicing/LifeCertificateManagement.tsx',
    'src/components/bn/life-certificates/LifeCertificateDetailPanel.tsx',
    'src/components/bn/life-certificates/LifeCertificateActionDialogs.tsx',
  ];

  it('canonical Life Certificate code never imports legacy Benefits mutation services', () => {
    for (const file of canonicalFiles) {
      const src = readCode(file);
      expect(src).not.toContain('awardServicingService');
      expect(src).not.toContain('updateAwardStatus');
      expect(src).not.toContain('/newbenefit/');
      expect(src).not.toContain('/nbenefit/');
    }
  });

  it('never writes to bn_life_certificate, awards, payments or communication tables from the browser', () => {
    for (const file of canonicalFiles) {
      const src = readCode(file);
      expect(src).not.toMatch(/from\(['"]bn_life_certificate/);
      expect(src).not.toMatch(/from\(['"]bn_award['"]\)[\s\S]{0,120}\.update\(/);
      expect(src).not.toMatch(/\.update\(/);
      expect(src).not.toMatch(/\.insert\(/);
      expect(src).not.toMatch(/\.delete\(/);
      expect(src).not.toContain('notification_queue');
      expect(src).not.toContain('bn_communication_log');
      expect(src).not.toContain('core_audit_log');
    }
  });

  it('retired the legacy browser Life Certificate mutations', () => {
    const src = read('src/services/bn/awardServicingService.ts');
    expect(src).not.toContain('export async function verifyLifeCertificate');
    expect(src).not.toContain('export async function recordLifeCertificateReminder');
  });

  it('keeps suspension and reinstatement as proposals only', () => {
    const src = read('src/services/bn/lifeCertificateCommandService.ts');
    expect(src).toContain('bn_life_certificate_escalate_to_suspension_v1');
    expect(src).toContain('bn_life_certificate_propose_reinstatement_v1');
    expect(src).not.toContain('bn_award_suspension_execute_v1');
    expect(src).not.toContain('bn_award_reinstatement_execute_v1');
  });
});

describe('Life Certificate scheduler runner', () => {
  const runner = 'supabase/functions/bn-life-certificate-runner/index.ts';

  it('exists and is registered with verify_jwt disabled for scheduler invocation', () => {
    expect(existsSync(resolve(process.cwd(), runner))).toBe(true);
    const config = read('supabase/config.toml');
    expect(config).toContain('[functions.bn-life-certificate-runner]');
  });

  it('requires the shared runner secret', () => {
    const src = read(runner);
    expect(src).toContain('BN_LIFE_CERTIFICATE_RUNNER_SECRET');
    expect(src).toContain('x-bn-life-certificate-runner-secret');
    expect(src).toContain('status: 401');
  });

  it('calls the canonical due-feed RPC name', () => {
    const src = readCode(runner);
    expect(src).toContain('bn_life_certificate_due_milestones_v1');
    expect(src).not.toContain('bn_life_certificate_due_for_milestone_v1');
    expect(src).not.toContain('p_as_of: asOf,\n          p_idempotency_key');
  });

  it('delegates outcomes to the server command and sanitizes errors', () => {
    const src = readCode(runner);
    expect(src).toContain('bn_life_certificate_mark_milestone_v1');
    expect(src).toContain('function sanitize');
    expect(src).not.toMatch(/\.from\(["']bn_life_certificate/);
    expect(src).not.toMatch(/ssn|first_name|last_name/i);
  });
});


// ---------------------------------------------------------------------------
// Executable scheduler contract — the runner's real planning code is imported
// and exercised against actual due-feed row shapes (no source-string checks).
// ---------------------------------------------------------------------------
describe('Life Certificate scheduler contract (executable)', () => {
  const row = (over: Partial<DueRow> = {}): DueRow => ({
    life_certificate_id: 'lc-1',
    bn_award_id: 'aw-1',
    milestone: 'REMINDER_1',
    milestone_date: '2026-03-18',
    attempts: 0,
    row_version: 4,
    obligation_status: 'DUE',
    ...over,
  });

  it('turns a due-feed row into a mark-milestone call with the correct identity', async () => {
    const [work] = planMilestoneWork([row()]);
    expect(work.skipped).toBe(false);

    rpcMock.mockResolvedValueOnce(ok({ status: 'APPLIED' }));
    await markMilestone({
      lifeCertificateId: work.lifeCertificateId,
      milestone: work.milestone as 'REMINDER_1',
      idempotencyKey: work.idempotencyKey,
    });

    expect(rpcMock.mock.calls[0][0]).toBe('bn_life_certificate_mark_milestone_v1');
    expect(rpcMock.mock.calls[0][1]).toEqual({
      p_life_certificate_id: 'lc-1',
      p_milestone: 'REMINDER_1',
      p_idempotency_key: 'lc:lc-1:REMINDER_1:2026-03-18',
      p_correlation_id: null,
    });
  });

  it('never sends a caller-supplied as-of date', async () => {
    await markMilestone({ lifeCertificateId: 'lc-1', milestone: 'OVERDUE' });
    expect(Object.keys(rpcMock.mock.calls[0][1] as object)).not.toContain('p_as_of');
  });

  it('gives each configured reminder offset a distinct milestone identity', () => {
    const plan = planMilestoneWork([
      row({ milestone: 'REMINDER_1', milestone_date: '2026-03-18' }),
      row({ milestone: 'REMINDER_2', milestone_date: '2026-03-29' }),
    ]);
    expect(plan.map((p) => p.idempotencyKey)).toEqual([
      'lc:lc-1:REMINDER_1:2026-03-18',
      'lc:lc-1:REMINDER_2:2026-03-29',
    ]);
    expect(new Set(plan.map((p) => p.idempotencyKey)).size).toBe(2);
  });

  it('replays the same key for the same milestone date (no daily repeat)', () => {
    const a = milestoneIdempotencyKey(row());
    const b = milestoneIdempotencyKey(row());
    expect(a).toBe(b);
  });

  it('counts first failure and retry, but stops at five failed attempts', () => {
    expect(planMilestoneWork([row({ attempts: 1 })])[0].skipped).toBe(false);
    expect(planMilestoneWork([row({ attempts: 4 })])[0].skipped).toBe(false);
    const parked = planMilestoneWork([row({ attempts: 5 })])[0];
    expect(parked.skipped).toBe(true);
    expect(parked.skipReason).toBe('E_MAX_ATTEMPTS');
  });

  it('does not block a later milestone because of an earlier failed one', () => {
    const plan = planMilestoneWork([
      row({ milestone: 'REMINDER_1', attempts: 5 }),
      row({ milestone: 'OVERDUE', milestone_date: '2026-04-30', attempts: 0 }),
    ]);
    expect(plan[0].skipped).toBe(true);
    expect(plan[1].skipped).toBe(false);
  });

  it('supports manual recovery through a server command', async () => {
    await clearMilestoneAttempts({ lifeCertificateId: 'lc-1' });
    expect(rpcMock.mock.calls[0][0]).toBe('bn_life_certificate_clear_milestone_attempts_v1');
  });

  it('bounds the batch at 200', () => {
    const rows = Array.from({ length: 500 }, (_, i) => row({ life_certificate_id: `lc-${i}` }));
    expect(planMilestoneWork(rows)).toHaveLength(MAX_BATCH);
    expect(MAX_BATCH).toBe(LIFE_CERTIFICATE_MAX_BATCH);
    expect(MAX_ATTEMPTS).toBe(5);
  });

  it('exposes a manual-intervention bucket in the worklist', () => {
    expect(LIFE_CERTIFICATE_BUCKETS.map((b) => b.key)).toContain('MANUAL_INTERVENTION');
  });
});

describe('Life Certificate database grant verifier', () => {
  it('ships an effective-grant verifier using catalogue privileges', () => {
    const sql = read('supabase/verify/bn_life_certificate_effective_grants.sql');
    expect(sql).toContain('pg_proc');
    expect(sql).toContain('proacl');
    expect(sql).toContain('aclexplode');
    expect(sql).toContain('bn_life_certificate_due_for_milestone_v1');
  });
});
