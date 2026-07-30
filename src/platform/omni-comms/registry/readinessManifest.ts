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
    currentStory: 'Accelerated Build 3 — Slice 2c-iii (implementation-only)',
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
    { ruleId: 'OMNI_RESOLVER_RUNTIME_BOUNDARY',  title: 'Resolver runtime boundary (Rule 11)',  status: 'Enforced in CI' },
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

    { item: 'Send-façade boundary (Slice 2a)',            state: 'Verified', note: 'Slice 2a — architecture rule OMNI_SEND_FACADE_BOUNDARY amended: exactly one canonical façade file src/platform/omni-comms/sendCommunication.ts with the single export sendCommunication; aliases sendOmniCommunication/dispatchCommunication/queueCommunication remain forbidden; provider SDK imports in the façade forbidden; business-module (src/modules/**) imports of src/platform/omni-comms/runtime/** forbidden.' },
    { item: 'Trusted runtime entrypoint (Slice 2b)',       state: 'Verified', note: 'Slice 2b — src/platform/omni-comms/runtime/sendCommunicationRuntime.ts is the sole entrypoint the façade calls. Owns canonicalization, fingerprinting, RPC invocation and controlled error mapping. Never imports a provider SDK.' },
    { item: 'Canonical request representation (Slice 2b)', state: 'Verified', note: 'Slice 2b — canonicalizeRequest normalises eventCode (trim), organisation/department UUIDs (lowercase), sorts + deduplicates requestedChannels, preserves recipient order, normalises recipient destinations (email lowercased), sorts payload object keys recursively (arrays preserve order), trims callerContext, rejects functions/symbols/undefined/cyclic/non-finite/depth>20, enforces recipient limit 500 and payload byte bound 262144.' },
    { item: 'Request fingerprint (Slice 2b)',              state: 'Verified', note: 'Slice 2b — SHA-256(canonical UTF-8 JSON) lowercase hex via crypto.subtle (no Node crypto/Buffer). correlationId is EXCLUDED from the fingerprint (operational tracing metadata). Material changes to eventCode/org/dept/recipient/destination/payload/mode/requestedChannels/callerContext all change the fingerprint.' },
    { item: 'Idempotency scope (Slice 2b)',                state: 'Verified', note: 'Slice 2b — scope = (organization_id, caller_module_code, idempotency_key) matching the Slice 1 UNIQUE index omni_comms_request_idempotency_uk. Missing callerContext.moduleCode defaults to OMNI_COMMS_DIRECT.' },
    { item: 'Atomic persistence RPC (Slice 2b)',           state: 'Verified', note: 'Slice 2b — public.omni_comms_priv_send_communication (SECURITY DEFINER, owner postgres, search_path=pg_catalog,public). Authenticates auth.uid(), resolves event_definition_id, locks the idempotency scope FOR UPDATE, replays identical fingerprint, rejects mismatched fingerprint (OC409 idempotency_payload_mismatch), inserts request + request_accepted event (sequence=1, message_id=null, status_before=null, status_after=accepted) in a single transaction. EXECUTE revoked from PUBLIC/anon; granted to authenticated + service_role.' },
    { item: 'Concurrency safety (Slice 2b)',               state: 'Verified', note: 'Slice 2b — concurrency handled by (a) FOR UPDATE lock inside the RPC, (b) DB UNIQUE(organization_id, caller_module_code, idempotency_key), (c) EXCEPTION WHEN unique_violation re-select + FOR UPDATE + fingerprint compare. Two concurrent identical requests yield one persisted row + one request_accepted event + one replayed=true. Two concurrent mismatched requests yield one accepted row + one idempotency_payload_mismatch.' },
    { item: 'Controlled runtime error mapping (Slice 2b)', state: 'Verified', note: 'Slice 2b — controlled codes: invalid_input, authentication_required, organization_required, department_organization_mismatch, recipients_required, recipient_limit_exceeded, payload_invalid, payload_too_large, mode_invalid, channel_invalid, idempotency_key_required, idempotency_key_too_long, idempotency_payload_mismatch, event_code_not_found, runtime_persistence_failed, permission_denied. Raw SQLSTATE/constraint/table/recipient/payload/stack never surface to callers.' },

    { item: 'Deterministic rendering package (Slice 2c-iii)', state: 'In progress', note: 'Slice 2c-iii Batch A — supabase/functions/omni-comms-runtime/rendering/** (renderingTypes, renderingErrors, checksum, tokenResolver, slotRenderer, layoutRenderer, snapshotRevalidator, renderMessage, renderOrchestrator). Pure snapshot-in / string-out: no clock read, no randomness, no network, no database access, no provider SDK. Required tokens {{path}} and optional tokens {{path?}}; HTML fields are escaped, subject/text are not. Render checksum = sha256: over canonical JSON of template/layout/asset/sender identifiers + checksums + rendered subject/html/text, assets sorted by asset_version_id.' },
    { item: 'Snapshot revalidation (Slice 2c-iii)',           state: 'In progress', note: 'Slice 2c-iii — rendering never re-resolves configuration. snapshotRevalidator asserts the persisted Slice 2c-ii identifiers still exist, still match their persisted checksums, remain in an immutable state, and remain owned by the request organisation/department. Failure blocks the message with resolution_snapshot_missing / snapshot_row_missing / snapshot_checksum_mismatch / snapshot_version_mutated / snapshot_ownership_mismatch.' },
    { item: 'Render context RPC (Slice 2c-iii)',              state: 'In progress', note: 'Slice 2c-iii Batch B — public.omni_comms_priv_load_render_context(actor, request, organisation): STABLE SECURITY DEFINER, search_path=pg_catalog,public, service_role EXECUTE only. Returns ONLY rows addressed by persisted snapshot identifiers (template_version_id, layout_version_id, asset_version_id, sender_identity_id) plus the request, recipients and organisation channel settings.' },
    { item: 'Atomic message persistence (Slice 2c-iii)',      state: 'In progress', note: 'Slice 2c-iii Batch B — public.omni_comms_priv_persist_rendered_messages: single transaction writing omni_comms_message rows, message_rendered/message_blocked timeline events, per-mode terminal status, held dispatch jobs, dispatch_held events, request blockers and the request_completed event. Replay-safe (existing messages short-circuit), requires status=processing, service_role EXECUTE only.' },
    { item: 'Mode-aware dispatch behaviour (Slice 2c-iii)',   state: 'In progress', note: 'Slice 2c-iii Batch C — dry_run creates NO dispatch job and completes messages as dry_run_completed; shadow creates held jobs with hold_reason=shadow_mode and completes messages as shadow_completed; queued creates held jobs only, message status held. The RPC raises OC422 runnable_job_forbidden for any job that is not status=held/is_runnable=false, and OC422 dry_run_jobs_forbidden for any dry_run job. No provider is contacted and no delivery attempt is created anywhere in this build.' },
    { item: 'Rendering boundary enforcement (Slice 2c-iii)',  state: 'Verified', note: 'Slice 2c-iii Batch D — architecture Rule 11 OMNI_RESOLVER_RUNTIME_BOUNDARY extended: src/** may not import the rendering package; omni_comms_priv_load_render_context and omni_comms_priv_persist_rendered_messages added to the browser-forbidden RPC list; the rendering package is guarded against clock reads, randomness, fetch, Supabase clients, .rpc/.from access and provider SDK imports. Architecture check reports 0 unbaselined violations.' },
    { item: 'Read-only Operations console (Phase 2)',        state: 'Verified', note: 'Phase 2 — /admin/omnichannel-communications/operations is Available and reads real runtime records through omni_comms_ops_summary, _request_list, _request_detail and _message_content only. Request detail is a panel driven by ?request=<id>, so the permanent route count stays at seven. No retry, resend, cancel, suppress or dispatch control exists; destinations and payloads are masked server-side unless omni_comms.view_sensitive_content is held and disclosure is explicitly requested; rendered HTML is only shown inside the sandboxed iframe.' },
    { item: 'Slice 2c-iii runtime certification',             state: 'In progress', note: 'Slice 2c-iii is implementation-only. End-to-end rendering, held-job and timeline behaviour against the deployed Edge Function still requires a privileged run, exactly as for Slice 2c-ii. No live send capability exists or is claimed.' },
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
    story: 'Accelerated Build 3 — Slice 2c-ii / 2c-iii runtime certification',
    title:
      'Slice 2c-iii rendering, message persistence, held jobs and the timeline are implemented and boundary-enforced, but remain uncertified. Run the privileged Edge integration harness (scripts/omni-comms/integration/run-edge-resolution.ts) in a privileged environment to certify Slice 2c-ii and 2c-iii end to end. No live send capability exists; every dispatch job produced by this build is held and non-runnable.',
    informationalOnly: true,
  },
};


