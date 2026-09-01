/**
 * Canonical Compliance obligation / deadline resolver.
 *
 * ONE implementation of the regulatory timeline for a wage period. Detection
 * (filing + payment), reminder generation and escalation all consume this
 * module — no rule re-implements calendar arithmetic.
 *
 * Client-confirmed policy (Compliance Business Review, 17/20/24 August 2026):
 *  - The current St Kitts & Nevis obligation is based on CALENDAR MONTH END of
 *    the month FOLLOWING the wage month, not a permanent 28th.
 *  - February (28), February in a leap year (29), 30-day and 31-day months are
 *    all resolved from the real calendar.
 *  - The "28th" discussed in the meetings is a POSSIBLE FUTURE legislative
 *    simplification, so the basis stays configurable rather than hard-coded.
 *
 * Ownership: the deadline BASIS has exactly one owner — the active row of
 * ce_compliance_policies (deadline_basis / reporting_offset_months /
 * deadline_fixed_day). Detection rules may only override the fixed day and the
 * grace days; they can never define their own calendar.
 *
 * MIRROR: supabase/functions/_shared/compliance/obligationDeadlineResolver.ts
 * must stay byte-identical (asserted by
 * src/__tests__/compliance/obligation-resolver-parity.test.ts).
 */

/** How the statutory due date of a reporting period is derived. */
export type CeDeadlineBasis = "calendar_month_end" | "fixed_day_of_month";

export const CE_DEADLINE_BASES: readonly CeDeadlineBasis[] = [
  "calendar_month_end",
  "fixed_day_of_month",
];

/** Obligations that share the one authoritative timeline. */
export type CeObligationType = "C3_FILING" | "CONTRIBUTION_PAYMENT";

export interface CeObligationPolicy {
  /** Owned by the active ce_compliance_policies row. */
  deadline_basis: CeDeadlineBasis;
  /** Months added to the wage period to obtain the reporting period (St Kitts: 1). */
  reporting_offset_months: number;
  /** Only consulted when deadline_basis = "fixed_day_of_month". */
  deadline_fixed_day?: number | null;
  /** Additional days allowed after the due date before the obligation is breached. */
  grace_days?: number;
}

export interface CeObligationTimeline {
  obligation_type: CeObligationType;
  /** Wage / contribution period, "YYYY-MM". */
  wage_period: string;
  /** Reporting period in which the obligation must be discharged, "YYYY-MM". */
  reporting_period: string;
  /** Statutory due date, "YYYY-MM-DD". */
  due_date: string;
  grace_days: number;
  /** Last day on which discharge is still timely, "YYYY-MM-DD". */
  grace_end_date: string;
  /** First day on which the obligation is in breach, "YYYY-MM-DD". */
  violation_effective_date: string;
  deadline_basis: CeDeadlineBasis;
}

export class CeObligationPolicyError extends Error {}

/* ────────────────────────── calendar primitives ────────────────────────── */

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && YM.test(value);
}

/** Normalise "YYYY-MM", "YYYY-MM-DD" or a Date to "YYYY-MM". */
export function toYearMonth(value: string | Date): string {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}`;
  }
  const ym = String(value).slice(0, 7);
  if (!isYearMonth(ym)) throw new CeObligationPolicyError(`Invalid period "${value}" — expected YYYY-MM.`);
  return ym;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Real calendar length of a month. month is 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return daysInMonth(year, 2) === 29;
}

/** Shift a "YYYY-MM" period by whole months. */
export function addMonths(period: string, months: number): string {
  const [y, m] = splitYm(period);
  const zero = y * 12 + (m - 1) + months;
  return `${Math.floor(zero / 12)}-${pad2((zero % 12) + 1)}`;
}

function splitYm(period: string): [number, number] {
  const ym = toYearMonth(period);
  return [Number(ym.slice(0, 4)), Number(ym.slice(5, 7))];
}

/** Add days to an ISO date, calendar-correct across month and year boundaries. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new CeObligationPolicyError(`Invalid date "${isoDate}".`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Build an ISO date inside a period, clamped to the real length of the month. */
export function dateInPeriod(period: string, dayOfMonth: number): string {
  const [y, m] = splitYm(period);
  const day = Math.min(Math.max(1, Math.trunc(dayOfMonth)), daysInMonth(y, m));
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

export function lastDayOfPeriod(period: string): string {
  const [y, m] = splitYm(period);
  return `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
}

/* ─────────────────────────── policy normalisation ───────────────────────── */

