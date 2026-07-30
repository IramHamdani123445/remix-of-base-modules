/**
 * Omni-Comms — Phase 4 Guided Configuration Setup Wizard: RPC contract types.
 *
 * Pure type declarations mirroring the single bounded read-only aggregate
 * RPC `public.omni_comms_setup_readiness`. No Supabase client, no React,
 * no Legacy Communication Hub references.
 */

export type SetupBlockerSeverity = 'blocker' | 'warning';

export type SetupStepId =
  | 'tenant'
  | 'event'
  | 'contract'
  | 'route'
  | 'template_family'
  | 'template_version'
  | 'layout'
  | 'assets'
  | 'provider'
  | 'provider_account'
  | 'sender'
  | 'binding'
  | 'channel_setting'
  | 'runtime';

/** Canonical ordered step list. Exactly fourteen guided steps. */
export const OMNI_COMMS_SETUP_STEP_IDS: readonly SetupStepId[] = [
  'tenant',
  'event',
  'contract',
  'route',
  'template_family',
  'template_version',
  'layout',
  'assets',
  'provider',
  'provider_account',
  'sender',
  'binding',
  'channel_setting',
  'runtime',
] as const;

export interface SetupBlocker {
  code: string;
  step: SetupStepId;
  severity: SetupBlockerSeverity;
  message: string;
}

export interface SetupTenantSection {
  organization_id: string;
  department_id: string | null;
  scope: 'organization_wide' | 'department';
  capabilities: Record<string, 'granted' | 'not_granted'>;
  sensitive_content_visible: boolean;
}

export interface SetupEventSection {
  present: boolean;
  id?: string;
  code?: string;
  name?: string;
  module_code?: string;
  entity_type?: string;
  communication_class?: string;
  default_priority?: string;
  status?: string;
}

export interface SetupContractSection {
  present: boolean;
  id?: string;
  version_number?: number;
  status?: string;
  checksum?: string | null;
  published_at?: string | null;
  sample_payload_present?: boolean;
  required_fields?: string[];
}

export interface SetupRouteSection {
  present: boolean;
  source: 'department' | 'organization' | 'unresolved';
  id?: string;
  lifecycle_state?: string;
  is_enabled?: boolean;
  is_required?: boolean;
  priority?: number;
  preference_policy?: string;
  sender_resolution_policy?: string;
  template_family_id?: string | null;
  sender_identity_id?: string | null;
}

export interface SetupTemplateFamilySection {
  present: boolean;
  id?: string;
  code?: string;
  name?: string;
  scope_type?: string;
  status?: string;
}

export interface SetupTemplateVersionSection {
  present: boolean;
  id?: string;
  version_number?: number;
  status?: string;
  channel?: string;
  locale?: string;
  checksum?: string | null;
  published_at?: string | null;
  layout_selection_mode?: string | null;
}

export interface SetupLayoutSection {
  present: boolean;
  layout_id?: string | null;
  layout_code?: string | null;
  layout_version_id?: string | null;
  layout_version_number?: number | null;
  layout_checksum?: string | null;
  inheritance_source?: string | null;
  slot_count?: number;
}

export interface SetupAssetSlot {
  slot_code: string;
  asset_id: string | null;
  asset_version_id: string | null;
  asset_type: string | null;
  checksum: string | null;
  inheritance_source: string | null;
  state: 'resolved' | 'unresolved';
}

export interface SetupAssetsSection {
  slots: SetupAssetSlot[];
  unresolved_required: number;
}

export interface SetupProviderSection {
  present: boolean;
  id?: string;
  code?: string;
  display_name?: string;
  adapter_key?: string;
  status?: string;
}

export interface SetupProviderAccountSection {
  present: boolean;
  id?: string;
  code?: string;
  display_name?: string;
  status?: string;
  region?: string | null;
  sandbox_mode?: boolean;
  health_state?: string;
  health_checked_at?: string | null;
  credential_check_recorded?: boolean;
}

export interface SetupSenderSection {
  present: boolean;
  id?: string;
  code?: string;
  display_name?: string;
  status?: string;
  /** Already masked server-side unless the caller holds sensitive access. */
  from_address_display?: string | null;
  from_address_masked?: boolean;
  scope?: 'event' | 'department' | 'organization';
}

export interface SetupBindingSection {
  present: boolean;
  id?: string;
  status?: string;
  verification_status?: string;
  verified_at?: string | null;
  priority?: number;
  provider_account_id?: string;
}

export interface SetupChannelSettingSection {
  present: boolean;
  id?: string;
  scope?: 'organization' | 'department';
  enabled?: boolean;
  live_delivery_enabled?: boolean;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  quiet_hours_timezone?: string | null;
  per_minute_limit?: number | null;
}

export interface SetupRuntimeSection {
  tables: Record<string, boolean>;
  functions: Record<string, boolean>;
  implementation_complete: boolean;
  live_dispatch_implemented: boolean;
  certification: {
    resolution: string;
    rendering: string;
    overall: string;
  };
}

export interface SetupReadinessPayload {
  organization_id: string;
  department_id: string | null;
  channel: 'email';
  locale: string;
  generated_at: string;
  tenant: SetupTenantSection;
  event: SetupEventSection;
  contract: SetupContractSection;
  route: SetupRouteSection;
  template_family: SetupTemplateFamilySection;
  template_version: SetupTemplateVersionSection;
  layout: SetupLayoutSection;
  assets: SetupAssetsSection;
  provider: SetupProviderSection;
  provider_account: SetupProviderAccountSection;
  sender: SetupSenderSection;
  binding: SetupBindingSection;
  channel_setting: SetupChannelSettingSection;
  runtime: SetupRuntimeSection;
  blockers: SetupBlocker[];
  dry_run_ready: boolean;
  live_send_ready: boolean;
}

// ─── Derived, presentation-facing plan ───────────────────────────────────

export type SetupStepState =
  | 'complete'
  | 'attention'
  | 'incomplete'
  | 'not_started';

export interface SetupStepTarget {
  /** Always one of the seven permanent Omni-Comms admin routes. */
  route: string;
  /** Optional query string appended to the permanent route (tab/panel). */
  query?: string;
  label: string;
}

export interface SetupStep {
  id: SetupStepId;
  /** 1-based position in the guided sequence. */
  index: number;
  title: string;
  purpose: string;
  state: SetupStepState;
  evidence: string[];
  blockers: SetupBlocker[];
  warnings: SetupBlocker[];
  target: SetupStepTarget | null;
}

export interface SetupPlan {
  steps: SetupStep[];
  totalSteps: number;
  completedSteps: number;
  /** First step that is not complete, or null when the path is complete. */
  nextRequiredStep: SetupStep | null;
  blockers: SetupBlocker[];
  warnings: SetupBlocker[];
  dryRunReady: boolean;
  liveSendReady: boolean;
  generatedAt: string;
}

export type SetupErrorKind =
  | 'permission_denied'
  | 'tenant_unavailable'
  | 'not_found'
  | 'rpc_unavailable'
  | 'timed_out'
  | 'unknown';

export interface SetupError {
  kind: SetupErrorKind;
  message: string;
  retryable: boolean;
}