// ─── Derived operational posture (Operations console banner) ─────────────
/**
 * Single derived source of truth for the Operations console badges.
 *
 * Every field is computed from the registries / foundation status above —
 * it is deliberately NOT a second hand-maintained product status.
 */
export interface OmniCommsOperationalPosture {
  schemaAvailable: boolean;
  runtimeImplemented: boolean;
  runtimeCertified: boolean;
  liveDeliveryEnabled: boolean;
  operationalMutations: 'Not implemented';
  retryResendCancelSuppress: 'Not implemented';
  providerDispatch: 'Not implemented';
  privilegedRuntimeCertification: 'Pending' | 'Certified';
}

const CORE_RUNTIME_OBJECTS = [
  'omni_comms_event_route',
  'omni_comms_request',
  'omni_comms_recipient',
  'omni_comms_message',
  'omni_comms_dispatch_job',
  'omni_comms_delivery_attempt',
  'omni_comms_message_event',
];

const runtimeObjectsAvailable = CORE_RUNTIME_OBJECTS.every((name) =>
  OMNI_COMMS_OBJECT_REGISTRY.some((o) => o.name === name && o.status === 'AVAILABLE'),
);

const runtimeCertified = OMNI_COMMS_READINESS_MANIFEST.foundationStatus
  .filter((f) => /certification/i.test(f.item))
  .every((f) => f.state === 'Verified');

export const OMNI_COMMS_OPERATIONAL_POSTURE: OmniCommsOperationalPosture = {
  schemaAvailable: runtimeObjectsAvailable,
  runtimeImplemented: true,
  runtimeCertified,
  liveDeliveryEnabled: false,
  operationalMutations: 'Not implemented',
  retryResendCancelSuppress: 'Not implemented',
  providerDispatch: 'Not implemented',
  privilegedRuntimeCertification: runtimeCertified ? 'Certified' : 'Pending',
};
