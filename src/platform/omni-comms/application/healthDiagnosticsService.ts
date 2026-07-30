/**
 * Omni-Comms — Phase 3 Live Health Diagnostics application service.
 *
 * Responsibilities:
 *   - typed adapters over the four bounded `omni_comms_health_*` read RPCs;
 *   - centralized, operator-safe error mapping;
 *   - PURE derivation of diagnostic rows, overall posture and the prioritized
 *     recommended-action list.
 *
 * Boundaries (enforced by OMNI_HEALTH_DIAGNOSTIC_BOUNDARY):
 *   - never imports the browser Supabase singleton;
 *   - never queries any table with `.from(...)`;
 *   - never invokes a runtime mutation or the send façade;
 *   - never imports a provider SDK;
 *   - never returns credentials, destinations or payload bodies.
 */
import type { OmniCommsRpcClient } from './eventCatalogueService';
import { callOmniCommsRpc } from './omniCommsRpcCall';
import { OmniCommsRpcError } from './eventCatalogueTypes';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '../registry/integrationRegistry';
import { OMNI_COMMS_OPERATIONAL_POSTURE } from '../registry/readinessManifest';
import {
  OMNI_COMMS_TARGET_SCREENS,
  type DiagnosticCategory,
  type DiagnosticRow,
  type DiagnosticState,
  type EdgeHealthProbeResult,
  type HealthCataloguePayload,
  type HealthChannelsPayload,
  type HealthError,
  type HealthPermissionsPayload,
  type HealthRuntimePayload,
  type HealthSummaryPayload,
  type LiveDiagnosticsResult,
  type OverallPosture,
  type RecommendedAction,
} from './healthDiagnosticsTypes';

export * from './healthDiagnosticsTypes';

const T = OMNI_COMMS_TARGET_SCREENS;

// ─── Adapters ────────────────────────────────────────────────────────────

export interface HealthQueryInput {
  organizationId: string;
  departmentId?: string | null;
  sinceHours?: number;
}

export function getHealthSummary(
  client: OmniCommsRpcClient,
  input: HealthQueryInput,
): Promise<HealthSummaryPayload> {
  return callOmniCommsRpc<HealthSummaryPayload>(client, 'omni_comms_health_summary', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_since_hours: input.sinceHours ?? 720,
  });
}

export function getHealthPermissions(
  client: OmniCommsRpcClient,
  input: HealthQueryInput,
): Promise<HealthPermissionsPayload> {
  return callOmniCommsRpc<HealthPermissionsPayload>(client, 'omni_comms_health_permissions', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
  });
}

export function getHealthCatalogue(
  client: OmniCommsRpcClient,
  input: HealthQueryInput,
): Promise<HealthCataloguePayload> {
  return callOmniCommsRpc<HealthCataloguePayload>(client, 'omni_comms_health_catalogue', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
  });
}

export function getHealthRuntime(
  client: OmniCommsRpcClient,
  input: HealthQueryInput,
): Promise<HealthRuntimePayload> {
  return callOmniCommsRpc<HealthRuntimePayload>(client, 'omni_comms_health_runtime', {
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_since_hours: input.sinceHours ?? 720,
  });
}

// ─── Error mapping ───────────────────────────────────────────────────────

/**
 * Converts any thrown value into an operator-safe HealthError. Raw SQLSTATE,
 * function bodies, table names and stack traces are never propagated.
 */
export function mapHealthError(err: unknown): HealthError {
  if (err instanceof OmniCommsRpcError) {
    switch (err.code) {
      case 'OC401':
        return { kind: 'permission_denied', message: 'Your session is not authenticated.', retryable: false };
      case 'OC403':
        return {
          kind: 'permission_denied',
          message: 'You do not hold the capability required to read Omni-Comms diagnostics.',
          retryable: false,
        };
      case 'OC404':
        return { kind: 'no_configuration', message: 'No configuration was found for this tenant.', retryable: true };
      case 'OC422':
        return {
          kind: 'tenant_unavailable',
          message: 'The selected organisation or department is not valid for diagnostics.',
          retryable: false,
        };
      default:
        return { kind: 'rpc_unavailable', message: 'The diagnostic service could not be reached.', retryable: true };
    }
  }
  const text = err instanceof Error ? err.message : String(err ?? '');
  if (/abort|timeout|timed out/i.test(text)) {
    return { kind: 'timed_out', message: 'The diagnostic request timed out.', retryable: true };
  }
  if (/could not find the function|schema cache|404/i.test(text)) {
    return { kind: 'rpc_unavailable', message: 'The diagnostic service is not available in this environment.', retryable: true };
  }
  return { kind: 'unknown', message: 'Diagnostics could not be completed.', retryable: true };
}

