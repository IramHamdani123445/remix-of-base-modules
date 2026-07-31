/**
 * Omni-Comms — Phase 5 Controlled Dry-Run Test Surface: types and constants.
 *
 * Pure declarations. No Supabase client, no React, no runtime internals and
 * no Legacy Communication Hub references. The controlled dry-run surface is
 * an ADMINISTRATION test path only: it creates Omni-Comms runtime evidence
 * and never contacts a provider, never creates a dispatch job and never
 * sends an email.
 */

/** Caller module code that activates the trusted administration guard. */
export const ADMIN_DRY_RUN_MODULE_CODE = 'OMNI_COMMS_ADMIN_DRY_RUN';
/** Bounded caller entity type for administration tests. */
export const ADMIN_DRY_RUN_ENTITY_TYPE = 'ADMIN_TEST';
/** The single supported administration test channel. */
export const ADMIN_DRY_RUN_CHANNEL = 'email';
/** Default locale for the administration test path. */
export const ADMIN_DRY_RUN_DEFAULT_LOCALE = 'en-US';
/** Recipient type for the single synthetic recipient. */
export const ADMIN_DRY_RUN_RECIPIENT_TYPE = 'synthetic_test';
/** The ONLY email domain accepted for administration test recipients. */
export const ADMIN_DRY_RUN_EMAIL_DOMAIN = 'example.com';
/** Exactly one recipient is permitted. */
export const ADMIN_DRY_RUN_RECIPIENT_LIMIT = 1;
/** Payload ceiling in bytes (256 KiB), mirroring the contract limit. */
export const ADMIN_DRY_RUN_PAYLOAD_MAX_BYTES = 262144;
/** Idempotency key prefix. */
export const ADMIN_DRY_RUN_IDEMPOTENCY_PREFIX = 'omni-admin-dryrun';
/** Correlation identifier prefix for administration tests. */
export const ADMIN_DRY_RUN_CORRELATION_PREFIX = 'omni-admin-dryrun-corr';

// ─── Server feature gate ────────────────────────────────────────────────

export type DryRunGateState = 'enabled' | 'disabled' | 'unavailable';

export interface DryRunGate {
  state: DryRunGateState;
  reason: string;
  source: string;
  caller_module_code: string;
  allowed_mode: 'dry_run';
  allowed_channels: string[];
  recipient_limit: number;
  required_recipient_domain: string;
  live_delivery_enabled: boolean;
  can_view: boolean;
  can_operate: boolean;
  can_view_sensitive_content: boolean;
  /** Server-held certification state for the deployed runtime. */
  certification_state?: 'certified' | 'pending' | 'failed' | string | null;
  /** Commit recorded as certified, when one exists. */
  certified_commit?: string | null;
  /** Server-held environment classification. Authoritative. */
  environment?: 'production' | 'non_production' | string | null;
  /**
   * The AUTHORITATIVE decision. When false the surface must not offer
   * execution, whatever the browser believes about the environment.
   */
  execution_permitted?: boolean | null;
  /** Bounded reason code when execution is not permitted. */
  execution_blocked_reason?: string | null;
  checked_at: string;
}

/** Operator-safe wording for each server-supplied block reason. */
export const DRY_RUN_BLOCK_REASON_MESSAGE: Readonly<Record<string, string>> = {
  admin_dry_run_disabled:
    'The safe dry test is switched off in server configuration.',
  permission_denied:
    'You do not hold the Omnichannel Communications operate capability.',
  admin_dry_run_environment_blocked:
    'The server classifies this environment as production. The safe dry test is never offered in production.',
  admin_dry_run_certification_blocked:
    'Privileged certification is recorded as failed for the deployed runtime.',
  admin_dry_run_revision_mismatch:
    'The certified commit does not match the deployed runtime revision.',
};

// ─── Authoritative payload validation ───────────────────────────────────

export interface DryRunValidationError {
  code: string;
  field?: string;
  message: string;
}

export interface DryRunValidationResult {
  valid: boolean;
  event_definition_id: string;
  event_code: string;
  contract_id: string;
  contract_version: number;
  contract_checksum: string | null;
  organization_id: string;
  department_id: string | null;
  payload_bytes: number;
  errors: DryRunValidationError[];
  validated_at: string;
}

/**
 * Material inputs a validation result is bound to. When any of these change
 * the validation is stale and execution must be blocked until revalidated.
 */
export interface DryRunValidationScope {
  organizationId: string;
  departmentId: string | null;
  eventDefinitionId: string;
  payloadText: string;
}

// ─── Synthetic recipient ────────────────────────────────────────────────

export interface DryRunSyntheticRecipient {
  recipientType: typeof ADMIN_DRY_RUN_RECIPIENT_TYPE;
  recipientReference: string;
  displayName: string;
  locale: string;
  email: string;
}

export type DryRunRecipientErrorCode =
  | 'admin_dry_run_recipient_invalid'
  | 'admin_dry_run_domain_required'
  | 'admin_dry_run_mode_required'
  | 'admin_dry_run_recipient_limit';

// ─── Submission state machine ───────────────────────────────────────────

export type DryRunSubmissionState =
  | 'not_ready'
  | 'ready'
  | 'validating_payload'
  | 'validation_failed'
  | 'awaiting_confirmation'
  | 'submitting'
  | 'completed'
  | 'completed_with_blockers'
  | 'blocked'
  | 'transport_uncertain'
  | 'replayed';

export type DryRunResultKind =
  | 'new_request'
  | 'idempotent_replay'
  | 'payload_mismatch'
  | 'transport_failure';

// ─── Post-run invariants ────────────────────────────────────────────────

export interface DryRunInvariants {
  requestPersisted: boolean;
  modeIsDryRun: boolean;
  recipientCount: number;
  recipientCountMatches: boolean;
  messageCount: number;
  messageCountMatches: boolean;
  dispatchJobCount: number;
  deliveryAttemptCount: number;
  timelinePresent: boolean;
  providerContacted: false;
  emailSent: false;
  safetyViolated: boolean;
}

// ─── Controlled failure guidance ────────────────────────────────────────

export interface DryRunGuidanceTarget {
  route: string;
  query?: string;
  label: string;
}

export interface DryRunGuidance {
  code: string;
  title: string;
  message: string;
  target: DryRunGuidanceTarget | null;
}
