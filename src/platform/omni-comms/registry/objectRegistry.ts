/**
 * Omni-Comms — Approved logical object catalogue (26 logical groups: the 19 foundation objects, the caller-module authorisation registry, the runtime-environment configuration record, the two Channels C2 generic provider-account objects, and the two Channels C3B channel-endpoint objects).
 *
 * This is the CEILING for the new system. No object listed here has been
 * created. This file does not create tables, policies, functions, or types.
 * It is a source-controlled architectural registry consumed by the
 * Readiness page and by CI boundary tests.
 */
import type { ObjectRegistryEntry } from './registry.types';

export const OMNI_COMMS_OBJECT_REGISTRY: readonly ObjectRegistryEntry[] = [
  // ─── Events and content ──────────────────────────────────────────────
  {
    name: 'omni_comms_event_definition',
    category: 'events_and_content',
    epic: 2,
    writeAuthority: 'admin_rpc',
    purpose: 'Canonical business-event catalogue keyed by MODULE.ENTITY.ACTION.',
    status: 'AVAILABLE',
    introductionStory: 'Epic 2 — Story 1',
  },
  {
    name: 'omni_comms_event_contract',
    category: 'events_and_content',
    epic: 2,
    writeAuthority: 'admin_rpc',
    purpose: 'Payload schema and required tokens for a business event.',
    status: 'AVAILABLE',
    introductionStory: 'Epic 2 — Story 1',
  },
  {
    name: 'omni_comms_template_family',
    category: 'events_and_content',
    epic: 3,
    writeAuthority: 'admin_rpc',
    purpose: 'Template family anchoring the event → department → organisation cascade.',
    status: 'AVAILABLE',
    introductionStory: 'Epic 3 — Story 1',
  },
  {
    name: 'omni_comms_template_version',
    category: 'events_and_content',
    epic: 3,
    writeAuthority: 'admin_rpc',
    purpose: 'Versioned template body per channel and locale, with approval state.',
    status: 'AVAILABLE',
    introductionStory: 'Epic 3 — Story 1',
  },
  {
    name: 'omni_comms_event_route',
    category: 'events_and_content',
    epic: 2,
    writeAuthority: 'admin_rpc',
    purpose: 'Channel obligation, preference rule and activation for an event.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },

  // ─── Channels, senders and preferences ───────────────────────────────
  {
    name: 'omni_comms_provider',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose: 'Registered provider vendor (Resend is the only initial vendor).',
    status: 'AVAILABLE',
    introductionStory: 'Epic 4 — Story 1',
  },
  {
    name: 'omni_comms_provider_account',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose: 'Provider account holding non-secret metadata; secrets reside in the vault.',
    status: 'AVAILABLE',
    introductionStory: 'Epic 4 — Story 1',
  },
  {
    name: 'omni_comms_provider_credential_requirement',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Named credential purposes an installed provider adapter requires, with the accepted secret-reference pattern.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C2 — Generic provider accounts',
  },
  {
    name: 'omni_comms_provider_account_secret_ref',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Bounded secret REFERENCE names configured per provider account and credential purpose. Never holds credential values.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C2 — Generic provider accounts',
  },

  {
    name: 'omni_comms_channel_endpoint',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Provider-independent channel endpoint configuration: sending domains, callbacks, webhooks, internal realtime endpoints and print render services. Configuration only — no DNS, provider or callback call is made.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C3B — Domains and channel endpoints',
  },
  {
    name: 'omni_comms_channel_endpoint_secret_ref',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Bounded Edge secret REFERENCE names per endpoint and purpose (signing, verification, auth). Never holds credential values.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C3B — Domains and channel endpoints',
  },



  {
    name: 'omni_comms_sender_identity',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose: 'Verified sender identity (email address, SMS sender ID, WhatsApp number).',
    status: 'AVAILABLE',
    introductionStory: 'Epic 4 — Story 1',
  },
  {
    name: 'omni_comms_sender_provider_binding',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Generic channel binding: which provider account (and optional channel endpoint) an approved channel identity may be presented through, with priority for future same-channel fallback and provider-controlled verification evidence. C4A adds no new table.',
    status: 'AVAILABLE',

    introductionStory: 'Epic 4 — Story 1',
  },
  {
    name: 'omni_comms_channel_setting',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose: 'Per-channel operational settings (enabled, rate limit, quiet hours).',
    status: 'AVAILABLE',
    introductionStory: 'Epic 4 — Story 1',
  },
  {
    name: 'omni_comms_preference',
    category: 'channels_senders_preferences',
    epic: 5,
    writeAuthority: 'admin_rpc',
    purpose: 'Recipient channel preferences and opt-out state.',
    status: 'PLANNED',
  },

  // ─── Runtime ─────────────────────────────────────────────────────────
  {
    name: 'omni_comms_batch',
    category: 'runtime',
    epic: 13,
    writeAuthority: 'service_role_only',
    purpose: 'Grouping record for bulk sends.',
    status: 'PLANNED',
  },
  {
    name: 'omni_comms_request',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'One row per sendCommunication() invocation with idempotency key.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_recipient',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'Resolved recipient(s) for a request, with channel eligibility snapshot.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_message',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'Per-recipient per-channel rendered message record.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_dispatch_job',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'Queue-visible dispatch job coordinating provider send attempts.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_delivery_attempt',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'One row per provider attempt with response code and latency.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_message_event',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'Lifecycle events for a message (queued, sent, delivered, opened, failed).',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Slice 1',
  },
  {
    name: 'omni_comms_caller_module_registry',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Maps a permitted caller module code to the business capability an actor must hold to submit communications on its behalf.',
    status: 'AVAILABLE',
    introductionStory: 'Accelerated Build 3 — Certification hardening',
  },
  {
    name: 'omni_comms_runtime_environment',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Singleton runtime-environment configuration record (unknown | non_production | production); the sole authoritative environment source for the certification posture.',
    status: 'AVAILABLE',
    introductionStory: 'Gate 3 — Path 2 runtime environment record',
  },
  {
    name: 'omni_comms_runtime_certification',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Singleton privileged certification record (pending | certified | failed, certified commit, workflow run, timestamp); the sole authoritative certification source for the certification posture.',
    status: 'AVAILABLE',
    introductionStory: 'Gate 3 — Protected certification record',
  },
  {
    name: 'omni_comms_producer_event_binding',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Explicitly authorises one registered business caller module to produce one event for an organisation and optional department, in a bounded set of modes (dry_run | shadow | queued).',
    status: 'AVAILABLE',
    introductionStory: 'Build 4A — Business producer integration',
  },
  {
    name: 'omni_comms_channel_test_run',
    category: 'runtime',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Immutable configuration-preflight evidence for a selected channel binding. Contains masked and hashed test input only and records no provider delivery.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C5A — Test Centre preflight',
  },
  {
    name: 'omni_comms_channel_test_delivery',
    category: 'runtime',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Immutable ledger of approved technical provider test deliveries. Rows are reserved by an operator RPC and completed by the trusted Edge boundary; it never records live business sending.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C5B — Controlled test delivery',
  },
  {
    name: 'omni_comms_channel_test_delivery_event',
    category: 'runtime',
    epic: 4,
    writeAuthority: 'service_role_only',
    purpose:
      'Verified provider callback evidence for approved test deliveries, deduplicated by provider event identifier.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C5B — Controlled test delivery',
  },
  {
    name: 'omni_comms_channel_test_delivery_attempt',
    category: 'runtime',
    epic: 4,
    writeAuthority: 'service_role_only',
    purpose:
      'Immutable per-attempt provider dispatch ledger for approved technical test deliveries. Each row records one atomic claim and its terminal outcome, including transport uncertainty, so a bounded retry can never hide a duplicate send.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C5B Closure — Retry-safe controlled delivery',
  },
  {
    name: 'omni_comms_webhook_event',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose: 'Raw inbound provider webhook payload, deduplicated and audited.',
    status: 'PLANNED',
  },
] as const;


export const OMNI_COMMS_OBJECT_COUNT = OMNI_COMMS_OBJECT_REGISTRY.length;
