/**
 * Omni-Comms — authoritative registry-derived counts.
 *
 * Single source of truth for "how big is the registry right now".
 * Tests and UI must read from here instead of duplicating literals, so that
 * adding a legitimate new Omni-Comms object never breaks historical story
 * tests that only care about the objects that story introduced.
 */
import { OMNI_COMMS_OBJECT_REGISTRY } from './objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from './deferredObjects';
import { OMNI_COMMS_ROUTE_REGISTRY } from './routeRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from './integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from './queueRegistry';

export interface OmniCommsRegistryCounts {
  activeObjects: number;
  deferredObjects: number;
  routes: number;
  integrations: number;
  queues: number;
}

export const OMNI_COMMS_REGISTRY_COUNTS: OmniCommsRegistryCounts = {
  activeObjects: OMNI_COMMS_OBJECT_REGISTRY.length,
  deferredObjects: OMNI_COMMS_DEFERRED_OBJECTS.length,
  routes: OMNI_COMMS_ROUTE_REGISTRY.length,
  integrations: OMNI_COMMS_INTEGRATION_REGISTRY.length,
  queues: OMNI_COMMS_QUEUE_REGISTRY.length,
};

/**
 * Runtime objects that are legitimately written through bounded admin RPCs
 * instead of the service role. Every entry is operator-driven governance or
 * physical production evidence — never a provider delivery record.
 */
export const OMNI_COMMS_ADMIN_RPC_RUNTIME_OBJECTS: ReadonlySet<string> = new Set([
  // C5A — configuration preflight evidence ledger.
  'omni_comms_channel_test_run',
  // C5B — operator-reserved approved technical test delivery.
  'omni_comms_channel_test_delivery',
  // Print Phase 3A — physical production foundation.
  'omni_comms_print_item',
  'omni_comms_print_attempt',
  // Print Phase 3B — governed print batches and reconciliation.
  'omni_comms_print_batch',
  'omni_comms_print_batch_item',
]);