// ─── Derivation helpers ──────────────────────────────────────────────────

function row(
  code: string,
  title: string,
  state: DiagnosticState,
  summary: string,
  evidenceAt: string,
  evidence: string[],
  recommendedAction: string | null = null,
  targetScreen: DiagnosticRow['targetScreen'] = null,
): DiagnosticRow {
  return { code, title, state, summary, evidenceAt, evidence, recommendedAction, targetScreen };
}

const CAP_LABEL: Record<string, string> = {
  'omni_comms.view': 'View',
  'omni_comms.operate': 'Operate',
  'omni_comms.configure': 'Configure',
  'omni_comms.author_templates': 'Author templates',
  'omni_comms.approve_templates': 'Approve templates',
  'omni_comms.view_sensitive_content': 'View sensitive content',
};

function tenantCategory(
  p: HealthPermissionsPayload,
  organizationName: string | null,
  departmentName: string | null,
): DiagnosticCategory {
  const at = p.generated_at;
  const rows: DiagnosticRow[] = [
    row('TEN.ORGANISATION', 'Organisation selected', 'configured',
      organizationName ?? 'Organisation selected', at,
      [`organisation: ${organizationName ?? p.organization_id}`]),
    row('TEN.DEPARTMENT', 'Department scope',
      p.department_id ? 'configured' : 'ready',
      p.department_id ? `Scoped to ${departmentName ?? 'the selected department'}` : 'Organisation-wide',
      at, [`scope: ${p.department_scope}`]),
    row('TEN.LOOKUP', 'Tenant lookup available',
      p.tenant_lookup_available ? 'healthy' : 'unavailable',
      p.tenant_lookup_available
        ? 'Organisation and department lookup responded.'
        : 'Tenant lookup did not respond.',
      at, [`lookup: ${p.tenant_lookup_available ? 'available' : 'unavailable'}`]),
  ];

  for (const [key, label] of Object.entries(CAP_LABEL)) {
    const state = p.capabilities?.[key] ?? 'unavailable';
    rows.push(
      row(
        `PERM.${key.split('.')[1].toUpperCase()}`,
        `${label} (${key})`,
        state === 'granted' ? 'healthy' : state === 'not_granted' ? 'partial' : 'unavailable',
        state === 'granted' ? 'Granted' : state === 'not_granted' ? 'Not granted' : 'Unavailable',
        at,
        [`capability: ${state}`],
        state === 'granted' ? null : 'Ask a platform administrator to grant this capability.',
        null,
      ),
    );
  }

  return {
    code: 'tenant_permissions',
    title: 'Tenant and permissions',
    description: 'Who you are operating as, and what this deployment allows you to do.',
    rows,
  };
}

