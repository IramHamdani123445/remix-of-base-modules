// ============================================
// PLAN CANDIDATE SERVICE v2 - FACT-DRIVEN ENGINE
//
// Two modes:
//   1. getScoredCandidatesV2() — calls fn_ce_score_candidates_batch
//      (single RPC, server-side scoring with real fact inputs)
//   2. getCandidates() — legacy compat: maps V2 back to PlanCandidate shape
//      for existing UI components until they are upgraded
// ============================================

import { supabase } from '@/integrations/supabase/client';
import { PlanCandidate, PlanCandidateV2, PlanCandidateV3, RecommendationReason } from '@/types/weeklyPlan';
import { normalisePlanCandidatesV3 } from '@/services/planCandidateNormalizer';

// ── Candidate Reason labels for UI ─────────────────────────

export const CANDIDATE_REASON_LABELS: Record<string, string> = {
  // Existing reasons (preserved)
  ESCALATED_VIOLATION: 'Escalated violation requiring urgent attention',
  AGING_VIOLATION: 'Open violation aging beyond 90 days',
  MULTIPLE_VIOLATIONS: '3+ concurrent open violations',
  OPEN_VIOLATION: 'Open violation pending action',
  OVERDUE_FOLLOW_UP: 'Follow-up action overdue',
  ARRANGEMENT_DEFAULT: 'Payment arrangement in default/breach',
  ARRANGEMENT_AT_RISK: 'Payment arrangement with missed installments',
  NOTICE_RESPONSE_DUE: 'Notice response deadline approaching',
  HIGH_RISK_NO_VISIT: 'High-risk employer with no recent visit',
  LAST_AUDIT_EXCEEDED: 'No audit/visit in 180+ days',
  CARRY_FORWARD_INCOMPLETE: 'Incomplete work from prior plan',
  SCOUTING_LEAD: 'Active scouting lead requiring investigation',
  // Phase 2 — richer planning-oriented reasons
  ROUTINE_CYCLE_DUE: 'Routine audit cycle is due or overdue',
  MANDATORY_HIGH_RISK_REVIEW: 'Mandatory review for high-risk employer',
  POST_ENFORCEMENT_RECHECK: 'Post-enforcement compliance recheck',
  COMPLAINT_DRIVEN_AUDIT: 'Audit triggered by complaint/intelligence',
  SECTOR_SWEEP: 'Selected as part of sector sweep / campaign',
  BENEFIT_PAYROLL_MISMATCH_REVIEW: 'Benefit/payroll mismatch requires review',
  ARRANGEMENT_BREACH: 'Payment arrangement breached',
  LEGAL_STAGE_TRIGGER: 'Active legal/enforcement stage trigger',
  OFFICER_NOMINATED: 'Officer-nominated from compliance case',
};

// ── V2: Batch-scored candidates from DB ────────────────────

async function fetchScoredCandidatesV2(
  limit: number = 200,
): Promise<PlanCandidateV2[]> {
  const { data, error } = await supabase.rpc(
    'fn_ce_score_candidates_batch' as any,
    { p_limit: limit },
  );

  if (error) throw error;

  return ((data as any[]) ?? []).map((row: any) => ({
    employer_id: row.employer_id ?? '',
    employer_name: row.employer_name,
    territory: row.territory,
    candidate_source: row.candidate_source ?? '',
    candidate_reason: row.candidate_reason ?? 'OPEN_VIOLATION',
    derived_priority: row.derived_priority ?? 'MEDIUM',
    risk_band: row.risk_band,
    risk_score: Number(row.risk_score ?? 0),
    days_since_last_inspection: row.days_since_last_inspection,
    open_violation_count: Number(row.open_violation_count ?? 0),
    escalated_violation_count: Number(row.escalated_violation_count ?? 0),
    overdue_followup_count: Number(row.overdue_followup_count ?? 0),
    financial_exposure: Number(row.financial_exposure ?? 0),
    notice_days_remaining: row.notice_days_remaining,
    any_breach_detected: Boolean(row.any_breach_detected),
    carry_forward_count: Number(row.carry_forward_count ?? 0),
    recommendation_score: Number(row.recommendation_score ?? 0),
  }));
}

// ── V1-compat mapper: PlanCandidateV2 → PlanCandidate ──────

function mapV2ToLegacy(v2: PlanCandidateV2): PlanCandidate {
  const reasonLabel = CANDIDATE_REASON_LABELS[v2.candidate_reason] || v2.candidate_reason;

  return {
    source_type: v2.candidate_source,
    source_id: `${v2.employer_id}-${v2.candidate_source}`,
    source_ref: v2.employer_id,
    employer_id: v2.employer_id,
    employer_name: v2.employer_name,
    territory: v2.territory,
    priority: v2.derived_priority,
    source_status: v2.candidate_reason,
    financial_exposure: v2.financial_exposure,
    due_date: null,
    assigned_to_user_id: null,
    source_created_at: new Date().toISOString(),
    description: reasonLabel,
    recommendation_score: v2.recommendation_score,
  };
}