export function normalizeObligationPolicy(
  raw: Record<string, unknown> | null | undefined,
  overrides?: { fixed_day?: number | null; grace_days?: number | null },
): CeObligationPolicy {
  if (!raw) {
    throw new CeObligationPolicyError(
      "No active Compliance Policy — the obligation deadline basis has no owner. Configure Compliance Policy before running detection or reminders.",
    );
  }
  const basis = String(raw.deadline_basis ?? "") as CeDeadlineBasis;
  if (!CE_DEADLINE_BASES.includes(basis)) {
    throw new CeObligationPolicyError(
      `Compliance Policy deadline_basis "${String(raw.deadline_basis)}" is not supported. Expected one of: ${CE_DEADLINE_BASES.join(", ")}.`,
    );
  }
  const offsetRaw = raw.reporting_offset_months;
  const offset = Number(offsetRaw);
  if (!Number.isInteger(offset) || offset < 0 || offset > 12) {
    throw new CeObligationPolicyError(
      "Compliance Policy reporting_offset_months must be a whole number between 0 and 12.",
    );
  }
  const fixedDay =
    overrides?.fixed_day ?? (raw.deadline_fixed_day == null ? null : Number(raw.deadline_fixed_day));
  if (basis === "fixed_day_of_month") {
    if (!Number.isInteger(fixedDay) || Number(fixedDay) < 1 || Number(fixedDay) > 31) {
      throw new CeObligationPolicyError(
        "Compliance Policy deadline_basis is fixed_day_of_month but deadline_fixed_day is not a valid day (1-31).",
      );
    }
  }
  const graceRaw = overrides?.grace_days ?? raw.grace_days;
  const grace = graceRaw == null ? 0 : Number(graceRaw);
  if (!Number.isInteger(grace) || grace < 0 || grace > 365) {
    throw new CeObligationPolicyError("Grace days must be a whole number between 0 and 365.");
  }
  return {
    deadline_basis: basis,
    reporting_offset_months: offset,
    deadline_fixed_day: fixedDay ?? null,
    grace_days: grace,
  };
}

/* ────────────────────────────── the resolver ────────────────────────────── */

/**
 * The one authoritative obligation timeline for a wage period.
 * Consumed by filing detection, payment detection and reminder generation.
 */
export function resolveObligationTimeline(
  wagePeriod: string,
  policy: CeObligationPolicy,
  obligationType: CeObligationType = "C3_FILING",
): CeObligationTimeline {
  const wage = toYearMonth(wagePeriod);
  const reporting = addMonths(wage, policy.reporting_offset_months);
  const dueDate =
    policy.deadline_basis === "calendar_month_end"
      ? lastDayOfPeriod(reporting)
      : dateInPeriod(reporting, Number(policy.deadline_fixed_day));
  const graceDays = policy.grace_days ?? 0;
  const graceEnd = graceDays > 0 ? addDays(dueDate, graceDays) : dueDate;
  return {
    obligation_type: obligationType,
    wage_period: wage,
    reporting_period: reporting,
    due_date: dueDate,
    grace_days: graceDays,
    grace_end_date: graceEnd,
    violation_effective_date: addDays(graceEnd, 1),
    deadline_basis: policy.deadline_basis,
  };
}

/* ────────────────────────────── reminders ───────────────────────────────── */

export type CeReminderOffsetType =
  | "reporting_day_of_month"
  | "days_before_due"
  | "days_after_due";

export const CE_REMINDER_OFFSET_TYPES: readonly CeReminderOffsetType[] = [
  "reporting_day_of_month",
  "days_before_due",
  "days_after_due",
];

export interface CeReminderRule {
  rule_code: string;
  label?: string | null;
  is_enabled: boolean;
  /** "C3_FILING" | "CONTRIBUTION_PAYMENT" | "ALL" */
  obligation_type: string;
  offset_type: CeReminderOffsetType;
  offset_value: number;
  audience: string;
  template_code: string;
  channels: string[];
  consolidate_periods: boolean;
  sequence?: number | null;
}

export class CeReminderConfigError extends Error {}

export function reminderAppliesTo(rule: CeReminderRule, obligationType: CeObligationType): boolean {
  return rule.obligation_type === "ALL" || rule.obligation_type === obligationType;
}

/**
 * Scheduled date of a reminder for one obligation timeline.
 * Returns null when the rule is disabled or does not apply to the obligation.
 */
