/**
 * Omnichannel Communications — Readiness Manifest
 *
 * SOURCE-CONTROLLED readiness aggregate. Since Story 3, most values are
 * derived from the dedicated registries in this folder. This file exists
 * to preserve the public shape consumed by the Readiness page and Story 2
 * tests while eliminating duplicated hard-coded architecture lists.
 */
import {
  OMNI_COMMS_OBJECT_REGISTRY,
} from './objectRegistry';
import {
  OMNI_COMMS_ROUTE_REGISTRY,
} from './routeRegistry';
import {
  OMNI_COMMS_INTEGRATION_REGISTRY,
} from './integrationRegistry';
import {
  OMNI_COMMS_QUEUE_REGISTRY,
} from './queueRegistry';

export type ReadinessRouteState = 'Available' | 'Placeholder' | 'Not implemented';

export type CapabilityRegistration = 'Registered' | 'Planned';
export type CapabilityMapping = 'Mapped to Admin' | 'Unmapped';

export type FoundationState =
  | 'Verified'
  | 'In progress'
  | 'Planned'
  | 'Blocked'
  | 'Not applicable';

export interface SystemIdentity {
  productName: string;
  systemType: string;
  sourceNamespace: string;
  apiPrefix: string;
  adminPrefix: string;
  dbPrefix: string;
  queuePrefix: string;
  currentEpic: string;
  currentStory: string;
  overallStatus: string;
}

export interface PermanentRoute {
  path: string;
  label: string;
  state: ReadinessRouteState;
}

export interface CapabilityEntry {
  key: string;
  registration: CapabilityRegistration;
  mapping: CapabilityMapping;
  intendedUse: string;
}

export interface PlannedObjectEntry {
  name: string;
  status: 'Physical schema available — service capability planned' | 'Registered in architecture catalogue — Not yet created';
  introductionStory?: string;
}

export interface PlannedObjects {
  eventsAndContent: PlannedObjectEntry[];
  channelsSendersPreferences: PlannedObjectEntry[];
  runtime: PlannedObjectEntry[];
  note: string;
}

export interface FoundationItem {
  item: string;
  state: FoundationState;
  note?: string;
}

export interface Blocker {
  id: string;
  description: string;
  affectsEpic: number;
}

export interface NextStep {
  epic: string;
  story: string;
  title: string;
  informationalOnly: true;
}

export interface ArchitectureBoundaryRow {
  ruleId: string;
  title: string;
  status: 'Enforced in CI';
}

export interface OmniCommsReadinessManifest {
  systemIdentity: SystemIdentity;
  legacyIsolation: { rules: string[] };
  permanentRoutes: PermanentRoute[];
  capabilities: CapabilityEntry[];
  plannedObjects: PlannedObjects;
  reservedEdgeFunctions: string[];
  reservedQueues: string[];
  architectureBoundaries: ArchitectureBoundaryRow[];
  foundationStatus: FoundationItem[];
  blockers: Blocker[];
  nextStep: NextStep;
}

// ─── Derived from registries ────────────────────────────────────────────
const permanentRoutes: PermanentRoute[] = OMNI_COMMS_ROUTE_REGISTRY.map((r) => ({
  path: r.path,
  label: r.label,
  state: r.state,
}));

const toPlannedEntry = (o: (typeof OMNI_COMMS_OBJECT_REGISTRY)[number]): PlannedObjectEntry => ({
  name: o.name,
  status:
    o.status === 'AVAILABLE'
      ? 'Physical schema available — service capability planned'
      : 'Registered in architecture catalogue — Not yet created',
  introductionStory: o.introductionStory,
});

const plannedObjects: PlannedObjects = {
  eventsAndContent: OMNI_COMMS_OBJECT_REGISTRY
    .filter((o) => o.category === 'events_and_content')
    .map(toPlannedEntry),
  channelsSendersPreferences: OMNI_COMMS_OBJECT_REGISTRY
    .filter((o) => o.category === 'channels_senders_preferences')
    .map(toPlannedEntry),
  runtime: OMNI_COMMS_OBJECT_REGISTRY
    .filter((o) => o.category === 'runtime')
    .map(toPlannedEntry),
  note:
    'Approved 19-object ceiling. Objects marked "Physical schema available" exist in the database; service capability may still be planned.',
};