function eventCategory(c: HealthCataloguePayload): DiagnosticCategory {
  const e = c.events;
  const at = c.generated_at;
  const rows: DiagnosticRow[] = [
    row('EVT.DEFINITIONS', 'Event definitions',
      e.event_definitions > 0 ? 'configured' : 'blocked',
      `${e.event_definitions} defined, ${e.event_definitions_active} active`,
      at, [`definitions: ${e.event_definitions}`, `active: ${e.event_definitions_active}`],
      e.event_definitions > 0 ? null : 'Create the first event definition.', T.events),
    row('EVT.PUBLISHED_CONTRACTS', 'Published contracts',
      e.published_contracts > 0 ? 'configured' : e.event_definitions > 0 ? 'blocked' : 'partial',
      `${e.published_contracts} published contract version(s)`,
      at, [`published_contracts: ${e.published_contracts}`],
      e.published_contracts > 0 ? null : 'Publish an event contract.', T.events),
    row('EVT.MISSING_CONTRACT', 'Active events missing a published contract',
      e.events_without_published_contract === 0 ? 'healthy' : 'blocked',
      `${e.events_without_published_contract} active event(s) have no published contract`,
      at, [`events_without_published_contract: ${e.events_without_published_contract}`],
      e.events_without_published_contract === 0 ? null : 'Publish a contract for every active event.', T.events),
    row('EVT.ACTIVE_ROUTES', 'Active event routes',
      e.active_event_routes > 0 ? 'configured' : 'blocked',
      `${e.active_event_routes} active route(s) in this scope`,
      at, [`active_routes: ${e.active_event_routes}`, `department_overrides: ${e.department_route_overrides}`],
      e.active_event_routes > 0 ? null : 'Activate an event route.', T.events),
    row('EVT.MISSING_ROUTE', 'Active events missing an active route',
      e.events_without_active_route === 0 ? 'healthy' : 'blocked',
      `${e.events_without_active_route} active event(s) have no active route`,
      at, [`events_without_active_route: ${e.events_without_active_route}`],
      e.events_without_active_route === 0 ? null : 'Activate a route for every active event.', T.events),
    row('EVT.ROUTE_TEMPLATE', 'Route template availability',
      e.routes_with_unavailable_template === 0 ? 'healthy' : 'blocked',
      `${e.routes_with_unavailable_template} active route(s) point at an unavailable template family`,
      at, [`routes_with_unavailable_template: ${e.routes_with_unavailable_template}`],
      e.routes_with_unavailable_template === 0 ? null : 'Point each route at an active template family.', T.events),
  ];
  return {
    code: 'event_catalogue',
    title: 'Event catalogue',
    description: 'Live event definitions, contracts and routing for this tenant.',
    rows,
  };
}

function templateCategory(c: HealthCataloguePayload): DiagnosticCategory {
  const t = c.templates;
  const a = c.assembly;
  const at = c.generated_at;
  const catalogueConfigured = t.template_families_active > 0;
  const renderable = catalogueConfigured && t.published_template_versions > 0;
  const readyForDryRun = renderable && a.unresolved_required_assets === 0;

  const rows: DiagnosticRow[] = [
    row('TPL.FAMILIES', 'Template families',
      catalogueConfigured ? 'configured' : 'blocked',
      `${t.template_families} families, ${t.template_families_active} active`,
      at, [`families: ${t.template_families}`, `active: ${t.template_families_active}`],
      catalogueConfigured ? null : 'Create and activate a template family.', T.templates),
    row('TPL.PUBLISHED_VERSIONS', 'Published template versions',
      t.published_template_versions > 0 ? 'configured' : 'blocked',
      `${t.published_template_versions} published version(s)`,
      at, [`published_versions: ${t.published_template_versions}`],
      t.published_template_versions > 0 ? null : 'Publish a template version.', T.templates),
    row('TPL.MISSING_PUBLISHED', 'Active families without a published version',
      t.families_without_published_version === 0 ? 'healthy' : 'blocked',
      `${t.families_without_published_version} active family/families have no published version`,
      at, [`families_without_published_version: ${t.families_without_published_version}`],
      t.families_without_published_version === 0 ? null : 'Publish a version for every active family.', T.templates),
    row('TPL.LAYOUT_SELECTION', 'Layout selection',
      t.templates_without_layout_selection === 0 ? 'healthy' : 'partial',
      `${t.templates_without_layout_selection} published version(s) have no layout selection`,
      at, [`templates_without_layout_selection: ${t.templates_without_layout_selection}`],
      t.templates_without_layout_selection === 0 ? null : 'Configure a layout for each published version.', T.templates),
    row('ASM.LAYOUTS', 'Layouts',
      a.layouts > 0 ? 'configured' : 'blocked',
      `${a.layouts} active layout(s), ${a.published_layout_versions} published layout version(s)`,
      at, [`layouts: ${a.layouts}`, `published_layout_versions: ${a.published_layout_versions}`],
      a.layouts > 0 ? null : 'Configure a layout.', T.templates),
    row('ASM.SLOTS', 'Required slots and resolved assets',
      a.required_slots === 0 ? 'partial' : a.unresolved_required_assets === 0 ? 'healthy' : 'blocked',
      `${a.resolved_assets} of ${a.required_slots} slot assignment(s) resolve to an active asset`,
      at, [
        `required_slots: ${a.required_slots}`,
        `resolved_assets: ${a.resolved_assets}`,
        `unresolved_required_assets: ${a.unresolved_required_assets}`,
      ],
      a.unresolved_required_assets === 0 ? null : 'Resolve required asset slots.', T.templates),
    row('TPL.CATALOGUE_CONFIGURED', 'Template catalogue configured',
      catalogueConfigured ? 'configured' : 'blocked',
      catalogueConfigured ? 'At least one active template family exists.' : 'No active template family exists.',
      at, [`active_families: ${t.template_families_active}`],
      catalogueConfigured ? null : 'Activate a template family.', T.templates),
    row('TPL.RENDERABLE', 'Template renderable',
      renderable ? 'ready' : 'blocked',
      renderable ? 'A published version is available to render.' : 'No published version is available to render.',
      at, [`published_versions: ${t.published_template_versions}`],
      renderable ? null : 'Publish a template version.', T.templates),
    row('TPL.DRY_RUN_READY', 'Template ready for dry run',
      readyForDryRun ? 'ready' : 'partial',
      readyForDryRun
        ? 'Templates and assembly assets resolve for a dry run.'
        : 'Assembly assets are incomplete for a dry run.',
      at, [`unresolved_required_assets: ${a.unresolved_required_assets}`],
      readyForDryRun ? null : 'Resolve required asset slots.', T.templates),
  ];
  return {
    code: 'templates_assembly',
    title: 'Templates and assembly',
    description: 'Live template catalogue, layouts and shared-asset resolution.',
    rows,
  };
}

