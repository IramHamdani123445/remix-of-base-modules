/**
 * Omni-Comms — Phase 3 Live Health Diagnostics types.
 *
 * These types describe LIVE environment state read through the four bounded
 * `omni_comms_health_*` SECURITY DEFINER RPCs plus one safe Edge health probe.
 * Nothing here describes source-controlled readiness — that remains the
 * Readiness tab's manifest.
 *
 * No secret material is modelled: there is no field for credential references, API keys,
 * tokens, authorization headers, destinations, or provider payloads.
 */

/** The only diagnostic states permitted anywhere in Live Diagnostics. */
export const DIAGNOSTIC_STATES = [
  'healthy',
  'ready',
  'configured',
  'partial',
  'blocked',
  'unavailable',
  'not_implemented',
  'not_certified',
  'unknown',
] as const;

export type DiagnosticState = (typeof DIAGNOSTIC_STATES)[number];

/** Permanent Omni-Comms admin routes usable as a diagnostic target screen. */
export const OMNI_COMMS_TARGET_SCREENS = {
  overview: '/admin/omnichannel-communications',
  operations: '/admin/omnichannel-communications/operations',
  events: '/admin/omnichannel-communications/events',
  templates: '/admin/omnichannel-communications/templates',
  channels: '/admin/omnichannel-communications/channels',
  preferences: '/admin/omnichannel-communications/preferences',
  health: '/admin/omnichannel-communications/health',
} as const;

export type TargetScreen =
  (typeof OMNI_COMMS_TARGET_SCREENS)[keyof typeof OMNI_COMMS_TARGET_SCREENS];

export interface DiagnosticRow {
  /** Stable diagnostic code, e.g. `EVT.PUBLISHED_CONTRACT`. */
  code: string;
  title: string;
  state: DiagnosticState;
  summary: string;
  /** ISO timestamp of the evidence that produced this row. */
  evidenceAt: string;
  /** Bounded, safe evidence strings (counts, statuses, availability). */
  evidence: string[];
  recommendedAction: string | null;
  targetScreen: TargetScreen | null;
}

export type DiagnosticCategoryCode =
  | 'tenant_permissions'
  | 'event_catalogue'
  | 'templates_assembly'
  | 'channel_configuration'
  | 'runtime_implementation'
  | 'runtime_data'
  | 'runtime_certification'
  | 'delivery_capability';

export interface DiagnosticCategory {
  code: DiagnosticCategoryCode;
  title: string;
  description: string;
  rows: DiagnosticRow[];
}

/** Deterministic posture precedence — index 0 wins. */
export const OVERALL_POSTURES = [
  'unavailable',
  'blocked',
  'configuration_incomplete',
  'ready_for_dry_run',
  'implementation_testing_only',
  'runtime_certified',
  'live_delivery_enabled',
] as const;

export type OverallPosture = (typeof OVERALL_POSTURES)[number];

export const OVERALL_POSTURE_LABELS: Record<OverallPosture, string> = {
  unavailable: 'Unavailable',
  blocked: 'Blocked',
  configuration_incomplete: 'Configuration incomplete',
  ready_for_dry_run: 'Ready for dry run',
  implementation_testing_only: 'Implementation testing only',
  runtime_certified: 'Runtime certified',
  live_delivery_enabled: 'Live delivery enabled',
};

export interface RecommendedAction {
  /** 1 = most urgent. */
  priority: number;
  title: string;
  reason: string;
  targetScreen: TargetScreen;
  blockingDiagnostic: string;
}

export type HealthErrorKind =
  | 'rpc_unavailable'
  | 'permission_denied'
  | 'tenant_unavailable'
  | 'timed_out'
  | 'edge_unavailable'
  | 'no_configuration'
  | 'no_runtime_data'
  | 'unknown';

export interface HealthError {
  kind: HealthErrorKind;
  /** Operator-safe message. Never a SQLSTATE, stack trace or table name. */
  message: string;
  retryable: boolean;
}

