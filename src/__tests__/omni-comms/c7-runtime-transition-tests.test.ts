/**
 * Omni-Comms Phase C7 Runtime Transition Closure — executable database tests.
 *
 * Source-grounded assertions over the executable runtime-transition suite
 * (`scripts/omni-comms/test-c7-runtime-transitions.sql`), the corrective
 * migration that it exposed, and the extended closure verifier.
 *
 * These tests read source only. They contact no provider, claim no job and
 * mutate no database.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const SUITE = read('scripts/omni-comms/test-c7-runtime-transitions.sql');
const VERIFIER = read('scripts/omni-comms/verify-c7-closure-correction.sql');

describe('C7 executable runtime transition suite — safety envelope', () => {
  it('never contacts a provider', () => {
    expect(SUITE).not.toMatch(/https?:\/\//i);
    expect(SUITE).not.toMatch(/\bresend\.com\b/i);
    expect(SUITE).not.toMatch(/\bnet\.http|pg_net|extensions\.http\b/i);
  });

  it('never enables live delivery or the live release state', () => {
    expect(SUITE).not.toMatch(/live_delivery_enabled\s*=\s*true/i);
    expect(SUITE).not.toMatch(/release_state\s*=\s*'live'\s*(?:,|;|$)/im);
    expect(SUITE).toMatch(/release_state='live'\)/);
  });


  it('rolls every fixture back through an explicit sentinel', () => {
    expect(SUITE).toContain('OMNI_COMMS_C7_TEST_ROLLBACK_SENTINEL');
    expect(SUITE).toMatch(/RAISE EXCEPTION 'OMNI_COMMS_C7_TEST_ROLLBACK_SENTINEL'/);
  });

  it('re-raises any non-sentinel failure instead of swallowing it', () => {
    expect(SUITE).toMatch(/ELSE\s+RAISE;/);
  });

  it('skips itself safely on an empty event catalogue', () => {
    expect(SUITE).toMatch(/IF NOT EXISTS \(SELECT 1 FROM public\.omni_comms_event_definition\)/);
  });

  it('creates no schema objects outside the temporary test namespace', () => {
    const creates = SUITE.match(/CREATE (?:OR REPLACE )?(?:TABLE|VIEW|INDEX|TYPE|TRIGGER)/gi);
    expect(creates).toBeNull();
  });
});

describe('C7 executable runtime transition suite — asserted behaviour', () => {
  const cases: Array<[string, RegExp]> = [
    ['provider acceptance completes the job', /T1 provider acceptance completes the job/],
    ['delivered callback keeps the job completed', /T2 delivered callback/],
    ['harmful callback preserves job history', /T3 complaint after delivered: job history preserved/],
    ['harmful callback suspends the pilot', /T3d complaint suspends the controlled pilot/],
    ['terminal request history is never rewritten', /T11 terminal request aggregate is not rewritten/],
    ['accepted message fails on complaint', /T4 accepted -> failed on complaint/],
    ['hard bounce fails and suspends', /T8 hard bounce fails the message and suspends the pilot/],
    ['delivered -> failed only via verified callback', /T6 direct delivered -> failed UPDATE is rejected/],
    ['verified callback may fail a delivered message', /T5 delivered -> failed succeeds through the verified callback/],
    ['first uncertain attempt schedules a retry', /T7\.1 attempt 1 outcome_unknown -> job retry_wait/],
    ['retries reuse the idempotency key and payload hash', /T7\.2 second attempt reuses idempotency key and payload hash/],
    ['three uncertain attempts park in reconciliation', /T7\.3 third outcome_unknown -> non-runnable reconciliation hold/],
    ['a late delivered callback resolves reconciliation', /T9 late delivered callback resolves reconciliation/],
    ['a late hard bounce resolves reconciliation as failed', /T10 late hard bounce resolves reconciliation as failed/],
    ['reconciliation holds require the dispatch worker context', /T8x direct processing -> reconciliation hold is rejected/],
    ['reconciliation holds close only via the verified callback', /T8y direct reconciliation hold -> completed is rejected/],
    ['department scope excludes other departments', /T13\.5 another department binding is never counted/],
    ['security definers are owned by postgres', /T14\.1 all C7 security-definer functions are owned by postgres/],
    ['security definers pin their search path', /T14\.2 all C7 security-definer functions pin pg_catalog, public/],
    ['service-role-only functions grant no public execute', /T14\.3 service-role-only functions grant no PUBLIC/],
    ['live delivery remains disabled', /T15\.1 live_delivery_enabled remains false everywhere/],
    ['the live release state remains unavailable', /T15\.2 Release Control live remains unavailable/],
  ];

  it.each(cases)('asserts %s', (_name, pattern) => {
    expect(SUITE).toMatch(pattern);
  });

  it('exercises the real dispatch workers rather than re-implementing them', () => {
    for (const fn of [
      'omni_comms_priv_dispatch_attempt_complete',
      'omni_comms_priv_dispatch_record_callback',
    ]) {
      expect(SUITE).toContain(`public.${fn}(`);
    }
  });

  it('fails loudly when a forbidden transition is accepted', () => {
    expect(SUITE).toMatch(/statement was ACCEPTED but must be rejected/);
  });
});

describe('C7 automatic pilot suspension defect fix', () => {
  it('records the canonical release_suspended event type', () => {
    expect(SUITE).toMatch(/v_rel, 'release_suspended', v_from, 'suspended'/);
    expect(SUITE).not.toMatch(/v_rel, 'suspended', v_from, 'suspended'/);
  });

  it('keeps the suspension worker service-role only and search-path pinned', () => {
    expect(SUITE).toMatch(/SET search_path TO 'pg_catalog', 'public'/);
    expect(SUITE).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_dispatch_suspend_pilot\(uuid, text, text\) FROM authenticated;/,
    );
    expect(SUITE).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_dispatch_suspend_pilot\(uuid, text, text\) TO service_role;/,
    );
    expect(SUITE).toMatch(
      /ALTER FUNCTION public\.omni_comms_priv_dispatch_suspend_pilot\(uuid, text, text\) OWNER TO postgres;/,
    );
  });
});

describe('C7 closure verifier covers the runtime transition closure', () => {
  it.each([['C7F.53'], ['C7F.54'], ['C7F.55']])('includes check %s', (code) => {
    expect(VERIFIER).toContain(code);
  });

  it('proves no fixture is retained by the executable tests', () => {
    expect(VERIFIER).toMatch(/caller_module_code = 'omni_comms_c7_test'/);
  });
});
