/**
 * DR-013 Self-employed (and voluntary) contributor compliance.
 *
 * The legacy "3 consecutive months unpaid" heuristic is retired. Self-employed
 * / voluntary contributors are now modelled with the SAME obligation timeline
 * as employers (Checkpoint A, `obligationDeadlineResolver.ts`):
 *  - reminders follow the same day-3 / day-20 style cycles as employers under
 *    the current St Kitts configuration (the actual dates come from the
 *    reminder rules — this module just evaluates the underlying obligation);
 *  - a violation / flag is only raised after the applicable grace deadline,
 *    never before;
 *  - multiple outstanding months for one person are consolidated into ONE
 *    communication, not one per month;
 *  - there is NO automatic Legal escalation for self-employed non-compliance
 *    — legal referral stays a manual, capability-gated action;
 *  - if the same person/period is also reported by an employer, that is
 *    flagged for a human to suppress/resolve the self-employed obligation —
 *    it is never auto-resolved by this module;
 *  - over-contribution is identified but only ever becomes a CREDIT/OFFSET,
 *    never an automatic cash refund (Finance decides the actual refund);
 *  - people reported by MULTIPLE employers for the same period are also
 *    identified, independent of any self-employed obligation;
 *  - voluntary contributors are included in all of this when configured.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/selfEmployedCompliance.ts
 */

import {
  evaluateFilingObligation,
  evaluatePaymentObligation,
  resolveObligationTimeline,
  type CeObligationPolicy,
} from "../obligationDeadlineResolver.ts";
import { buildReviewFlag, type CeReviewFlagDraft, type CeReviewFlagRecord } from "./reviewFlag.ts";

/** Documents (and enforces via test) that legal referral for self-employed non-compliance is manual only. */
export const SELF_EMPLOYED_LEGAL_ESCALATION_IS_MANUAL_ONLY = true as const;

export interface CeSelfEmployedObligation {
  obligationId?: string;
  personSsn: string;
  personName?: string;
  contributorType: "SELF_EMPLOYED" | "VOLUNTARY";
  periodKey: string;
  expectedAmount: number;
  declaredAmount: number;
  paidAmount: number;
  filingReceivedDate?: string | null;
  paymentReceivedDate?: string | null;
  suppressed?: boolean;
  employerReported?: boolean;
  employerReportedBy?: string;
}

export interface CeSelfEmployedConfig {
  includeVoluntary: boolean;
  consolidateReminders: boolean;
  /** Must always be false — asserted by tests; kept explicit/configurable rather than hard-coded away. */
  autoLegalEscalation: boolean;
  overContributionCreatesCredit: boolean;
  flagEmployerOverlap: boolean;
}

export type CeSelfEmployedOutcome =
  | "NOT_YET_DUE"
  | "SATISFIED"
  | "OUTSTANDING_FILING"
  | "OUTSTANDING_PAYMENT"
  | "SUPPRESSED"
  | "EXCLUDED";

export interface CeSelfEmployedEvaluation {
  personSsn: string;
  contributorType: string;
  periodKey: string;
  outcome: CeSelfEmployedOutcome;
  dueDate: string;
  graceEndDate: string;
  shortfall: number;
  overContribution: number;
  summary: string;
}

function isExcluded(o: CeSelfEmployedObligation, config: CeSelfEmployedConfig): boolean {
  return o.contributorType === "VOLUNTARY" && !config.includeVoluntary;
}

/**
 * Evaluate one self-employed/voluntary obligation against the shared
 * Checkpoint A obligation timeline. Never raises anything before the
 * applicable grace deadline.
 */
export function evaluateSelfEmployedObligation(
  o: CeSelfEmployedObligation,
  policy: CeObligationPolicy,
  config: CeSelfEmployedConfig,
  asOf: string,
): CeSelfEmployedEvaluation {
  const timeline = resolveObligationTimeline(o.periodKey, policy, "CONTRIBUTION_PAYMENT");
  const declared = Number(o.declaredAmount) || 0;
  const expected = Number(o.expectedAmount) || 0;
  const paid = Number(o.paidAmount) || 0;
  const overContribution = Math.max(0, paid - Math.max(declared, expected));
  const shortfall = Math.max(0, Math.max(declared, expected) - paid);

  const base = {
    personSsn: o.personSsn,
    contributorType: o.contributorType,
    periodKey: o.periodKey,
    dueDate: timeline.due_date,
    graceEndDate: timeline.grace_end_date,
    overContribution,
  };

  if (isExcluded(o, config)) {
    return {
      ...base,
      outcome: "EXCLUDED",
      shortfall: 0,
      summary: `${o.personSsn} excluded from self-employed compliance (voluntary contributors not included).`,
    };
  }

  if (o.suppressed) {
    return {
      ...base,
      outcome: "SUPPRESSED",
      shortfall,
      summary: `${o.personSsn} obligation for ${o.periodKey} suppressed (e.g. resolved via employer overlap review).`,
    };
  }

  const filingOutcome = evaluateFilingObligation({
    timeline,
    filingReceivedDate: o.filingReceivedDate,
    asOf,
  });
  const paymentOutcome = evaluatePaymentObligation({
    timeline,
    declaredAmount: Math.max(declared, expected),
    paidAmount: paid,
    asOf,
  });

  if (filingOutcome === "PENDING" && paymentOutcome === "PENDING") {
    return {
      ...base,
      outcome: "NOT_YET_DUE",
      shortfall,
      summary: `${o.personSsn} obligation for ${o.periodKey} not yet due (before ${timeline.grace_end_date}).`,
    };
  }

  if (filingOutcome === "UNREPORTED") {
    return {
      ...base,
      outcome: "OUTSTANDING_FILING",
      shortfall,
      summary: `${o.personSsn} has an outstanding self-employed filing for ${o.periodKey}.`,
    };
  }

  if (paymentOutcome === "NOT_PAID" || paymentOutcome === "PARTIALLY_PAID") {
    return {
      ...base,
      outcome: "OUTSTANDING_PAYMENT",
      shortfall,
      summary: `${o.personSsn} has an outstanding self-employed contribution for ${o.periodKey} (shortfall ${shortfall.toFixed(2)}).`,
    };
  }

  return {
    ...base,
    outcome: "SATISFIED",
    shortfall: 0,
    summary: `${o.personSsn} self-employed obligation for ${o.periodKey} satisfied.`,
  };
}

