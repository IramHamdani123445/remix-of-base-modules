/**
 * Omni-Comms C6 — Release Control typed contracts.
 *
 * Boundaries (permanent):
 *   - Governance metadata only. This module never sends, enqueues, renders or
 *     dispatches anything, and never imports a provider SDK.
 *   - Raw recipient addresses never appear here. The server normalises, masks
 *     and hashes them; the browser only ever receives the masked form and a
 *     short hash prefix.
 *   - `live` is a reserved state that C6 can never reach.
 */

export const RELEASE_STATES = [
  'disabled',
  'configuration',
  'test_only',
  'controlled_pilot',
  'live',
  'suspended',
] as const;

export type ReleaseState = (typeof RELEASE_STATES)[number];

/** States an operator may select through the basic-state RPC. */
export const RELEASE_BASIC_STATES = ['disabled', 'configuration', 'test_only'] as const;
export type ReleaseBasicState = (typeof RELEASE_BASIC_STATES)[number];

export const RELEASE_DATA_ORIGINS = ['system_seed', 'user', 'reference_seed'] as const;
export type ReleaseDataOrigin = (typeof RELEASE_DATA_ORIGINS)[number];

export const RELEASE_EVENT_TYPES = [
  'release_created',
  'release_updated',
  'transition_proposed',
  'proposal_cancelled',
  'proposal_expired',
  'transition_approved',
  'release_activated',
  'release_suspended',
  'release_resumed',
  'release_expired',
  'release_gate_denied',
] as const;
export type ReleaseEventType = (typeof RELEASE_EVENT_TYPES)[number];

/** The only mode a controlled pilot may permit. */
export const RELEASE_PERMITTED_MODE = 'queued' as const;

/** Caller module that can never be a business pilot caller. */
export const RELEASE_FORBIDDEN_CALLER = 'OMNI_COMMS_ADMIN_DRY_RUN' as const;

export const RELEASE_LIMITS = {
  maxRecipientRules: 20,
  recipientsPerRequest: { min: 1, max: 10 },
  messagesPerHour: { min: 1, max: 20 },
  messagesPerDay: { min: 1, max: 100 },
  messagesTotal: { min: 1, max: 500 },
  /** Maximum controlled-pilot lifetime. */
  maxPilotDays: 7,
  /** Maximum proposal validity. */
  maxProposalHours: 24,
} as const;

/** Masked projection of one approved pilot recipient. Never the raw address. */
export interface ReleaseRecipientRule {
  readonly target_type: 'email_address';
  readonly target_masked: string;
  /** Short prefix only — the full digest is never returned to the browser. */
  readonly target_hash_prefix: string;
}

