/**
 * Omni-Comms — Reserved queue registry (5 queues).
 *
 * Reserves logical queue / topic names. Nothing is provisioned. Business
 * modules must never publish to any of these names directly; only future
 * server-side Omni-Comms code paths may enqueue work.
 */
import type { QueueRegistryEntry } from './registry.types';

export const OMNI_COMMS_QUEUE_REGISTRY: readonly QueueRegistryEntry[] = [
  {
    name: 'omni-comms.transactional',
    deliveryClass: 'transactional',
    purpose: 'Low-latency, per-event transactional sends.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms.bulk',
    deliveryClass: 'bulk',
    purpose: 'Batch/mass sends with lower priority.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms.webhook',
    deliveryClass: 'webhook',
    purpose: 'Inbound provider webhook processing.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms.retry',
    deliveryClass: 'retry',
    purpose: 'Delayed retries for transient provider failures.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms.dead-letter',
    deliveryClass: 'dead_letter',
    purpose: 'Terminal-failure sink for operator triage.',
    status: 'Reserved',
  },
] as const;

export const OMNI_COMMS_QUEUE_COUNT = OMNI_COMMS_QUEUE_REGISTRY.length;