// ── Legacy view fallback ───────────────────────────────────

async function fetchLegacyCandidates(
  assignedTo?: string,
  sourceTypes?: string[],
): Promise<PlanCandidate[]> {
  const PAGE_SIZE = 1000;
  let all: PlanCandidate[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('ce_v_weekly_plan_candidates' as any)
      .select('*')
      .range(offset, offset + PAGE_SIZE - 1)
      .order('source_created_at', { ascending: false });

    if (assignedTo) {
      query = query.eq('assigned_to_user_id', assignedTo);
    }
    if (sourceTypes && sourceTypes.length > 0) {
      query = query.in('source_type', sourceTypes);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as unknown as PlanCandidate[];
    all = all.concat(rows);
    hasMore = rows.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  return all;
}

// ── Public API ─────────────────────────────────────────────

export const planCandidateService = {
  /**
   * V2: Get fact-driven, server-scored candidates.
   * Returns PlanCandidateV2[] — employer-level with reason codes.
   */
  async getScoredCandidatesV2(options?: {
    limit?: number;
  }): Promise<PlanCandidateV2[]> {
    return fetchScoredCandidatesV2(options?.limit ?? 200);
  },

  /**
   * Legacy-compat: Get scored candidates mapped to PlanCandidate shape.
   * Uses V2 engine under the hood, then maps to legacy format.
   */
  async getScoredCandidates(filters?: {
    assignedToUserId?: string;
    sourceTypes?: string[];
    topN?: number;
  }): Promise<PlanCandidate[]> {
    const v2 = await fetchScoredCandidatesV2(filters?.topN ?? 200);

    let mapped = v2.map(mapV2ToLegacy);

    // Apply source type filter if requested
    if (filters?.sourceTypes && filters.sourceTypes.length > 0) {
      mapped = mapped.filter((c) => filters.sourceTypes!.includes(c.source_type));
    }

    return mapped;
  },

  /**
   * Legacy-compat: Get candidates without scoring (uses old view).
   * Preserved for backward compatibility with assignment-scoped queries.
   */
  async getCandidates(filters?: {
    assignedToUserId?: string;
    sourceTypes?: string[];
    limit?: number;
  }): Promise<PlanCandidate[]> {
    const candidates = await fetchLegacyCandidates(
      filters?.assignedToUserId,
      filters?.sourceTypes,
    );
    return filters?.limit ? candidates.slice(0, filters.limit) : candidates;
  },

  /**
   * Get candidate counts by source type (for dashboard KPIs).
   * Uses V2 engine for fact-driven counts.
   */
  async getCandidateSummary(assignedToUserId?: string): Promise<Record<string, number>> {
    // For summary, pull a generous batch
    const v2 = await fetchScoredCandidatesV2(500);
    const summary: Record<string, number> = {};
    for (const c of v2) {
      const key = c.candidate_source;
      summary[key] = (summary[key] || 0) + 1;
    }
    return summary;
  },

  /**
   * Get candidate counts by reason code (for dashboard).
   */
  async getCandidateReasonSummary(): Promise<Record<string, number>> {
    const v2 = await fetchScoredCandidatesV2(500);
    const summary: Record<string, number> = {};
    for (const c of v2) {
      summary[c.candidate_reason] = (summary[c.candidate_reason] || 0) + 1;
    }
    return summary;
  },

  /** Reason labels for UI display */
  REASON_LABELS: CANDIDATE_REASON_LABELS,

  /**
   * V3 (Phase 2): zone-aware, audit-cycle-aware, explainable candidates.
   * Pass zoneId or inspectorId to enforce zone visibility server-side.
   * Returns the same shape as V2 plus zone_id, audit cycle info, and
   * a recommendation_reasons[] array for "why this employer" UI.
   */
  async getScoredCandidatesV3(options?: {
    zoneId?: string | null;
    inspectorId?: string | null;
    limit?: number;
  }): Promise<PlanCandidateV3[]> {
    const { data, error } = await supabase.rpc(
      'fn_ce_score_candidates_v3' as any,
      {
        p_zone_id: options?.zoneId ?? null,
        p_inspector_id: options?.inspectorId ?? null,
        p_limit: options?.limit ?? 200,
      },
    );
    if (error) throw error;

    // Normalise at the service boundary: a single malformed engine row must
    // never be able to crash or silently distort the planning workspace.
    const batch = normalisePlanCandidatesV3((data as unknown[]) ?? []);
    if (batch.rejected.length > 0 || batch.degradedCount > 0) {
      console.warn(
        `[planCandidateService] candidate data quality: ${batch.rejected.length} rejected, ${batch.degradedCount} degraded`,
        batch.rejected.slice(0, 5),
      );
    }
    return batch.candidates;
  },


  /** Phase 3: Read the configurable bucket allocation policy. */
  async getBucketPolicy() {
    const { data, error } = await supabase
      .from('ce_planner_bucket_policy' as any)
      .select('*')
      .eq('enabled', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return (data as any[]) ?? [];
  },
};