// ─── Raw RPC payloads ────────────────────────────────────────────────────

export type CapabilityState = 'granted' | 'not_granted' | 'unavailable';

export interface HealthPermissionsPayload {
  organization_id: string;
  department_id: string | null;
  department_scope: 'organization_wide' | 'department';
  tenant_lookup_available: boolean;
  capabilities: Record<string, CapabilityState>;
  generated_at: string;
}

export interface HealthCataloguePayload {
  organization_id: string;
  department_id: string | null;
  events: {
    event_definitions: number;
    event_definitions_active: number;
    published_contracts: number;
    events_without_published_contract: number;
    active_event_routes: number;
    events_without_active_route: number;
    department_route_overrides: number;
    routes_with_unavailable_template: number;
  };
  templates: {
    template_families: number;
    template_families_active: number;
    published_template_versions: number;
    families_without_published_version: number;
    templates_without_layout_selection: number;
  };
  assembly: {
    layouts: number;
    published_layout_versions: number;
    required_slots: number;
    resolved_assets: number;
    unresolved_required_assets: number;
  };
  generated_at: string;
}

export interface HealthRuntimeCounters {
  requests: number;
  recipients: number;
  messages: number;
  held_jobs: number;
  runnable_jobs: number;
  delivery_attempts: number;
  blocked_requests: number;
  processing_requests: number;
  completed_dry_runs: number;
  failed_requests: number;
  last_request_at: string | null;
}

export interface HealthRuntimePayload {
  organization_id: string;
  department_id: string | null;
  runtime_tables: Record<string, boolean>;
  runtime_functions: Record<string, boolean>;
  counters: HealthRuntimeCounters;
  live_delivery_enabled: boolean;
  runnable_queue_enabled: boolean;
  certification: {
    resolution: string;
    rendering: string;
    overall: string;
  };
  generated_at: string;
}

export interface HealthChannelsPayload {
  email_provider_registered: boolean;
  email_provider_active: boolean;
  provider_accounts: number;
  provider_accounts_active: number;
  provider_accounts_credentials_configured: number;
  provider_accounts_healthy: number;
  sender_identities: number;
  sender_identities_active: number;
  bindings: number;
  bindings_active: number;
  bindings_verified: number;
  email_channel_setting_present: boolean;
  email_channel_enabled: boolean;
  email_send_ready: boolean;
}

export interface HealthSummaryPayload {
  organization_id: string;
  department_id: string | null;
  permissions: HealthPermissionsPayload;
  catalogue: HealthCataloguePayload;
  runtime: HealthRuntimePayload;
  channels: HealthChannelsPayload;
  generated_at: string;
}

/** Result of the safe, non-mutating `omni-comms-runtime` health probe. */
/**
 * Bounded facts returned by the deployed runtime's non-mutating `/health`
 * probe. Every field is preserved exactly as reported — the build tag is a
 * human-readable label and must never be substituted for `revision`, which is
 * the deployed source revision used for certification binding.
 */
export interface EdgeHealthProbeResult {
  available: boolean;
  functionName: string;
  /** Human-readable build label. Not a source revision. */
  buildTag: string | null;
  /** Deployed source revision, when the runtime was deployed with one. */
  revision: string | null;
  /** Whether the runtime could report a revision at all. */
  revisionVerified: boolean | null;
  runtimeVersion: string | null;
  certificationState: string | null;
  liveDeliveryEnabled: boolean | null;
  checkedAt: string;
  error: HealthError | null;
}

export interface LiveDiagnosticsResult {
  organizationId: string;
  departmentId: string | null;
  categories: DiagnosticCategory[];
  posture: OverallPosture;
  postureReason: string;
  recommendations: RecommendedAction[];
  generatedAt: string;
}

/** Minimum permitted auto-refresh interval (ms). */
export const HEALTH_MIN_REFRESH_MS = 30_000;
/** Default auto-refresh interval when the operator enables polling (ms). */
export const HEALTH_DEFAULT_REFRESH_MS = 60_000;
