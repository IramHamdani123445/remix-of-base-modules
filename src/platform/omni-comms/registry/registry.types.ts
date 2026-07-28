/**
 * Omni-Comms — shared registry types.
 *
 * Source-controlled, read-only architecture registries for the new parallel
 * Omnichannel Communications system. Nothing here is fetched at runtime and
 * nothing here creates DB objects, routes, edge functions, queues, or
 * provider integrations.
 */

export type ObjectCategory =
  | 'events_and_content'
  | 'channels_senders_preferences'
  | 'runtime';

export type ObjectStatus = 'PLANNED';

export type WriteAuthority =
  | 'admin_rpc'
  | 'service_role_only'
  | 'admin_rpc_or_service_role';

export interface ObjectRegistryEntry {
  /** Physical table name in the public schema. Always `omni_comms_` prefixed. */
  name: string;
  /** Logical grouping used for readiness reporting. */
  category: ObjectCategory;
  /** Approved epic that will introduce the object. */
  epic: 1 | 2 | 3 | 4 | 5 | 6 | 13;
  /** Write authority once the object exists. */
  writeAuthority: WriteAuthority;
  /** One-sentence purpose statement. */
  purpose: string;
  /** Always PLANNED for Epic 1. Nothing is created yet. */
  status: ObjectStatus;
}

export type DeferredReason =
  | 'reuses_shared_infrastructure'
  | 'superseded_by_approved_object';

export interface DeferredObjectEntry {
  /** Proposed name that was NOT approved. */
  proposedName: string;
  /** Why the object is not being created. */
  reason: DeferredReason;
  /** Existing shared asset or approved object that replaces it. */
  replacedBy: string;
  /** One-sentence explanation. */
  note: string;
}

export type RouteState = 'Available' | 'Placeholder' | 'Not implemented';

export interface RouteRegistryEntry {
  path: string;
  label: string;
  /** Thin page wrapper file under src/pages. */
  pageWrapper: string;
  /** Composition module under src/platform/omni-comms/admin/views. */
  moduleView: string;
  /** Permission key required by the guard. */
  requiredPermission: 'omni_comms.view';
  state: RouteState;
}

export type IntegrationKind =
  | 'edge_function'
  | 'provider'
  | 'storage_bucket'
  | 'audit_sink'
  | 'secret_vault';

export interface IntegrationRegistryEntry {
  /** Reserved logical name (edge function name, provider code, bucket id, etc.). */
  name: string;
  kind: IntegrationKind;
  /** Whether the integration is a new Omni-Comms asset or a shared/reused one. */
  ownership: 'omni_comms' | 'shared_platform';
  purpose: string;
  status: 'Reserved' | 'Reused';
}

export type QueueDeliveryClass =
  | 'transactional'
  | 'bulk'
  | 'webhook'
  | 'retry'
  | 'dead_letter';

export interface QueueRegistryEntry {
  /** Reserved queue / topic name. Always `omni-comms.` prefixed. */
  name: string;
  deliveryClass: QueueDeliveryClass;
  purpose: string;
  status: 'Reserved';
}
