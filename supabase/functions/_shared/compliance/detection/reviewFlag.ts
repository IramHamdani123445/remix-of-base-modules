/**
 * Canonical shape of a REVIEW FLAG produced by the compliance detection engine.
 *
 * A review flag is deliberately NOT a violation. Rules whose client-approved
 * semantics are "review first" (DR-005 repeat offender, DR-008 unregistered
 * business lead, DR-009 headcount anomaly, DR-010 wage anomaly, DR-013
 * employer-overlap) emit these instead of writing a confirmed violation row.
 * They land in `ce_compliance_review_flags` and only become a violation after a
 * human with the required capability confirms them.
 *
 * MIRROR: supabase/functions/_shared/compliance/detection/reviewFlag.ts
 */

export type CeReviewFlagSubjectType = "EMPLOYER" | "PERSON" | "LEAD";

export type CeReviewFlagType =
  | "REPEAT_OFFENDER"
  | "UNREGISTERED_EMPLOYER_LEAD"
  | "HEADCOUNT_DISCREPANCY"
  | "HEADCOUNT_ANOMALY"
  | "WAGE_BELOW_BENCHMARK"
  | "WAGE_ANOMALY"
  | "SELF_EMPLOYED_EMPLOYER_OVERLAP"
  | "MULTI_EMPLOYER_REPORTING"
  | "OVER_CONTRIBUTION_CREDIT";

/** Capability required to dispose of each flag type. */
export const REVIEW_FLAG_CAPABILITY: Record<CeReviewFlagType, string> = {
  REPEAT_OFFENDER: "compliance.review_flag.review",
  UNREGISTERED_EMPLOYER_LEAD: "compliance.registration_lead.manage",
  HEADCOUNT_DISCREPANCY: "compliance.review_flag.review",
  HEADCOUNT_ANOMALY: "compliance.review_flag.review",
  WAGE_BELOW_BENCHMARK: "compliance.review_flag.review",
  WAGE_ANOMALY: "compliance.review_flag.review",
  SELF_EMPLOYED_EMPLOYER_OVERLAP: "compliance.review_flag.review",
  MULTI_EMPLOYER_REPORTING: "compliance.review_flag.review",
  OVER_CONTRIBUTION_CREDIT: "compliance.review_flag.review",
};

export interface CeReviewFlagDraft {
  flag_type: CeReviewFlagType;
  rule_code: string;
  rule_id?: string;
  subject_type: CeReviewFlagSubjectType;
  subject_id: string;
  subject_name?: string;
  employer_id?: string;
  /** YYYY-MM (or "ALL" for standing, non-period flags). */
  period_key?: string;
  severity?: "Low" | "Medium" | "High" | "Critical";
  summary: string;
  evidence: Record<string, unknown>;
  triggering_violation_ids?: string[];
}

export interface CeReviewFlagRecord extends CeReviewFlagDraft {
  flag_number: string;
  dedupe_key: string;
  required_review_capability: string;
  status: "OPEN";
}

/**
 * Deterministic dedupe key. Re-running detection against unchanged data must
 * produce the identical key so the unique index on `dedupe_key` absorbs the
 * second run instead of creating a duplicate flag.
 */
export function reviewFlagDedupeKey(draft: CeReviewFlagDraft): string {
  const discriminator = String(
    (draft.evidence?.dedupe_discriminator as string | undefined) ?? "",
  );
  return [
    draft.flag_type,
    draft.subject_type,
    draft.subject_id,
    draft.period_key ?? "ALL",
    discriminator,
  ]
    .join("|")
    .toUpperCase();
}

/** Stable, human-readable flag number derived from the dedupe key. */
export function reviewFlagNumber(draft: CeReviewFlagDraft): string {
  const key = reviewFlagDedupeKey(draft);
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return `FLG-${draft.flag_type.slice(0, 4)}-${hash.toString(36).toUpperCase().padStart(7, "0")}`;
}

export function buildReviewFlag(draft: CeReviewFlagDraft): CeReviewFlagRecord {
  return {
    ...draft,
    severity: draft.severity ?? "Medium",
    triggering_violation_ids: draft.triggering_violation_ids ?? [],
    flag_number: reviewFlagNumber(draft),
    dedupe_key: reviewFlagDedupeKey(draft),
    required_review_capability: REVIEW_FLAG_CAPABILITY[draft.flag_type],
    status: "OPEN",
  };
}

/** Collapse a batch to one record per dedupe key (last write wins on evidence). */
export function dedupeReviewFlags(records: CeReviewFlagRecord[]): CeReviewFlagRecord[] {
  const byKey = new Map<string, CeReviewFlagRecord>();
  for (const record of records) byKey.set(record.dedupe_key, record);
  return [...byKey.values()];
}
