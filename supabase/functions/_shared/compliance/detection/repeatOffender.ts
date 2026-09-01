/**
 * DR-005 Repeat Offender detection.
 *
 * Client-approved semantics (Compliance Business Review):
 *  - An employer becomes a "repeat offender" once it accumulates `threshold`
 *    qualifying violation OCCURRENCES inside a trailing `rollingMonths`
 *    window. Occurrences do NOT need to be consecutive unless
 *    `requireConsecutive` is explicitly turned on.
 *  - When `sameTypeOnly` is true, only occurrences of the SAME violation type
 *    are pooled together and a SEPARATE flag is produced per qualifying type.
 *    When false, all qualifying occurrences (of any type) are pooled into one
 *    per-employer flag.
 *  - `includeResolvedOccurrences` controls whether resolved violations still
 *    count as an occurrence. This rule counts qualifying OCCURRENCES, never
 *    just "currently unresolved" violations — a resolved violation is still a
 *    historical fact about repeat behaviour when the config says so.
 *  - Review-flag artifacts must never recursively feed the count: any
 *    occurrence flagged `isRepeatFlagArtifact: true`, or whose violation type
 *    code starts with "REPEAT", is excluded from consideration entirely.
 *  - Output is a REVIEW FLAG (human confirmation required), never a violation.
 *
 * All thresholds arrive as configuration — nothing here is hard-coded.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/repeatOffender.ts
 */

import { buildReviewFlag, type CeReviewFlagRecord } from "./reviewFlag.ts";

export interface CeRepeatOccurrence {
  violationId: string;
  employerId: string;
  employerName?: string;
  violationTypeId: string;
  violationTypeCode: string;
  /** ISO date the occurrence was discovered. */
  occurredOn: string;
  /** period key YYYY-MM when known, used only for the consecutive test. */
  periodKey?: string;
  resolved: boolean;
  isRepeatFlagArtifact?: boolean;
}

export interface CeRepeatOffenderConfig {
  threshold: number;
  rollingMonths: number;
  sameTypeOnly: boolean;
  requireConsecutive: boolean;
  includeResolvedOccurrences: boolean;
}

export interface CeRepeatOffenderResult {
  employerId: string;
  employerName?: string;
  violationTypeId: string | null;
  violationTypeCode: string | null;
  qualifyingCount: number;
  triggeringViolationIds: string[];
  windowStart: string;
  windowEnd: string;
  summary: string;
  /** Configuration echoed back so the flag builder never needs the config re-supplied. */
  threshold: number;
  rollingMonths: number;
  sameTypeOnly: boolean;
}

