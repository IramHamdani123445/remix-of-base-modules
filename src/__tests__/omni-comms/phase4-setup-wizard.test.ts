/**
 * Omni-Comms — Phase 4 Guided Configuration Setup Wizard.
 *
 * Read-only verification of:
 *   - the 14-step canonical plan and derivation purity;
 *   - evidence, blocker/warning routing and next-required-step selection;
 *   - dry-run vs live-send posture separation;
 *   - operator-safe error mapping;
 *   - deep links restricted to the seven permanent routes;
 *   - architecture Rule 13 OMNI_SETUP_WIZARD_BOUNDARY detection.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  OMNI_COMMS_SETUP_STEP_IDS,
  buildSetupPlan,
  getSetupReadiness,
  mapSetupError,
  stepTargetHref,
  type SetupBlocker,
  type SetupReadinessPayload,
} from '@/platform/omni-comms/application/setupReadinessService';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/eventCatalogueTypes';
import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import { OMNI_COMMS_READINESS_MANIFEST } from '@/platform/omni-comms/registry/readinessManifest';
import {
  checkSetupWizardBoundary,
  isSetupWizardFile,
} from '@/platform/omni-comms/architecture';

const REPO_ROOT = process.cwd();

// ─── Fixtures ────────────────────────────────────────────────────────────

function completePayload(
  overrides: Partial<SetupReadinessPayload> = {},
): SetupReadinessPayload {
  return {
    organization_id: 'org-1',
    department_id: null,
    channel: 'email',
    locale: 'en',
    generated_at: '2026-07-30T10:00:00Z',
    tenant: {
      organization_id: 'org-1',
      department_id: null,
      scope: 'organization_wide',
      capabilities: { 'omni_comms.view': 'granted' },
      sensitive_content_visible: false,
    },
    event: {
      present: true,
      id: 'evt-1',
      code: 'BN.CLAIM.APPROVED',
      name: 'Claim approved',
      module_code: 'BN',
      entity_type: 'claim',
      communication_class: 'transactional',
      default_priority: 'normal',
      status: 'active',
    },
    contract: {
      present: true,
      id: 'ctr-1',
      version_number: 2,
      status: 'published',
      checksum: 'a'.repeat(64),
      published_at: '2026-07-01T00:00:00Z',
      sample_payload_present: true,
      required_fields: ['claim_number'],
    },
    route: {
      present: true,
      source: 'organization',
      id: 'rt-1',
      lifecycle_state: 'active',
      is_enabled: true,
      is_required: false,
      priority: 100,
      preference_policy: 'honour',
      sender_resolution_policy: 'organisation_default',
      template_family_id: 'tf-1',
      sender_identity_id: 'si-1',
    },
    template_family: {
      present: true,
      id: 'tf-1',
      code: 'BN_CLAIM_APPROVED',
      name: 'Claim approved',
      scope_type: 'organization',
      status: 'active',
    },
    template_version: {
      present: true,
      id: 'tv-1',
      version_number: 3,
      status: 'published',
      channel: 'email',
      locale: 'en',
      checksum: 'b'.repeat(64),
      published_at: '2026-07-02T00:00:00Z',
      layout_selection_mode: 'inherit',
    },
    layout: {
      present: true,
      layout_id: 'ly-1',
      layout_code: 'STANDARD',
      layout_version_id: 'lv-1',
      layout_version_number: 1,
      layout_checksum: 'c'.repeat(64),
      inheritance_source: 'organization',
      slot_count: 3,
    },
    assets: {
      slots: [
        {
          slot_code: 'letterhead',
          asset_id: 'as-1',
          asset_version_id: 'av-1',
          asset_type: 'letterhead',
          checksum: 'd'.repeat(64),
          inheritance_source: 'organization',
          state: 'resolved',
        },
      ],
      unresolved_required: 0,
    },
    provider: {
      present: true,
      id: 'pv-1',
      code: 'resend',
      display_name: 'Resend',
      adapter_key: 'resend',
      status: 'active',
    },
    provider_account: {
      present: true,
      id: 'pa-1',
      code: 'PRIMARY',
      display_name: 'Primary',
      status: 'active',
      region: null,
      sandbox_mode: true,
      health_state: 'healthy',
      health_checked_at: '2026-07-29T00:00:00Z',
      credential_check_recorded: true,
    },
    sender: {
      present: true,
      id: 'si-1',
      code: 'NOREPLY',
      display_name: 'No reply',
      status: 'active',
      from_address_display: 'n•••@example.com',
      from_address_masked: true,
      scope: 'organization',
    },
    binding: {
      present: true,
      id: 'bd-1',
      status: 'active',
      verification_status: 'verified',
      verified_at: '2026-07-10T00:00:00Z',
      priority: 1,
      provider_account_id: 'pa-1',
    },
    channel_setting: {
      present: true,
      id: 'cs-1',
      scope: 'organization',
      enabled: true,
      live_delivery_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      quiet_hours_timezone: null,
      per_minute_limit: 60,
    },
    runtime: {
      tables: { omni_comms_request: true, omni_comms_message: true },
      functions: { omni_comms_priv_send_communication: true },
      implementation_complete: true,
      live_dispatch_implemented: false,
      certification: {
        resolution: 'not_certified',
        rendering: 'not_certified',
        overall: 'not_certified',
      },
    },
    blockers: [],
    dry_run_ready: true,
    live_send_ready: false,
    ...overrides,
  };
}

function blocker(
  step: SetupBlocker['step'],
  severity: SetupBlocker['severity'] = 'blocker',
): SetupBlocker {
  return { code: `${step}_missing`, step, severity, message: `${step} is not ready` };
}

function scan(files: { filePath: string; content: string }[]) {
  return {
    files,
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
    dependencies: {},
  };
}

function readFiles(dir: string): { filePath: string; content: string }[] {
  const abs = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({
      filePath: `${dir}/${f}`,
      content: fs.readFileSync(path.join(abs, f), 'utf8'),
    }));
}

// ─── 1. Canonical step list ──────────────────────────────────────────────

describe('Phase 4 — setup step catalogue', () => {
  it('1. defines exactly fourteen guided steps', () => {
    expect(OMNI_COMMS_SETUP_STEP_IDS).toHaveLength(14);
  });

  it('2. step ids are unique', () => {
    expect(new Set(OMNI_COMMS_SETUP_STEP_IDS).size).toBe(14);
  });

  it('3. builds a plan with one entry per canonical step, in order', () => {
    const plan = buildSetupPlan(completePayload());
    expect(plan.steps.map((s) => s.id)).toEqual([...OMNI_COMMS_SETUP_STEP_IDS]);
  });

  it('4. assigns 1-based sequential indexes', () => {
    const plan = buildSetupPlan(completePayload());
    expect(plan.steps.map((s) => s.index)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
  });

  it('5. gives every step a title and a purpose', () => {
    for (const s of buildSetupPlan(completePayload()).steps) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.purpose.length).toBeGreaterThan(0);
    }
  });
});

// ─── 2. Derivation ───────────────────────────────────────────────────────

describe('Phase 4 — plan derivation', () => {
  it('6. marks every step complete for a fully configured path', () => {
    const plan = buildSetupPlan(completePayload());
    expect(plan.steps.every((s) => s.state === 'complete')).toBe(true);
    expect(plan.completedSteps).toBe(14);
    expect(plan.nextRequiredStep).toBeNull();
  });

  it('7. marks an absent section not_started', () => {
    const p = completePayload({ event: { present: false } });
    const step = buildSetupPlan(p).steps.find((s) => s.id === 'event')!;
    expect(step.state).toBe('not_started');
  });

  it('8. marks a present-but-blocked section incomplete', () => {
    const p = completePayload({ blockers: [blocker('route')] });
    const step = buildSetupPlan(p).steps.find((s) => s.id === 'route')!;
    expect(step.state).toBe('incomplete');
  });

  it('9. marks a warning-only section as attention', () => {
    const p = completePayload({ blockers: [blocker('provider_account', 'warning')] });
    const step = buildSetupPlan(p).steps.find((s) => s.id === 'provider_account')!;
    expect(step.state).toBe('attention');
  });

  it('10. routes blockers to the owning step only', () => {
    const p = completePayload({ blockers: [blocker('binding')] });
    const plan = buildSetupPlan(p);
    expect(plan.steps.find((s) => s.id === 'binding')!.blockers).toHaveLength(1);
    expect(
      plan.steps.filter((s) => s.id !== 'binding').every((s) => s.blockers.length === 0),
    ).toBe(true);
  });

  it('11. selects the earliest incomplete step as next required', () => {
    const p = completePayload({
      template_version: { present: false },
      sender: { present: false },
    });
    expect(buildSetupPlan(p).nextRequiredStep?.id).toBe('template_version');
  });

  it('12. counts attention steps as completed progress', () => {
    const p = completePayload({ blockers: [blocker('channel_setting', 'warning')] });
    expect(buildSetupPlan(p).completedSteps).toBe(14);
  });

  it('13. treats unresolved required asset slots as not complete', () => {
    const p = completePayload({
      assets: { slots: [], unresolved_required: 2 },
      blockers: [blocker('assets')],
    });
    expect(buildSetupPlan(p).steps.find((s) => s.id === 'assets')!.state).toBe(
      'not_started',
    );
  });

  it('14. tolerates a missing blockers array', () => {
    const p = completePayload();
    delete (p as unknown as Record<string, unknown>).blockers;
    expect(() => buildSetupPlan(p)).not.toThrow();
  });

  it('15. is pure — repeated calls return equal plans and never mutate input', () => {
    const p = completePayload({ blockers: [blocker('layout')] });
    const snapshot = JSON.stringify(p);
    const a = buildSetupPlan(p);
    const b = buildSetupPlan(p);
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('16. surfaces generated_at from the server payload', () => {
    expect(buildSetupPlan(completePayload()).generatedAt).toBe('2026-07-30T10:00:00Z');
  });
});

// ─── 3. Evidence ─────────────────────────────────────────────────────────

describe('Phase 4 — step evidence', () => {
  it('17. every step reports at least one evidence line', () => {
    for (const s of buildSetupPlan(completePayload()).steps) {
      expect(s.evidence.length).toBeGreaterThan(0);
    }
  });

  it('18. reports the resolved route source (precedence is server-decided)', () => {
    const p = completePayload({
      route: { ...completePayload().route, source: 'department' },
    });
    const step = buildSetupPlan(p).steps.find((s) => s.id === 'route')!;
    expect(step.evidence.join(' ')).toContain('department');
  });

  it('19. reports asset inheritance source per slot', () => {
    const step = buildSetupPlan(completePayload()).steps.find((s) => s.id === 'assets')!;
    expect(step.evidence[0]).toContain('letterhead');
    expect(step.evidence[0]).toContain('resolved');
  });

  it('20. shows the masked sender address exactly as returned', () => {
    const step = buildSetupPlan(completePayload()).steps.find((s) => s.id === 'sender')!;
    expect(step.evidence.join(' ')).toContain('n•••@example.com');
    expect(step.evidence.join(' ')).toContain('masked');
  });

  it('21. never emits credential material in evidence', () => {
    const text = buildSetupPlan(completePayload())
      .steps.flatMap((s) => s.evidence)
      .join(' ');
    for (const token of ['secret_ref', 'service_role', 'api_key', 'Bearer ']) {
      expect(text).not.toContain(token);
    }
  });

  it('22. states plainly that live provider dispatch is not implemented', () => {
    const step = buildSetupPlan(completePayload()).steps.find((s) => s.id === 'runtime')!;
    expect(step.evidence.join(' ')).toContain('live provider dispatch: not implemented');
  });
});

// ─── 4. Posture ──────────────────────────────────────────────────────────

describe('Phase 4 — dry-run vs live-send posture', () => {
  it('23. reports dry-run readiness from the server', () => {
    expect(buildSetupPlan(completePayload()).dryRunReady).toBe(true);
  });

  it('24. never reports live-send readiness in this build', () => {
    const p = completePayload({ live_send_ready: true });
    expect(buildSetupPlan(p).liveSendReady).toBe(false);
  });

  it('25. is not dry-run ready when the server says so', () => {
    const p = completePayload({ dry_run_ready: false, blockers: [blocker('template_version')] });
    expect(buildSetupPlan(p).dryRunReady).toBe(false);
  });

  it('26. separates blockers from warnings at plan level', () => {
    const p = completePayload({
      blockers: [blocker('route'), blocker('provider_account', 'warning')],
    });
    const plan = buildSetupPlan(p);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.warnings).toHaveLength(1);
  });
});

// ─── 5. Adapter and errors ───────────────────────────────────────────────

describe('Phase 4 — RPC adapter', () => {
  it('27. calls only omni_comms_setup_readiness with the pilot arguments', async () => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: async (fn: string, args?: Record<string, unknown>) => {
        calls.push({ fn, args: args ?? {} });
        return { data: completePayload(), error: null };
      },
    };
    await getSetupReadiness(client, {
      organizationId: 'org-1',
      departmentId: 'dept-1',
      eventDefinitionId: 'evt-1',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe('omni_comms_setup_readiness');
    expect(calls[0].args).toEqual({
      p_organization_id: 'org-1',
      p_department_id: 'dept-1',
      p_event_definition_id: 'evt-1',
      p_channel: 'email',
      p_locale: 'en',
    });
  });

  it('28. defaults channel to email and locale to en', async () => {
    let args: Record<string, unknown> = {};
    const client = {
      rpc: async (_fn: string, a?: Record<string, unknown>) => {
        args = a ?? {};
        return { data: completePayload(), error: null };
      },
    };
    await getSetupReadiness(client, { organizationId: 'org-1' });
    expect(args.p_channel).toBe('email');
    expect(args.p_locale).toBe('en');
    expect(args.p_department_id).toBeNull();
  });

  it('29. maps OC403 to a non-retryable permission error', () => {
    const e = mapSetupError(new OmniCommsRpcError('OC403'));
    expect(e.kind).toBe('permission_denied');
    expect(e.retryable).toBe(false);
  });

  it('30. maps a missing function to a retryable rpc_unavailable error', () => {
    const e = mapSetupError(new Error('Could not find the function in the schema cache'));
    expect(e.kind).toBe('rpc_unavailable');
    expect(e.retryable).toBe(true);
  });

  it('31. maps a timeout to timed_out', () => {
    expect(mapSetupError(new Error('request timed out')).kind).toBe('timed_out');
  });

  it('32. never leaks raw technical detail for unknown failures', () => {
    const e = mapSetupError(new Error('pgsql: relation "x" does not exist at 0x7f'));
    expect(e.kind).toBe('unknown');
    expect(e.message).not.toContain('relation');
  });
});

// ─── 6. Route ceiling and deep links ─────────────────────────────────────

describe('Phase 4 — route ceiling', () => {
  it('33. keeps the permanent route count at seven', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
    expect(
      OMNI_COMMS_ROUTE_REGISTRY.some((r) => r.path.includes('setup')),
    ).toBe(false);
  });

  it('34. every step deep link targets a permanent route', () => {
    const permanent = new Set(OMNI_COMMS_ROUTE_REGISTRY.map((r) => r.path));
    for (const step of buildSetupPlan(completePayload()).steps) {
      if (!step.target) continue;
      expect(permanent.has(step.target.route)).toBe(true);
      const href = stepTargetHref(step)!;
      expect(href.startsWith(step.target.route)).toBe(true);
    }
  });

  it('35. the wizard is reachable from the Overview route as a tab', () => {
    const landing = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'src/platform/omni-comms/admin/views/OmniCommsLandingPage.tsx',
      ),
      'utf8',
    );
    expect(landing).toContain('SetupWizardPanel');
    expect(landing).toContain('"view"');
    expect(landing).toContain('"setup"');
  });
});

// ─── 7. Rule 13 boundary ─────────────────────────────────────────────────

describe('Phase 4 — Rule 13 OMNI_SETUP_WIZARD_BOUNDARY', () => {
  const wizardFiles = [
    ...readFiles('src/platform/omni-comms/admin/views/setup'),
    {
      filePath: 'src/platform/omni-comms/application/setupReadinessService.ts',
      content: fs.readFileSync(
        path.join(
          REPO_ROOT,
          'src/platform/omni-comms/application/setupReadinessService.ts',
        ),
        'utf8',
      ),
    },
  ];

  it('36. recognises the Setup Wizard surface', () => {
    expect(isSetupWizardFile('src/platform/omni-comms/admin/views/setup/SetupWizardPanel.tsx')).toBe(true);
    expect(isSetupWizardFile('src/platform/omni-comms/application/setupReadinessService.ts')).toBe(true);
    expect(isSetupWizardFile('src/platform/omni-comms/admin/views/OmniCommsEventsPage.tsx')).toBe(false);
  });

  it('37. reports zero violations for the real Setup Wizard surface', () => {
    expect(wizardFiles.length).toBeGreaterThan(0);
    expect(checkSetupWizardBoundary(scan(wizardFiles))).toEqual([]);
  });

  it('38. rejects a direct configuration-table read', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: "const x = client.from('omni_comms_event_route').select('*');",
        },
      ]),
    );
    expect(v.length).toBeGreaterThan(0);
    expect(v[0].ruleId).toBe('OMNI_SETUP_WIZARD_BOUNDARY');
  });

  it('39. rejects a non-approved RPC reference', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: "await client.rpc('omni_comms_priv_send_communication', {});",
        },
      ]),
    );
    expect(v.some((x) => x.evidence.includes('omni_comms_priv_send_communication'))).toBe(true);
  });

  it('40. rejects a configuration write from the wizard', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: 'await table.insert({ a: 1 });',
        },
      ]),
    );
    expect(v.some((x) => x.message.includes('data write'))).toBe(true);
  });

  it('41. rejects a provider SDK import', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: "import { Resend } from 'resend';",
        },
      ]),
    );
    expect(v.some((x) => x.message.includes('provider SDK'))).toBe(true);
  });

  it('42. rejects a Legacy Communication Hub reference', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: "import x from 'src/platform/communication-hub/foo';",
        },
      ]),
    );
    expect(v.some((x) => x.message.includes('Legacy'))).toBe(true);
  });

  it('43. rejects secret exposure', () => {
    const v = checkSetupWizardBoundary(
      scan([
        {
          filePath: 'src/platform/omni-comms/admin/views/setup/Bad.tsx',
          content: 'const s = account.secret_ref;',
        },
      ]),
    );
    expect(v.some((x) => x.message.includes('secret'))).toBe(true);
  });

  it('44. ignores files outside the Setup Wizard surface', () => {
    expect(
      checkSetupWizardBoundary(
        scan([
          {
            filePath: 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx',
            content: 'await client.rpc("omni_comms_channel_setting_upsert", {});',
          },
        ]),
      ),
    ).toEqual([]);
  });
});

// ─── 8. Manifest reconciliation ──────────────────────────────────────────

describe('Phase 4 — readiness manifest reconciliation', () => {
  it('45. records Rule 13 as enforced in CI', () => {
    const row = OMNI_COMMS_READINESS_MANIFEST.architectureBoundaries.find(
      (r) => r.ruleId === 'OMNI_SETUP_WIZARD_BOUNDARY',
    );
    expect(row?.status).toBe('Enforced in CI');
  });

  it('46. records the Setup Wizard in foundation status', () => {
    const row = OMNI_COMMS_READINESS_MANIFEST.foundationStatus.find((r) =>
      r.item.includes('Setup Wizard (Phase 4)'),
    );
    expect(row?.state).toBe('Verified');
    expect(row?.note).toContain('omni_comms_setup_readiness');
  });

  it('47. reports the Events route as available', () => {
    const events = OMNI_COMMS_ROUTE_REGISTRY.find((r) => r.path.endsWith('/events'));
    expect(events?.state).toBe('Available');
  });
});