export function resolveReminderDate(
  timeline: CeObligationTimeline,
  rule: CeReminderRule,
): string | null {
  if (!rule.is_enabled) return null;
  if (!reminderAppliesTo(rule, timeline.obligation_type)) return null;
  if (!CE_REMINDER_OFFSET_TYPES.includes(rule.offset_type)) {
    throw new CeReminderConfigError(
      `Reminder rule ${rule.rule_code} has unsupported offset_type "${rule.offset_type}".`,
    );
  }
  const value = Number(rule.offset_value);
  if (!Number.isInteger(value) || value < 0) {
    throw new CeReminderConfigError(
      `Reminder rule ${rule.rule_code} has an invalid offset_value "${rule.offset_value}".`,
    );
  }
  switch (rule.offset_type) {
    case "reporting_day_of_month":
      return dateInPeriod(timeline.reporting_period, value);
    case "days_before_due":
      return addDays(timeline.due_date, -value);
    case "days_after_due":
      return addDays(timeline.grace_end_date, value);
  }
}

/** Reminder schedule for a timeline, ordered by date, for persistence/audit. */
export function resolveReminderSchedule(
  timeline: CeObligationTimeline,
  rules: CeReminderRule[],
): Array<{ rule_code: string; scheduled_date: string; template_code: string; channels: string[] }> {
  const out: Array<{ rule_code: string; scheduled_date: string; template_code: string; channels: string[] }> = [];
  for (const rule of rules) {
    const date = resolveReminderDate(timeline, rule);
    if (!date) continue;
    out.push({
      rule_code: rule.rule_code,
      scheduled_date: date,
      template_code: rule.template_code,
      channels: rule.channels ?? [],
    });
  }
  return out.sort((a, b) => (a.scheduled_date < b.scheduled_date ? -1 : 1));
}

/** Reminders due to be issued on `asOf` (exact-day cycle, idempotent per cycle key). */
export function remindersDueOn(
  timeline: CeObligationTimeline,
  rules: CeReminderRule[],
  asOf: string,
): CeReminderRule[] {
  return rules.filter((rule) => resolveReminderDate(timeline, rule) === asOf);
}

/* ─────────────────────── obligation state evaluation ────────────────────── */

export type CeFilingOutcome =
  | "PENDING"
  | "FILED_ON_TIME"
  | "FILED_LATE"
  | "UNREPORTED";

/**
 * DR-001 / DR-002 client semantics.
 *  - A Late Filing requires an ACTUAL filing received after the permitted deadline.
 *  - Absence of a filing after the deadline is UNREPORTED, never Late Filing.
 *  - A valid NIL return is a submitted report.
 */
export function evaluateFilingObligation(input: {
  timeline: CeObligationTimeline;
  /** Date the C3 was received ("YYYY-MM-DD"), or null when nothing was received. */
  filingReceivedDate?: string | null;
  asOf: string;
}): CeFilingOutcome {
  const { timeline, asOf } = input;
  const received = input.filingReceivedDate ? String(input.filingReceivedDate).slice(0, 10) : null;
  if (received) {
    return received <= timeline.grace_end_date ? "FILED_ON_TIME" : "FILED_LATE";
  }
  return asOf >= timeline.violation_effective_date ? "UNREPORTED" : "PENDING";
}

export type CePaymentOutcome =
  | "PENDING"
  | "PAID_IN_FULL"
  | "PARTIALLY_PAID"
  | "NOT_PAID";

/**
 * DR-003 client semantics: zero / partial / full are distinguished, using the
 * same authoritative deadline. DR-004's approval workflow is out of scope here.
 */
export function evaluatePaymentObligation(input: {
  timeline: CeObligationTimeline;
  declaredAmount: number;
  paidAmount: number;
  asOf: string;
  /** Rounding tolerance in currency units; not a business waiver. */
  tolerance?: number;
}): CePaymentOutcome {
  const { timeline, asOf } = input;
  const declared = Number(input.declaredAmount) || 0;
  const paid = Number(input.paidAmount) || 0;
  const tolerance = input.tolerance ?? 0.005;
  if (declared <= 0) return "PAID_IN_FULL";
  if (paid + tolerance >= declared) return "PAID_IN_FULL";
  if (asOf < timeline.violation_effective_date) return "PENDING";
  return paid > 0 ? "PARTIALLY_PAID" : "NOT_PAID";
}

/** True when a filing outcome must keep an open unreported obligation. */
export function isOutstandingFiling(outcome: CeFilingOutcome): boolean {
  return outcome === "UNREPORTED";
}

/** True when a payment outcome must keep an open payment obligation. */
export function isOutstandingPayment(outcome: CePaymentOutcome): boolean {
  return outcome === "NOT_PAID" || outcome === "PARTIALLY_PAID";
}
