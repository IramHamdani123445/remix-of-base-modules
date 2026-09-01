/**
 * DR-007 Levy / Severance / Social Security contribution omission.
 *
 * IMPORTANT: this rule's runtime meaning was previously (incorrectly)
 * implemented as "employer arrears above $500". That interpretation is
 * retired entirely and must never reappear. The client-approved semantics
 * are:
 *
 *  - For each C3 person/fund line, when the person/fund combination is
 *    APPLICABLE for the period (i.e. it is expected to attract a
 *    contribution) and the reported contribution is zero or omitted
 *    (null/undefined), the omission is flagged — UNLESS a valid exemption
 *    covers that exact person + employer + fund + period.
 *  - Exemptions are scoped narrowly. An exemption granted for
 *    (person, employer A, fund) never suppresses an omission for the same
 *    person at employer B, and only ACTIVE exemptions suppress anything —
 *    REVOKED, EXPIRED and PENDING_VERIFICATION exemptions do not.
 *  - Detection must run identically regardless of how the C3 data reached
 *    the system: ONLINE, PHYSICAL, KIOSK or LEGACY_IMPORT. Online C3
 *    validation may block a submission before it is ever stored, but
 *    physical/kiosk/legacy data bypasses that validation and must still be
 *    caught here.
 *  - There is no dollar threshold anywhere in this rule — omission is a
 *    zero/blank test, not an arrears-size test.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/fundOmission.ts
 */

export type CeFundCode = "LV" | "SV" | "SS";

export interface CeC3PersonFundLine {
  submissionId: string;
  employerId: string;
  employerName?: string;
  personSsn: string;
  personName?: string;
  /** YYYY-MM */
  periodKey: string;
  fundCode: CeFundCode;
  /** true when this person/fund combination attracts a contribution in this period */
  applicable: boolean;
  contributionAmount: number | null | undefined;
  wageAmount?: number;
  ingestionSource?: "ONLINE" | "PHYSICAL" | "KIOSK" | "LEGACY_IMPORT";
}

export interface CeContributionExemption {
  personSsn: string;
  employerId: string;
  fundCode: CeFundCode;
  /** ISO date */
  effectiveFrom: string;
  /** ISO date, or null/undefined for open-ended */
  effectiveTo?: string | null;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "PENDING_VERIFICATION";
  authorityReference?: string;
}

export interface CeFundOmissionConfig {
  checkFunds: CeFundCode[];
  zeroThreshold: number;
}

export interface CeFundOmission {
  employerId: string;
  employerName?: string;
  personSsn: string;
  personName?: string;
  periodKey: string;
  fundCode: CeFundCode;
  contributionAmount: number;
  submissionId: string;
  ingestionSource: string;
  summary: string;
}

interface CeExemptionScope {
  personSsn: string;
  employerId: string;
  fundCode: CeFundCode;
  periodKey: string;
}

/** Last calendar day (ISO, YYYY-MM-DD) of a YYYY-MM period key, UTC-safe. */
function lastDayOfPeriod(periodKey: string): string {
  const [year, month] = periodKey.split("-").map(Number);
  // day 0 of next month == last day of this month
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

/**
 * True when the exemption is ACTIVE, matches the person/employer/fund exactly,
 * and its effective period covers the last day of the given period key.
 */
export function isExemptionApplicable(
  e: CeContributionExemption,
  scope: CeExemptionScope,
): boolean {
  if (e.status !== "ACTIVE") return false;
  if (e.personSsn !== scope.personSsn) return false;
  if (e.employerId !== scope.employerId) return false;
  if (e.fundCode !== scope.fundCode) return false;

  const periodEnd = lastDayOfPeriod(scope.periodKey);
  if (periodEnd < e.effectiveFrom) return false;
  if (e.effectiveTo && periodEnd > e.effectiveTo) return false;

  return true;
}

/** First matching applicable exemption, if any. */
export function findApplicableExemption(
  exemptions: CeContributionExemption[],
  scope: CeExemptionScope,
): CeContributionExemption | undefined {
  return exemptions.find((e) => isExemptionApplicable(e, scope));
}

/**
 * Evaluate a batch of C3 person/fund lines for fund-omission violations,
 * suppressing only those covered by a narrowly-scoped ACTIVE exemption.
 */
export function evaluateFundOmissions(
  lines: CeC3PersonFundLine[],
  exemptions: CeContributionExemption[],
  config: CeFundOmissionConfig,
): CeFundOmission[] {
  const results: CeFundOmission[] = [];

  for (const line of lines) {
    if (!config.checkFunds.includes(line.fundCode)) continue;
    if (!line.applicable) continue;

    const amount = line.contributionAmount ?? 0;
    if (amount > 0) continue;

    const scope: CeExemptionScope = {
      personSsn: line.personSsn,
      employerId: line.employerId,
      fundCode: line.fundCode,
      periodKey: line.periodKey,
    };
    if (findApplicableExemption(exemptions, scope)) continue;

    results.push({
      employerId: line.employerId,
      employerName: line.employerName,
      personSsn: line.personSsn,
      personName: line.personName,
      periodKey: line.periodKey,
      fundCode: line.fundCode,
      contributionAmount: amount,
      submissionId: line.submissionId,
      ingestionSource: line.ingestionSource ?? "ONLINE",
      summary: `${line.fundCode} contribution omitted for ${line.personName ?? line.personSsn} in ${line.periodKey}`,
    });
  }

  results.sort((a, b) =>
    a.employerId.localeCompare(b.employerId) ||
    a.periodKey.localeCompare(b.periodKey) ||
    a.personSsn.localeCompare(b.personSsn) ||
    a.fundCode.localeCompare(b.fundCode),
  );

  return results;
}
