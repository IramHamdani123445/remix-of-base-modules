/**
 * Omnichannel Communications — Readiness Manifest
 *
 * SOURCE-CONTROLLED architecture and implementation-readiness data for the
 * new parallel Omnichannel Communications system.
 *
 * Every value in this file is a factual architecture decision or a static
 * implementation status. Nothing here is fetched at runtime. This file MUST
 * NOT read from the database, communication runtime tables, providers,
 * queues, Legacy Communication Hub, or any monitoring source.
 *
 * Updated per story. Story 2: introduces the Readiness page consumer.
 */

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

export interface PlannedObjects {
  eventsAndContent: string[];
  channelsSendersPreferences: string[];
  runtime: string[];
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

export interface OmniCommsReadinessManifest {
  systemIdentity: SystemIdentity;
  legacyIsolation: { rules: string[] };
  permanentRoutes: PermanentRoute[];
  capabilities: CapabilityEntry[];
  plannedObjects: PlannedObjects;
  reservedEdgeFunctions: string[];
  reservedQueues: string[];
  foundationStatus: FoundationItem[];
  blockers: Blocker[];
  nextStep: NextStep;
}

export const OMNI_COMMS_READINESS_MANIFEST: OmniCommsReadinessManifest = {
  systemIdentity: {
    productName: 'Omnichannel Communications',
    systemType: 'Parallel replacement',
    sourceNamespace: 'src/platform/omni-comms',
    apiPrefix: '/api/omni-comms',
    adminPrefix: '/admin/omnichannel-communications',
    dbPrefix: 'omni_comms_',
    queuePrefix: 'omni-comms.',
    currentEpic: 'Epic 1',
    currentStory: 'Story 2',
    overallStatus: 'Foundation',
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

  permanentRoutes: [
    { path: '/admin/omnichannel-communications',              label: 'Overview',    state: 'Available' },
    { path: '/admin/omnichannel-communications/operations',   label: 'Operations',  state: 'Not implemented' },
    { path: '/admin/omnichannel-communications/events',       label: 'Events',      state: 'Not implemented' },
    { path: '/admin/omnichannel-communications/templates',    label: 'Templates',   state: 'Not implemented' },
    { path: '/admin/omnichannel-communications/channels',     label: 'Channels',    state: 'Not implemented' },
    { path: '/admin/omnichannel-communications/preferences',  label: 'Preferences', state: 'Not implemented' },
    { path: '/admin/omnichannel-communications/health',       label: 'Health',      state: 'Available' },
  ],

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

  plannedObjects: {
    eventsAndContent: [
      'omni_comms_event_definition',
      'omni_comms_event_contract',
      'omni_comms_template_family',
      'omni_comms_template_version',
      'omni_comms_event_route',
    ],
    channelsSendersPreferences: [
      'omni_comms_provider',
      'omni_comms_provider_account',
      'omni_comms_sender_identity',
      'omni_comms_sender_provider_binding',
      'omni_comms_channel_setting',
      'omni_comms_preference',
    ],
    runtime: [
      'omni_comms_batch',
      'omni_comms_request',
      'omni_comms_recipient',
      'omni_comms_message',
      'omni_comms_dispatch_job',
      'omni_comms_delivery_attempt',
      'omni_comms_message_event',
      'omni_comms_webhook_event',
    ],
    note:
      'This is the APPROVED CEILING of logical database objects for the new system. It is not an instruction to create all 19 objects now. None of these tables exist and none are queried by this page.',
  },

  reservedEdgeFunctions: [
    'omni-comms-send',
    'omni-comms-dispatch',
    'omni-comms-webhook-resend',
  ],

  reservedQueues: [
    'omni-comms.transactional',
    'omni-comms.retry',
    'omni-comms.dead-letter',
    'omni-comms.webhook',
    'omni-comms.bulk',
  ],

  foundationStatus: [
    { item: 'Isolated source namespace',              state: 'Verified', note: 'src/platform/omni-comms' },
    { item: 'Permanent route shell',                  state: 'Verified', note: 'Seven routes registered under /admin/omnichannel-communications' },
    { item: 'Route guard',                            state: 'Verified', note: 'OmniCommsAdminRoute checks omni_comms.view' },
    { item: 'Permission capability registration',     state: 'Verified', note: 'Six omni_comms.* keys in the shared permission registry' },
    { item: 'DB-driven navigation',                   state: 'Verified', note: 'Menu entry seeded via app_modules (nav only)' },
    { item: 'Architecture README',                    state: 'Verified', note: 'src/platform/omni-comms/README.md' },
    { item: 'Readiness page',                         state: 'Verified', note: 'This page — source-controlled data only' },
    { item: 'Object registry',                        state: 'Planned',  note: 'Planned for Story 3' },
    { item: 'Architecture-boundary CI tests',         state: 'Planned',  note: 'Planned for Story 4' },
    { item: 'Communication business tables',          state: 'Planned',  note: 'None created; ceiling defined only' },
    { item: 'sendCommunication façade',               state: 'Planned',  note: 'Planned for Epic 7' },
    { item: 'Provider integrations',                  state: 'Planned',  note: 'Planned for Epic 9' },
    { item: 'Runtime worker',                         state: 'Planned',  note: 'Planned alongside runtime tables' },
    { item: 'First business event',                   state: 'Blocked',  note: 'Blocked until event-selection evidence is approved (Epic 11)' },
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
    epic: 'Epic 1',
    story: 'Story 3',
    title: 'Object, route, edge-function and queue registries',
    informationalOnly: true,
  },
};
