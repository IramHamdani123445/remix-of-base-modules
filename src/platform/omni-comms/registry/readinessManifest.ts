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
    currentEpic: 'Epic 3',
    currentStory: 'Story 1',
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
    { item: 'Template application services',           state: 'Planned',  note: 'Deferred to Epic 3 Story 2 — no template RPCs, resolver, or repository exist yet.' },
    { item: 'Template content validation',             state: 'Planned',  note: 'Deferred to Epic 3 Story 2 — channel-specific content schemas not yet enforced.' },
    { item: 'Template rendering',                      state: 'Planned',  note: 'Deferred to Epic 3 Story 2 — no rendering, token extraction, or preview exists.' },
    { item: 'Template approval workflow',              state: 'Planned',  note: 'Deferred to Epic 3 Story 2 — approval and publication RPCs not yet implemented.' },
    { item: 'Template administration UI',              state: 'Planned',  note: 'Templates route remains a placeholder — no admin views wired.' },
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
    epic: 'Epic 3',
    story: 'Story 2',
    title: 'Template Application Services, Content Validation, Rendering, Approval, and Publication',
    informationalOnly: true,
  },
};
