/**
 * DR-011 (improper cessation) and DR-012 (contribution/reporting gap) rules,
 * plus the shared employer-status-change validation used by the
 * `ce_set_employer_status_v1` RPC mirror.
 *
 * Client-confirmed semantics:
 *  - Authoritative employer statuses are ACTIVE, INACTIVE, CLOSED, CEASED.
 *    No UI-only status values are permitted here.
 *  - Every status change must carry supporting evidence (an inspector visit,
 *    an employer-submitted form, or another configured evidence source) and
 *    leave a documented audit trail (evidenceType + evidenceReference).
 *  - Moving an employer to Inactive/Closed/Ceased must never erase historical
 *    obligations or violations — history is always preserved, only new
 *    obligation generation stops going forward.
 *  - DR-011 flags an "improper" cessation: a status change into a ceasing
 *    status while money, a clearance certificate, obligations or violations
 *    are still outstanding.
 *  - DR-012 is a REAL gap in the obligation history (missed filings/payments
 *    against genuinely expected periods), not a generic "two missed months"
 *    heuristic.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/employerStatusRules.ts
 */

/** Authoritative employer statuses (no UI-only values). */
export type CeEmployerStatus = "ACTIVE" | "INACTIVE" | "CLOSED" | "CEASED";

export const CE_EMPLOYER_STATUSES: readonly CeEmployerStatus[] = [
  "ACTIVE",
  "INACTIVE",
  "CLOSED",
  "CEASED",
];

/** Evidence sources accepted in support of a status change. */
export type CeStatusEvidenceType =
  | "INSPECTOR_VISIT"
  | "EMPLOYER_FORM"
  | "REGISTRY_NOTICE"
  | "COURT_ORDER"
  | "SYSTEM_MIGRATION"
  | "OTHER_DOCUMENTED";

export const CE_STATUS_EVIDENCE_TYPES: readonly CeStatusEvidenceType[] = [
  "INSPECTOR_VISIT",
  "EMPLOYER_FORM",
  "REGISTRY_NOTICE",
  "COURT_ORDER",
  "SYSTEM_MIGRATION",
  "OTHER_DOCUMENTED",
];

/** Capability required to change an employer's status (mirrors the RPC guard). */
export const EMPLOYER_STATUS_CHANGE_CAPABILITY = "compliance.employer_status.change";

export interface CeStatusChangeRequest {
  employerId: string;
  toStatus: string;
  evidenceType?: string;
  evidenceReference?: string;
  reason?: string;
  effectiveDate?: string;
  clearanceCertificateReference?: string;
  actorCapabilities: string[];
}

export interface CeStatusChangeValidation {
  ok: boolean;
  errorCode?: string;
  message?: string;
}

/**
 * Validates an employer status change request exactly as
 * `ce_set_employer_status_v1` does server-side: unknown status, missing or
 * unknown evidence type, blank evidence reference, or a missing capability
 * are all rejected before any status mutation is attempted.
 */
export function validateStatusChange(req: CeStatusChangeRequest): CeStatusChangeValidation {
  if (!req.actorCapabilities?.includes(EMPLOYER_STATUS_CHANGE_CAPABILITY)) {
    return {
      ok: false,
      errorCode: "CE-EST-403",
      message: `Actor lacks required capability "${EMPLOYER_STATUS_CHANGE_CAPABILITY}".`,
    };
  }
  if (!CE_EMPLOYER_STATUSES.includes(req.toStatus as CeEmployerStatus)) {
    return {
      ok: false,
      errorCode: "CE-EST-422",
      message: `Unknown employer status "${req.toStatus}". Expected one of: ${CE_EMPLOYER_STATUSES.join(", ")}.`,
    };
  }
  if (!req.evidenceType || !CE_STATUS_EVIDENCE_TYPES.includes(req.evidenceType as CeStatusEvidenceType)) {
    return {
      ok: false,
      errorCode: "CE-EST-422",
      message: `Unknown or missing evidence type "${req.evidenceType}". Expected one of: ${CE_STATUS_EVIDENCE_TYPES.join(", ")}.`,
    };
  }
  if (!req.evidenceReference || req.evidenceReference.trim().length === 0) {
    return {
      ok: false,
      errorCode: "CE-EST-422",
      message: "A non-blank evidence reference is required to support the status change audit trail.",
    };
  }
  return { ok: true };
}

/* ─────────────────────────── DR-011: improper cessation ─────────────────────────── */

