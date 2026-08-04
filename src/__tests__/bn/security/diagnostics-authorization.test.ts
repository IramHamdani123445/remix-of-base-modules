/**
 * BN Phase 0 (final slice) — Benefits Diagnostics authorization guard.
 *
 * Proves:
 *  - the raw row-preview capability (dialog, buttons, CSV export) is retired,
 *  - no browser code calls `bn_preview_table`,
 *  - `/bn/admin/diagnostics` is wrapped in a server-backed permission gate so
 *    direct URL navigation fails closed for unauthenticated and
 *    non-authorised users,
 *  - the forward migration revokes PUBLIC/anon/authenticated on
 *    `bn_preview_table`, drops it, and fail-closes `bn_list_tables()`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { globSync } from 'node:fs';

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

const MIGRATIONS_DIR = 'supabase/migrations';
const migrationFiles = existsSync(MIGRATIONS_DIR)
  ? readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  : [];
const migrationText = migrationFiles.map((f) => read(`${MIGRATIONS_DIR}/${f}`)).join('\n');

const sourceFiles = globSync('src/**/*.{ts,tsx}').filter((f) => !f.includes('__tests__'));

describe('BN security — raw Benefits table preview is retired', () => {
  it('no longer ships the TablePreviewDialog component', () => {
    expect(existsSync('src/components/bn/admin/TablePreviewDialog.tsx')).toBe(false);
  });

  it('has no browser call to bn_preview_table', () => {
    const offenders = sourceFiles.filter((f) => {
      if (f.endsWith('src/integrations/supabase/types.ts')) return false;
      const src = read(f);
      return src.includes("rpc('bn_preview_table'") || src.includes('rpc("bn_preview_table"');
    });
    expect(offenders).toEqual([]);
  });

  it('removes the row-preview button and CSV export from the Diagnostics screen', () => {
    const page = read('src/pages/bn/admin/BenefitsDiagnostics.tsx');
    expect(page).not.toContain('TablePreviewDialog');
    expect(page).not.toContain('previewTable');
    expect(page).not.toContain('downloadCsv');
    expect(page).not.toContain('text/csv');
  });

  it('retains only non-sensitive metadata diagnostics', () => {
    const page = read('src/pages/bn/admin/BenefitsDiagnostics.tsx');
    expect(page).toContain("rpc('bn_list_tables')");
    expect(page).toContain('Metadata only');
  });
});

describe('BN security — /bn/admin/diagnostics fails closed', () => {
  const routes = read('src/components/routing/AppRoutes.tsx');

  it('wraps the diagnostics route in the permission gate', () => {
    const line = routes
      .split('\n')
      .find((l) => l.includes('path="/bn/admin/diagnostics"')) ?? '';
    expect(line).toContain('PermissionProtectedRoute');
    expect(line).toContain('moduleName="benefits_management"');
  });

  it('imports the permission gate component', () => {
    expect(routes).toContain(
      "import { PermissionProtectedRoute } from '@/components/auth/PermissionProtectedRoute'",
    );
  });

  it('denies unauthenticated users and redirects non-permitted users', () => {
    const guard = read('src/components/auth/PermissionProtectedRoute.tsx');
    // unauthenticated -> /login
    expect(guard).toContain('if (!isAuthenticated)');
    expect(guard).toContain('<Navigate to="/login" replace />');
    // authenticated but not permitted -> fallback (unauthorized)
    expect(guard).toContain('if (!canAccess)');
    expect(guard).toContain("fallbackPath = '/unauthorized'");
    // admin bypass exists (authorised admin access permitted)
    expect(guard).toContain('if (isAdmin)');
  });
});

describe('BN security — database boundary for diagnostics functions', () => {
  it('revokes and drops bn_preview_table in a forward migration', () => {
    expect(migrationText).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.bn_preview_table\(text,\s*int,\s*int\)\s+FROM\s+PUBLIC/i,
    );
    expect(migrationText).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.bn_preview_table\(text,\s*int,\s*int\)\s+FROM\s+anon/i,
    );
    expect(migrationText).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.bn_preview_table\(text,\s*int,\s*int\)\s+FROM\s+authenticated/i,
    );
    expect(migrationText).toMatch(
      /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.bn_preview_table\(text,\s*int,\s*int\)/i,
    );
  });

  it('fail-closes bn_list_tables() behind authentication and Benefits admin authorisation', () => {
    expect(migrationText).toContain("RAISE EXCEPTION 'Authentication required'");
    expect(migrationText).toContain("public.has_permission(v_uid, 'benefits_management', 'admin')");
    expect(migrationText).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.bn_list_tables\(\)\s+FROM\s+anon/i,
    );
  });
});
