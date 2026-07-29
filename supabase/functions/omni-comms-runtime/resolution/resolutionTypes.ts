// Omni-Comms Runtime — Slice 2c-ii Batch B internal type surface.
// The RuntimeResolutionResult and its parts stay inside the Edge Function;
// only a bounded, PII-safe projection is returned to the caller.

export type Channel =
  | "email"
  | "sms"
  | "whatsapp"
  | "push"
  | "in_app"
  | "print";

export interface RuntimeValidationIssue {
  path: string;
  code: string;
}

/** Shape of the aggregate snapshot RPC returned by
 * `omni_comms_priv_runtime_resolution_snapshot`. Only fields the resolvers
 * actually read are declared; unknown fields are ignored, but structural
 * absence of these fields fails snapshot validation.
 */
export interface AggregateSnapshot {
  snapshot_at: string;
  organization_id: string;
  department_id: string | null;
  requested_channels: string[];
  event: {
    id: string;
    code: string;
    status: string;
    module_code?: string;
    entity_type?: string;
    communication_class?: string;
  } | null;
  event_contracts: Array<{
    id: string;
    event_definition_id: string;
    version_number: number;
    json_schema: unknown;
    checksum: string | null;
    status: string;
  }>;
  routes: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    event_definition_id: string;
    channel: string;
    is_required: boolean;
    is_enabled: boolean;
    priority: number;
    template_family_id: string | null;
    sender_identity_id: string | null;
    sender_resolution_policy?: string | null;
    preference_policy?: string | null;
    lifecycle_state: string;
  }>;
  channel_settings: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    channel: string;
    enabled: boolean;
    live_delivery_enabled: boolean;
  }>;
  template_families: Array<{
    id: string;
    code: string;
    scope_type: string;
    organization_id: string;
    department_id: string | null;
    event_definition_id: string | null;
    status: string;
  }>;
  template_versions: Array<{
    id: string;
    template_family_id: string;
    version_number: number;
    channel: string;
    locale: string;
    content: unknown;
    checksum: string;
    status: string;
    layout_selection_mode: string | null;
    layout_id: string | null;
    pinned_layout_version_id: string | null;
  }>;
  layouts: Array<{
    id: string;
    code: string;
    name: string;
    is_active: boolean;
    layout_kind?: string;
  }>;
  layout_versions: Array<{
    id: string;
    layout_id: string;
    version_number: number;
    slots: unknown;
    wrapper_html: string | null;
    checksum: string;
    status: string;
  }>;
  layout_assignments: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    output_channel: string | null;
    layout_id: string;
  }>;
  asset_assignments: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    output_channel: string | null;
    slot_code: string;
    asset_id: string;
  }>;
  assets: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    asset_type: string;
    code: string;
    status: string;
    active_version_id: string | null;
  }>;
  asset_versions: Array<{
    id: string;
    asset_id: string;
    version_number: number;
    checksum: string;
    status: string;
  }>;
  senders: Array<{
    id: string;
    organization_id: string;
    department_id: string | null;
    event_definition_id: string | null;
    code: string;
    channel: string;
    from_address: string | null;
    from_name: string | null;
    reply_to_address: string | null;
    status: string;
  }>;
  bindings: Array<{
    id: string;
    sender_identity_id: string;
    provider_account_id: string;
    priority: number;
    verification_status: string;
    status: string;
  }>;
  provider_accounts: Array<{
    id: string;
    organization_id: string;
    provider_id: string;
    code: string;
    status: string;
    health_state: string | null;
    sandbox_mode: boolean | null;
    secret_reference_configured: boolean;
  }>;
  providers: Array<{
    id: string;
    code: string;
    display_name: string;
    channel: string;
    adapter_key: string;
    status: string;
  }>;
}

export interface RecipientInput {
  recipientType?: "person" | "organization" | "role" | string;
  recipientReference?: string;
  displayName?: string;
  locale?: string;
  destinations?: Partial<{
    email: string;
    phone: string;
    push: string;
    inApp: string;
    print: string;
  }>;
}

export interface NormalizedRecipient {
  inputIndex: number;
  fingerprint: string;
  recipientType: string;
  recipientReference: string | null;
  displayName: string | null;
  normalizedLocale: string;
  localeFallbackCandidates: string[];
  normalizedDestinations: Record<string, string | null>;
  blockers: string[];
}

export interface ResolvedAsset {
  slot: string;
  required: boolean;
  assetId: string;
  assetVersionId: string;
  assetType: string;
  assetChecksum: string;
  inheritanceSource: "department" | "organization";
}

export interface ChannelResolution {
  channel: string;
  eventRouteId: string;
  isRequired: boolean;
  templateFamilyId?: string;
  templateFamilyScope?: "route_pinned" | "event" | "department" | "organization";
  templateVersionId?: string;
  templateVersionChecksum?: string;
  templateVersionNumber?: number;
  layoutId?: string;
  layoutVersionId?: string;
  layoutInheritance?: "pinned" | "department" | "organization";
  layoutChecksum?: string;
  assets: ResolvedAsset[];
  senderIdentityId?: string;
  senderProviderBindingId?: string;
  providerId?: string;
  providerAccountId?: string;
  senderChannelReady: boolean;
  liveDeliveryReady: boolean;
  blockers: string[];
}

export interface RuntimeRecipientResolution {
  inputIndex: number;
  fingerprint: string;
  recipientType: string;
  recipientReference: string | null;
  displayName: string | null;
  normalizedLocale: string;
  normalizedDestinations: Record<string, string | null>;
  resolvedChannels: string[];
  blockers: string[];
  channelResolutions: ChannelResolution[];
}

export interface RuntimeResolutionResult {
  event: {
    eventDefinitionId: string;
    eventContractId: string;
    eventContractVersion: number;
    eventContractChecksum: string;
  };
  requestedChannels: string[];
  recipients: RuntimeRecipientResolution[];
  blockers: string[];
}

/** Bounded, PII-safe projection returned to the outer caller. */
export interface PublicRecipientProjection {
  inputIndex: number;
  recipientReference: string | null;
  eligibilityStatus: "eligible" | "partially_eligible" | "blocked" | "invalid";
  resolvedChannels: string[];
  blockers: string[];
}
