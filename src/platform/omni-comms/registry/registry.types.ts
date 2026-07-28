/**
 * Omnichannel Communications — Registry shared types.
 *
 * Types used by objectRegistry, routeRegistry, integrationRegistry and
 * queueRegistry. Metadata only. Nothing here creates database objects,
 * routes, edge functions or queues.
 */

export type RegistryStatus =
  | 'planned'
  | 'reserved'
  | 'available'
  | 'verified'
  | 'deferred'
  | 'blocked'
  | 'retired';

export const ALLOWED_REGISTRY_STATUSES: readonly RegistryStatus[] = [
  'planned',
  'reserved',
  'available',
  'verified',
  'deferred',
  'blocked',
  'retired',
] as const;

/** Names that must never appear as permanent registry entry fragments. */
export const BANNED_NAME_FRAGMENTS: readonly string[] = [
  'advanced',
  'new',
  'next',
  'v2',
  'pilot',
  'controlled',
  'rehearsal',
  'standby',
  'phase',
] as const;

/** Forbidden loose status strings that must not appear in any registry field. */
export const FORBIDDEN_STATUS_WORDS: readonly string[] = [
  'live',
  'production-ready',
  'production_ready',
  'operational',
  'complete',
] as const;

export type ObjectCategory =
  | 'events_content'
  | 'channels_senders_preferences'
  | 'runtime'
  | 'bulk';

export interface OmniCommsObjectEntry {
  name: string;
  objectType: 'table';
  category: ObjectCategory;
  purpose: string;
  owningEpic: number;
  introductionStory?: string;
  currentStatus: RegistryStatus;
  writeAuthority: string;
  readAuthority: string;
  containsSensitiveData: boolean;
  legacyDependency: 'none';
  requiredForFirstProductionSlice: boolean;
  notes?: string;
}

export interface OmniCommsDeferredObjectEntry {
  name: string;
  currentStatus: 'deferred';
  intendedEpic: number | string;
  reasonDeferred: string;
}

export interface OmniCommsRouteEntry {
  routeId: string;
  path: string;
  label: string;
  requiredPermission: 'omni_comms.view';
  owningEpic: number;
  currentStatus: RegistryStatus;
  purpose: string;
  approvedTabs: string[];
  pageWrapperPath: string;
  moduleViewPath: string;
}

export type IntegrationType =
  | 'edge_function'
  | 'webhook_handler'
  | 'worker_entrypoint';

export interface OmniCommsIntegrationEntry {
  name: string;
  integrationType: IntegrationType;
  owningEpic: number | string;
  currentStatus: 'reserved';
  purpose: string;
  provider?: string;
  publicExposure: 'internal' | 'public_webhook';
  authenticationModel: string;
  notes?: string;
}

export type QueuePriorityClass =
  | 'transactional'
  | 'bulk'
  | 'webhook'
  | 'retry'
  | 'dead-letter';

export interface OmniCommsQueueEntry {
  name: string;
  purpose: string;
  owningEpic: number | string;
  currentStatus: 'reserved';
  priorityClass: QueuePriorityClass;
  producer: string;
  consumer: string;
  retryAllowed: boolean;
  notes?: string;
}

export interface RegistryValidationError {
  registry: 'object' | 'route' | 'integration' | 'queue';
  code: string;
  entryName?: string;
  message: string;
}
