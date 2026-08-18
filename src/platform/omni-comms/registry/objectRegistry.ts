/**
 * Omni-Comms — Approved logical object catalogue (31 logical groups: the 19 foundation objects, the caller-module authorisation registry, the runtime-environment configuration record, the two Channels C2 generic provider-account objects, the two Channels C3B channel-endpoint objects, and the two Channels C6 release-control objects).
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
    name: 'omni_comms_test_recipient',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Approved recipients a controlled test delivery is permitted to reach. Governs the test allowlist only; never used by business dispatch.',
    status: 'AVAILABLE',
    introductionStory: 'Provider Administration — controlled test recipients',
  },
  {
    name: 'omni_comms_domain_verification',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'How a sending domain was verified with the external provider, together with the DNS evidence the trusted server observed. An operator claim alone never marks a domain verified.',
    status: 'AVAILABLE',
    introductionStory: 'Provider Administration — external domain verification',
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
    name: 'omni_comms_runtime_environment_event',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Append-only audit of trusted runtime-environment confirmations (who confirmed, from/to classification, reason and bounded evidence). It enables no delivery and certifies no commit.',
    status: 'AVAILABLE',
    introductionStory: 'Production Release Control — environment authority',
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
    name: 'omni_comms_channel_release_control',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Mutable per-scope release governance record: release state, permitted events, caller modules, modes, masked pilot recipients, volume and time restrictions, proposal and approval segregation, and the certified-commit binding. Never enables live delivery.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C6 — Release control and controlled-pilot governance',
  },
  {
    name: 'omni_comms_channel_release_event',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc_or_service_role',
    purpose:
      'Append-only release governance ledger recording every proposal, cancellation, approval, activation, suspension, expiry and gate denial with the release version, fingerprint and certified commit at the time of the event.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C6 — Release control and controlled-pilot governance',
  },
  {
    name: 'omni_comms_webhook_event',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Deduplicated, signature-verified inbound provider callback ledger. Stores only a bounded payload summary and a SHA-256 payload digest, never raw provider bodies or headers.',
    status: 'AVAILABLE',
    introductionStory: 'Channels C7 — Controlled business Email dispatch',

  },
  {
    name: 'omni_comms_module_sender_profile',
    category: 'channels_senders_preferences',
    epic: 4,
    writeAuthority: 'admin_rpc',
    purpose:
      'Authorised sender-profile assignments for an Omni-Comms caller/business module: which sender addresses a module may use on a channel, which one is its default, and whether event-level override or organisation fallback is permitted. Configuration governance only — never consulted at send time.',
    status: 'AVAILABLE',
    introductionStory: 'Module Sender Profiles — module → sender assignment layer',
  },
  {
    name: 'omni_comms_scheduler_run',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Append-only evidence ledger of automatic dispatch scheduler ticks: when the scheduled boundary ran, how many live-authorised jobs were scanned and claimed, and the bounded blocker code when nothing was eligible. Records no recipient data and never calls a provider.',
    status: 'AVAILABLE',
    introductionStory: 'Benefits Live — automatic dispatch scheduler',
  },
  {
    name: 'omni_comms_scheduler_ticket',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Single-use, short-expiry nonce minted by the database scheduler to authenticate a scheduled server-to-server invocation of the canonical Edge dispatcher. Consumed atomically; never mintable or readable from a browser.',
    status: 'AVAILABLE',
    introductionStory: 'Benefits Live — automatic dispatch scheduler',
  },
  {
    name: 'omni_comms_product_communication_config',
    category: 'events_and_content',
    epic: 5,
    writeAuthority: 'admin_rpc',
    purpose:
      'Per business-product communication configuration for a registered Omni-Comms event: whether the channel obligation is enabled, and the template, sender profile, recipient source and delivery mode the producer must resolve. Configuration only — never enables delivery on its own.',
    status: 'AVAILABLE',
    introductionStory: 'Benefits Live — Product Definition communications',
  },
  {
    name: 'omni_comms_product_communication_audit',
    category: 'events_and_content',
    epic: 5,
    writeAuthority: 'admin_rpc',
    purpose:
      'Append-only change ledger for per-product communication configuration. Every enable, disable, template, sender, recipient-source or mode change is recorded with the acting operator, the before and after values and the reason. Written only by the configuration RPC; never writable from a browser.',
    status: 'AVAILABLE',
    introductionStory: 'Benefits Live — Product Definition communications',
  },
  {
    name: 'omni_comms_presentation_assignment_audit',
    category: 'events_and_content',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Append-only history of branding and layout assignment changes: which layout or shared asset was set, removed or replaced, at which scope (organisation, module, department x module, module x event, department x module x event), by whom and with the previous value. Presentation configuration only — never message content.',
    status: 'AVAILABLE',
    introductionStory: 'Enterprise template, branding and inheritance consolidation',
  },
  {
    name: 'omni_comms_business_object',
    category: 'events_and_content',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Governed business-object classification metadata (module code, business object code, display name, display order) used to present the template catalogue as Module → Business Object → Event → Communication Action. Presentation classification only — never message content, never a second template store.',
    status: 'AVAILABLE',
    introductionStory: 'Business-oriented template workspace and navigation consolidation',
  },
  {
    name: 'omni_comms_business_event_outbox',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'service_role_only',
    purpose:
      'Durable business-event outbox. A business module records its communication obligation inside its own database transaction, so the obligation can never be lost when the browser closes or the network fails. The ingest worker drains it server-side into the canonical runtime; a browser can never write to it.',
    status: 'AVAILABLE',
    introductionStory: 'Benefits Live — durable business integration',
  },

  {
    name: 'omni_comms_print_item',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'One physical fulfilment record per Print/Correspondence message: letter reference, recipient reference, postal destination snapshot, artefact provenance (path, checksum, pages) and the governed physical production status. Producing the artefact is not printing.',
    status: 'AVAILABLE',
    introductionStory: 'Print Phase 3A — physical production foundation',
  },
  {
    name: 'omni_comms_print_attempt',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Append-only record of every physical paper-production attempt for a print item: attempt number, production account, operator, equipment reference, timings, outcome and failure or spoil reason. Earlier attempts are never overwritten.',
    status: 'AVAILABLE',
    introductionStory: 'Print Phase 3A — physical production foundation',
  },
  {
    name: 'omni_comms_print_batch',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Governed production run grouping compatible print items: batch reference, production account, frozen production-profile signature and snapshot, lifecycle status (draft, ready, locked, in production, reconciling, completed, cancelled) and governed override or cancellation reasons. A batch is an operational grouping only — it never creates a communication or artefact and never means dispatched or delivered.',
    status: 'AVAILABLE',
    introductionStory: 'Print Phase 3B — governed print batches and reconciliation',
  },
  {
    name: 'omni_comms_print_batch_item',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Membership of a print item in a print batch, preserving history: when it joined, whether it was removed before lock or deliberately deferred out of the run, and the governed reason. Reconciliation counts are derived from this membership plus current item state plus immutable print attempts, never from an editable counter.',
    status: 'AVAILABLE',
    introductionStory: 'Print Phase 3B — governed print batches and reconciliation',
  },



  {
    name: 'omni_comms_print_dispatch',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Physical dispatch evidence for a produced print item: the postal destination actually used, dispatch method, carrier/tracking reference, dispatch cost, dispatching operator and timestamps, plus any returned-undelivered outcome. It records what physically left the building; it never produces an artefact and never decides a channel.',
    status: 'AVAILABLE',
    introductionStory: 'Print dispatch tracking — physical fulfilment evidence',
  },

  {
    name: 'omni_comms_print_equipment',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Tenant register of physical production equipment (print-room printers, multi-function devices, mail inserters and outsourced bureaux): device code, name, location, capability and lifecycle status. Every physical print attempt is bound to a registered active device, so "equipment reference" is evidence rather than free text. Registering a device never sends, prints or dispatches anything.',
    status: 'AVAILABLE',
    introductionStory: 'Print equipment register — traceable physical production',
  },

  {
    name: 'omni_comms_print_discovery_source',
    category: 'runtime',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Registered network print server or print agent that reports its available print queues so the equipment register can be kept in step automatically. Holds the secure endpoint, mode, owning department/production account and the last sync outcome. Discovery only names devices; it never sends, prints or dispatches anything.',
    status: 'AVAILABLE',
    introductionStory: 'Print equipment register — network discovery',
  },




  {
    name: 'omni_comms_communication_action',
    category: 'channels_senders_preferences',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Communication obligation for a business event and recipient role (for example "issue formal notice"). Declares whether the action is required or optional and how it is satisfied. Channels are chosen to satisfy the action; the action itself is channel-neutral.',
    status: 'AVAILABLE',
    introductionStory: 'Communication Action layer — channel-neutral obligations',
  },
  {
    name: 'omni_comms_action_channel_option',
    category: 'channels_senders_preferences',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Ranked channel that may satisfy a communication action, optionally bound to a template family and marked as a fallback. A channel is only selectable when a published template variant exists for that channel.',
    status: 'AVAILABLE',
    introductionStory: 'Communication Action layer — channel-neutral obligations',
  },
  {
    name: 'omni_comms_delivery_policy',
    category: 'channels_senders_preferences',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Versioned organisation or action level delivery policy: digital-first, paper-first or both, plus the conditions under which print remains required. Superseded versions are retired, never edited.',
    status: 'AVAILABLE',
    introductionStory: 'Communication Action layer — channel-neutral obligations',
  },
  {
    name: 'omni_comms_recipient_channel_preference',
    category: 'channels_senders_preferences',
    epic: 6,
    writeAuthority: 'admin_rpc',
    purpose:
      'Recipient-stated channel preference, opt-out or paper requirement with its source and evidence. Preferences narrow channel selection but never override a statutory requirement.',
    status: 'AVAILABLE',
    introductionStory: 'Communication Action layer — channel-neutral obligations',
  },

] as const;





export const OMNI_COMMS_OBJECT_COUNT = OMNI_COMMS_OBJECT_REGISTRY.length;
