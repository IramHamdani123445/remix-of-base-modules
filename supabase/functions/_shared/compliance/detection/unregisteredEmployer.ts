/**
 * DR-008 Unregistered employer operating.
 *
 * Client-approved semantics (Compliance Business Review):
 *  - Leads originate exclusively from the existing inspection/scouting
 *    workflow (a field officer physically observes or is tipped off about a
 *    business). There is, and must never be, an automated external
 *    business-registry crawler feeding this rule.
 *  - A lead is matched against the employer register by trade/business name
 *    and/or address, per configuration. A confident match means the "lead"
 *    is really an already-registered employer and produces no flag.
 *  - An unmatched, brand-new lead is escalated as a REVIEW FLAG (never a
 *    violation) so a human decides whether to instruct registration.
 *  - Once compliance instructs the business to register, St Kitts defaults
 *    give it `registrationResponseDays` (default 14) to register. If still
 *    unresolved after `managementEscalationDays` (default 21) it is escalated
 *    to Compliance Management.
 *  - Serious cases may be recommended for Legal immediately, but that
 *    recommendation NEVER auto-approves — a management/senior approval
 *    (`legalApprovedBy`) is always required first.
 *  - `registeredEmployerId` being set means the lead resolved by the
 *    business actually registering; no further action.
 *
 * All response/escalation windows arrive as configuration — nothing here is
 * hard-coded, so operational policy changes require no code change.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/unregisteredEmployer.ts
 */

import { buildReviewFlag, type CeReviewFlagRecord } from "./reviewFlag.ts";

export interface CeEmployerRegisterEntry {
  employerId: string;
  tradeName: string;
  legalName?: string;
  address?: string;
}

export interface CeScoutingLead {
  leadId: string;
  tradeName: string;
  businessAddress?: string;
  discoveredDate: string;
  sourceType: "INSPECTION" | "SCOUTING";
  sourceReference?: string;
  estimatedEmployees?: number;
  status: string;
  instructedAt?: string | null;
  registeredEmployerId?: string | null;
  legalRecommended?: boolean;
  legalApprovedBy?: string | null;
}

export interface CeLeadMatchConfig {
  matchOnTradeName: boolean;
  matchOnAddress: boolean;
}

export interface CeLeadLifecycleConfig {
  registrationResponseDays: number;
  managementEscalationDays: number;
}

export interface CeLeadMatch {
  employerId: string;
  method: "TRADE_NAME" | "ADDRESS" | "TRADE_NAME_AND_ADDRESS";
  confidence: number;
}

/** Legal-entity suffixes stripped for fuzzy business-name comparison. */
const LEGAL_SUFFIXES = ["ltd", "limited", "inc", "co"];

/** Lowercase, strip punctuation and legal suffixes, collapse whitespace. */
export function normalizeBusinessText(v?: string | null): string {
  if (!v) return "";
  let text = v.toLowerCase();
  text = text.replace(/[.,'"()\-_/&]/g, " ");
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !LEGAL_SUFFIXES.includes(w));
  return words.join(" ").trim();
}

/**
 * Attempt to match a scouting lead to an existing register entry using the
 * configured signals. Trade name and address are both normalized before
 * comparison. Returns undefined when no configured signal matches.
 */
export function matchLeadToRegister(
  lead: CeScoutingLead,
  register: CeEmployerRegisterEntry[],
  config: CeLeadMatchConfig,
): CeLeadMatch | undefined {
  const leadTradeName = normalizeBusinessText(lead.tradeName);
  const leadAddress = normalizeBusinessText(lead.businessAddress);

  for (const entry of register) {
    const nameMatch =
      config.matchOnTradeName &&
      leadTradeName.length > 0 &&
      (normalizeBusinessText(entry.tradeName) === leadTradeName ||
        normalizeBusinessText(entry.legalName) === leadTradeName);

    const addressMatch =
      config.matchOnAddress &&
      leadAddress.length > 0 &&
      normalizeBusinessText(entry.address) === leadAddress;

    if (nameMatch && addressMatch) {
      return { employerId: entry.employerId, method: "TRADE_NAME_AND_ADDRESS", confidence: 1 };
    }
    if (nameMatch) {
      return { employerId: entry.employerId, method: "TRADE_NAME", confidence: 0.75 };
    }
    if (addressMatch) {
      return { employerId: entry.employerId, method: "ADDRESS", confidence: 0.6 };
    }
  }

  return undefined;
}

export type CeLeadAction =
  | "RAISE_REVIEW_FLAG"
  | "MARK_MATCHED"
  | "ESCALATE_TO_MANAGEMENT"
  | "AWAIT_REGISTRATION"
  | "RESOLVE_REGISTERED"
  | "AWAIT_LEGAL_APPROVAL"
  | "NO_ACTION";

export interface CeLeadEvaluation {
  leadId: string;
  action: CeLeadAction;
  matched?: CeLeadMatch;
  registerByDate?: string;
  managementEscalationDue?: string;
  daysSinceInstruction?: number;
  summary: string;
}

/** Add whole days to an ISO date (YYYY-MM-DD), returning an ISO date. */
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (b - a), UTC-safe. */
function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / 86_400_000);
}