export interface CeCessationInput {
  employerId: string;
  employerName?: string;
  status: CeEmployerStatus;
  effectiveDate: string;
  outstandingAmount: number;
  clearanceCertificateReference?: string | null;
  openObligationPeriods?: string[];
  openViolationCount?: number;
}

export interface CeCessationConfig {
  /** Statuses considered a "cessation" event worth evaluating (e.g. ["CLOSED", "CEASED"]). */
  triggerOnStatus: string[];
  requireClearanceCertificate: boolean;
  minOutstandingAmountXcd: number;
}

export interface CeCessationFinding {
  employerId: string;
  employerName?: string;
  reasons: string[];
  outstandingAmount: number;
  openObligationPeriods: string[];
  summary: string;
}

/**
 * DR-011: an employer cessation (closed/ceased) is improper when it leaves
 * outstanding money, a missing clearance certificate, open obligation
 * periods, or open violations behind it. Only statuses configured in
 * `triggerOnStatus` are evaluated at all.
 */
export function evaluateImproperCessation(
  input: CeCessationInput,
  config: CeCessationConfig,
): CeCessationFinding | undefined {
  if (!config.triggerOnStatus.includes(input.status)) return undefined;

  const reasons: string[] = [];
  const outstanding = Number(input.outstandingAmount) || 0;
  if (outstanding > config.minOutstandingAmountXcd) {
    reasons.push("OUTSTANDING_BALANCE");
  }
  if (config.requireClearanceCertificate && !input.clearanceCertificateReference) {
    reasons.push("NO_CLEARANCE_CERTIFICATE");
  }
  const openObligationPeriods = input.openObligationPeriods ?? [];
  if (openObligationPeriods.length > 0) {
    reasons.push("OPEN_OBLIGATIONS");
  }
  if ((input.openViolationCount ?? 0) > 0) {
    reasons.push("OPEN_VIOLATIONS");
  }

  if (reasons.length === 0) return undefined;

  return {
    employerId: input.employerId,
    employerName: input.employerName,
    reasons,
    outstandingAmount: outstanding,
    openObligationPeriods,
    summary: `Improper cessation for employer ${input.employerId} (${input.status}): ${reasons.join(", ")}.`,
  };
}

/* ────────────────────────── DR-012: contribution/reporting gap ────────────────────────── */

export interface CeObligationHistoryEntry {
  periodKey: string;
  expected: boolean;
  filingReceived: boolean;
  contributionPaid: boolean;
}

export interface CeContributionGapConfig {
  minMissedMonths: number;
  /** Retained for API/policy completeness; deadline math itself lives in obligationDeadlineResolver. */
  daysPastDeadline: number;
}

export interface CeContributionGapFinding {
  employerId: string;
  gapPeriods: string[];
  longestConsecutiveRun: number;
  summary: string;
}

/**
 * DR-012: builds the gap directly from real obligation history — a period
 * only counts when it was actually expected and either the filing or the
 * contribution was missing. Flags once the number of gap periods reaches the
 * configured `minMissedMonths`.
 */
export function evaluateContributionGap(
  employerId: string,
  history: CeObligationHistoryEntry[],
  config: CeContributionGapConfig,
): CeContributionGapFinding | undefined {
  const sorted = [...history].sort((a, b) => (a.periodKey < b.periodKey ? -1 : 1));
  const gapPeriods = sorted
    .filter((entry) => entry.expected && (!entry.filingReceived || !entry.contributionPaid))
    .map((entry) => entry.periodKey);

  if (gapPeriods.length < config.minMissedMonths) return undefined;

  let longestRun = 0;
  let currentRun = 0;
  for (const entry of sorted) {
    const isGap = entry.expected && (!entry.filingReceived || !entry.contributionPaid);
    currentRun = isGap ? currentRun + 1 : 0;
    longestRun = Math.max(longestRun, currentRun);
  }

  return {
    employerId,
    gapPeriods,
    longestConsecutiveRun: longestRun,
    summary: `Employer ${employerId} has ${gapPeriods.length} gap period(s), longest consecutive run ${longestRun}.`,
  };
}

/**
 * Guard used by tests and callers to assert that a status change never drops
 * historical obligation/violation counts — an Inactive/Closed employer keeps
 * its full history.
 */
export function preservesHistoryOnStatusChange(
  before: { obligations: number; violations: number },
  after: { obligations: number; violations: number },
): boolean {
  return after.obligations >= before.obligations && after.violations >= before.violations;
}
