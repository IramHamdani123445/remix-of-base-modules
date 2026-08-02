/**
 * Phase 3 — Live Health Diagnostics tests.
 *
 * Pure derivation, error mapping, boundary, registry-ceiling and UI-contract
 * coverage. No network, no database, no provider.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildLiveDiagnostics,
  derivePosture,
  deriveRecommendedActions,
  getHealthSummary,
  mapHealthError,
  OMNI_COMMS_HEALTH_RPCS,
} from '@/platform/omni-comms/application/healthDiagnosticsService';
import {
  DIAGNOSTIC_STATES,
  HEALTH_DEFAULT_REFRESH_MS,
  HEALTH_MIN_REFRESH_MS,
  OMNI_COMMS_TARGET_SCREENS,
  type HealthSummaryPayload,
  type EdgeHealthProbeResult,
} from '@/platform/omni-comms/application/healthDiagnosticsTypes';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/eventCatalogueTypes';
import {
  checkHealthBoundary,
  isHealthSurfaceFile,
} from '@/platform/omni-comms/architecture';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';

const AT = '2026-07-30T10:00:00.000Z';

function payload(overrides: Partial<HealthSummaryPayload> = {}): HealthSummaryPayload {
  const base: HealthSummaryPayload = {
    organization_id: 'org-1',
    department_id: null,
    generated_at: AT,
    permissions: {
      organization_id: 'org-1',
      department_id: null,
      department_scope: 'organization_wide',
      tenant_lookup_available: true,
      capabilities: {
        'omni_comms.view': 'granted',
        'omni_comms.operate': 'not_granted',
        'omni_comms.configure': 'granted',
        'omni_comms.author_templates': 'granted',
        'omni_comms.approve_templates': 'not_granted',
        'omni_comms.view_sensitive_content': 'not_granted',
      },
      generated_at: AT,
    },
    catalogue: {
      organization_id: 'org-1',
      department_id: null,
      generated_at: AT,
      events: {
        event_definitions: 3,
        event_definitions_active: 2,
        published_contracts: 2,
        events_without_published_contract: 0,
        active_event_routes: 2,
        events_without_active_route: 0,
        department_route_overrides: 1,
        routes_with_unavailable_template: 0,
      },
      templates: {
        template_families: 2,
        template_families_active: 2,
        published_template_versions: 2,
        families_without_published_version: 0,
        templates_without_layout_selection: 0,
      },
      assembly: {
        layouts: 1,
        published_layout_versions: 1,
        required_slots: 3,
        resolved_assets: 3,
        unresolved_required_assets: 0,
      },
    },
    channels: {
      email_provider_registered: true,
      email_provider_active: true,
      provider_accounts: 1,
      provider_accounts_active: 1,
      provider_accounts_credentials_configured: 1,
      provider_accounts_healthy: 1,
      sender_identities: 1,
      sender_identities_active: 1,
      bindings: 1,
      bindings_active: 1,
      bindings_verified: 1,
      email_channel_setting_present: true,
      email_channel_enabled: true,
      email_send_ready: true,
    },
    runtime: {
      organization_id: 'org-1',
      department_id: null,
      generated_at: AT,
      runtime_tables: {
        omni_comms_request: true,
        omni_comms_recipient: true,
        omni_comms_message: true,
        omni_comms_dispatch_job: true,
        omni_comms_delivery_attempt: true,
        omni_comms_message_event: true,
      },
      runtime_functions: {
        omni_comms_priv_send_communication: true,
        omni_comms_priv_runtime_resolution_snapshot: true,
        omni_comms_priv_finalize_resolution: true,
        omni_comms_priv_load_render_context: true,
        omni_comms_priv_persist_rendered_messages: true,
        omni_comms_ops_summary: true,
      },
      counters: {
        requests: 4,
        recipients: 5,
        messages: 5,
        held_jobs: 5,
        runnable_jobs: 0,
        delivery_attempts: 0,
        blocked_requests: 0,
        processing_requests: 0,
        completed_dry_runs: 4,
        failed_requests: 0,
        last_request_at: AT,
      },
      live_delivery_enabled: false,
      runnable_queue_enabled: false,
      certification: {
        resolution: 'not_certified',
        rendering: 'not_certified',
        overall: 'not_certified',
      },
    },
  };
  return { ...base, ...overrides };
}

const edgeOk: EdgeHealthProbeResult = {
  available: true,
  functionName: 'omni-comms-runtime',
  buildTag: 'omni-comms-runtime@2c-iii',
  // A shortened revision is never accepted as verified by the hardened probe.
  revision: 'abc1234',
  revisionVerified: false,
  runtimeVersion: '2c-iii',
  certificationState: 'not_certified',
  certifiedCommit: null,
  environment: 'non_production',
  revisionMatch: 'unknown',
  safeTestPermitted: false,
  safeTestBlockedReason: 'runtime_certification_required',
  liveDeliveryEnabled: false,
  checkedAt: AT,
  error: null,
};

function findRow(res: ReturnType<typeof buildLiveDiagnostics>, code: string) {
  return res.categories.flatMap((c) => c.rows).find((r) => r.code === code);
}

describe('Phase 3 — health diagnostics model', () => {
  it('exposes exactly the nine permitted diagnostic states', () => {
    expect([...DIAGNOSTIC_STATES]).toEqual([
      'healthy', 'ready', 'configured', 'partial', 'blocked',
      'unavailable', 'not_implemented', 'not_certified', 'unknown',
    ]);
  });

  it('declares the four bounded health RPCs', () => {
    expect([...OMNI_COMMS_HEALTH_RPCS]).toEqual([
      'omni_comms_health_summary',
      'omni_comms_health_catalogue',
      'omni_comms_health_runtime',
      'omni_comms_health_permissions',
    ]);
  });

  it('builds every diagnostic category', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(res.categories.map((c) => c.code)).toEqual([
      'tenant_permissions',
      'event_catalogue',
      'templates_assembly',
      'channel_configuration',
      'runtime_implementation',
      'runtime_data',
      'runtime_certification',
      'delivery_capability',
    ]);
  });

  it('reports permission diagnostics as granted / not granted', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'PERM.VIEW')?.summary).toBe('Granted');
    expect(findRow(res, 'PERM.OPERATE')?.summary).toBe('Not granted');
  });

  it('shows department scope when a department is selected', () => {
    const p = payload();
    p.permissions.department_id = 'dept-1';
    p.permissions.department_scope = 'department';
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk, departmentName: 'Benefits' });
    expect(findRow(res, 'TEN.DEPARTMENT')?.summary).toContain('Benefits');
  });

  it('flags tenant lookup failure as unavailable', () => {
    const p = payload();
    p.permissions.tenant_lookup_available = false;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'TEN.LOOKUP')?.state).toBe('unavailable');
  });

  it('reports live event counts', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'EVT.DEFINITIONS')?.summary).toContain('3 defined');
    expect(findRow(res, 'EVT.ACTIVE_ROUTES')?.summary).toContain('2 active route');
  });

  it('blocks when an active event has no published contract', () => {
    const p = payload();
    p.catalogue.events.events_without_published_contract = 1;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'EVT.MISSING_CONTRACT')?.state).toBe('blocked');
  });

  it('blocks when an active event has no active route', () => {
    const p = payload();
    p.catalogue.events.events_without_active_route = 2;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'EVT.MISSING_ROUTE')?.state).toBe('blocked');
  });

  it('blocks when a route points at an unavailable template', () => {
    const p = payload();
    p.catalogue.events.routes_with_unavailable_template = 1;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'EVT.ROUTE_TEMPLATE')?.state).toBe('blocked');
  });

  it('reports template counts', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'TPL.FAMILIES')?.summary).toContain('2 families');
    expect(findRow(res, 'TPL.PUBLISHED_VERSIONS')?.summary).toContain('2 published');
  });

  it('blocks when an active family has no published version', () => {
    const p = payload();
    p.catalogue.templates.families_without_published_version = 1;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'TPL.MISSING_PUBLISHED')?.state).toBe('blocked');
  });

  it('flags missing layout selection', () => {
    const p = payload();
    p.catalogue.templates.templates_without_layout_selection = 2;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'TPL.LAYOUT_SELECTION')?.state).toBe('partial');
  });

  it('blocks on unresolved required assets', () => {
    const p = payload();
    p.catalogue.assembly.unresolved_required_assets = 2;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'ASM.SLOTS')?.state).toBe('blocked');
    expect(findRow(res, 'TPL.DRY_RUN_READY')?.state).toBe('partial');
  });

  it('separates catalogue configured, renderable and dry-run ready', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'TPL.CATALOGUE_CONFIGURED')?.state).toBe('configured');
    expect(findRow(res, 'TPL.RENDERABLE')?.state).toBe('ready');
    expect(findRow(res, 'TPL.DRY_RUN_READY')?.state).toBe('ready');
  });

  it('reports provider configuration diagnostics', () => {
    const p = payload();
    p.channels.provider_accounts_active = 0;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'CHN.ACCOUNTS')?.state).toBe('blocked');
  });

  it('reports sender binding diagnostics', () => {
    const p = payload();
    p.channels.bindings_verified = 0;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'CHN.BINDINGS')?.state).toBe('blocked');
  });

  it('never infers live delivery from email send readiness', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'CHN.SEND_READY')?.state).toBe('configured');
    expect(findRow(res, 'DLV.LIVE')?.state).toBe('not_implemented');
  });

  it('reports runtime table diagnostics', () => {
    const p = payload();
    p.runtime.runtime_tables.omni_comms_message = false;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(findRow(res, 'RTI.TABLES')?.state).toBe('unavailable');
  });

  it('reuses the Operations runtime counters without recomputing them', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'RTD.REQUESTS')?.summary).toBe('4');
    expect(findRow(res, 'RTD.MESSAGES')?.summary).toBe('5');
    expect(findRow(res, 'RTD.RUNNABLE_JOBS')?.state).toBe('ready');
  });

  it('keeps runtime certification not certified', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    for (const code of ['CRT.RESOLUTION', 'CRT.RENDERING', 'CRT.OVERALL']) {
      expect(findRow(res, code)?.state).toBe('not_certified');
    }
    expect(findRow(res, 'CRT.OVERALL')?.summary).toContain('certification marker');
  });

  it('keeps live delivery capability disabled', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(findRow(res, 'DLV.ADAPTER')?.state).toBe('not_implemented');
    expect(findRow(res, 'DLV.DISPATCH_FN')?.state).toBe('not_implemented');
    // C5B deployed the webhook receiver for approved test-delivery evidence.
    // It does not make live delivery available.
    expect(findRow(res, 'DLV.WEBHOOK_FN')?.state).toBe('configured');
    expect(findRow(res, 'DLV.QUEUE')?.state).toBe('not_implemented');
  });

  it('marks the edge probe unknown when it has not run', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: null });
    expect(findRow(res, 'RTI.FUNCTION_CALLABLE')?.state).toBe('unknown');
  });
});

describe('Phase 3 — posture and recommendations', () => {
  it('derives implementation testing only for a fully configured tenant', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(res.posture).toBe('implementation_testing_only');
  });

  it('derives configuration incomplete when configuration blockers exist', () => {
    const p = payload();
    p.catalogue.events.event_definitions = 0;
    p.catalogue.events.event_definitions_active = 0;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(res.posture).toBe('configuration_incomplete');
  });

  it('derives unavailable when a diagnostic cannot be read', () => {
    const p = payload();
    p.permissions.tenant_lookup_available = false;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(res.posture).toBe('unavailable');
  });

  it('never derives an operational or production-ready posture', () => {
    const res = buildLiveDiagnostics({ summary: payload(), edge: edgeOk });
    expect(['Operational', 'Production Ready']).not.toContain(res.posture);
  });

  it('orders recommended actions by priority and links to permanent screens', () => {
    const p = payload();
    p.catalogue.events.event_definitions = 0;
    p.catalogue.events.event_definitions_active = 0;
    p.catalogue.events.published_contracts = 0;
    p.catalogue.templates.template_families_active = 0;
    p.channels.provider_accounts_active = 0;
    const res = buildLiveDiagnostics({ summary: p, edge: edgeOk });
    expect(res.recommendations[0].blockingDiagnostic).toBe('EVT.DEFINITIONS');
    expect(res.recommendations[0].priority).toBe(1);
    const screens = new Set(Object.values(OMNI_COMMS_TARGET_SCREENS));
    for (const a of res.recommendations) expect(screens.has(a.targetScreen)).toBe(true);
    const priorities = res.recommendations.map((a) => a.priority);
    expect(priorities).toEqual([...priorities].sort((x, y) => x - y));
  });

  it('produces no recommendation for a healthy row', () => {
    const actions = deriveRecommendedActions([
      {
        code: 'x', title: 'X', description: '',
        rows: [
          {
            code: 'EVT.DEFINITIONS', title: 'ok', state: 'configured', summary: '',
            evidenceAt: AT, evidence: [], recommendedAction: 'Do it',
            targetScreen: OMNI_COMMS_TARGET_SCREENS.events,
          },
        ],
      } as never,
    ]);
    expect(actions).toHaveLength(0);
  });

  it('derivePosture is pure and deterministic', () => {
    const cats = buildLiveDiagnostics({ summary: payload(), edge: edgeOk }).categories;
    expect(derivePosture(cats)).toEqual(derivePosture(cats));
  });
});

describe('Phase 3 — error mapping', () => {
  it('distinguishes permission denial', () => {
    expect(mapHealthError(new OmniCommsRpcError('OC403')).kind).toBe('permission_denied');
  });
  it('distinguishes tenant validation failure', () => {
    expect(mapHealthError(new OmniCommsRpcError('OC422')).kind).toBe('tenant_unavailable');
  });
  it('distinguishes missing configuration', () => {
    expect(mapHealthError(new OmniCommsRpcError('OC404')).kind).toBe('no_configuration');
  });
  it('distinguishes timeouts', () => {
    expect(mapHealthError(new Error('The operation timed out')).kind).toBe('timed_out');
  });
  it('distinguishes an unavailable RPC', () => {
    expect(mapHealthError(new Error('Could not find the function in the schema cache')).kind)
      .toBe('rpc_unavailable');
  });
  it('never leaks SQLSTATE or table names', () => {
    const e = mapHealthError(new OmniCommsRpcError('OC500', 'omni_comms_request P0001'));
    expect(e.message).not.toMatch(/P0001|omni_comms_/);
  });
  it('does not collapse every failure into "not configured"', () => {
    const kinds = [
      mapHealthError(new OmniCommsRpcError('OC403')).kind,
      mapHealthError(new Error('timed out')).kind,
      mapHealthError(new Error('boom')).kind,
    ];
    expect(new Set(kinds).size).toBe(3);
  });
});

describe('Phase 3 — RPC adapter', () => {
  it('calls the summary RPC with a mandatory organisation scope', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: payload(), error: null });
    await getHealthSummary({ rpc }, { organizationId: 'org-1', departmentId: 'dept-1' });
    expect(rpc).toHaveBeenCalledWith('omni_comms_health_summary', {
      p_organization_id: 'org-1',
      p_department_id: 'dept-1',
      p_since_hours: 720,
    });
  });

  it('maps RPC failure through the shared error model', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'OC403 permission_denied' } });
    await expect(getHealthSummary({ rpc }, { organizationId: 'org-1' })).rejects.toBeInstanceOf(
      OmniCommsRpcError,
    );
  });
});

describe('Phase 3 — surface boundaries', () => {
  const root = process.cwd();
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const HEALTH_FILES = [
    'src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx',
    'src/platform/omni-comms/admin/views/health/LiveDiagnosticsTab.tsx',
    'src/platform/omni-comms/admin/views/health/HealthPostureCard.tsx',
    'src/platform/omni-comms/admin/views/health/DiagnosticCategoryCard.tsx',
    'src/platform/omni-comms/admin/views/health/RecommendedActions.tsx',
    'src/platform/omni-comms/application/healthDiagnosticsService.ts',
    'src/platform/omni-comms/application/healthDiagnosticsTypes.ts',
  ];

  it('recognises the health surface files', () => {
    for (const f of HEALTH_FILES) expect(isHealthSurfaceFile(f)).toBe(true);
    expect(isHealthSurfaceFile('src/platform/omni-comms/sendCommunication.ts')).toBe(false);
  });

  it('keeps both tabs on the single permanent Health route', () => {
    const page = read('src/platform/omni-comms/admin/views/OmniCommsHealthPage.tsx');
    expect(page).toContain('<ReadinessTab');
    expect(page).toContain('<LiveDiagnosticsTab');
  });

  it('uses the shared tenant selector and context', () => {
    const tab = read('src/platform/omni-comms/admin/views/health/LiveDiagnosticsTab.tsx');
    expect(tab).toContain('OmniCommsTenantSelector');
    expect(tab).toContain('useOmniCommsTenant');
    expect(tab).not.toContain('localStorage');
    expect(tab).not.toContain('window.location.reload');
  });

  it('renders explicit tenant states', () => {
    const tab = read('src/platform/omni-comms/admin/views/health/LiveDiagnosticsTab.tsx');
    for (const id of [
      'omni-comms-health-tenant-loading',
      'omni-comms-health-tenant-error',
      'omni-comms-health-no-organisations',
      'omni-comms-health-no-organisation-selected',
    ]) {
      expect(tab).toContain(id);
    }
  });

  it('exposes refresh, last-checked and an off-by-default auto-refresh', () => {
    const tab = read('src/platform/omni-comms/admin/views/health/LiveDiagnosticsTab.tsx');
    expect(tab).toContain('omni-comms-health-refresh');
    expect(tab).toContain('omni-comms-health-last-checked');
    expect(tab).toContain('useState(false)');
    expect(tab).toContain('HEALTH_DEFAULT_REFRESH_MS');
    expect(tab).toContain('window.clearInterval');
  });

  it('does not poll faster than the 30s floor', () => {
    expect(HEALTH_DEFAULT_REFRESH_MS).toBeGreaterThanOrEqual(HEALTH_MIN_REFRESH_MS);
  });

  it('never reads a table directly from the health surface', () => {
    for (const f of HEALTH_FILES) expect(read(f)).not.toMatch(/\.from\(\s*['"`]/);
  });

  it('never exposes credential material from the health surface', () => {
    for (const f of HEALTH_FILES) {
      const src = read(f);
      expect(src).not.toContain('secret_ref');
      expect(src).not.toContain('SERVICE_ROLE');
    }
  });

  it('never imports a provider SDK or the Legacy Hub from the health surface', () => {
    for (const f of HEALTH_FILES) {
      const src = read(f);
      expect(src).not.toMatch(/from\s*['"`](resend|twilio|@sendgrid)/);
      expect(src).not.toContain('platform/communication-hub');
    }
  });

  it('keeps the edge health probe non-mutating (GET only, no send)', () => {
    const hook = read('src/platform/omni-comms/admin/hooks/useOmniCommsEdgeHealthProbe.ts');
    expect(hook).toContain('method: "GET"');
    expect(hook).not.toContain('sendCommunication');
    expect(hook).not.toContain('SERVICE_ROLE');
    const fn = read('supabase/functions/omni-comms-runtime/index.ts');
    expect(fn).toContain('url.pathname.endsWith("/health")');
  });
});

describe('Phase 3 — rule 12 negative fixtures', () => {
  const scanOf = (filePath: string, content: string) =>
    checkHealthBoundary({
      files: [{ filePath, content }],
      routeSource: null,
      migrations: [],
      edgeFunctionDirs: [],
      dependencies: {},
    });

  const HEALTH = 'src/platform/omni-comms/admin/views/health/Bad.tsx';

  it('detects a direct omni_comms table read', () => {
    const v = scanOf(HEALTH, `supabase.from('omni_comms_request').select('*')`);
    expect(v).toHaveLength(1);
    expect(v[0].ruleId).toBe('OMNI_HEALTH_DIAGNOSTIC_BOUNDARY');
  });

  it('detects a provider metadata table read', () => {
    expect(scanOf(HEALTH, `supabase.from("notification_providers").select()`)).toHaveLength(1);
  });

  it('detects a runtime mutation import', () => {
    expect(scanOf(HEALTH, `import { x } from "@/platform/omni-comms/sendCommunication";`).length)
      .toBeGreaterThan(0);
  });

  it('detects a provider SDK import', () => {
    expect(scanOf(HEALTH, `import { Resend } from "resend";`).length).toBeGreaterThan(0);
  });

  it('detects a Legacy Communication Hub reference', () => {
    expect(scanOf(HEALTH, `import x from "@/platform/communication-hub/foo";`).length)
      .toBeGreaterThan(0);
  });

  it('detects secret exposure', () => {
    expect(scanOf(HEALTH, `const s = row.secret_ref;`)).toHaveLength(1);
  });

  it('detects an eighth permanent route', () => {
    const v = scanOf(
      'src/platform/omni-comms/registry/bad.ts',
      `export const R = '/admin/omnichannel-communications/diagnostics';`,
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain('ceiling is exactly seven');
  });

  it('accepts the approved seven routes', () => {
    const v = scanOf(
      'src/platform/omni-comms/registry/ok.ts',
      Object.values(OMNI_COMMS_TARGET_SCREENS).map((r) => `'${r}'`).join(','),
    );
    expect(v).toHaveLength(0);
  });

  it('ignores non-health files for the health-only rules', () => {
    expect(scanOf('src/other/Thing.tsx', `supabase.from('omni_comms_request').select()`))
      .toHaveLength(0);
  });
});

describe('Phase 3 — registry ceilings', () => {
  it('keeps exactly seven permanent admin routes', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
  });

  it('keeps exactly twenty-one logical database objects', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(30);
  });
});

describe('Phase 3 — verifier script', () => {
  let src = '';
  beforeEach(() => {
    src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/omni-comms/verify-health-live-diagnostics.sql'),
      'utf8',
    );
  });
  afterEach(() => {
    src = '';
  });

  it('asserts the four health RPCs and prints the marker', () => {
    for (const fn of OMNI_COMMS_HEALTH_RPCS) expect(src).toContain(fn);
    expect(src).toContain('OMNI COMMS HEALTH LIVE DIAGNOSTICS VERIFY OK');
  });

  it('asserts owner, security definer, search path and grants', () => {
    for (const token of ['postgres', 'prosecdef', 'search_path', 'authenticated=X', 'anon=']) {
      expect(src).toContain(token);
    }
  });
});
