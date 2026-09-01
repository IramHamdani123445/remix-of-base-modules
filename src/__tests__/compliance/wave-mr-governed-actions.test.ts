/**
 * Waves M–R final security check — every governed Compliance state change must
 * be authorised at the server/database command boundary, not by a hidden or
 * disabled UI control.
 *
 * The trusted boundary is the database: `ce_upsert_contribution_exemption_v1`,
 * `ce_revoke_contribution_exemption_v1`, `ce_override_sector_benchmark_v1` and
 * `ce_set_employer_status_v1` are SECURITY DEFINER commands that check the
 * caller's capability; table grants for the exemption and benchmark registers
 * are revoked and `zz_ce_exemption_guard` blocks direct DML.
 *
 * These tests guard the client half: no application code may write those
 * registers directly, and each UI surface must call the governed command.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const FILES = walk(SRC);

function sourcesWriting(table: string): string[] {
  const writePattern = new RegExp(
    `from\\(\\s*['"\`]${table}['"\`](\\s+as\\s+(any|never))?\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\(`,
    'm',
  );
  return FILES.filter((f) => writePattern.test(readFileSync(f, 'utf8')));
}

describe('Governed Compliance actions — client write boundary (Waves M–R)', () => {
  it('no application code writes ce_contribution_exemptions directly', () => {
    expect(sourcesWriting('ce_contribution_exemptions')).toEqual([]);
  });

  it('no application code writes ce_sector_wage_benchmarks directly', () => {
    expect(sourcesWriting('ce_sector_wage_benchmarks')).toEqual([]);
  });

  it('the exemption register uses the governed grant/amend command', () => {
    const src = readFileSync(
      join(SRC, 'pages', 'compliance', 'settings', 'ContributionExemptions.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_upsert_contribution_exemption_v1');
  });

  it('the benchmark register overrides through the governed command', () => {
    const src = readFileSync(
      join(SRC, 'pages', 'compliance', 'settings', 'WageBenchmarks.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_override_sector_benchmark_v1');
  });

  it('employer status changes run through the governed command', () => {
    const src = readFileSync(
      join(SRC, 'pages', 'compliance', 'settings', 'EmployerStatusRegister.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_set_employer_status_v1');
    expect(sourcesWriting('ce_employer_status_states')).toEqual([]);
  });
});