function channelCategory(ch: HealthChannelsPayload, at: string): DiagnosticCategory {
  const rows: DiagnosticRow[] = [
    row('CHN.PROVIDER_REGISTERED', 'Email provider registered',
      ch.email_provider_registered ? 'configured' : 'blocked',
      ch.email_provider_registered ? 'An email provider record exists.' : 'No email provider record exists.',
      at, [`registered: ${ch.email_provider_registered}`],
      ch.email_provider_registered ? null : 'Register the email provider.', T.channels),
    row('CHN.PROVIDER_ACTIVE', 'Email provider active',
      ch.email_provider_active ? 'configured' : 'blocked',
      ch.email_provider_active ? 'The email provider is active.' : 'The email provider is not active.',
      at, [`active: ${ch.email_provider_active}`],
      ch.email_provider_active ? null : 'Activate the email provider.', T.channels),
    row('CHN.ACCOUNTS', 'Provider accounts',
      ch.provider_accounts_active > 0 ? 'configured' : 'blocked',
      `${ch.provider_accounts_active} of ${ch.provider_accounts} account(s) active`,
      at, [`accounts: ${ch.provider_accounts}`, `active: ${ch.provider_accounts_active}`],
      ch.provider_accounts_active > 0 ? null : 'Configure an email provider account.', T.channels),
    row('CHN.CREDENTIAL_HEALTH', 'Credential-check health',
      ch.provider_accounts_healthy > 0
        ? 'configured'
        : ch.provider_accounts_credentials_configured > 0
          ? 'partial'
          : 'blocked',
      `${ch.provider_accounts_healthy} account(s) reported healthy at the last credential check`,
      at, [
        `credentials_configured: ${ch.provider_accounts_credentials_configured}`,
        `healthy: ${ch.provider_accounts_healthy}`,
      ],
      ch.provider_accounts_healthy > 0 ? null : 'Record a successful credential check.', T.channels),
    row('CHN.SENDERS', 'Sender identities',
      ch.sender_identities_active > 0 ? 'configured' : 'blocked',
      `${ch.sender_identities_active} of ${ch.sender_identities} sender identity/identities active`,
      at, [`senders: ${ch.sender_identities}`, `active: ${ch.sender_identities_active}`],
      ch.sender_identities_active > 0 ? null : 'Create and activate a sender identity.', T.channels),
    row('CHN.BINDINGS', 'Verified sender bindings',
      ch.bindings_verified > 0 && ch.bindings_active > 0 ? 'configured' : 'blocked',
      `${ch.bindings_active} active binding(s), ${ch.bindings_verified} verified`,
      at, [`bindings: ${ch.bindings}`, `active: ${ch.bindings_active}`, `verified: ${ch.bindings_verified}`],
      ch.bindings_verified > 0 && ch.bindings_active > 0 ? null : 'Verify a sender binding.', T.channels),
    row('CHN.SETTING', 'Email channel setting',
      ch.email_channel_setting_present ? 'configured' : 'blocked',
      ch.email_channel_setting_present ? 'An email channel setting exists.' : 'No email channel setting exists.',
      at, [`setting_present: ${ch.email_channel_setting_present}`],
      ch.email_channel_setting_present ? null : 'Create the email channel setting.', T.channels),
    row('CHN.ENABLED', 'Email channel enabled',
      ch.email_channel_enabled ? 'configured' : 'blocked',
      ch.email_channel_enabled ? 'The email channel is enabled.' : 'The email channel is disabled.',
      at, [`enabled: ${ch.email_channel_enabled}`],
      ch.email_channel_enabled ? null : 'Enable the email channel.', T.channels),
    row('CHN.SEND_READY', 'Email send readiness (configuration only)',
      ch.email_send_ready ? 'configured' : 'partial',
      ch.email_send_ready
        ? 'Email configuration is complete. This is a configuration state, not live delivery capability.'
        : 'Email configuration is incomplete.',
      at, [`email_send_ready: ${ch.email_send_ready}`],
      ch.email_send_ready ? null : 'Complete the email channel configuration.', T.channels),
  ];
  return {
    code: 'channel_configuration',
    title: 'Channel configuration',
    description:
      'Live email channel configuration. Configuration readiness never implies live provider delivery.',
    rows,
  };
}

