// Omni-Comms Runtime — Slice 2c-iii rendering type surface.
//
// Every type here describes an EXACT persisted Slice 2c-ii snapshot row.
// Nothing in this package resolves current configuration; it only consumes
// historical snapshot identifiers and the rows those identifiers point at.

/** Hard output bounds mirrored by the omni_comms_message CHECK constraints. */
export const RENDER_LIMITS = {
  subjectMaxChars: 998,
  htmlMaxBytes: 1048576,
  textMaxBytes: 262144,
} as const;

export interface TemplateSnapshot {
  id: string;
  template_family_id: string;
  version_number: number;
  channel: string;
  locale: string;
  checksum: string;
  status: string;
  content: Record<string, unknown>;
}

export interface LayoutSlotDefinition {
  code: string;
  order: number;
  required: boolean;
}

export interface LayoutSnapshot {
  id: string;
  layout_id: string;
  version_number: number;
  checksum: string;
  status: string;
  wrapper_html: string | null;
  slots: unknown;
}

export interface AssetVersionSnapshot {
  id: string;
  asset_id: string;
  version_number: number;
  checksum: string;
  status: string;
}

export interface SenderSnapshot {
  id: string;
  code: string;
  channel: string;
  from_address: string | null;
  from_name: string | null;
  reply_to_address: string | null;
  status: string;
  organization_id: string;
  department_id: string | null;
}

/** One `channel_resolutions[]` entry persisted by Slice 2c-ii. */
export interface PersistedChannelResolution {
  channel: string;
  route_id: string;
  template_family_id: string | null;
  template_version_id: string | null;
  template_version_checksum: string | null;
  layout_id: string | null;
  layout_version_id: string | null;
  layout_checksum: string | null;
  assets: Array<{
    slot: string;
    required: boolean;
    asset_id: string;
    asset_version_id: string;
    asset_type: string;
    asset_checksum: string;
    inheritance_source: string;
  }>;
  sender_identity_id: string | null;
  sender_provider_binding_id: string | null;
  provider_id: string | null;
  provider_account_id: string | null;
  sender_channel_ready: boolean;
  live_delivery_ready: boolean;
  blockers: string[];
}

export interface PersistedRecipient {
  id: string;
  recipient_type: string;
  recipient_reference: string | null;
  display_name: string | null;
  locale: string | null;
  destination_snapshot: Record<string, unknown>;
  eligibility_status: string;
  resolved_channels: string[];
  blockers: unknown;
  resolution_snapshot: {
    fingerprint?: string;
    input_index?: number;
    channel_resolutions?: PersistedChannelResolution[];
  };
}

/** Exact rows the render context RPC returns, keyed by snapshot identifier. */
export interface RenderContext {
  request: {
    id: string;
    organization_id: string;
    department_id: string | null;
    event_definition_id: string;
    mode: "dry_run" | "shadow" | "queued";
    status: string;
    payload_snapshot: Record<string, unknown>;
    correlation_id: string | null;
  };
  recipients: PersistedRecipient[];
  template_versions: TemplateSnapshot[];
  layout_versions: LayoutSnapshot[];
  asset_versions: AssetVersionSnapshot[];
  senders: SenderSnapshot[];
  channel_settings: Array<{
    id: string;
    channel: string;
    enabled: boolean;
    live_delivery_enabled: boolean;
    organization_id: string;
    department_id: string | null;
  }>;
}

export interface RenderedOutput {
  subject: string | null;
  html: string | null;
  text: string | null;
  unresolvedTokens: string[];
  unresolvedRequiredSlots: string[];
  checksum: string;
  blockers: string[];
}

/** Message row candidate handed to the atomic persistence RPC. */
export interface MessageCandidate {
  recipient_id: string;
  channel: string;
  event_route_id: string | null;
  template_family_id: string | null;
  template_version_id: string | null;
  layout_id: string | null;
  layout_version_id: string | null;
  resolved_asset_manifest: Record<string, unknown>;
  sender_identity_id: string | null;
  provider_id: string | null;
  provider_account_id: string | null;
  channel_setting_snapshot: Record<string, unknown>;
  destination_snapshot: Record<string, unknown>;
  rendered_subject: string | null;
  rendered_html: string | null;
  rendered_text: string | null;
  unresolved_tokens: string[];
  unresolved_required_slots: string[];
  rendered_checksum: string | null;
  status: "rendered" | "blocked";
  blockers: string[];
}
