/**
 * BN Phase 0 — privileged SQL / DDL security regression guard.
 *
 * The Benefits module must not expose a browser-reachable free-form SQL
 * surface, and the browser must not be able to drive cross-environment DDL
 * or arbitrary-table bulk copies.
 *
 * Covered:
 *  - `/bn/admin/sql` screen and route are gone.
 *  - No browser code calls the privileged RPCs.
 *  - The `create-missing-table` utility is retired (edge function deleted,
 *    no browser invocation, no config entry).
 *  - The forward migrations revoke PUBLIC / anon / authenticated for every
 *    privileged function and grant only service_role.
 *
 * These tests fail closed if any of that is reintroduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { globSync } from 'node:fs';

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const MIGRATIONS_DIR = 'supabase/migrations';
// Chronological order — Supabase migration filenames are timestamp-prefixed.
const migrationFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
  : [];
const migrationText = migrationFiles.map((f) => read(`${MIGRATIONS_DIR}/${f}`)).join('\n');

/**
 * Replays every GRANT/REVOKE statement in chronological order and returns the
 * final effective privilege targets for a function name. Historical migrations
 * legitimately granted these functions to `authenticated`; only the FINAL state
 * matters for the security boundary.
 */
function finalGrantTargets(fnName: string): Set<string> {
  const effective = new Set<string>();
  for (const file of migrationFiles) {
    const sql = read(`${MIGRATIONS_DIR}/${file}`);
    const statements = sql.split(';');
    for (const raw of statements) {
      const stmt = raw.replace(/--[^\n]*/g, '').trim();
      if (!stmt) continue;
      const re = new RegExp(`\\b(GRANT|REVOKE)\\b[\\s\\S]*\\b${fnName}\\s*\\(`, 'i');
      if (!re.test(stmt)) continue;
      const isGrant = /^GRANT\b/i.test(stmt);
      const tail = stmt.split(isGrant ? /\bTO\b/i : /\bFROM\b/i).slice(1).join(' ');
      const roles = tail
        .split(',')
        .map((r) => r.trim().toLowerCase().replace(/["\s]/g, ''))
        .filter(Boolean);
      for (const role of roles) {
        if (isGrant) effective.add(role);
        else effective.delete(role);
      }
    }
  }
  return effective;
}


const PRIVILEGED_FUNCTIONS = [
  'public.bn_run_select(text)',
  'public.admin_execute_ddl(text)',
  'public.admin_bulk_insert_jsonb(text, jsonb)',
  'public.admin_create_enum_if_not_exists(text, text[])',
  'public.get_table_ddl_info(text)',
] as const;

const PRIVILEGED_RPC_NAMES = [
  'bn_run_select',
  'admin_execute_ddl',
  'admin_bulk_insert_jsonb',
  'admin_create_enum_if_not_exists',
  'get_table_ddl_info',
] as const;

const sourceFiles = globSync('src/**/*.{ts,tsx}').filter((f) => !f.includes('__tests__'));

describe('BN security — no free-form SQL from the browser', () => {
  it('does not ship a Benefits SQL editor page', () => {
    expect(existsSync('src/pages/bn/admin/BenefitsSqlEditor.tsx')).toBe(false);
  });

  it('does not register a /bn/admin/sql route', () => {
    const routes = read('src/components/routing/AppRoutes.tsx');
    expect(routes).not.toContain('/bn/admin/sql');
    expect(routes).not.toContain('BenefitsSqlEditor');
  });

  it('does not link the SQL editor from the Benefits menu or diagnostics', () => {
    expect(read('src/components/sidebar/menuItems/bnMenuItems.ts')).not.toContain('/bn/admin/sql');
    expect(read('src/pages/bn/admin/BenefitsDiagnostics.tsx')).not.toContain('/bn/admin/sql');
  });

  it('has no client-side call to any privileged SQL/DDL/metadata function', () => {
    const offenders = sourceFiles.filter((f) => {
      const src = read(f);
      // `types.ts` is generated and only *declares* the RPC signatures.
      if (f.endsWith('src/integrations/supabase/types.ts')) return false;
      return PRIVILEGED_RPC_NAMES.some(
        (name) => src.includes(`rpc('${name}'`) || src.includes(`rpc("${name}"`),
      );
    });
    expect(offenders).toEqual([]);
  });
});

describe('BN security — cross-environment table creation utility is retired', () => {
  it('has no create-missing-table edge function in the repository', () => {
    expect(existsSync('supabase/functions/create-missing-table/index.ts')).toBe(false);
    expect(existsSync('supabase/functions/create-missing-table')).toBe(false);
  });

  it('has no create-missing-table entry in supabase/config.toml', () => {
    expect(read('supabase/config.toml')).not.toContain('create-missing-table');
  });

  it('has no browser code invoking create-missing-table', () => {
    const offenders = sourceFiles.filter((f) => read(f).includes('create-missing-table'));
    expect(offenders).toEqual([]);
  });

  it('does not present a working create-table action in the Data Migration UI', () => {
    const ui = read('src/pages/admin/DataMigration.tsx');
    expect(ui).not.toContain('handleCreateMissingTable');
    expect(ui).not.toContain('Create with Data');
    expect(ui).not.toContain('Create Schema Only');
    // Truthful disabled-state message must be present instead.
    expect(ui).toContain('permanently disabled');
    expect(ui).toContain('controlled migration process');
  });
});

describe('BN security — forward migrations revoke privileged execution', () => {
  it.each(PRIVILEGED_FUNCTIONS)('revokes PUBLIC/anon/authenticated on %s', (sig) => {
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const revokes = new RegExp(
      `REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${escaped}\\s+FROM\\s+([^;]*)`,
      'gi',
    );
    const targets = [...migrationText.matchAll(revokes)]
      .map((m) => m[1].toLowerCase())
      .join(' ');
    expect(targets).toContain('public');
    expect(targets).toContain('anon');
    expect(targets).toContain('authenticated');
  });

  it.each(PRIVILEGED_FUNCTIONS)('grants %s to service_role only', (sig) => {
    const escaped = sig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    const grants = new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${escaped}\\s+TO\\s+([^;]*)`, 'gi');
    const matches = [...migrationText.matchAll(grants)].map((m) => m[1].toLowerCase().trim());
    expect(matches.length).toBeGreaterThan(0);
    for (const target of matches) {
      expect(target).toBe('service_role');
      expect(target).not.toContain('anon');
      expect(target).not.toContain('authenticated');
      expect(target).not.toContain('public');
    }
  });

  it('never re-grants a privileged function to anon or authenticated anywhere', () => {
    for (const name of PRIVILEGED_RPC_NAMES) {
      const re = new RegExp(`GRANT[^;]*${name}[^;]*TO[^;]*(anon|authenticated|PUBLIC)`, 'i');
      expect(migrationText).not.toMatch(re);
    }
  });
});