function runtimeImplementationCategory(
  r: HealthRuntimePayload,
  edge: EdgeHealthProbeResult | null,
): DiagnosticCategory {
  const at = r.generated_at;
  const tables = Object.entries(r.runtime_tables ?? {});
  const tablesPresent = tables.length > 0 && tables.every(([, v]) => v === true);
  const fn = r.runtime_functions ?? {};
  const registered = OMNI_COMMS_INTEGRATION_REGISTRY.find((i) => i.name === 'omni-comms-runtime');
  const p = OMNI_COMMS_OPERATIONAL_POSTURE;

  const rows: DiagnosticRow[] = [
    row('RTI.FUNCTION_REGISTERED', 'omni-comms-runtime registered',
      registered ? 'configured' : 'not_implemented',
      registered ? `Registered in the integration catalogue (${registered.status}).` : 'Not registered.',
      at, [`registry_status: ${registered?.status ?? 'absent'}`]),
    row('RTI.FUNCTION_CALLABLE', 'omni-comms-runtime deployed or callable',
      edge === null ? 'unknown' : edge.available ? 'healthy' : 'unavailable',
      edge === null
        ? 'Deployment availability has not been probed.'
        : edge.available
          ? 'The safe health probe responded.'
          : 'The safe health probe did not respond.',
      edge?.checkedAt ?? at,
      [
        `probe: ${edge === null ? 'not_run' : edge.available ? 'available' : 'unavailable'}`,
        `build_tag: ${edge?.buildTag ?? 'unknown'}`,
      ],
      edge?.available === false ? 'Confirm the runtime function is deployed for this environment.' : null,
      null),
    row('RTI.FACADE', 'sendCommunication façade present',
      p.runtimeImplemented ? 'configured' : 'not_implemented',
      'The single public send façade is present in source control.', at,
      ['facade: src/platform/omni-comms/sendCommunication.ts']),
    row('RTI.TABLES', 'Runtime request tables present',
      tablesPresent ? 'healthy' : 'unavailable',
      tablesPresent ? 'All runtime tables are present in this database.' : 'One or more runtime tables are missing.',
      at, tables.map(([k, v]) => `${k}: ${v ? 'present' : 'missing'}`)),
    row('RTI.RENDERING', 'Rendering implementation present',
      fn['omni_comms_priv_load_render_context'] ? 'configured' : 'not_implemented',
      fn['omni_comms_priv_load_render_context']
        ? 'The rendering context loader is deployed.'
        : 'The rendering context loader is not deployed.',
      at, [`render_context_loader: ${fn['omni_comms_priv_load_render_context'] ? 'present' : 'absent'}`]),
    row('RTI.PERSISTENCE', 'Message persistence implementation present',
      fn['omni_comms_priv_persist_rendered_messages'] ? 'configured' : 'not_implemented',
      fn['omni_comms_priv_persist_rendered_messages']
        ? 'Atomic message persistence is deployed.'
        : 'Atomic message persistence is not deployed.',
      at, [`message_persistence: ${fn['omni_comms_priv_persist_rendered_messages'] ? 'present' : 'absent'}`]),
    row('RTI.HELD_JOBS', 'Held-job implementation present',
      r.runtime_tables?.['omni_comms_dispatch_job'] ? 'configured' : 'not_implemented',
      'Dispatch jobs are created in a held, non-runnable state only.',
      at, [`runnable_queue_enabled: ${r.runnable_queue_enabled}`]),
    row('RTI.OPS_CONSOLE', 'Operations read console present',
      fn['omni_comms_ops_summary'] ? 'configured' : 'not_implemented',
      fn['omni_comms_ops_summary']
        ? 'The read-only Operations console surface is deployed.'
        : 'The Operations console read surface is not deployed.',
      at, [`ops_summary: ${fn['omni_comms_ops_summary'] ? 'present' : 'absent'}`],
      null, T.operations),
  ];
  return {
    code: 'runtime_implementation',
    title: 'Runtime implementation',
    description:
      'What the deployed environment can execute. Static implementation facts come from source control; deployment availability comes from a bounded server probe.',
    rows,
  };
}