export interface ChannelReleaseControl {
  readonly id: string;
  readonly organization_id: string;
  readonly department_id: string | null;
  readonly channel: 'email';
  readonly data_origin: ReleaseDataOrigin;
  readonly release_state: ReleaseState;
  readonly release_version: number;
  readonly permitted_event_codes: readonly string[];
  readonly permitted_caller_modules: readonly string[];
  readonly permitted_modes: readonly string[];
  readonly pilot_recipient_rules: readonly ReleaseRecipientRule[];
  readonly max_recipients_per_request: number;
  readonly max_messages_per_hour: number;
  readonly max_messages_per_day: number;
  readonly max_messages_total: number;
  readonly release_starts_at: string | null;
  readonly release_expires_at: string | null;
  readonly proposed_state: ReleaseState | null;
  readonly proposal_reason: string | null;
  readonly proposed_by: string | null;
  readonly proposed_at: string | null;
  readonly proposal_expires_at: string | null;
  readonly approved_by: string | null;
  readonly approved_at: string | null;
  readonly approval_note: string | null;
  readonly activated_by: string | null;
  readonly activated_at: string | null;
  readonly suspended_by: string | null;
  readonly suspended_at: string | null;
  readonly suspension_reason: string | null;
  readonly approved_commit: string | null;
  readonly certification_workflow_run_id: string | null;
  readonly certification_recorded_at: string | null;
  readonly release_fingerprint: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type ReleaseCheckState =
  | 'passed'
  | 'failed'
  | 'warning'
  | 'not_applicable'
  | 'not_implemented';

export interface ReleasePrerequisiteCheck {
  readonly sequence: number;
  readonly code: string;
  readonly state: ReleaseCheckState;
  readonly detail: string;
}

export interface ReleaseHistoryEntry {
  readonly id: string;
  readonly event_type: ReleaseEventType;
  readonly from_state: ReleaseState | null;
  readonly to_state: ReleaseState | null;
  readonly reason: string | null;
  readonly actor_id: string | null;
  readonly release_version: number;
  readonly release_fingerprint: string;
  readonly certified_commit: string | null;
  readonly occurred_at: string;
}

export interface ChannelReleaseControlSummary {
  readonly release: ChannelReleaseControl | null;
  readonly scope: {
    readonly organization_id: string;
    readonly department_id: string | null;
    readonly channel: string;
  };
  readonly certification: {
    readonly certification_state?: string | null;
    readonly certified_commit?: string | null;
    readonly workflow_run_id?: string | null;
    readonly certified_at?: string | null;
  } | null;
  readonly runtime_environment: string | null;
  readonly live_delivery_enabled: boolean;
  readonly prerequisites: readonly ReleasePrerequisiteCheck[];
  readonly usage: { readonly hourly?: number; readonly daily?: number; readonly total?: number };
  readonly history: readonly ReleaseHistoryEntry[];
  readonly capabilities: {
    readonly can_configure: boolean;
    readonly can_approve: boolean;
    readonly can_suspend: boolean;
  };
  readonly actor_id: string | null;
  /** Always false in C6. Business provider dispatch arrives in C7. */
  readonly business_dispatch_implemented: boolean;
  readonly generated_at: string;
}

/** Blocking prerequisites are checks 1–31 that are not `passed`. */
export function releaseBlockers(
  checks: readonly ReleasePrerequisiteCheck[] | null | undefined,
): ReleasePrerequisiteCheck[] {
  return (checks ?? []).filter((c) => c.sequence <= 31 && c.state !== 'passed');
}

export function releaseWarnings(
  checks: readonly ReleasePrerequisiteCheck[] | null | undefined,
): ReleasePrerequisiteCheck[] {
  return (checks ?? []).filter((c) => c.state === 'warning');
}

/**
 * Terminal prerequisite check 32.
 *
 * C7 Closure Correction: this is now a truthful dispatcher-installation
 * check. It reports whether the controlled business dispatch RPCs exist —
 * without them dispatch fails closed. The legacy C6 code is still accepted so
 * that a database that has not yet received the closure migration renders
 * correctly.
 */
export const BUSINESS_DISPATCH_CHECK_CODES = [
  'business_dispatch_dispatcher_installed',
  'business_dispatch_not_implemented_c6',
] as const;

export function businessDispatchCheck(
  checks: readonly ReleasePrerequisiteCheck[] | null | undefined,
): ReleasePrerequisiteCheck | null {
  return (
    (checks ?? []).find((c) =>
      (BUSINESS_DISPATCH_CHECK_CODES as readonly string[]).includes(c.code),
    ) ?? null
  );
}

export function isReferenceRelease(r: ChannelReleaseControl | null | undefined): boolean {
  return r?.data_origin === 'reference_seed';
}

export function isProposalActive(
  r: ChannelReleaseControl | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!r?.proposed_state || !r.proposal_expires_at) return false;
  return new Date(r.proposal_expires_at).getTime() > now.getTime();
}

export function isReleaseExpired(
  r: ChannelReleaseControl | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!r?.release_expires_at) return false;
  return new Date(r.release_expires_at).getTime() <= now.getTime();
}

/**
 * Controlled-pilot governance is only "in force" when the pilot is active,
 * unexpired, unsuspended and still bound to the certified commit.
 */
export function isControlledPilotGovernanceActive(
  summary: ChannelReleaseControlSummary | null | undefined,
  now: Date = new Date(),
): boolean {
  const r = summary?.release;
  if (!r || isReferenceRelease(r)) return false;
  if (r.release_state !== 'controlled_pilot') return false;
  if (isReleaseExpired(r, now)) return false;
  if (r.suspended_at) return false;
  if (!r.release_fingerprint) return false;
  const certified = summary?.certification?.certified_commit ?? null;
  if (!r.approved_commit || !certified) return false;
  if (r.approved_commit.toLowerCase() !== certified.toLowerCase()) return false;
  return (
    r.permitted_event_codes.length > 0
    && r.permitted_caller_modules.length > 0
    && r.permitted_modes.length > 0
    && r.pilot_recipient_rules.length > 0
  );
}

/** True when a genuine Release Control record exists for the scope. */
export function isReleaseControlConfigured(
  summary: ChannelReleaseControlSummary | null | undefined,
): boolean {
  return Boolean(summary?.release && !isReferenceRelease(summary.release));
}

export interface UpsertReleaseConfigurationInput {
  id?: string | null;
  expectedUpdatedAt?: string | null;
  organizationId: string;
  departmentId?: string | null;
  channel: 'email';
  permittedEventCodes: string[];
  permittedCallerModules: string[];
  permittedModes: string[];
  /**
   * Raw or already-canonical recipient entries. Raw addresses are accepted
   * only in transit: the server normalises, masks and hashes them and the raw
   * value is discarded and never persisted.
   */
  recipientInput: Array<{ target?: string; target_masked?: string; target_hash?: string }>;
  maxRecipientsPerRequest: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  maxMessagesTotal: number;
  releaseStartsAt?: string | null;
  releaseExpiresAt?: string | null;
  correlationId?: string | null;
}
