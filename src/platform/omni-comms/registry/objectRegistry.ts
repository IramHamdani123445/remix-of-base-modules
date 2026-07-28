/**
 * Omnichannel Communications — Object Registry.
 *
 * Source-controlled catalogue of the 19 approved logical database objects
 * plus 2 deferred attachment objects. Metadata only — no table exists
 * merely because its name appears here.
 */

import type {
  OmniCommsDeferredObjectEntry,
  OmniCommsObjectEntry,
} from './registry.types';

const CFG_WRITE = 'authorised Omni-Comms application services';
const CFG_READ = 'authorised admin server APIs (configuration)';
const RUNTIME_READ = 'authorised operations server APIs (runtime)';
const NO_BROWSER = 'browser clients never write directly';

export const OMNI_COMMS_OBJECT_REGISTRY: readonly OmniCommsObjectEntry[] = [
  // ─────────── Events & content ───────────
  {
    name: 'omni_comms_event_definition',
    objectType: 'table',
    category: 'events_content',
    purpose:
      'Canonical registry of business events that the new system may accept.',
    owningEpic: 2,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_event_contract',
    objectType: 'table',
    category: 'events_content',
    purpose:
      'Schema and validation contract per event definition (payload shape, required fields).',
    owningEpic: 2,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_template_family',
    objectType: 'table',
    category: 'events_content',
    purpose:
      'Logical template family (scope anchor: organisation | department | event).',
    owningEpic: 3,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_template_version',
    objectType: 'table',
    category: 'events_content',
    purpose:
      'Immutable versioned template body (per channel and locale) with approval state.',
    owningEpic: 3,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_event_route',
    objectType: 'table',
    category: 'events_content',
    purpose:
      'Channel planning per event: channel obligation, preference rule, activation.',
    owningEpic: 5,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },

  // ─────────── Channels, senders and preferences ───────────
  {
    name: 'omni_comms_provider',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose: 'Catalogue of supported delivery providers (e.g. Resend).',
    owningEpic: 4,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_provider_account',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose:
      'Tenant-scoped provider account references; secrets remain in the edge-function secret store.',
    owningEpic: 4,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_sender_identity',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose:
      'Approved sender identities (email address, SMS sender ID, WhatsApp number, push app).',
    owningEpic: 4,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_sender_provider_binding',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose:
      'Binds a sender identity to the provider account used to deliver on its behalf.',
    owningEpic: 4,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_channel_setting',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose:
      'Per-channel operational settings (rate limits, quiet hours, defaults).',
    owningEpic: 4,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: false,
  },
  {
    name: 'omni_comms_preference',
    objectType: 'table',
    category: 'channels_senders_preferences',
    purpose:
      'Recipient-scoped delivery preferences, opt-outs and channel suppressions.',
    owningEpic: 5,
    currentStatus: 'planned',
    writeAuthority: `${CFG_WRITE}; ${NO_BROWSER}`,
    readAuthority: CFG_READ,
    containsSensitiveData: true,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: false,
  },

  // ─────────── Runtime ───────────
  {
    name: 'omni_comms_request',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'Inbound send request received through the sendCommunication façade.',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `sendCommunication application service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: true,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_recipient',
    objectType: 'table',
    category: 'runtime',
    purpose: 'Per-request recipient row (resolved addressing per channel).',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `sendCommunication application service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: true,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_message',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'Concrete per-channel message derived from a request/recipient/template.',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `sendCommunication application service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: true,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_dispatch_job',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'Queued dispatch unit picked up by the dispatch worker for a message.',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `dispatch worker service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_delivery_attempt',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'One provider call attempt per dispatch job with response classification.',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `dispatch worker service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_message_event',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'Append-only lifecycle events for a message (queued, sent, delivered, failed, opened, etc.).',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `approved application and worker services (append-only); ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },
  {
    name: 'omni_comms_webhook_event',
    objectType: 'table',
    category: 'runtime',
    purpose:
      'Raw provider webhook events staged for classification and correlation.',
    owningEpic: 6,
    currentStatus: 'planned',
    writeAuthority: `webhook ingestion service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: true,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: true,
  },

  // ─────────── Bulk ───────────
  {
    name: 'omni_comms_batch',
    objectType: 'table',
    category: 'bulk',
    purpose:
      'Bulk campaign header grouping many requests originating from one operator action.',
    owningEpic: 13,
    currentStatus: 'planned',
    writeAuthority: `createCommunicationBatch application service; ${NO_BROWSER}`,
    readAuthority: RUNTIME_READ,
    containsSensitiveData: false,
    legacyDependency: 'none',
    requiredForFirstProductionSlice: false,
  },
] as const;

/**
 * Deferred objects — NOT counted in the 19-object active ceiling.
 * Recorded so their names remain reserved and cannot be re-used elsewhere.
 */
export const OMNI_COMMS_DEFERRED_OBJECTS: readonly OmniCommsDeferredObjectEntry[] = [
  {
    name: 'omni_comms_attachment',
    currentStatus: 'deferred',
    intendedEpic: 'Attachment epic',
    reasonDeferred:
      'Attachments are introduced only when a verified business event or channel requires immutable attachment handling.',
  },
  {
    name: 'omni_comms_message_attachment',
    currentStatus: 'deferred',
    intendedEpic: 'Attachment epic',
    reasonDeferred:
      'Attachments are introduced only when a verified business event or channel requires immutable attachment handling.',
  },
] as const;

export const OMNI_COMMS_ACTIVE_OBJECT_COUNT = OMNI_COMMS_OBJECT_REGISTRY.length;
