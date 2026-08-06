/**
 * BN Medical Reviews — governed command boundary for the legacy
 * `bn_medical_review_schedule` surface (Screen 24 scheduler + award
 * provisioning).
 *
 * The browser holds no INSERT/UPDATE/DELETE privilege on
 * `bn_medical_review_schedule`. Every state change routes through a versioned
 * `SECURITY DEFINER` RPC that re-enforces, server side:
 *   - authentication (`_bn_mr_actor`)
 *   - Medical Review dark-launch gate (`_bn_mr_assert_enabled`)
 *   - granular permission (`_bn_mr_require`)
 *   - record scope (`_bn_mr_can_access_award`)
 *   - source-state validation
 *   - row-version (optimistic concurrency) validation
 *   - idempotency (`_bn_mr_cmd_begin` / `_bn_mr_cmd_finish`)
 *   - safe audit (`_bn_mr_audit`, no clinical free text in the audit payload)
 */
import { supabase } from '@/integrations/supabase/client';
import { mapMedicalReviewError } from '@/features/bn/medical-reviews/model/errors';

export type LegacyCommandStatus = 'OK' | 'REPLAYED' | 'NO_OP' | 'UNKNOWN';

export interface LegacyCommandResult {
  status: LegacyCommandStatus;
  replayed: boolean;
  scheduleId: string | null;
  rowVersion: number | null;
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function call(fn: string, args: Record<string, unknown>): Promise<LegacyCommandResult> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw mapMedicalReviewError(error.message ?? error.code ?? '');
  const envelope = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const raw = typeof envelope.status === 'string' ? envelope.status.toUpperCase() : 'UNKNOWN';
  const status: LegacyCommandStatus =
    raw === 'OK' || raw === 'REPLAYED' || raw === 'NO_OP' ? raw : 'UNKNOWN';
  return {
    status,
    replayed: status === 'REPLAYED',
    scheduleId: typeof envelope.schedule_id === 'string' ? envelope.schedule_id : null,
    rowVersion: typeof envelope.row_version === 'number' ? envelope.row_version : null,
  };
}

export const medicalReviewLegacyScheduleCommands = {
  /** Schedule (or re-date) a legacy periodic review appointment. */
  schedule(input: {
    scheduleId: string;
    scheduledDate: string;
    examiningProvider?: string | null;
    expectedRowVersion: number;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return call('bn_medical_review_legacy_schedule_v1', {
      p_schedule_id: input.scheduleId,
      p_scheduled_date: input.scheduledDate,
      p_examining_provider: input.examiningProvider ?? null,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
      p_reason: input.reason ?? null,
    });
  },

  /** Record the outcome of a legacy periodic review. */
  recordOutcome(input: {
    scheduleId: string;
    outcome: 'CONTINUE' | 'UPGRADE' | 'DOWNGRADE' | 'CEASE' | 'REFER_BOARD';
    notes?: string | null;
    nextReviewDate?: string | null;
    expectedRowVersion: number;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return call('bn_medical_review_legacy_record_outcome_v1', {
      p_schedule_id: input.scheduleId,
      p_outcome: input.outcome,
      p_notes: input.notes ?? null,
      p_next_review_date: input.nextReviewDate ?? null,
      p_expected_row_version: input.expectedRowVersion,
      p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
      p_reason: input.reason ?? null,
    });
  },

  /** Provision the first periodic review obligation when an award is created. */
  provision(input: {
    awardId: string;
    scheduledDate: string;
    reviewType?: string | null;
    idempotencyKey?: string;
    reason?: string | null;
  }) {
    return call('bn_medical_review_legacy_provision_v1', {
      p_award_id: input.awardId,
      p_scheduled_date: input.scheduledDate,
      p_review_type: input.reviewType ?? 'PERIODIC',
      p_idempotency_key: input.idempotencyKey ?? newIdempotencyKey(),
      p_reason: input.reason ?? null,
    });
  },
};

export default medicalReviewLegacyScheduleCommands;
