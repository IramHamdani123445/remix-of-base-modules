// Pure scheduling contract for the BN Life Certificate runner.
//
// Kept free of Deno/Supabase imports so the exact planning logic the runner
// executes can be tested directly (no source-string assertions).

/** DUE, GRACE, OVERDUE or a numbered reminder identity such as REMINDER_1. */
export type Milestone = string;

export interface DueRow {
  life_certificate_id: string;
  bn_award_id: string;
  milestone: Milestone;
  milestone_date: string;
  attempts: number | null;
  row_version: number;
  obligation_status: string;
}

export interface PlannedWork {
  lifeCertificateId: string;
  milestone: Milestone;
  milestoneDate: string;
  idempotencyKey: string;
  /** True when the obligation is parked for manual intervention. */
  skipped: boolean;
  skipReason?: 'E_MAX_ATTEMPTS';
}

/** Failed attempts beyond this stop automatic processing. */
export const MAX_ATTEMPTS = 5;

/** Bounded batch so a single invocation cannot run unbounded. */
export const MAX_BATCH = 200;

/**
 * The idempotency identity is obligation + milestone identity + milestone date,
 * so a reminder is never repeated daily and a later milestone is never blocked
 * by an earlier one.
 */
export function milestoneIdempotencyKey(row: DueRow): string {
  return `lc:${row.life_certificate_id}:${row.milestone}:${row.milestone_date}`;
}

export function planMilestoneWork(rows: DueRow[]): PlannedWork[] {
  return rows.slice(0, MAX_BATCH).map((row) => ({
    lifeCertificateId: row.life_certificate_id,
    milestone: row.milestone,
    milestoneDate: row.milestone_date,
    idempotencyKey: milestoneIdempotencyKey(row),
    skipped: (row.attempts ?? 0) >= MAX_ATTEMPTS,
    skipReason: (row.attempts ?? 0) >= MAX_ATTEMPTS ? 'E_MAX_ATTEMPTS' : undefined,
  }));
}
