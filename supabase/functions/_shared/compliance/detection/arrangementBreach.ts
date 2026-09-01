/**
 * DR-006 Payment Arrangement Breach detection.
 *
 * Client-approved semantics:
 *  - `graceDaysAfterInstallment` (default 0) is the number of days after an
 *    installment's contractual due date before it can be treated as breached.
 *  - `reminderLeadDays` (default 15) controls how far ahead of the due date a
 *    reminder is generated. Reminders are advisory only — a pending or sent
 *    reminder NEVER delays a breach; the due date + grace is the sole source
 *    of truth for whether the arrangement is in breach.
 *  - A MISSED installment (nothing paid) breaches immediately once the grace
 *    period has elapsed.
 *  - A PARTIAL installment (paid amount below the amount due) breaches
 *    immediately once `partialInstallmentIsBreach` is true and the grace
 *    period has elapsed (or on the due date itself when the partial payment
 *    is already known to be insufficient and no grace remains to cure it).
 *
 * All thresholds arrive as configuration — nothing here is hard-coded.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/arrangementBreach.ts
 */

export interface CeInstallment {
  installmentId: string;
  arrangementId: string;
  employerId: string;
  employerName?: string;
  installmentNumber: number;
  dueDate: string;
  amount: number;
  paidAmount: number;
  paidDate?: string | null;
  status?: string | null;
}

export interface CeArrangementBreachConfig {
  graceDaysAfterInstallment: number;
  reminderLeadDays: number;
  partialInstallmentIsBreach: boolean;
}

export type CeInstallmentOutcome =
  | "NOT_YET_DUE"
  | "PAID_IN_FULL"
  | "WITHIN_GRACE"
  | "BREACH_MISSED"
  | "BREACH_PARTIAL";

export interface CeInstallmentEvaluation {
  installmentId: string;
  arrangementId: string;
  employerId: string;
  installmentNumber: number;
  outcome: CeInstallmentOutcome;
  dueDate: string;
  breachDate?: string;
  shortfall: number;
  summary: string;
}

export interface CeArrangementReminder {
  installmentId: string;
  arrangementId: string;
  employerId: string;
  installmentDueDate: string;
  reminderDate: string;
  leadDays: number;
}

/** Add days to an ISO date, calendar-correct across month/year boundaries. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Evaluate one installment's compliance outcome as of a given date. */
export function evaluateInstallment(
  i: CeInstallment,
  c: CeArrangementBreachConfig,
  asOf: string,
): CeInstallmentEvaluation {
  const grace = c.graceDaysAfterInstallment ?? 0;
  const graceEnd = addDays(i.dueDate, grace);
  const paid = Number(i.paidAmount) || 0;
  const amount = Number(i.amount) || 0;
  const shortfall = Math.max(0, amount - paid);

  const base = {
    installmentId: i.installmentId,
    arrangementId: i.arrangementId,
    employerId: i.employerId,
    installmentNumber: i.installmentNumber,
    dueDate: i.dueDate,
  };

  // Fully paid on or before the end of grace: always compliant regardless of asOf.
  if (paid >= amount && (!i.paidDate || i.paidDate <= graceEnd)) {
    return {
      ...base,
      outcome: "PAID_IN_FULL",
      shortfall: 0,
      summary: `Installment #${i.installmentNumber} paid in full by ${i.paidDate ?? "n/a"}.`,
    };
  }

  if (asOf < i.dueDate) {
    return {
      ...base,
      outcome: "NOT_YET_DUE",
      shortfall,
      summary: `Installment #${i.installmentNumber} not yet due (due ${i.dueDate}).`,
    };
  }

  const graceElapsed = asOf > graceEnd;

  if (!graceElapsed) {
    if (paid > 0 && paid < amount && c.partialInstallmentIsBreach) {
      return {
        ...base,
        outcome: "BREACH_PARTIAL",
        breachDate: asOf,
        shortfall,
        summary: `Installment #${i.installmentNumber} partially paid (shortfall ${shortfall}) on/after due date; treated as breach.`,
      };
    }
    if (grace > 0) {
      return {
        ...base,
        outcome: "WITHIN_GRACE",
        shortfall,
        summary: `Installment #${i.installmentNumber} past due but within the ${grace}-day grace period.`,
      };
    }
    // grace === 0 and we're exactly at due date with nothing/partial paid and partial isn't
    // configured to be an immediate breach yet within a zero grace window — falls through
    // to the elapsed logic below since graceEnd === dueDate here.
  }

  if (paid > 0 && paid < amount) {
    return {
      ...base,
      outcome: "BREACH_PARTIAL",
      breachDate: addDays(graceEnd, 1) > asOf ? asOf : addDays(graceEnd, 1),
      shortfall,
      summary: `Installment #${i.installmentNumber} in breach: partial payment (shortfall ${shortfall}) after grace elapsed.`,
    };
  }

  return {
    ...base,
    outcome: "BREACH_MISSED",
    breachDate: addDays(graceEnd, 1) > asOf ? asOf : addDays(graceEnd, 1),
    shortfall,
    summary: `Installment #${i.installmentNumber} in breach: missed payment after grace elapsed.`,
  };
}

/** Evaluate every installment in a batch (may span multiple arrangements/employers). */
export function evaluateArrangementInstallments(
  items: CeInstallment[],
  c: CeArrangementBreachConfig,
  asOf: string,
): CeInstallmentEvaluation[] {
  return items.map((i) => evaluateInstallment(i, c, asOf));
}

/**
 * One reminder per unpaid, not-yet-past-due installment, scheduled
 * `reminderLeadDays` before its due date. Reminders never substitute for or
 * delay a breach — they are purely advisory.
 */
export function planInstallmentReminders(
  items: CeInstallment[],
  c: CeArrangementBreachConfig,
  asOf: string,
): CeArrangementReminder[] {
  const out: CeArrangementReminder[] = [];
  for (const i of items) {
    const paid = Number(i.paidAmount) || 0;
    const amount = Number(i.amount) || 0;
    if (paid >= amount) continue; // fully paid — nothing to remind about

    const reminderDate = addDays(i.dueDate, -c.reminderLeadDays);
    const isPastDue = asOf > i.dueDate;
    if (isPastDue && reminderDate < asOf) continue; // already past due, reminder date has lapsed

    out.push({
      installmentId: i.installmentId,
      arrangementId: i.arrangementId,
      employerId: i.employerId,
      installmentDueDate: i.dueDate,
      reminderDate,
      leadDays: c.reminderLeadDays,
    });
  }
  return out;
}

/** True when the outcome represents a confirmed breach of the arrangement. */
export function isBreach(o: CeInstallmentOutcome): boolean {
  return o === "BREACH_MISSED" || o === "BREACH_PARTIAL";
}
