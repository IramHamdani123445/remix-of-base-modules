/**
 * Omni-Comms — Registry validation.
 *
 * Enforces the Story 3 invariants against the source-controlled registries.
 * Called by the Readiness page and by CI tests. Never touches the database,
 * runtime, providers, queues, edge functions, or Legacy code.
 */
import { OMNI_COMMS_OBJECT_REGISTRY } from './objectRegistry';
import { OMNI_COMMS_DEFERRED_OBJECTS } from './deferredObjects';
import { OMNI_COMMS_ROUTE_REGISTRY } from './routeRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from './integrationRegistry';
import { OMNI_COMMS_QUEUE_REGISTRY } from './queueRegistry';

export interface RegistryValidationResult {
  ok: boolean;
  counts: {
    activeObjects: number;
    deferredObjects: number;
    routes: number;
    integrations: number;
    queues: number;
  };
  errors: string[];
}

const APPROVED_EPICS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5, 6, 13]);
const ROUTE_PREFIX = '/admin/omnichannel-communications';
const OBJECT_PREFIX = 'omni_comms_';
const EDGE_PREFIX = 'omni-comms-';
const QUEUE_PREFIX = 'omni-comms.';

export function validateOmniCommsRegistries(): RegistryValidationResult {
  const errors: string[] = [];

  // Objects
  if (OMNI_COMMS_OBJECT_REGISTRY.length !== 20) {
    errors.push(`Object registry must contain 20 entries, found ${OMNI_COMMS_OBJECT_REGISTRY.length}.`);
  }
  const seenObjects = new Set<string>();
  for (const o of OMNI_COMMS_OBJECT_REGISTRY) {
    if (!o.name.startsWith(OBJECT_PREFIX)) errors.push(`Object ${o.name} missing ${OBJECT_PREFIX} prefix.`);
    if (seenObjects.has(o.name)) errors.push(`Duplicate object name ${o.name}.`);
    seenObjects.add(o.name);
    if (!APPROVED_EPICS.has(o.epic)) errors.push(`Object ${o.name} maps to unapproved epic ${o.epic}.`);
    if (o.status !== 'PLANNED' && o.status !== 'AVAILABLE') {
      errors.push(`Object ${o.name} has unknown status ${o.status}.`);
    }
    if (o.status === 'AVAILABLE' && !o.introductionStory) {
      errors.push(`Object ${o.name} is AVAILABLE but has no introductionStory.`);
    }
    if (o.category === 'runtime' && o.writeAuthority !== 'service_role_only') {
      errors.push(`Runtime object ${o.name} must be service_role_only.`);
    }
  }

  // Deferred
  if (OMNI_COMMS_DEFERRED_OBJECTS.length !== 2) {
    errors.push(`Deferred registry must contain 2 entries, found ${OMNI_COMMS_DEFERRED_OBJECTS.length}.`);
  }
  for (const d of OMNI_COMMS_DEFERRED_OBJECTS) {
    if (seenObjects.has(d.proposedName)) {
      errors.push(`Deferred object ${d.proposedName} conflicts with an approved object.`);
    }
  }

  // Routes
  if (OMNI_COMMS_ROUTE_REGISTRY.length !== 7) {
    errors.push(`Route registry must contain 7 entries, found ${OMNI_COMMS_ROUTE_REGISTRY.length}.`);
  }
  const seenRoutes = new Set<string>();
  for (const r of OMNI_COMMS_ROUTE_REGISTRY) {
    if (!r.path.startsWith(ROUTE_PREFIX)) errors.push(`Route ${r.path} missing ${ROUTE_PREFIX} prefix.`);
    if (seenRoutes.has(r.path)) errors.push(`Duplicate route ${r.path}.`);
    seenRoutes.add(r.path);
    if (r.requiredPermission !== 'omni_comms.view') {
      errors.push(`Route ${r.path} must require omni_comms.view.`);
    }
  }

  // Integrations
  if (OMNI_COMMS_INTEGRATION_REGISTRY.length !== 7) {
    errors.push(`Integration registry must contain 7 entries, found ${OMNI_COMMS_INTEGRATION_REGISTRY.length}.`);
  }
  const seenIntegrations = new Set<string>();
  for (const i of OMNI_COMMS_INTEGRATION_REGISTRY) {
    if (seenIntegrations.has(i.name)) errors.push(`Duplicate integration ${i.name}.`);
    seenIntegrations.add(i.name);
    if (i.kind === 'edge_function' && !i.name.startsWith(EDGE_PREFIX)) {
      errors.push(`Edge function ${i.name} missing ${EDGE_PREFIX} prefix.`);
    }
    if (i.ownership === 'omni_comms' && i.status !== 'Reserved' && i.status !== 'Available') {
      errors.push(`Omni-Comms integration ${i.name} must be Reserved or Available.`);
    }
    if (i.ownership === 'shared_platform' && i.status !== 'Reused') {
      errors.push(`Shared platform integration ${i.name} must be Reused.`);
    }
  }

  // Queues
  if (OMNI_COMMS_QUEUE_REGISTRY.length !== 5) {
    errors.push(`Queue registry must contain 5 entries, found ${OMNI_COMMS_QUEUE_REGISTRY.length}.`);
  }
  const seenQueues = new Set<string>();
  for (const q of OMNI_COMMS_QUEUE_REGISTRY) {
    if (!q.name.startsWith(QUEUE_PREFIX)) errors.push(`Queue ${q.name} missing ${QUEUE_PREFIX} prefix.`);
    if (seenQueues.has(q.name)) errors.push(`Duplicate queue ${q.name}.`);
    seenQueues.add(q.name);
    if (q.status !== 'Reserved') errors.push(`Queue ${q.name} must be Reserved.`);
  }

  return {
    ok: errors.length === 0,
    counts: {
      activeObjects: OMNI_COMMS_OBJECT_REGISTRY.length,
      deferredObjects: OMNI_COMMS_DEFERRED_OBJECTS.length,
      routes: OMNI_COMMS_ROUTE_REGISTRY.length,
      integrations: OMNI_COMMS_INTEGRATION_REGISTRY.length,
      queues: OMNI_COMMS_QUEUE_REGISTRY.length,
    },
    errors,
  };
}