/** Add whole calendar months to an ISO date, UTC-safe. */
function addMonthsToDate(isoDate: string, months: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** True when it is not excluded from occurrence counting (an artifact of a prior flag). */
function isEligibleOccurrence(o: CeRepeatOccurrence): boolean {
  if (o.isRepeatFlagArtifact) return false;
  if (o.violationTypeCode?.toUpperCase().startsWith("REPEAT")) return false;
  return true;
}

/** True when the periodKeys, sorted, form an unbroken run of consecutive calendar months. */
function isConsecutiveRun(periodKeys: string[]): boolean {
  const keys = [...new Set(periodKeys.filter(Boolean))].sort();
  if (keys.length < 2) return keys.length === periodKeys.length; // all keys distinct & present
  for (let i = 1; i < keys.length; i += 1) {
    const [py, pm] = keys[i - 1].split("-").map(Number);
    const [cy, cm] = keys[i].split("-").map(Number);
    const prevIdx = py * 12 + (pm - 1);
    const curIdx = cy * 12 + (cm - 1);
    if (curIdx - prevIdx !== 1) return false;
  }
  return keys.length === periodKeys.length;
}

/**
 * Evaluate the repeat-offender rule across a batch of occurrences for
 * potentially many employers, returning zero, one, or several results
 * (one per employer × qualifying violation type when `sameTypeOnly`).
 */
export function evaluateRepeatOffender(
  occurrences: CeRepeatOccurrence[],
  config: CeRepeatOffenderConfig,
  asOf: string,
): CeRepeatOffenderResult[] {
  const windowStart = addMonthsToDate(asOf, -config.rollingMonths);
  const windowEnd = asOf;

  const inWindow = occurrences.filter(
    (o) =>
      isEligibleOccurrence(o) &&
      (config.includeResolvedOccurrences || !o.resolved) &&
      o.occurredOn >= windowStart &&
      o.occurredOn <= windowEnd,
  );

  // group employerId -> (groupKey -> occurrences)
  const groups = new Map<string, Map<string, CeRepeatOccurrence[]>>();
  for (const o of inWindow) {
    const groupKey = config.sameTypeOnly ? o.violationTypeCode : "ANY_TYPE";
    if (!groups.has(o.employerId)) groups.set(o.employerId, new Map());
    const byGroup = groups.get(o.employerId)!;
    if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
    byGroup.get(groupKey)!.push(o);
  }

  const results: CeRepeatOffenderResult[] = [];
  for (const [employerId, byGroup] of groups) {
    for (const [groupKey, list] of byGroup) {
      if (list.length < config.threshold) continue;
      if (config.requireConsecutive) {
        const sorted = [...list].sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : 1));
        const periodKeys = sorted.map((o) => o.periodKey ?? o.occurredOn.slice(0, 7));
        if (!isConsecutiveRun(periodKeys)) continue;
      }
      const violationTypeId = config.sameTypeOnly ? list[0].violationTypeId : null;
      const violationTypeCode = config.sameTypeOnly ? groupKey : null;
      const triggeringViolationIds = list.map((o) => o.violationId);
      results.push({
        employerId,
        employerName: list[0].employerName,
        violationTypeId,
        violationTypeCode,
        qualifyingCount: list.length,
        triggeringViolationIds,
        windowStart,
        windowEnd,
        threshold: config.threshold,
        rollingMonths: config.rollingMonths,
        sameTypeOnly: config.sameTypeOnly,
        summary: config.sameTypeOnly
          ? `${list.length} occurrences of ${groupKey} in the trailing ${config.rollingMonths} months (threshold ${config.threshold}).`
          : `${list.length} qualifying violation occurrences in the trailing ${config.rollingMonths} months (threshold ${config.threshold}).`,
      });
    }
  }

  return results.sort((a, b) => {
    if (a.employerId !== b.employerId) return a.employerId < b.employerId ? -1 : 1;
    const ac = a.violationTypeCode ?? "";
    const bc = b.violationTypeCode ?? "";
    return ac < bc ? -1 : ac > bc ? 1 : 0;
  });
}

/** Build the persisted review-flag record for one repeat-offender result. */
export function buildRepeatOffenderFlag(
  result: CeRepeatOffenderResult,
  ruleCode: string,
  ruleId?: string,
): CeReviewFlagRecord {
  return buildReviewFlag({
    flag_type: "REPEAT_OFFENDER",
    rule_code: ruleCode,
    rule_id: ruleId,
    subject_type: "EMPLOYER",
    subject_id: result.employerId,
    subject_name: result.employerName,
    employer_id: result.employerId,
    period_key: "ALL",
    summary: result.summary,
    triggering_violation_ids: result.triggeringViolationIds,
    evidence: {
      qualifying_count: result.qualifyingCount,
      threshold: result.threshold,
      rolling_months: result.rollingMonths,
      same_type_only: result.sameTypeOnly,
      violation_type_code: result.violationTypeCode ?? "ANY_TYPE",
      triggering_violation_ids: result.triggeringViolationIds,
      window_start: result.windowStart,
      window_end: result.windowEnd,
      dedupe_discriminator: result.violationTypeCode ?? "ANY_TYPE",
    },
  });
}