function runtimeDataCategory(r: HealthRuntimePayload): DiagnosticCategory {
  const c = r.counters;
  const at = r.generated_at;
  const mk = (code: string, title: string, value: number, extra?: string) =>
    row(code, title, value > 0 ? 'healthy' : 'ready', `${value}`, at,
      [`${title.toLowerCase()}: ${value}`, ...(extra ? [extra] : [])], null, T.operations);

  return {
    code: 'runtime_data',
    title: 'Runtime data',
    description: 'Live runtime counters, reused from the Operations summary RPC.',
    rows: [
      mk('RTD.REQUESTS', 'Requests', c.requests, `last_request_at: ${c.last_request_at ?? 'none'}`),
      mk('RTD.RECIPIENTS', 'Recipients', c.recipients),
      mk('RTD.MESSAGES', 'Messages', c.messages),
      mk('RTD.HELD_JOBS', 'Held jobs', c.held_jobs),
      row('RTD.RUNNABLE_JOBS', 'Runnable jobs',
        c.runnable_jobs === 0 ? 'ready' : 'blocked',
        `${c.runnable_jobs} (expected 0 while dispatch is not implemented)`,
        at, [`runnable_jobs: ${c.runnable_jobs}`], null, T.operations),
      row('RTD.DELIVERY_ATTEMPTS', 'Delivery attempts',
        c.delivery_attempts === 0 ? 'ready' : 'partial',
        `${c.delivery_attempts} (expected 0 while no provider is contacted)`,
        at, [`delivery_attempts: ${c.delivery_attempts}`], null, T.operations),
      row('RTD.BLOCKED', 'Blocked requests',
        c.blocked_requests === 0 ? 'healthy' : 'partial',
        `${c.blocked_requests}`, at, [`blocked_requests: ${c.blocked_requests}`],
        c.blocked_requests === 0 ? null : 'Review blocked requests in Operations.', T.operations),
      mk('RTD.PROCESSING', 'Processing requests', c.processing_requests),
      mk('RTD.DRY_RUNS', 'Completed dry runs', c.completed_dry_runs),
      row('RTD.FAILED', 'Failed requests',
        c.failed_requests === 0 ? 'healthy' : 'partial',
        `${c.failed_requests}`, at, [`failed_requests: ${c.failed_requests}`],
        c.failed_requests === 0 ? null : 'Review failed requests in Operations.', T.operations),
    ],
  };
}

const CERTIFICATION_EXPLANATION =
  'Implementation and static verification are complete, but the privileged Edge integration harness has not produced the required certification marker.';

function certificationCategory(r: HealthRuntimePayload): DiagnosticCategory {
  const at = r.generated_at;
  const st = (v: string | undefined): DiagnosticState => (v === 'certified' ? 'healthy' : 'not_certified');
  return {
    code: 'runtime_certification',
    title: 'Runtime certification',
    description: CERTIFICATION_EXPLANATION,
    rows: [
      row('CRT.RESOLUTION', 'Slice 2c-ii privileged resolution certification',
        st(r.certification?.resolution), CERTIFICATION_EXPLANATION, at,
        ['required marker: BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK'],
        'Run privileged runtime certification.', null),
      row('CRT.RENDERING', 'Slice 2c-iii privileged rendering certification',
        st(r.certification?.rendering), CERTIFICATION_EXPLANATION, at,
        ['required marker: BUILD 3 SLICE 2C-III EDGE RUNTIME VERTICAL INTEGRATION OK'],
        'Run privileged runtime certification.', null),
      row('CRT.OVERALL', 'Overall runtime vertical certification',
        st(r.certification?.overall), CERTIFICATION_EXPLANATION, at,
        [`overall: ${r.certification?.overall ?? 'not_certified'}`],
        'Run privileged runtime certification.', null),
    ],
  };
}

