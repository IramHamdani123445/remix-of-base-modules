import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Regression: omni_comms_print_provision_defaults previously omitted
 * max_messages_total, so the table default (50) was used and the release-control
 * ladder constraint (hour <= day <= total) rejected 20 <= 100 <= 50.
 *
 * This asserts the shipped SQL seeds an internally consistent quota set.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

function latestProvisioningSql(): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const sql = readFileSync(join(MIGRATIONS_DIR, files[i]), 'utf8');
    if (sql.includes('FUNCTION public.omni_comms_print_provision_defaults')) return sql;
  }
  throw new Error('omni_comms_print_provision_defaults migration not found');
}

describe('print provisioning release-control quota ladder', () => {
  const sql = latestProvisioningSql();

  it('inserts an explicit max_messages_total column', () => {
    expect(sql).toContain('max_messages_total');
  });

  it('seeds quotas that satisfy hour <= day <= total', () => {
    const match = sql.match(
      /'print',\s*'system_seed',\s*'configuration',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),/,
    );
    expect(match).not.toBeNull();
    const [recipients, hour, day, total] = (match as RegExpMatchArray)
      .slice(1)
      .map((n) => Number(n));

    expect(recipients).toBe(10);
    expect(hour).toBe(20);
    expect(day).toBe(100);
    expect(total).toBe(500);
    expect(hour).toBeLessThanOrEqual(day);
    expect(day).toBeLessThanOrEqual(total);
  });

  it('creates the release-control row for the print channel in configuration state', () => {
    expect(sql).toMatch(/INSERT INTO public\.omni_comms_channel_release_control/);
    expect(sql).toMatch(/'print',\s*'system_seed',\s*'configuration'/);
  });

  it('stays idempotent by only inserting when no release row exists', () => {
    expect(sql).toMatch(/SELECT id INTO v_release FROM public\.omni_comms_channel_release_control/);
    expect(sql).toMatch(/IF v_release IS NULL THEN/);
  });

  it('keeps the governed draft -> active lifecycle and service verification source', () => {
    expect(sql).toContain("'service'");
    expect(sql).toMatch(/status='active'/);
    expect(sql).toMatch(/'draft'/);
  });
});
