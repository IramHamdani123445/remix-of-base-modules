/**
 * Checkpoint F-S1 — GAP-F-01 negative security tests (client boundary).
 *
 * The trusted boundary is the database: `ce_violation_assign_v1`,
 * `ce_violation_reassign_v1`, `ce_violation_bulk_reassign_v1`,
 * `ce_violation_bulk_assign_unassigned_v1` and
 * `ce_violation_return_to_queue_v1` are SECURITY DEFINER commands that verify
 * the caller's `compliance.violations.manage` capability. Table grants on
 * `ce_violation_assignments` are revoked for anon/authenticated and a guard
 * trigger blocks direct DML.
 *
 * These tests guard the client half: no application code may write the
 * assignment register directly, and every UI writer must route through the
 * governed commands.
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
    `from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,300}?\\.(insert|update|upsert|delete)\\(`,
    'm',
  );
  return FILES.filter((f) => writePattern.test(readFileSync(f, 'utf8')));
}

describe('Violation assignment governance — client write boundary', () => {
  it('no application code writes ce_violation_assignments directly', () => {
    expect(sourcesWriting('ce_violation_assignments')).toEqual([]);
  });

  it('the assignment dialog uses the governed assign/reassign commands', () => {
    const src = readFileSync(join(SRC, 'components', 'compliance', 'AssignmentDialog.tsx'), 'utf8');
    expect(src).toContain('ce_violation_assign_v1');
    expect(src).toContain('ce_violation_reassign_v1');
  });

  it('the workload reassignment page uses the governed bulk commands', () => {
    const src = readFileSync(
      join(SRC, 'pages', 'compliance', 'operations', 'Reassignment.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_violation_bulk_reassign_v1');
    expect(src).toContain('ce_violation_bulk_assign_unassigned_v1');
  });

  it('officer status changes reassign through governed commands only', () => {
    const src = readFileSync(
      join(SRC, 'components', 'compliance', 'staff', 'OfficerStatusChangeWizard.tsx'),
      'utf8',
    );
    expect(src).toContain('ce_violation_reassign_v1');
    expect(src).toContain('ce_violation_return_to_queue_v1');
  });
});