export function evaluateSelfEmployedPortfolio(
  items: CeSelfEmployedObligation[],
  policy: CeObligationPolicy,
  config: CeSelfEmployedConfig,
  asOf: string,
): CeSelfEmployedEvaluation[] {
  return items.map((item) => evaluateSelfEmployedObligation(item, policy, config, asOf));
}

/* ─────────────────────────── consolidated reminders ─────────────────────────── */

export interface CeConsolidatedReminder {
  personSsn: string;
  contributorType: string;
  periods: string[];
  totalOutstanding: number;
  summary: string;
}

const OUTSTANDING_OUTCOMES: CeSelfEmployedOutcome[] = ["OUTSTANDING_FILING", "OUTSTANDING_PAYMENT"];

/**
 * Builds reminders for outstanding self-employed obligations. When
 * `consolidateReminders` is true, every outstanding period for one person is
 * merged into a single communication; otherwise one reminder per period.
 */
export function consolidateSelfEmployedReminders(
  evaluations: CeSelfEmployedEvaluation[],
  obligations: CeSelfEmployedObligation[],
  config: CeSelfEmployedConfig,
): CeConsolidatedReminder[] {
  const outstanding = evaluations.filter((e) => OUTSTANDING_OUTCOMES.includes(e.outcome));
  const shortfallByKey = new Map<string, number>();
  for (const o of obligations) {
    shortfallByKey.set(`${o.personSsn}|${o.periodKey}`, Number(o.expectedAmount || 0) - Number(o.paidAmount || 0));
  }

  if (!config.consolidateReminders) {
    return outstanding.map((e) => ({
      personSsn: e.personSsn,
      contributorType: e.contributorType,
      periods: [e.periodKey],
      totalOutstanding: Math.max(0, shortfallByKey.get(`${e.personSsn}|${e.periodKey}`) ?? e.shortfall),
      summary: `Reminder to ${e.personSsn} for outstanding period ${e.periodKey}.`,
    }));
  }

  const byPerson = new Map<string, CeSelfEmployedEvaluation[]>();
  for (const e of outstanding) {
    const list = byPerson.get(e.personSsn) ?? [];
    list.push(e);
    byPerson.set(e.personSsn, list);
  }

  const result: CeConsolidatedReminder[] = [];
  for (const [personSsn, list] of byPerson) {
    const periods = [...list].sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1)).map((e) => e.periodKey);
    const total = periods.reduce(
      (sum, p) => sum + Math.max(0, shortfallByKey.get(`${personSsn}|${p}`) ?? 0),
      0,
    );
    result.push({
      personSsn,
      contributorType: list[0].contributorType,
      periods,
      totalOutstanding: total,
      summary: `Consolidated reminder to ${personSsn} covering ${periods.length} outstanding period(s): ${periods.join(", ")}.`,
    });
  }
  return result;
}

/* ─────────────────────────── over-contribution credits ─────────────────────────── */

export interface CeContributionCreditDraft {
  personSsn: string;
  periodKey: string;
  amount: number;
  sourceType: "OVER_CONTRIBUTION";
  treatment: "CREDIT_OFFSET";
  financeHandoffRequired: boolean;
  summary: string;
}

/**
 * Over-contribution is never an automatic cash refund. It always produces a
 * CREDIT_OFFSET draft for the person's account; Finance is only pulled in
 * (financeHandoffRequired) when their coverage has ended and there is no
 * further liability to offset against.
 */
