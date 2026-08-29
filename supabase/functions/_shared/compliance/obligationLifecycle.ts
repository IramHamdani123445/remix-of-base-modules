/**
 * Compliance obligation lifecycle — pure planning logic.
 *
 * Everything here is deterministic and IO-free so it can be unit tested with
 * explicit dates. The edge worker (`ce-obligation-lifecycle`) supplies facts
 * and persists the results; it contains no calendar or policy logic of its own.
 *
 * MIRROR: supabase/functions/_shared/compliance/obligationLifecycle.ts must
 * stay byte-identical (asserted by
 * src/__tests__/compliance/obligation-resolver-parity.test.ts).
 */

import {
  type CeFilingOutcome,
  type CeObligationPolicy,
  type CeObligationTimeline,
  type CeObligationType,
  type CePaymentOutcome,
  type CeReminderRule,
  addMonths,
  evaluateFilingObligation,
  evaluatePaymentObligation,
  isOutstandingFiling,
  isOutstandingPayment,
  reminderAppliesTo,
  resolveObligationTimeline,
  resolveReminderDate,
  resolveReminderSchedule,
  toYearMonth,
} from "./obligationDeadlineResolver.ts";

/** Facts known about one employer/wage period. */
export interface CePeriodFacts {
  /** Date the C3 was received, null when nothing was received. */
  filing_received_date?: string | null;
  /** A valid NIL return is a submitted report. */
  filing_is_nil?: boolean;
  declared_amount?: number;
  paid_amount?: number;
  last_payment_date?: string | null;
}

export interface CeObligationRow {
  employer_id: string;
  employer_name: string | null;
  obligation_type: CeObligationType;
  wage_period: string;
  reporting_period: string;
  due_date: string;
  grace_days: number;
  grace_end_date: string;
  violation_effective_date: string;
  deadline_basis: string;
  reminder_schedule: Array<{ rule_code: string; scheduled_date: string; template_code: string; channels: string[] }>;
  filing_received_date: string | null;
  filing_is_nil: boolean;
  declared_amount: number;
  paid_amount: number;
  last_payment_date: string | null;
  filing_status: CeFilingOutcome | "NOT_APPLICABLE";
  payment_status: CePaymentOutcome | "NOT_APPLICABLE";
  is_outstanding: boolean;
}

/** Wage periods from an employer's compliance start to the last complete month. */
export function enumerateWagePeriods(
  startPeriod: string,
  lastCompletePeriod: string,
  capMonths: number,
): string[] {
  const last = toYearMonth(lastCompletePeriod);
  const capStart = addMonths(last, -(Math.max(0, capMonths) - 1));
  let cursor = toYearMonth(startPeriod);
  if (cursor < capStart) cursor = capStart;
  const out: string[] = [];
  while (cursor <= last && out.length <= capMonths) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return out;
}

/**
 * Build the two obligation rows (filing + payment) for one employer/period.
 * `filingPolicy` and `paymentPolicy` share the same deadline basis owner and
 * differ only in their configured grace days.
 */
export function buildObligationRows(input: {
  employerId: string;
  employerName?: string | null;
  wagePeriod: string;
  facts: CePeriodFacts;
  filingPolicy: CeObligationPolicy;
  paymentPolicy: CeObligationPolicy;
  reminderRules: CeReminderRule[];
  asOf: string;
  /** Dormant / inapplicable employers produce NOT_APPLICABLE rows. */
  applicable?: boolean;
}): CeObligationRow[] {
  const {
    employerId,
    employerName = null,
    wagePeriod,
    facts,
    filingPolicy,
    paymentPolicy,
    reminderRules,
    asOf,
  } = input;
  const applicable = input.applicable !== false;

  const filingTimeline = resolveObligationTimeline(wagePeriod, filingPolicy, "C3_FILING");
  const paymentTimeline = resolveObligationTimeline(wagePeriod, paymentPolicy, "CONTRIBUTION_PAYMENT");

  const received = facts.filing_received_date ? String(facts.filing_received_date).slice(0, 10) : null;
  const declared = Number(facts.declared_amount ?? 0);
  const paid = Number(facts.paid_amount ?? 0);

  const filingOutcome: CeObligationRow["filing_status"] = applicable
    ? evaluateFilingObligation({ timeline: filingTimeline, filingReceivedDate: received, asOf })
    : "NOT_APPLICABLE";

  // Payment can only be assessed once a declaration exists; an unreported
  // period is a filing problem, not a payment problem.
  const paymentOutcome: CeObligationRow["payment_status"] = !applicable
    ? "NOT_APPLICABLE"
    : received
      ? evaluatePaymentObligation({
          timeline: paymentTimeline,
          declaredAmount: declared,
          paidAmount: paid,
          asOf,
        })
      : "PENDING";

  const row = (
    timeline: CeObligationTimeline,
    filing_status: CeObligationRow["filing_status"],
    payment_status: CeObligationRow["payment_status"],
    outstanding: boolean,
  ): CeObligationRow => ({
    employer_id: employerId,
    employer_name: employerName,
    obligation_type: timeline.obligation_type,
    wage_period: timeline.wage_period,
    reporting_period: timeline.reporting_period,
    due_date: timeline.due_date,
    grace_days: timeline.grace_days,
    grace_end_date: timeline.grace_end_date,
    violation_effective_date: timeline.violation_effective_date,
    deadline_basis: timeline.deadline_basis,
    reminder_schedule: resolveReminderSchedule(timeline, reminderRules),
    filing_received_date: received,
    filing_is_nil: facts.filing_is_nil === true,
    declared_amount: declared,
    paid_amount: paid,
    last_payment_date: facts.last_payment_date ?? null,
    filing_status,
    payment_status,
    is_outstanding: outstanding,
  });

  return [
    row(
      filingTimeline,
      filingOutcome,
      "NOT_APPLICABLE",
      applicable && isOutstandingFiling(filingOutcome as CeFilingOutcome),
    ),
    row(
      paymentTimeline,
      "NOT_APPLICABLE",
      paymentOutcome,
      applicable && paymentOutcome !== "NOT_APPLICABLE" && isOutstandingPayment(paymentOutcome as CePaymentOutcome),
    ),
  ];
}

