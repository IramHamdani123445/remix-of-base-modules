/**
 * Omni-Comms — Integrations registry (8 entries).
 *
 * Reserves the external touchpoints the new system will use once
 * implementation begins. Nothing here is deployed, configured, or wired.
 * Shared-platform entries call out reused, existing infrastructure and are
 * not re-created under an omni-comms prefix.
 */
import type { IntegrationRegistryEntry } from './registry.types';

export const OMNI_COMMS_INTEGRATION_REGISTRY: readonly IntegrationRegistryEntry[] = [
  // Edge functions (4) — Omni-Comms-owned
  {
    name: 'omni-comms-runtime',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Trusted server boundary for sendCommunication(): authenticates callers, canonicalizes and fingerprints requests, and persists via the SECURITY DEFINER runtime RPC using service_role.',
    status: 'Available',
  },
  {
    name: 'omni-comms-dispatch',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Canonical controlled business Email dispatcher. The server selects eligible queued Email jobs; the claim transaction locks Release Control, revalidates every gate, reserves pilot volume and writes the delivery attempt before any provider call. Callers may supply only a bounded batch limit and a correlation identifier.',
    status: 'Available',
  },
  {
    name: 'omni-comms-webhook-resend',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Receives Svix-verified Resend delivery webhooks and records normalized callback evidence for business delivery attempts and approved technical test deliveries. Automatically suspends the controlled pilot on complaint or hard bounce.',
    status: 'Available',
  },
  {
    name: 'omni-comms-test-delivery',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Trusted server boundary for approved technical test delivery: authorises via RPC, dispatches through the shared Resend adapter using an Edge secret, and records the outcome. Cannot send business communications.',
    status: 'Available',
  },
  // Provider (1) — Omni-Comms-owned
  {
    name: 'resend',
    kind: 'provider',
    ownership: 'omni_comms',
    purpose: 'Sole initial email provider. Credentials live in Edge Function Secrets and are read by name only inside the shared server-only adapter, which is reachable solely from the approved test-delivery and controlled business dispatch boundaries.',
    status: 'Available',
  },

  {
    name: 'omni-comms-release-control',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Trusted approval boundary for controlled-pilot activation: verifies the second approver, matches the deployed revision against the certified commit server-side, and records the activation. Contacts no provider and sends nothing.',
    status: 'Available',
  },
  // Shared platform assets (3) — reused, not re-created
  {
    name: 'core-documents',
    kind: 'storage_bucket',
    ownership: 'shared_platform',
    purpose: 'Existing storage bucket for archived PDFs and print artefacts.',
    status: 'Reused',
  },
  {
    name: 'core_audit_log',
    kind: 'audit_sink',
    ownership: 'shared_platform',
    purpose: 'Existing audit sink for all Omni-Comms configuration and runtime events.',
    status: 'Reused',
  },
  {
    name: 'edge_function_secrets',
    kind: 'secret_vault',
    ownership: 'shared_platform',
    purpose: 'Existing secret vault for provider API keys and webhook signing secrets.',
    status: 'Reused',
  },
] as const;

export const OMNI_COMMS_INTEGRATION_COUNT = OMNI_COMMS_INTEGRATION_REGISTRY.length;