export function computeOverContributionCredits(
  items: CeSelfEmployedObligation[],
  config: CeSelfEmployedConfig,
  opts?: { coverageEnded?: Record<string, boolean> },
): CeContributionCreditDraft[] {
  if (!config.overContributionCreatesCredit) return [];
  const coverageEnded = opts?.coverageEnded ?? {};
  const drafts: CeContributionCreditDraft[] = [];
  for (const o of items) {
    if (isExcluded(o, config)) continue;
    const paid = Number(o.paidAmount) || 0;
    const owed = Math.max(Number(o.declaredAmount) || 0, Number(o.expectedAmount) || 0);
    const overpaid = paid - owed;
    if (overpaid <= 0) continue;
    const financeHandoffRequired = coverageEnded[o.personSsn] === true;
    drafts.push({
      personSsn: o.personSsn,
      periodKey: o.periodKey,
      amount: overpaid,
      sourceType: "OVER_CONTRIBUTION",
      treatment: "CREDIT_OFFSET",
      financeHandoffRequired,
      summary: `Over-contribution of ${overpaid.toFixed(2)} for ${o.personSsn} (${o.periodKey}) recorded as a credit offset${financeHandoffRequired ? " with a Finance hand-off (coverage ended)" : ""}.`,
    });
  }
  return drafts;
}

/* ─────────────────────────── employer overlap ─────────────────────────── */

export interface CeEmployerReportedPeriod {
  personSsn: string;
  periodKey: string;
  employerId: string;
}

export interface CeSelfEmployedOverlap {
  personSsn: string;
  periodKey: string;
  employerIds: string[];
  summary: string;
}

/**
 * A person who has a self-employed obligation for a period AND is also
 * reported by at least one employer for the same period is flagged so a
 * human can suppress/resolve the self-employed side — never resolved
 * automatically.
 */
export function detectEmployerOverlap(
  items: CeSelfEmployedObligation[],
  employerReported: CeEmployerReportedPeriod[],
  config: CeSelfEmployedConfig,
): CeSelfEmployedOverlap[] {
  if (!config.flagEmployerOverlap) return [];
  const byKey = new Map<string, Set<string>>();
  for (const rep of employerReported) {
    const key = `${rep.personSsn}|${rep.periodKey}`;
    const set = byKey.get(key) ?? new Set<string>();
    set.add(rep.employerId);
    byKey.set(key, set);
  }

  const overlaps: CeSelfEmployedOverlap[] = [];
  for (const item of items) {
    if (isExcluded(item, config)) continue;
    const key = `${item.personSsn}|${item.periodKey}`;
    const employerIds = byKey.get(key);
    if (!employerIds || employerIds.size === 0) continue;
    const ids = [...employerIds].sort();
    overlaps.push({
      personSsn: item.personSsn,
      periodKey: item.periodKey,
      employerIds: ids,
      summary: `${item.personSsn} has a self-employed obligation for ${item.periodKey} but is also reported by employer(s) ${ids.join(", ")}.`,
    });
  }
  return overlaps;
}

/** People reported by MULTIPLE employers for the same period, independent of self-employed status. */
export function detectMultiEmployerReporting(
  employerReported: CeEmployerReportedPeriod[],
): CeSelfEmployedOverlap[] {
  const byKey = new Map<string, Set<string>>();
  for (const rep of employerReported) {
    const key = `${rep.personSsn}|${rep.periodKey}`;
    const set = byKey.get(key) ?? new Set<string>();
    set.add(rep.employerId);
    byKey.set(key, set);
  }

  const result: CeSelfEmployedOverlap[] = [];
  for (const [key, employerIds] of byKey) {
    if (employerIds.size < 2) continue;
    const [personSsn, periodKey] = key.split("|");
    const ids = [...employerIds].sort();
    result.push({
      personSsn,
      periodKey,
      employerIds: ids,
      summary: `${personSsn} was reported by ${ids.length} employers (${ids.join(", ")}) for period ${periodKey}.`,
    });
  }
  return result.sort((a, b) => (a.personSsn + a.periodKey < b.personSsn + b.periodKey ? -1 : 1));
}

/* ─────────────────────────── review flag builders ─────────────────────────── */

export function buildSelfEmployedOverlapFlag(
  overlap: CeSelfEmployedOverlap,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  const draft: CeReviewFlagDraft = {
    flag_type: "SELF_EMPLOYED_EMPLOYER_OVERLAP",
    rule_code: ruleCode,
    rule_id: ruleId,
    subject_type: "PERSON",
    subject_id: overlap.personSsn,
    period_key: overlap.periodKey,
    summary: overlap.summary,
    evidence: { employerIds: overlap.employerIds, periodKey: overlap.periodKey },
  };
  return buildReviewFlag(draft);
}

export function buildMultiEmployerFlag(
  overlap: CeSelfEmployedOverlap,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  const draft: CeReviewFlagDraft = {
    flag_type: "MULTI_EMPLOYER_REPORTING",
    rule_code: ruleCode,
    rule_id: ruleId,
    subject_type: "PERSON",
    subject_id: overlap.personSsn,
    period_key: overlap.periodKey,
    summary: overlap.summary,
    evidence: { employerIds: overlap.employerIds, periodKey: overlap.periodKey },
  };
  return buildReviewFlag(draft);
}
