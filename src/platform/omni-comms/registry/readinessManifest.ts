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
    currentEpic: 'Epic 2',
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
      mapping: 'Unmapped',
      intendedUse: 'Manage channels, providers, sender identities and recipient preferences.',
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
      mapping: 'Unmapped',
      intendedUse: 'Unmask PII / sensitive payload content in trace and audit views.',
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
    { item: 'Isolated source namespace',              state: 'Verified', note: 'src/platform/omni-comms' },
    { item: 'Permanent route shell',                  state: 'Verified', note: 'Seven routes registered under /admin/omnichannel-communications' },
    { item: 'Route guard',                            state: 'Verified', note: 'OmniCommsAdminRoute checks omni_comms.view' },
    { item: 'Permission capability registration',     state: 'Verified', note: 'Six omni_comms.* keys in the shared permission registry' },
    { item: 'DB-driven navigation',                   state: 'Verified', note: 'Menu entry seeded via app_modules (nav only)' },
    { item: 'Architecture README',                    state: 'Verified', note: 'src/platform/omni-comms/README.md' },
    { item: 'Readiness page',                         state: 'Verified', note: 'Source-controlled data only' },
    { item: 'Object registry',                        state: 'Verified', note: 'Story 3 — 19 approved objects, 2 deferred' },
    { item: 'Route / integration / queue registries', state: 'Verified', note: 'Story 3 — 7 routes, 7 integrations, 5 queues' },
    { item: 'Architecture-boundary CI tests',         state: 'Verified', note: 'Story 4 — 10 rules enforced locally and in pull-request CI' },
    { item: 'Communication business tables',          state: 'In progress', note: 'omni_comms_event_definition and omni_comms_event_contract physical schema available (Epic 2 Story 1); remaining 17 planned.' },
    { item: 'sendCommunication façade',               state: 'Planned',  note: 'Planned for Epic 7' },
    { item: 'Provider integrations',                  state: 'Planned',  note: 'Planned for Epic 9' },
    { item: 'Runtime worker',                         state: 'Planned',  note: 'Planned for Epic 8' },
    { item: 'First business event',                   state: 'Blocked',  note: 'Blocked until Epic 11 evidence is approved' },
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
    epic: 'Epic 2',
    story: 'Story 2',
    title: 'Event Catalogue Application Services',
    informationalOnly: true,
  },
};
