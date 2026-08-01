/**
 * Build 4A certification — schema contract test.
 *
 * Every column name used by certification SQL must exist in the repository's
 * generated Supabase types. This is the guard that keeps the harness, the
 * preflight cleanup and the fixture-cleanup verifier bound to the canonical
 * schema instead of invented columns.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  CERTIFICATION_COLUMN_CONTRACT,
  FORBIDDEN_COLUMN_REFERENCES,
} from '../../../scripts/omni-comms/integration/certificationContract';

const ROOT = path.resolve(__dirname, '../../..');
const TYPES = readFileSync(path.join(ROOT, 'src/integrations/supabase/types.ts'), 'utf8');

const CERT_SQL_SOURCES = [
  'scripts/omni-comms/integration/run-build4a-authorization.ts',
  'scripts/omni-comms/verify-build4a-fixture-cleanup.sql',
];

function rowColumns(table: string): string[] {
  const marker = `\n      ${table}: {\n`;
  const start = TYPES.indexOf(marker);
  if (start === -1) return [];
  const rowStart = TYPES.indexOf('Row: {', start);
  if (rowStart === -1) return [];
  const rest = TYPES.slice(rowStart);
  const lines = rest.split('\n').slice(1);
  const columns: string[] = [];
  for (const line of lines) {
    if (/^\s{8}\}/.test(line)) break;
    const m = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*)\??:/);
    if (m) columns.push(m[1]);
  }
  return columns;
}

describe('Build 4A certification schema contract', () => {
  it('declares only tables that exist in the generated types', () => {
    for (const table of Object.keys(CERTIFICATION_COLUMN_CONTRACT)) {
      expect(rowColumns(table).length, `table not found in generated types: ${table}`).toBeGreaterThan(0);
    }
  });

  it('declares only columns that exist in the generated types', () => {
    for (const [table, columns] of Object.entries(CERTIFICATION_COLUMN_CONTRACT)) {
      const actual = rowColumns(table);
      for (const column of columns) {
        expect(actual, `${table}.${column} is not a canonical column`).toContain(column);
      }
    }
  });

  it('proves core_staff_assignments has no organization_id', () => {
    expect(rowColumns('core_staff_assignments')).not.toContain('organization_id');
    expect(rowColumns('core_staff_assignments')).toContain('department_id');
    expect(rowColumns('core_department')).toContain('organization_id');
  });

  it('never references core_staff_assignments.organization_id anywhere in certification code', () => {
    for (const file of CERT_SQL_SOURCES) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, file).not.toMatch(/core_staff_assignments\s+[A-Za-z]*\s*WHERE[^;]*organization_id/i);
      expect(src, file).not.toContain('core_staff_assignments.organization_id');
      // No aliased form either: `a.organization_id` where `a` is the assignment alias.
      expect(src, file).not.toMatch(/FROM\s+public\.core_staff_assignments\s+a[^;]*a\.organization_id/is);
    }
  });

  it('reaches tenancy through department_id → core_department.organization_id', () => {
    const harness = readFileSync(
      path.join(ROOT, 'scripts/omni-comms/integration/run-build4a-authorization.ts'),
      'utf8',
    );
    const verifier = readFileSync(
      path.join(ROOT, 'scripts/omni-comms/verify-build4a-fixture-cleanup.sql'),
      'utf8',
    );
    for (const src of [harness, verifier]) {
      expect(src).toMatch(/core_department\s+d\s+ON\s+d\.id\s*=\s*a\.department_id/i);
      expect(src).toMatch(/d\.organization_id/);
    }
  });

  it('uses template_family_id, never family_id, for template versions', () => {
    for (const file of CERT_SQL_SOURCES) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, file).not.toMatch(/tv\.family_id/);
    }
    expect(rowColumns('omni_comms_template_version')).toContain('template_family_id');
    expect(rowColumns('omni_comms_template_version')).not.toContain('family_id');
  });

  it('queries omni_comms_event_definition by code, never event_code', () => {
    for (const file of CERT_SQL_SOURCES) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      expect(src, file).not.toMatch(/event_code\s*=/);
    }
    expect(rowColumns('omni_comms_event_definition')).toContain('code');
    expect(rowColumns('omni_comms_event_definition')).not.toContain('event_code');
  });

  it('lists every forbidden column reference in the shared contract', () => {
    expect(FORBIDDEN_COLUMN_REFERENCES).toContain('core_staff_assignments.organization_id');
    expect(FORBIDDEN_COLUMN_REFERENCES).toContain('tv.family_id');
    expect(FORBIDDEN_COLUMN_REFERENCES).toContain('omni_comms_event_definition.event_code');
  });
});
