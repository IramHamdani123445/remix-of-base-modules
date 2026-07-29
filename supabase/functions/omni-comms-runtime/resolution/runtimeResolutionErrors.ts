// Omni-Comms Runtime — Slice 2c-ii Batch B controlled blocker/error codes.
// These are the ONLY codes the Edge Function may propagate to a caller.
// Each maps to a bounded, structured meaning; never leak raw payloads or
// row values through error messages.

export const RUNTIME_ERROR_CODES = {
  // Snapshot / trust
  resolution_snapshot_invalid: "resolution_snapshot_invalid",
  runtime_persistence_failed: "runtime_persistence_failed",

  // Event / contract
  event_not_found: "event_not_found",
  event_not_active: "event_not_active",
  event_definition_ambiguous: "event_definition_ambiguous",
  event_contract_missing: "event_contract_missing",
  event_contract_ambiguous: "event_contract_ambiguous",
  event_contract_invalid: "event_contract_invalid",
  payload_schema_violation: "payload_schema_violation",

  // Route
  event_route_missing: "event_route_missing",
  event_route_channel_not_requested: "event_route_channel_not_requested",
  event_route_ownership_mismatch: "event_route_ownership_mismatch",

  // Recipient / destination
  recipient_input_invalid: "recipient_input_invalid",
  recipient_destination_missing: "recipient_destination_missing",
  recipient_destination_invalid: "recipient_destination_invalid",
  recipient_locale_invalid: "recipient_locale_invalid",

  // Channel eligibility
  channel_disabled: "channel_disabled",
  channel_setting_missing: "channel_setting_missing",

  // Template
  template_family_unresolved: "template_family_unresolved",
  template_version_unresolved: "template_version_unresolved",
  template_ambiguous: "template_ambiguous",

  // Layout
  layout_unresolved: "layout_unresolved",
  layout_version_unresolved: "layout_version_unresolved",
  layout_pinned_mismatch: "layout_pinned_mismatch",

  // Asset
  asset_slot_unresolved: "asset_slot_unresolved",
  asset_type_mismatch: "asset_type_mismatch",
  asset_version_unresolved: "asset_version_unresolved",

  // Sender / provider
  sender_unresolved: "sender_unresolved",
  sender_channel_mismatch: "sender_channel_mismatch",
  sender_ownership_mismatch: "sender_ownership_mismatch",
  sender_verification_pending: "sender_verification_pending",
  sender_provider_binding_unresolved: "sender_provider_binding_unresolved",
  provider_credentials_unavailable: "provider_credentials_unavailable",
  provider_inactive: "provider_inactive",
  provider_account_inactive: "provider_account_inactive",
  live_delivery_disabled: "live_delivery_disabled",

  // Pending pipeline stages
  runtime_rendering_pending: "runtime_rendering_pending",
} as const;

export type RuntimeErrorCode =
  typeof RUNTIME_ERROR_CODES[keyof typeof RUNTIME_ERROR_CODES];

export class RuntimeResolutionError extends Error {
  readonly code: RuntimeErrorCode;
  constructor(code: RuntimeErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}