/* ─────────────────────── consolidated reminder planning ─────────────────── */

export interface CeNoticePlanPeriod {
  employer_id: string;
  obligation_type: CeObligationType;
  wage_period: string;
  state: string;
}

export interface CeNoticePlan {
  employer_id: string;
  employer_name: string | null;
  rule_code: string;
  template_code: string;
  channels: string[];
  audience: string;
  obligation_type: string;
  /** Reporting cycle the reminder belongs to; makes the run idempotent. */
  cycle_key: string;
  periods: CeNoticePlanPeriod[];
}

/**
 * Which reminders fire on `asOf`, and which periods each message covers.
 *
 * Consolidation (client decision, 20 August 2026): one message per reminder
 * cycle listing every applicable outstanding period, instead of one message per
 * period. The underlying obligation rows stay separate and auditable, and the
 * exact periods included are returned so they can be linked to the notice.
 */
export function planReminderNotices(input: {
  asOf: string;
  rules: CeReminderRule[];
  obligations: CeObligationRow[];
  filingPolicy: CeObligationPolicy;
  paymentPolicy: CeObligationPolicy;
}): CeNoticePlan[] {
  const { asOf, rules, obligations, filingPolicy, paymentPolicy } = input;
  const asOfMonth = toYearMonth(asOf);
  const plans: CeNoticePlan[] = [];

  for (const rule of rules) {
    if (!rule.is_enabled) continue;

    // The cycle period is the wage period whose reminder falls on `asOf`.
    const policy = rule.obligation_type === "CONTRIBUTION_PAYMENT" ? paymentPolicy : filingPolicy;
    const cycleWagePeriod = addMonths(asOfMonth, -policy.reporting_offset_months);
    const cycleTimeline = resolveObligationTimeline(
      cycleWagePeriod,
      policy,
      rule.obligation_type === "CONTRIBUTION_PAYMENT" ? "CONTRIBUTION_PAYMENT" : "C3_FILING",
    );
    if (resolveReminderDate(cycleTimeline, rule) !== asOf) continue;

    // Group every applicable, not-yet-discharged obligation by employer.
    const byEmployer = new Map<string, { name: string | null; periods: CeNoticePlanPeriod[] }>();
    for (const o of obligations) {
      if (!reminderAppliesTo(rule, o.obligation_type)) continue;
      const undischarged =
        o.obligation_type === "C3_FILING"
          ? o.filing_status === "PENDING" || o.filing_status === "UNREPORTED"
          : o.payment_status === "PENDING" || o.payment_status === "NOT_PAID" || o.payment_status === "PARTIALLY_PAID";
      if (!undischarged) continue;
      // Never remind about a period whose reminder cycle has not started yet.
      if (o.wage_period > cycleWagePeriod) continue;
      let bucket = byEmployer.get(o.employer_id);
      if (!bucket) {
        bucket = { name: o.employer_name ?? null, periods: [] };
        byEmployer.set(o.employer_id, bucket);
      }
      bucket.periods.push({
        employer_id: o.employer_id,
        obligation_type: o.obligation_type,
        wage_period: o.wage_period,
        state: o.obligation_type === "C3_FILING" ? o.filing_status : o.payment_status,
      });
    }

    for (const [employerId, bucket] of byEmployer) {
      if (bucket.periods.length === 0) continue;
      const sorted = bucket.periods.sort((a, b) =>
        a.wage_period === b.wage_period
          ? a.obligation_type < b.obligation_type
            ? -1
            : 1
          : a.wage_period < b.wage_period
            ? -1
            : 1,
      );
      if (rule.consolidate_periods) {
        plans.push({
          employer_id: employerId,
          employer_name: bucket.name,
          rule_code: rule.rule_code,
          template_code: rule.template_code,
          channels: rule.channels ?? [],
          audience: rule.audience,
          obligation_type: rule.obligation_type,
          cycle_key: cycleTimeline.reporting_period,
          periods: sorted,
        });
      } else {
        for (const p of sorted) {
          plans.push({
            employer_id: employerId,
            employer_name: bucket.name,
            rule_code: rule.rule_code,
            template_code: rule.template_code,
            channels: rule.channels ?? [],
            audience: rule.audience,
            obligation_type: rule.obligation_type,
            cycle_key: `${cycleTimeline.reporting_period}:${p.obligation_type}:${p.wage_period}`,
            periods: [p],
          });
        }
      }
    }
  }

  return plans;
}

/** Human-readable outstanding-period list used by the notice payload. */
export function describeOutstandingPeriods(periods: CeNoticePlanPeriod[]): string {
  const months = [...new Set(periods.map((p) => p.wage_period))].sort();
  return months
    .map((ym) => {
      const [y, m] = ym.split("-");
      const name = new Date(Date.UTC(Number(y), Number(m) - 1, 1)).toLocaleString("en-GB", {
        month: "long",
        timeZone: "UTC",
      });
      return `${name} ${y}`;
    })
    .join(", ");
}
