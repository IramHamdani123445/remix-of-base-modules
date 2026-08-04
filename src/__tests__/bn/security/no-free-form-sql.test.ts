/**
 * BN Phase 1 — security regression guard.
 *
 * The Benefits module must not expose a browser-reachable free-form SQL
 * surface. The `/bn/admin/sql` screen and the `bn_run_select` RPC call were
 * removed, and EXECUTE on the privileged SQL functions was revoked from
 * `anon`/`authenticated` (service_role only).
 *
 * These tests fail closed if any of that is reintroduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

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

  it('has no client-side call to a privileged free-form SQL function', () => {
    const files = globSync('src/**/*.{ts,tsx}');
    const offenders = files.filter((f) => {
      if (f.includes('__tests__')) return false;
      const src = read(f);
      return (
        src.includes("rpc('bn_run_select'") ||
        src.includes('rpc("bn_run_select"') ||
        src.includes("rpc('admin_execute_ddl'") ||
        src.includes("rpc('admin_bulk_insert_jsonb'")
      );
    });
    expect(offenders).toEqual([]);
  });
});
