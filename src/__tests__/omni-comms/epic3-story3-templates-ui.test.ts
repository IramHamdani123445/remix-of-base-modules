/**
 * Epic 3 — Story 3 verification.
 *
 * Structural + adapter-shape + preview-isolation invariants for the
 * Template Catalogue admin UI. Full RPC behaviour is exercised by
 * scripts/omni-comms/verify-epic3-story2-db.sql and the Story 2 suite.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_READINESS_MANIFEST as M } from '@/platform/omni-comms/registry/readinessManifest';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import * as svc from '@/platform/omni-comms/application/templateCatalogueService';
import { TEMPLATE_CATALOGUE_VALIDATION_DETAILS } from '@/platform/omni-comms/application/templateCatalogueErrors';

const ROOT = process.cwd();
const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsTemplatesPage.tsx';
const IFRAME = 'src/platform/omni-comms/admin/components/OmniCommsSandboxedPreview.tsx';
const ORG = 'src/platform/organization/organizationService.ts';
const VERIFY_SQL = 'scripts/omni-comms/verify-story3-nav-permissions.sql';
const ROLLBACK_SQL = 'scripts/omni-comms/rollback/story2-publish-hotfix-rollback.sql';

const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Omni-Comms Epic 3 — Story 3 (Template Admin UI)', () => {
  // ── Registry / manifest ────────────────────────────────────────────────
  it('Templates route is Available in the route registry', () => {
    const r = OMNI_COMMS_ROUTE_REGISTRY.find((x) => x.path === '/admin/omnichannel-communications/templates');
    expect(r?.state).toBe('Available');
    expect(r?.requiredPermission).toBe('omni_comms.view');
  });

  it('readiness manifest promotes Template administration UI to Verified', () => {
    const row = M.foundationStatus.find((r) => r.item === 'Template administration UI');
    expect(row?.state).toBe('Verified');
    const iso = M.foundationStatus.find((r) => r.item === 'Template preview isolation');
    expect(iso?.state).toBe('Verified');
    const nav = M.foundationStatus.find((r) => r.item === 'Template navigation & permission setup');
    expect(nav?.state).toBe('Verified');
  });

  it('nextStep advances to Epic 3 Story 4', () => {
    expect(M.nextStep.epic).toBe('Epic 3');
    expect(M.nextStep.story).toBe('Story 4');
  });

  // ── Adapter contract used by the UI ────────────────────────────────────
  it('publishTemplateVersion sends the hardened 5-argument contract', async () => {
    let captured: { fn: string; args: Record<string, unknown> } | null = null;
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        captured = { fn, args };
        return { data: { id: 'v', status: 'published', published_at: 't', replaced_version_id: null }, error: null };
      },
    };
    await svc.publishTemplateVersion(client, {
      id: 'v1',
      expectedUpdatedAt: '2026-07-28T00:00:00Z',
      confirmReplacement: true,
      replacementReason: 'because',
      correlationId: 'c',
    });
    expect(captured!.fn).toBe('omni_comms_template_version_publish');
    expect(captured!.args).toEqual({
      p_id: 'v1',
      p_expected_updated_at: '2026-07-28T00:00:00Z',
      p_confirm_replacement: true,
      p_replacement_reason: 'because',
      p_correlation_id: 'c',
    });
  });

  it('publish detail slugs include the four hotfix codes', () => {
    for (const s of [
      'expected_updated_at_required',
      'replacement_confirmation_required',
      'replacement_reason_required',
      'replacement_not_applicable',
    ]) {
      expect(TEMPLATE_CATALOGUE_VALIDATION_DETAILS).toContain(s);
    }
  });

  // ── Templates page invariants ──────────────────────────────────────────
  it('Templates page consumes only the bound RPC client hook — no direct supabase client', () => {
    const src = read(PAGE);
    expect(src).toMatch(/from\s+["']\.\.\/hooks\/useOmniCommsRpcClient["']/);
    expect(src).not.toMatch(/@\/integrations\/supabase\/client/);
    // No direct table access
    expect(src).not.toMatch(/supabase\s*\.\s*from\s*\(/);
  });

  it('Templates page uses useModulePermissions with denied-by-default gating', () => {
    const src = read(PAGE);
    expect(src).toContain('useModulePermissions("omni_comms")');
    // Must not use useIsAdmin for authorisation
    expect(src).not.toMatch(/\buseIsAdmin\s*\(/);
    // Denied while loading
    expect(src).toContain('!perms.isLoading');
  });

  it('Templates page pulls departments from organizationService, never core_department directly', () => {
    const src = read(PAGE);
    expect(src).toContain('listActiveDepartmentsForOrganization');
    expect(src).not.toMatch(/from\s*\(\s*['"]core_department['"]\s*\)/);
  });

  it('Publish dialog wires expectedUpdatedAt + confirmReplacement + replacementReason', () => {
    const src = read(PAGE);
    expect(src).toContain('expectedUpdatedAt: v.updated_at');
    expect(src).toContain('confirmReplacement');
    expect(src).toContain('replacementReason: confirmReplacement ? reason.trim()');
    // Never issues a browser retirement call during replacement
    expect(src).not.toMatch(/retireTemplateVersion\([^)]*before publishing/);
  });

  it('Preview payload is not persisted to react-query cache, storage, URL, or telemetry', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/localStorage\s*\./);
    expect(src).not.toMatch(/sessionStorage\s*\./);
    expect(src).not.toMatch(/useQuery\([^)]*payload/);
    expect(src).not.toMatch(/searchParams\.set\([^)]*payload/);
    // Never sends payload to a toast, log, or telemetry sink
    expect(src).not.toMatch(/toast\.[a-z]+\([^)]*payload/i);
  });

  it('Parent page does not use dangerouslySetInnerHTML anywhere', () => {
    const src = read(PAGE);
    expect(src).not.toMatch(/dangerouslySetInnerHTML/);
  });

  // ── Sandboxed preview iframe ───────────────────────────────────────────
  it('Sandboxed preview enforces sandbox="", referrerPolicy="no-referrer", srcDoc, and restrictive CSP', () => {
    const src = read(IFRAME);
    expect(src).toContain('sandbox=""');
    expect(src).toContain('referrerPolicy="no-referrer"');
    expect(src).toContain('srcDoc');
    expect(src).not.toMatch(/\bsrc=\{/);
    // CSP essentials
    for (const rule of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
      "object-src 'none'",
      'img-src data:',
    ]) {
      expect(src).toContain(rule);
    }
  });

  // ── organizationService method ─────────────────────────────────────────
  it('organizationService exports listActiveDepartmentsForOrganization with sane filters', () => {
    const src = read(ORG);
    expect(src).toMatch(/export\s+async\s+function\s+listActiveDepartmentsForOrganization/);
    expect(src).toContain("from('core_department')");
    expect(src).toContain("'is_active.eq.true'");
  });

  // ── Nav & rollback source-controlled artifacts ─────────────────────────
  it('nav & permission verification SQL is present and free of write statements', () => {
    const sql = read(VERIFY_SQL);
    expect(sql).toContain('STORY 3 NAV & PERMISSIONS OK');
    for (const w of ['INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'DROP ', 'CREATE TABLE', 'GRANT ', 'REVOKE ']) {
      expect(sql.toUpperCase()).not.toContain(w);
    }
  });

  it('Story 2 publish hotfix rollback SQL contains the exact original body (no placeholder)', () => {
    const sql = read(ROLLBACK_SQL);
    expect(sql).not.toMatch(/original body from migration/);
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.omni_comms_template_version_publish(');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.omni_comms_template_version_publish(');
    expect(sql).toContain("public.omni_comms_priv_require_capability('approve_templates')");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.omni_comms_template_version_publish(uuid, text, text) TO authenticated");
  });
});