/**
 * Evaluate a single scouting/inspection lead against the employer register
 * and the current lifecycle configuration, deriving the single next action.
 */
export function evaluateLead(
  lead: CeScoutingLead,
  register: CeEmployerRegisterEntry[],
  match: CeLeadMatchConfig,
  lifecycle: CeLeadLifecycleConfig,
  asOf: string,
): CeLeadEvaluation {
  if (lead.registeredEmployerId) {
    return {
      leadId: lead.leadId,
      action: "RESOLVE_REGISTERED",
      summary: `Lead ${lead.leadId} resolved: business registered as ${lead.registeredEmployerId}`,
    };
  }

  const matched = matchLeadToRegister(lead, register, match);
  if (matched) {
    return {
      leadId: lead.leadId,
      action: "MARK_MATCHED",
      matched,
      summary: `Lead ${lead.leadId} matches existing employer ${matched.employerId} (${matched.method})`,
    };
  }

  if (lead.legalRecommended && !lead.legalApprovedBy) {
    return {
      leadId: lead.leadId,
      action: "AWAIT_LEGAL_APPROVAL",
      summary: `Lead ${lead.leadId} recommended for Legal but requires management/senior approval first`,
    };
  }

  if (lead.instructedAt) {
    const registerByDate = addDays(lead.instructedAt, lifecycle.registrationResponseDays);
    const managementEscalationDue = addDays(lead.instructedAt, lifecycle.managementEscalationDays);
    const daysSinceInstruction = daysBetween(lead.instructedAt, asOf);

    if (daysSinceInstruction > lifecycle.managementEscalationDays) {
      return {
        leadId: lead.leadId,
        action: "ESCALATE_TO_MANAGEMENT",
        registerByDate,
        managementEscalationDue,
        daysSinceInstruction,
        summary: `Lead ${lead.leadId} unresolved ${daysSinceInstruction} days after instruction — escalate to Compliance Management`,
      };
    }

    return {
      leadId: lead.leadId,
      action: "AWAIT_REGISTRATION",
      registerByDate,
      managementEscalationDue,
      daysSinceInstruction,
      summary: `Lead ${lead.leadId} awaiting registration (due ${registerByDate})`,
    };
  }

  return {
    leadId: lead.leadId,
    action: "RAISE_REVIEW_FLAG",
    summary: `Unmatched ${lead.sourceType.toLowerCase()} lead ${lead.leadId} for "${lead.tradeName}" requires review`,
  };
}

/** Build the review-flag record for a lead evaluation whose action is RAISE_REVIEW_FLAG. */
export function buildUnregisteredLeadFlag(
  ev: CeLeadEvaluation,
  lead: CeScoutingLead,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  return buildReviewFlag({
    flag_type: "UNREGISTERED_EMPLOYER_LEAD",
    rule_code: ruleCode,
    rule_id: ruleId,
    subject_type: "LEAD",
    subject_id: lead.leadId,
    subject_name: lead.tradeName,
    period_key: "ALL",
    summary: ev.summary,
    evidence: {
      dedupe_discriminator: lead.leadId,
      tradeName: lead.tradeName,
      businessAddress: lead.businessAddress,
      sourceType: lead.sourceType,
      sourceReference: lead.sourceReference,
      matchAttempt: ev.matched ?? null,
      registerByDate: ev.registerByDate ?? null,
      managementEscalationDue: ev.managementEscalationDue ?? null,
    },
  });
}
