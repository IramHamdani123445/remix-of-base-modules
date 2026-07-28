/**
 * Omni-Comms — Reserved integrations registry (7 entries).
 *
 * Reserves the external touchpoints the new system will use once
 * implementation begins. Nothing here is deployed, configured, or wired.
 * Shared-platform entries call out reused, existing infrastructure and are
 * not re-created under an omni-comms prefix.
 */
import type { IntegrationRegistryEntry } from './registry.types';

export const OMNI_COMMS_INTEGRATION_REGISTRY: readonly IntegrationRegistryEntry[] = [
  // Edge functions (3) — Omni-Comms-owned
  {
    name: 'omni-comms-send',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Server entry point for sendCommunication(); persists request + recipients.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms-dispatch',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Drains dispatch jobs and calls the correct provider adapter.',
    status: 'Reserved',
  },
  {
    name: 'omni-comms-webhook-resend',
    kind: 'edge_function',
    ownership: 'omni_comms',
    purpose: 'Receives Resend delivery webhooks and updates message events.',
    status: 'Reserved',
  },
  // Provider (1) — Omni-Comms-owned
  {
    name: 'resend',
    kind: 'provider',
    ownership: 'omni_comms',
    purpose: 'Sole initial email provider. Credentials live in Edge Function Secrets.',
    status: 'Reserved',
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