const reservedEdgeFunctions: string[] = OMNI_COMMS_INTEGRATION_REGISTRY
  .filter((i) => i.kind === 'edge_function')
  .map((i) => i.name);

const reservedQueues: string[] = OMNI_COMMS_QUEUE_REGISTRY.map((q) => q.name);

export const OMNI_COMMS_READINESS_MANIFEST: OmniCommsReadinessManifest = {
  systemIdentity: {
    productName: 'Omnichannel Communications',
    systemType: 'Parallel replacement',
    sourceNamespace: 'src/platform/omni-comms',
    apiPrefix: '/api/omni-comms',
    adminPrefix: '/admin/omnichannel-communications',
    dbPrefix: 'omni_comms_',
    queuePrefix: 'omni-comms.',
    currentEpic: 'Epic 4',
    currentStory: 'Accelerated Build 2',
    overallStatus: 'In progress',

  },

  legacyIsolation: {
    rules: [
      'Legacy Communication Hub remains operational.',
      'No Legacy imports are allowed from Omni-Comms source.',
      'No Legacy communication-table reads are allowed from Omni-Comms.',
      'No Legacy communication-table writes are allowed from Omni-Comms.',
      'One business event may not be live in both systems.',
      'Legacy retirement is deferred until all events are migrated.',
    ],
  },

  permanentRoutes,

  capabilities: [
    {
      key: 'omni_comms.view',
      registration: 'Registered',
      mapping: 'Mapped to Admin',
      intendedUse: 'Access the Omnichannel Communications admin shell and its sub-pages.',
    },
    {
      key: 'omni_comms.operate',
      registration: 'Registered',
      mapping: 'Unmapped',
      intendedUse: 'Retry, resend, cancel or suppress messages once the operational console exists.',
    },
    {
      key: 'omni_comms.configure',
      registration: 'Registered',
      mapping: 'Mapped to Admin',
      intendedUse: 'Manage channels, providers, sender identities and recipient preferences; required by Event Catalogue lifecycle mutations.',
    },
    {
      key: 'omni_comms.author_templates',
      registration: 'Registered',
      mapping: 'Unmapped',
      intendedUse: 'Draft and edit template families and versions.',
    },
    {
      key: 'omni_comms.approve_templates',
      registration: 'Registered',
      mapping: 'Unmapped',
      intendedUse: 'Approve template versions for controlled or production use.',
    },
    {
      key: 'omni_comms.view_sensitive_content',
      registration: 'Registered',
      mapping: 'Mapped to Admin',
      intendedUse: 'Unmask sensitive contract sample payloads and PII in trace and audit views.',
    },
  ],

  plannedObjects,

  reservedEdgeFunctions,

  reservedQueues,

  architectureBoundaries: [
    { ruleId: 'OMNI_LEGACY_IMPORT',              title: 'Legacy import isolation',              status: 'Enforced in CI' },
    { ruleId: 'OMNI_LEGACY_TABLE_REFERENCE',     title: 'Legacy table-reference isolation',     status: 'Enforced in CI' },
    { ruleId: 'OMNI_PROVIDER_IMPORT_BOUNDARY',   title: 'Provider adapter isolation',           status: 'Enforced in CI' },
    { ruleId: 'OMNI_REACT_RUNTIME_WRITE',        title: 'React runtime-write prohibition',      status: 'Enforced in CI' },
    { ruleId: 'OMNI_MIGRATION_OBJECT_REGISTRY', title: 'Migration registry enforcement',       status: 'Enforced in CI' },
    { ruleId: 'OMNI_ROUTE_REGISTRY',             title: 'Route registry enforcement',           status: 'Enforced in CI' },
    { ruleId: 'OMNI_INTEGRATION_REGISTRY',       title: 'Integration registry enforcement',     status: 'Enforced in CI' },
    { ruleId: 'OMNI_QUEUE_REGISTRY',             title: 'Queue registry enforcement',           status: 'Enforced in CI' },
    { ruleId: 'OMNI_SEND_FACADE_BOUNDARY',       title: 'Send-façade boundary',                 status: 'Enforced in CI' },
    { ruleId: 'OMNI_PERMANENT_NAME_POLICY',      title: 'Permanent-name policy',                status: 'Enforced in CI' },
  ],

  foundationStatus: [
    { item: 'Event Definition schema',                 state: 'Verified', note: 'Epic 2 Story 1 — public.omni_comms_event_definition; unique code; segment/format CHECKs; lifecycle CHECK; before-insert/update rules trigger.' },
    { item: 'Event Contract schema',                   state: 'Verified', note: 'Epic 2 Story 1 — public.omni_comms_event_contract; FK ON DELETE RESTRICT; unique(event_definition_id, version_number); lifecycle CHECK; checksum format CHECK.' },
    { item: 'Event Catalogue application services',    state: 'Verified', note: 'Epic 2 Story 2 — 13 SECURITY DEFINER RPCs; audit-atomic; optimistic concurrency; owner postgres; search_path=pg_catalog,extensions.' },
    { item: 'Contract schema validation',              state: 'Verified', note: 'pg_jsonschema 0.3.3; extensions.jsonschema_is_valid + jsonb_matches_schema; rejects non-local $ref; 256 KB size limit.' },
    { item: 'Contract sample validation',              state: 'Verified', note: 'Sample payload must be a JSON object and satisfy the schema; enforced on create/update/publish.' },
    { item: 'Contract checksum generation',            state: 'Verified', note: 'SHA-256 hex over canonical (eventCode, versionNumber, jsonSchema) via extensions.digest; caller cannot supply.' },
    { item: 'Event Catalogue administration UI',       state: 'Verified', note: 'Epic 2 Story 3 — /admin/omnichannel-communications/events wired through the bound Story 2 adapter.' },
    { item: 'Event Definition administration',         state: 'Verified', note: 'Definitions tab: list/search/filter, create/edit draft, activate/reactivate, suspend/retire with server-enforced reason.' },
    { item: 'Event Contract administration',           state: 'Verified', note: 'Contracts tab: create/edit draft, publish with synthetic-sample confirmation, retire with reason; published & retired content read-only.' },
    { item: 'Authorised RPC integration',              state: 'Verified', note: 'React admin views use useOmniCommsRpcClient; no direct .from(omni_comms_event_*) and no service-role client.' },
    { item: 'Sensitive sample-payload protection',     state: 'Verified', note: 'contract_get returns sample_payload=null, sample_payload_redacted=true without omni_comms.view_sensitive_content; list responses omit schema and sample.' },
    { item: 'Event lifecycle audit',                   state: 'Verified', note: 'omni_comms_priv_write_lifecycle_audit writes one atomic core_audit_log row per successful mutation with actor from auth.uid() and trimmed reason.' },
    { item: 'Contract lifecycle audit',                state: 'Verified', note: 'Draft/publish/retire mutations emit OMNI_COMMS.EVENT_CONTRACT.* actions with safe before/after metadata; no schema or sample payload copied.' },
    { item: 'Event Routes administration',             state: 'Planned',  note: 'Deferred until Epic 4 — Routes tab remains a placeholder.' },
    { item: 'Event Simulator',                         state: 'Planned',  note: 'Deferred until Epic 6 — Simulator tab remains a placeholder.' },
    { item: 'Template Family schema',                  state: 'Verified', note: 'Epic 3 Story 1 — public.omni_comms_template_family; organisation/department/event scope shape CHECK; partial unique indexes per scope; lifecycle trigger enforces draft-only insert, transitions, identity immutability, deletion protection.' },
    { item: 'Template Version schema',                 state: 'Verified', note: 'Epic 3 Story 1 — public.omni_comms_template_version; unique(family, channel, locale, version); one published per family/channel/locale (partial unique); approved/published/retired content immutable; independent-approver CHECK.' },
    { item: 'Template application services',           state: 'Verified', note: 'Epic 3 Story 2 — 14 SECURITY DEFINER RPCs (family create/update/activate/retire/list/get; version create/update/approve/publish/retire/list/get; resolve_published); owner postgres; search_path=pg_catalog,public; REVOKE anon; GRANT authenticated.' },
    { item: 'Template content validation',              state: 'Verified', note: 'Epic 3 Story 2 — omni_comms_priv_validate_channel_content enforces exact allowed keys per channel, UTF-8 256 KiB bound, non-empty trimmed strings, email body requirement, and token grammar on every field.' },
    { item: 'Template rendering',                       state: 'Verified', note: 'Epic 3 Story 2 — pure deterministic renderer under src/platform/omni-comms/rendering; strict {{path}} grammar mirrored in SQL; HTML escaping on html fields only; TextEncoder byte bound; no Node crypto/Buffer; inputs never mutated; payload values never re-parsed.' },
    { item: 'Template approval workflow',               state: 'Verified', note: 'Epic 3 Story 2 — approve requires omni_comms.approve_templates and approver != author; publish atomically retires prior published version under family-row lock; resolve_published applies event → department → organization precedence after department/organisation ownership validation.' },
    { item: 'Template administration UI',               state: 'Verified', note: 'Epic 3 Story 3 — /admin/omnichannel-communications/templates wired to the Story 2 adapter through useOmniCommsRpcClient with Library, Versions and Preview tabs; family create/edit/activate/retire and version create/edit/approve/publish/replace/retire flows; capability-gated actions (view/configure/author_templates/approve_templates) with denied-by-default loading; optimistic-concurrency and atomic publication-replacement UI; synthetic payload preview isolated to component memory and rendered through sandbox="" iframe with restrictive CSP plus escaped source view; departments resolved via organizationService.listActiveDepartmentsForOrganization.' },
    { item: 'Template preview isolation',                state: 'Verified', note: 'Epic 3 Story 3 — HTML preview uses <iframe sandbox="" referrerPolicy="no-referrer" srcDoc=...> with meta-CSP default-src none, script-src none, connect-src none, frame-src none, form-action none, base-uri none, img-src restricted to data:; parent never uses dangerouslySetInnerHTML; escaped source view always available.' },
    { item: 'Template navigation & permission setup',    state: 'Verified', note: 'Epic 3 Story 3 — app_modules(omni_comms) parent + Templates child (route /admin/omnichannel-communications/templates, visibility omni_comms.view) verified; six module_actions view/operate/configure/author_templates/approve_templates/view_sensitive_content mapped to Admin role via role_permissions (is_granted=true); admin@secureserve.gov holds Admin in public.user_roles; scripts/omni-comms/verify-story3-nav-permissions.sql is the source-controlled proof.' },
    { item: 'Template catalogue security evidence',      state: 'Verified', note: 'Epic 3 Story 4 — pg_proc-verified: 14 public template RPCs (owner postgres, SECURITY DEFINER, search_path=pg_catalog,public, EXECUTE granted only to authenticated); 6 template-scoped private helpers with no anon/authenticated EXECUTE; obsolete 3-arg publish overload absent; hardened 5-arg publish present. Corrective migration revoked PUBLIC grants from six private helpers.' },
    { item: 'Template catalogue rollback proof',         state: 'Verified', note: 'Epic 3 Story 4 — scripts/omni-comms/rollback/epic3-template-catalogue-rollback.sql documents dependency-safe reversal for Stories 1/2/2-hotfix/3 with exact identity arguments, no CASCADE, and explicit preservation of Epic 1, Epic 2, public.core_audit_log, navigation, Admin permissions and Legacy artefacts.' },
    { item: 'Epic 3 completion evidence',                state: 'Verified', note: 'Epic 3 Story 4 — src/platform/omni-comms/registry/evidence/epic-03-template-catalogue.md captures table inventory, exact 14 public + 6 private function inventory, permission model, lifecycle, concurrency, checksum, scope resolution, preview isolation, audit atomicity (public.core_audit_log), test/architecture/type-check/scoped-lint/build results, and next-step Epic 4 — Story 1.' },
    { item: 'Provider schema',                           state: 'Verified', note: 'Epic 4 Story 1 — public.omni_comms_provider; UNIQUE(code); UNIQUE(adapter_key, channel); channel CHECK against email/sms/in_app/push/whatsapp/print; status CHECK draft/active/retired; lifecycle trigger enforces draft-only insert, terminal retirement, identity immutability after activation.' },
    { item: 'Provider account schema',                   state: 'Verified', note: 'Epic 4 Story 1 — public.omni_comms_provider_account; FK organization/provider ON DELETE RESTRICT; UNIQUE(organization_id, code); secret_ref matches ^OMNI_COMMS_...$ (16–96); status draft/active/disabled/retired; health_state unknown/healthy/degraded/failed with checked_at consistency.' },
    { item: 'Sender identity schema',                    state: 'Verified', note: 'Epic 4 Story 1 — public.omni_comms_sender_identity; per-channel field rules (email/sms/whatsapp require from_address, reply_to only for email, print_config only for print, event-scoped print prohibited); trigger verifies department & event belong to organisation via omni_comms_priv_verify_department_ownership.' },
    { item: 'Sender-provider binding schema',            state: 'Verified', note: 'Epic 4 Story 1 — public.omni_comms_sender_provider_binding; UNIQUE(sender_identity_id, provider_account_id); active-priority uniqueness per sender; trigger enforces organisation and channel compatibility between sender_identity and provider_account/provider.' },
    { item: 'Channel setting schema',                    state: 'Verified', note: 'Epic 4 Story 1 — public.omni_comms_channel_setting; organisation defaults with optional department override enforced via partial unique indexes; quiet-hours pair/timezone/distinct/live-requires-enabled checks; timezone validated against pg_timezone_names by trigger.' },
    { item: 'Story 1 permission model',                  state: 'Verified', note: 'Epic 4 Story 1 — all five tables have RLS enabled + FORCE; PUBLIC/anon/authenticated revoked; only service_role granted; no policies (denied by default); no public administration RPCs introduced; secrets remain outside DB rows.' },

    { item: 'Shared communication asset model',           state: 'Verified', note: 'Build 1 — public.core_comm_asset (organisation-owned, optional department ownership, controlled asset types, stable codes, lifecycle draft/active/retired) + public.core_comm_asset_version (immutable, deterministic sha256 checksum, no destructive delete). RLS + FORCE RLS; only service_role granted.' },
    { item: 'Shared layout version model',                state: 'Verified', note: 'Build 1 — public.core_template_layout_version stores immutable published versions with a strictly validated slot schema (unique codes/orders, required flag, allowed asset types, wrapper, fallback policy, no unknown keys). public.core_template_layout retains its current RLS state; compatibility debt tracked to move it behind the shared service boundary in a later build.' },
    { item: 'Shared assignment model',                    state: 'Verified', note: 'Build 1 — public.core_comm_assignment with layout_default/asset_slot kinds and four explicit partial unique indexes; resolution department → organisation → unresolved; reset retires only the department row.' },
    { item: 'Template-version layout selection',          state: 'Verified', note: 'Build 1 — omni_comms_template_version gains layout_selection_mode/layout_id/pinned_layout_version_id; editable only while draft, required before approval/publication, pinned enforces exact layout + version pairing.' },
    { item: 'Neutral department-ownership helper',        state: 'Verified', note: 'Build 1 — public.core_priv_verify_department_ownership introduced; omni_comms_priv_verify_department_ownership signature preserved and now delegates.' },
    { item: 'Shared assets RPC surface',                  state: 'Verified', note: 'Build 1 — exactly 12 SECURITY DEFINER RPCs (asset read x2, layout read x2, assignment read/upsert-org/upsert-dept/reset x4, layout selection x1, render manifest x1, pilot dry-run/apply x2); owner postgres; search_path=pg_catalog,public; PUBLIC/anon revoked; GRANT authenticated.' },
    { item: 'Deterministic render manifest',              state: 'Verified', note: 'Build 1 — omni_comms_resolve_render_manifest returns template_family_id, template_version_id, layout_id, layout_version_id, layout_inheritance_source, resolved_assets (slot, asset_id, asset_version_id, asset_type, inheritance_source), and slot list. Client composer produces rendered_subject/html/text and a stable sha256 rendered_checksum with no I/O, time or randomness.' },
    { item: 'Assembly admin surface',                     state: 'Verified', note: 'Build 1 — /admin/omnichannel-communications/templates gains an Assembly tab with layout selection, organisation/department preview context, resolved-layout metadata, asset-slot resolution table, inheritance-source badges, department override reset, unresolved-slot display, sandboxed assembled HTML preview, plain-text preview and rendered checksum. React does not query shared or Legacy asset tables directly.' },
    { item: 'Pilot migration path',                       state: 'Verified', note: 'Build 1 — core_comm_pilot_migration_dry_run and core_comm_pilot_migration_apply are parameterised, idempotent, transactional, and reject ambiguous or missing sources. No source-row changes and no dual write.' },
    { item: 'Legacy asset boundary',                      state: 'Verified', note: 'Build 1 — Omni-Comms React code reads assets/layouts exclusively via the 12 shared RPCs. Legacy comm_letterhead/comm_signature/comm_footer are only touched inside the controlled pilot migration RPC.' },
    { item: 'core_template_layout RLS compatibility debt', state: 'In progress', note: 'Build 1 — core_template_layout retains its current RLS state to preserve existing Legacy/shared readers. Debt: move it fully behind the shared service boundary in a later build.' },

    { item: 'Email provider ensure/activate',             state: 'Verified', note: 'Build 2 — omni_comms_email_provider_ensure() and omni_comms_email_provider_activate(id, expected_updated_at) manage the canonical resend_email provider. SECURITY DEFINER, owner postgres, capability omni_comms.configure, optimistic concurrency, atomic channel-domain audit.' },
    { item: 'Provider account application services',      state: 'Verified', note: 'Build 2 — omni_comms_provider_account_upsert_draft, _activate, _record_credential_check enforce draft-only edits, credential-check-before-activate gate, and record health_state (healthy|degraded|failed). Secret is stored only as OMNI_COMMS_* reference; no raw credentials in DB rows.' },
    { item: 'Sender identity application services',       state: 'Verified', note: 'Build 2 — omni_comms_sender_identity_upsert_draft, _activate: channel forced to email in Build 2, org/department/event ownership enforced by Story 1 triggers, optimistic concurrency + audit.' },
    { item: 'Binding application services',               state: 'Verified', note: 'Build 2 — omni_comms_binding_upsert_draft, _record_verification (pending/verified/failed), _activate (blocks unless verified). Active-priority uniqueness enforced; verification updates verified_at only when result is verified.' },
    { item: 'Email channel setting service',              state: 'Verified', note: 'Build 2 — omni_comms_channel_setting_upsert accepts email only; delegates quiet-hours/rate/live-requires-enabled checks to Story 1 CHECK constraints and timezone trigger; optimistic concurrency + audit.' },
    { item: 'Email configuration summary',                state: 'Verified', note: 'Build 2 — omni_comms_email_config_summary(p_organization_id) returns provider, provider_accounts, sender_identities, bindings, channel_setting and a computed email_send_ready boolean. Capability omni_comms.view; scoped strictly to the passed organisation.' },
    { item: 'Channels admin surface',                     state: 'Verified', note: 'Build 2 — /admin/omnichannel-communications/channels now Available with tabs for Provider, Accounts, Senders, Bindings and Settings. Consumes the bound Omni-Comms RPC client only; no direct table reads, no provider SDK imports, no send behaviour.' },
  ],

  blockers: [
    {
      id: 'first-event-legacy-trigger',
      description: 'First business-event selection requires a verified Legacy trigger and named owner.',
      affectsEpic: 11,
    },
    {
      id: 'ninety-day-frequency-evidence',
      description: '90-day frequency evidence is required before selecting the first shadow event.',
      affectsEpic: 11,
    },
    {
      id: 'independent-legacy-disable',
      description: 'Independent Legacy-disable capability must be verified before production cutover.',
      affectsEpic: 12,
    },
  ],

  nextStep: {
    epic: 'Epic 4',
    story: 'Build 3',
    title: 'Sender verification and first synthetic email send',
    informationalOnly: true,
  },
};