function deliveryCategory(r: HealthRuntimePayload): DiagnosticCategory {
  const at = r.generated_at;
  const find = (n: string) => OMNI_COMMS_INTEGRATION_REGISTRY.find((i) => i.name === n);
  const dispatch = find('omni-comms-dispatch');
  const webhook = find('omni-comms-webhook-resend');
  const provider = find('resend');
  const reserved = (s?: string): DiagnosticState => (s === 'Available' ? 'configured' : 'not_implemented');
  return {
    code: 'delivery_capability',
    title: 'Delivery capability',
    description:
      'Live provider delivery. Email configuration readiness and live dispatch availability are separate concepts.',
    rows: [
      row('DLV.ADAPTER', 'Provider adapter implemented', reserved(provider?.status),
        `Provider adapter status: ${provider?.status ?? 'absent'}`, at,
        [`provider_adapter: ${provider?.status ?? 'absent'}`], 'Implement dispatch processing.', null),
      row('DLV.DISPATCH_FN', 'Dispatch Edge Function available', reserved(dispatch?.status),
        `Dispatch function status: ${dispatch?.status ?? 'absent'}`, at,
        [`omni-comms-dispatch: ${dispatch?.status ?? 'absent'}`], 'Implement dispatch processing.', null),
      row('DLV.WEBHOOK_FN', 'Webhook Edge Function available', reserved(webhook?.status),
        `Webhook function status: ${webhook?.status ?? 'absent'}`, at,
        [`omni-comms-webhook-resend: ${webhook?.status ?? 'absent'}`], null, null),
      row('DLV.QUEUE', 'Runnable queue enabled',
        r.runnable_queue_enabled ? 'configured' : 'not_implemented',
        r.runnable_queue_enabled ? 'Enabled' : 'Disabled — every dispatch job is held.',
        at, [`runnable_queue_enabled: ${r.runnable_queue_enabled}`], null, null),
      row('DLV.LIVE', 'Live delivery enabled',
        r.live_delivery_enabled ? 'configured' : 'not_implemented',
        r.live_delivery_enabled
          ? 'A channel setting requests live delivery, but no dispatch implementation exists.'
          : 'Disabled.',
        at, [`live_delivery_enabled: ${r.live_delivery_enabled}`], null, T.channels),
    ],
  };
}

// ─── Posture and recommendations ─────────────────────────────────────────

export function derivePosture(categories: DiagnosticCategory[]): {
  posture: OverallPosture;
  reason: string;
} {
  const rows = categories.flatMap((c) => c.rows);
  const find = (code: string) => rows.find((r) => r.code === code);

  if (rows.some((r) => r.state === 'unavailable')) {
    return { posture: 'unavailable', reason: 'At least one diagnostic could not be read from this environment.' };
  }

  const configBlockers = rows.filter(
    (r) => r.state === 'blocked' &&
      (r.code.startsWith('EVT.') || r.code.startsWith('TPL.') || r.code.startsWith('ASM.') || r.code.startsWith('CHN.')),
  );
  const otherBlockers = rows.filter((r) => r.state === 'blocked' && !configBlockers.includes(r));

  if (otherBlockers.length > 0) {
    return { posture: 'blocked', reason: 'A runtime diagnostic is blocked.' };
  }
  if (configBlockers.length > 0) {
    return {
      posture: 'configuration_incomplete',
      reason: `${configBlockers.length} configuration diagnostic(s) are incomplete.`,
    };
  }

  const certified = find('CRT.OVERALL')?.state === 'healthy';
  const live = find('DLV.LIVE')?.state === 'configured' && find('DLV.DISPATCH_FN')?.state === 'configured';

  if (live) return { posture: 'live_delivery_enabled', reason: 'Live provider delivery is enabled.' };
  if (certified) return { posture: 'runtime_certified', reason: 'The runtime vertical is certified.' };

  const dryRunReady = find('TPL.DRY_RUN_READY')?.state === 'ready';
  if (dryRunReady) {
    return {
      posture: 'implementation_testing_only',
      reason:
        'Configuration is complete and dry runs can be exercised, but privileged runtime certification is pending and no live delivery exists.',
    };
  }
  return { posture: 'ready_for_dry_run', reason: 'Configuration is complete enough to attempt a dry run.' };
}

