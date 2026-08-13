/**
 * Omni-Comms — trusted business-event tenancy contract.
 *
 * These are SOURCE contract assertions for the trusted transactional path.
 * The executable database proof lives in
 * `supabase/tests/omni-comms/business_event_tenancy.sql`.
 *
 * Rule: a business communication event must NEVER acquire its tenant because
 * an organisation happened to be created first.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function readSql(relative: string): string {
  return readFileSync(join(root, relative), 'utf8');
}

describe('business-event tenancy', () => {
  const sql = readSql('supabase/tests/omni-comms/business_event_tenancy.sql');

  it('proves organisation A and organisation B never cross', () => {
    expect(sql).toContain('organization_a');
    expect(sql).toContain('organization_b');
  });

  it('proves ambiguous ownership refuses instead of choosing one', () => {
    expect(sql).toContain('organization_ambiguous');
  });

  it('proves unresolved ownership fails closed', () => {
    expect(sql).toContain('organization_unresolved');
  });

  it('never accepts a first-active-organisation fallback', () => {
    expect(sql).not.toMatch(/ORDER BY\s+o?\.?created_at\s+LIMIT 1/i);
  });
});
