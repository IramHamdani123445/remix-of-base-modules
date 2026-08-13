/**
 * Omni-Comms — permanent migrations must be environment-independent.
 *
 * Production incident remediation belongs in explicit audited operational
 * tooling, never in schema migrations. A fresh environment must rebuild from
 * source without any production identifier existing.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = 'supabase/migrations';

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => ({ name: f, sql: readFileSync(path.join(DIR, f), 'utf8') }));

/** Strip comments so documentation may explain the rule it enforces. */
function executable(sql: string): string {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

const UUID = "'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'";

/**
 * Incident-specific operational calls: requeue / reconcile / recover of a
 * single named runtime record.
 */
const INCIDENT_CALLS = new RegExp(
  `(omni_comms_priv_requeue_business_event|omni_comms_priv_reconcile_business_event_handoff|omni_comms_priv_recover_request)\\s*\\(\\s*${UUID}`,
  'i',
);

/** Direct data mutation of a single named Omni-Comms runtime record. */
const RUNTIME_TABLES = [
  'omni_comms_business_event_outbox',
  'omni_comms_request',
  'omni_comms_message',
  'omni_comms_dispatch_job',
];

describe('permanent migrations contain no live incident data', () => {
  it('never calls incident remediation functions with a hard-coded identifier', () => {
    const offenders = files
      .filter((f) => INCIDENT_CALLS.test(executable(f.sql)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  it('never mutates a single named Omni-Comms runtime record', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const sql = executable(f.sql);
      for (const table of RUNTIME_TABLES) {
        const re = new RegExp(
          `(UPDATE|DELETE\\s+FROM)\\s+(public\\.)?${table}[\\s\\S]{0,600}?WHERE[\\s\\S]{0,200}?id\\s*=\\s*${UUID}`,
          'i',
        );
        if (re.test(sql)) offenders.push(`${f.name} (${table})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('carries no reference to the recorded production incident identifiers', () => {
    const known = ['8963c01b-e8cb-4ba1-8699-90653d085bf4', 'b07386bf-5f1a-46c6-9281-25ee3332ef04'];
    const offenders = files
      .filter((f) => known.some((id) => f.sql.includes(id)))
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });
});

describe('resolution scope semantics are source-controlled and strict', () => {
  const withDef = (fn: string) =>
    files.filter((f) => f.sql.includes(`FUNCTION public.${fn}(`)).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

  for (const fn of [
    'omni_comms_priv_effective_channels',
    'omni_comms_priv_runtime_resolution_snapshot',
  ]) {
    it(`${fn} never widens a missing department to every department`, () => {
      const defs = withDef(fn);
      expect(defs.length).toBeGreaterThan(0);
      const latest = defs[defs.length - 1];
      // The unsafe form: "department_id IS NULL OR p_department_id IS NULL"
      // makes EVERY department-scoped row a candidate when no department
      // context is supplied.
      expect(latest.sql).not.toMatch(/p_department_id IS NULL\s+OR\s+\w+\.department_id\s*=/i);
      expect(latest.sql).not.toMatch(/department_id IS NULL\s+OR\s+p_department_id IS NULL/i);
      expect(latest.sql).toMatch(
        /WHEN p_department_id IS NULL THEN \w+\.department_id IS NULL/i,
      );
    });
  }
});
