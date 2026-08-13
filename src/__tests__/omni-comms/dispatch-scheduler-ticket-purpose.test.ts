/**
 * Omni-Comms — dispatch scheduler authentication closure.
 *
 * Proves, from source of truth in the repository:
 *  - the legacy one-argument consume-ticket overload is dropped so exactly one
 *    callable signature remains (no PostgREST ambiguity);
 *  - the canonical signature keeps an explicit purpose parameter;
 *  - privileges stay service_role only;
 *  - the dispatcher passes p_purpose = 'dispatch' explicitly and never relies
 *    on the default for a security-sensitive purpose boundary;
 *  - the ingest worker keeps its own distinct purpose.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');

function allMigrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
    .join('\n');
}

const DISPATCHER = readFileSync(
  join(process.cwd(), 'supabase/functions/omni-comms-dispatch/index.ts'),
  'utf8',
);
const INGEST = readFileSync(
  join(process.cwd(), 'supabase/functions/omni-comms-business-event-ingest/index.ts'),
  'utf8',
);

describe('consume-ticket signature closure', () => {
  const sql = allMigrationSql();

  it('drops the legacy one-argument overload', () => {
    expect(sql).toMatch(
      /DROP FUNCTION IF EXISTS\s+public\.omni_comms_priv_scheduler_consume_ticket\(text\)/i,
    );
  });

  it('keeps a canonical two-argument signature with an explicit purpose', () => {
    expect(sql).toMatch(
      /omni_comms_priv_scheduler_consume_ticket\(\s*\n?\s*p_nonce text,\s*p_purpose text DEFAULT 'dispatch'/i,
    );
  });

  it('grants execute to service_role only', () => {
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_scheduler_consume_ticket\(text, text\) TO service_role/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_scheduler_consume_ticket\(text, text\) FROM anon/i,
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_scheduler_consume_ticket\(text, text\) FROM authenticated/i,
    );
  });

  it('enforces purpose isolation inside the canonical function', () => {
    expect(sql).toMatch(/AND purpose = v_purpose/i);
    expect(sql).toMatch(/AND consumed_at IS NULL/i);
    expect(sql).toMatch(/AND expires_at > now\(\)/i);
  });
});

describe('worker purpose boundaries', () => {
  it('dispatcher consumes tickets with an explicit dispatch purpose', () => {
    expect(DISPATCHER).toContain('omni_comms_priv_scheduler_consume_ticket');
    expect(DISPATCHER).toMatch(/p_purpose:\s*"dispatch"/);
  });

  it('ingest worker consumes tickets with its own purpose', () => {
    expect(INGEST).toMatch(/p_purpose:\s*SCHEDULER_PURPOSE/);
    expect(INGEST).toMatch(/SCHEDULER_PURPOSE\s*=\s*["']business_event_ingest["']/);
  });

  it('dispatcher rejects a tick when the ticket is not consumed', () => {
    expect(DISPATCHER).toContain('scheduler_ticket_invalid');
  });
});

describe('zero-work scheduler evidence', () => {
  const sql = allMigrationSql();

  it('records a zero-work dispatch tick without a blocker', () => {
    expect(sql).toMatch(/v_scanned = 0 AND v_claimed = 0 AND v_blocker_count = 0 THEN NULL/i);
  });

  it('still writes dispatch run evidence for every tick', () => {
    expect(sql).toMatch(/INSERT INTO public\.omni_comms_scheduler_run/i);
    expect(sql).toMatch(/'scheduler', 'email'/);
  });
});
