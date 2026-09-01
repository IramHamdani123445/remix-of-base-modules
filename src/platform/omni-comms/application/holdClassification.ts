/**
 * Omni-Comms — canonical hold classification (presentation mirror).
 *
 * This is the TypeScript mirror of the database function
 * `public.omni_comms_hold_classification(text)`. The database remains the
 * authority; this module exists so the Operations UI and the header attention
 * badge can label a hold without a round trip, and so the mapping is unit
 * testable.
 *
 * Two distinct truths are modelled and must never be conflated:
 *   - stored hold reason      — the last claim blocker persisted on the job;
 *   - authorization outcome   — the current authoritative dispatch-authorization
 *                               result recomputed by the hold reevaluator.
 *
 * "Actionable" means an operator can reasonably do something about it now.
 * A governance outcome that is intentionally permanent (a business event that
 * predates dispatch activation) is NOT actionable and must never inflate the
 * header attention badge.
 */

export type HoldBucket =
  | 'READY'
  | 'PERMANENT_HISTORICAL'
  | 'GOVERNANCE_BLOCKED'
  | 'CONFIGURATION_BLOCKED'
  | 'TEMPORARY_HOLD'
  | 'FAILED_RETRY_REQUIRED';

export interface HoldClassification {
  bucket: HoldBucket;
  /** Whether an operator can reasonably act on this now. */
  actionable: boolean;
  /** Business-readable label. Never contains credentials or recipient PII. */
  label: string;
}

export const HOLD_BUCKET_LABELS: Readonly<Record<HoldBucket, string>> = {
  READY: 'Ready',
  PERMANENT_HISTORICAL: 'Permanent historical',
  GOVERNANCE_BLOCKED: 'Governance blocked',
  CONFIGURATION_BLOCKED: 'Configuration blocked',
  TEMPORARY_HOLD: 'Temporary hold',
  FAILED_RETRY_REQUIRED: 'Failed — retry required',
};

const GOVERNANCE_REASONS = new Set([
  'release_control_missing',
  'release_snapshot_missing',
  'release_snapshot_stale',
  'release_fingerprint_mismatch',
  'release_expired',
  'release_denied',
  'business_dispatch_disabled',
  'certification_not_effective',
  'certification_mismatch',
  'deployed_revision_mismatch',
  'runtime_certification_missing',
]);

const CONFIGURATION_REASONS = new Set([
  'resolution_snapshot_incomplete',
  'provider_account_missing',
  'provider_unavailable',
  'sender_not_verified',
  'sender_binding_missing',
  'provider_secret_missing',
  'credential_missing',
  'adapter_not_capable',
  'live_delivery_enabled_unexpected',
  'volume_integrity_failure',
  'recipient_invalid',
  'recipient_malformed',
]);

const TEMPORARY_REASONS = new Set([
  'release_limit_exceeded',
  'retry_wait',
  'provider_rate_limited',
]);

const FAILED_REASONS = new Set([
  'retry_exhausted',
  'provider_attempts_exhausted',
  'delivery_failed',
]);

const RECIPIENT_REASONS = new Set([
  'recipient_not_allowlisted',
  'recipient_not_permitted',
]);

/** Classify a stored hold reason or authorization outcome. */
export function classifyHold(reason: string | null | undefined): HoldClassification {
  const r = (reason ?? '').trim();
  if (!r) {
    return { bucket: 'READY', actionable: false, label: 'Ready — eligible for delivery' };
  }
  if (r === 'historical_job_not_authorized') {
    return {
      bucket: 'PERMANENT_HISTORICAL',
      actionable: false,
      label: 'Held — historical pre-activation communication',
    };
  }
  if (r.startsWith('superseded_') || r === 'archived' || r === 'cancelled_by_operator') {
    return {
      bucket: 'PERMANENT_HISTORICAL',
      actionable: false,
      label: 'Archived — superseded record',
    };
  }
  if (RECIPIENT_REASONS.has(r)) {
    return {
      bucket: 'GOVERNANCE_BLOCKED',
      actionable: true,
      label: 'Held — recipient not allowlisted',
    };
  }
  if (GOVERNANCE_REASONS.has(r)) {
    return {
      bucket: 'GOVERNANCE_BLOCKED',
      actionable: true,
      label: 'Held — release approval required',
    };
  }
  if (CONFIGURATION_REASONS.has(r)) {
    return {
      bucket: 'CONFIGURATION_BLOCKED',
      actionable: true,
      label: 'Held — provider or recipient configuration required',
    };
  }
  if (TEMPORARY_REASONS.has(r)) {
    return {
      bucket: 'TEMPORARY_HOLD',
      actionable: false,
      label: 'Waiting — temporary limit, resumes automatically',
    };
  }
  if (FAILED_REASONS.has(r)) {
    return {
      bucket: 'FAILED_RETRY_REQUIRED',
      actionable: true,
      label: 'Failed — retry exhausted',
    };
  }
  return {
    bucket: 'GOVERNANCE_BLOCKED',
    actionable: true,
    label: 'Held — governance review required',
  };
}

/**
 * Operator-facing status for one dispatch job, combining the stored claim
 * blocker with the current authorization outcome. The current outcome wins for
 * the headline, because it is the authoritative present-tense truth.
 */
export function jobHoldStatus(job: {
  status: string;
  hold_reason?: string | null;
  authorization_outcome?: string | null;
}): HoldClassification & { technicalReason: string | null } {
  if (job.status !== 'held') {
    const c = classifyHold(job.hold_reason ?? null);
    return { ...c, technicalReason: job.hold_reason ?? null };
  }
  const authoritative =
    job.authorization_outcome !== undefined && job.authorization_outcome !== null
      ? job.authorization_outcome
      : job.hold_reason ?? null;
  return {
    ...classifyHold(authoritative),
    technicalReason: authoritative,
  };
}

/** Shape returned by `omni_comms_ops_attention_summary`. */
export interface OmniCommsAttentionSummary {
  actionable_held: number;
  failed_jobs: number;
  retry_exhausted_jobs: number;
  attention_total: number;
  held_by_bucket: Partial<Record<HoldBucket, number>>;
}

/**
 * Bounded, presentation-only attention total. Only conditions an operator can
 * act upon are counted; permanent historical holds never are.
 */
export function attentionTotal(summary: OmniCommsAttentionSummary | null): number {
  if (!summary) return 0;
  const n = (v: unknown): number => {
    const parsed = typeof v === 'string' ? Number(v) : v;
    return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return n(summary.actionable_held) + n(summary.failed_jobs) + n(summary.retry_exhausted_jobs);
}