const ACTION_PRIORITY: Record<string, number> = {
  'EVT.DEFINITIONS': 1,
  'EVT.PUBLISHED_CONTRACTS': 2,
  'EVT.MISSING_CONTRACT': 3,
  'EVT.ACTIVE_ROUTES': 4,
  'EVT.MISSING_ROUTE': 5,
  'EVT.ROUTE_TEMPLATE': 6,
  'TPL.CATALOGUE_CONFIGURED': 7,
  'TPL.FAMILIES': 8,
  'TPL.PUBLISHED_VERSIONS': 9,
  'TPL.MISSING_PUBLISHED': 10,
  'ASM.LAYOUTS': 11,
  'TPL.LAYOUT_SELECTION': 12,
  'ASM.SLOTS': 13,
  'TPL.DRY_RUN_READY': 14,
  'CHN.PROVIDER_REGISTERED': 15,
  'CHN.PROVIDER_ACTIVE': 16,
  'CHN.ACCOUNTS': 17,
  'CHN.CREDENTIAL_HEALTH': 18,
  'CHN.SENDERS': 19,
  'CHN.BINDINGS': 20,
  'CHN.SETTING': 21,
  'CHN.ENABLED': 22,
  'CHN.SEND_READY': 23,
  'CRT.RESOLUTION': 24,
  'CRT.RENDERING': 25,
  'CRT.OVERALL': 26,
  'DLV.ADAPTER': 27,
  'DLV.DISPATCH_FN': 28,
};

export function deriveRecommendedActions(categories: DiagnosticCategory[]): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  for (const cat of categories) {
    for (const r of cat.rows) {
      if (!r.recommendedAction) continue;
      if (r.state === 'healthy' || r.state === 'ready' || r.state === 'configured') continue;
      out.push({
        priority: ACTION_PRIORITY[r.code] ?? 90,
        title: r.recommendedAction,
        reason: r.summary,
        targetScreen: r.targetScreen ?? T.health,
        blockingDiagnostic: r.code,
      });
    }
  }
  out.sort((a, b) => (a.priority !== b.priority ? a.priority - b.priority : a.blockingDiagnostic.localeCompare(b.blockingDiagnostic)));
  // Re-number 1..n so the list reads as a prioritized queue.
  return out.map((a, i) => ({ ...a, priority: i + 1 }));
}

export interface BuildLiveDiagnosticsInput {
  summary: HealthSummaryPayload;
  edge?: EdgeHealthProbeResult | null;
  organizationName?: string | null;
  departmentName?: string | null;
}

export function buildLiveDiagnostics(input: BuildLiveDiagnosticsInput): LiveDiagnosticsResult {
  const { summary, edge = null } = input;
  const categories: DiagnosticCategory[] = [
    tenantCategory(summary.permissions, input.organizationName ?? null, input.departmentName ?? null),
    eventCategory(summary.catalogue),
    templateCategory(summary.catalogue),
    channelCategory(summary.channels, summary.generated_at),
    runtimeImplementationCategory(summary.runtime, edge),
    runtimeDataCategory(summary.runtime),
    certificationCategory(summary.runtime),
    deliveryCategory(summary.runtime),
  ];
  const { posture, reason } = derivePosture(categories);
  return {
    organizationId: summary.organization_id,
    departmentId: summary.department_id,
    categories,
    posture,
    postureReason: reason,
    recommendations: deriveRecommendedActions(categories),
    generatedAt: summary.generated_at,
  };
}

/** Names of the bounded health read RPCs — used by tests and the verifier. */
export const OMNI_COMMS_HEALTH_RPCS = [
  'omni_comms_health_summary',
  'omni_comms_health_catalogue',
  'omni_comms_health_runtime',
  'omni_comms_health_permissions',
] as const;
