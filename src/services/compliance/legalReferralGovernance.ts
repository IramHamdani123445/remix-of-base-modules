/**
 * Checkpoint D — one governed Compliance → Legal referral lifecycle.
 *
 *   Recommendation  →  Management approval  →  Pack preparation
 *                   →  Handoff checklist    →  Legal queue / handoff
 *                   →  Legal status tracking
 *
 * The three historical entry paths (Recommend Legal, Refer to Legal, Quick
 * Forward) all converge here. None of them can create a referral directly:
 * `ce_legal_referrals` is protected by the `zz_ce_legal_referral_governance`
 * trigger, which only accepts rows produced by `ce_approve_legal_referral_v1`.
 */
import { supabase } from '@/integrations/supabase/client';

const sb = supabase as any;

export type LegalEntryPath = 'RECOMMEND_LEGAL' | 'REFER_TO_LEGAL' | 'QUICK_FORWARD';

export interface RecommendLegalInput {
  employerId: string;
  reason: string;
  caseId?: string | null;
  violationId?: string | null;
  entryPath?: LegalEntryPath;
  /** Rule that justifies recommending before the ordinary timed path completes. */
  earlyRuleCode?: string | null;
}

export interface RecommendLegalResult {
  status: 'pending_approval';
  recommendation_id: string;
  recommendation_type: 'ORDINARY' | 'EARLY_SERIOUS' | 'EXPEDITED';
  entry_path: LegalEntryPath;
  eligibility: Record<string, unknown> | null;
  financial_snapshot: Record<string, unknown>;
  arrears_evaluation: Record<string, unknown>;
}

export interface ArrearsThresholdEvaluation {
  status: 'evaluated' | 'insufficient_history' | 'configuration_error';
  employer_id?: string;
  policy_code?: string;
  history_period_count?: number;
  multiplier?: number;
  source_periods?: string[];
  monthly_liabilities?: { period: string; liability: number }[];
  average_monthly_liability?: number;
  threshold_amount?: number;
  qualifying_arrears?: number;
  threshold_breached?: boolean;
  action_on_breach?: 'MANAGEMENT_REVIEW' | 'RECOMMEND_LEGAL' | 'NONE';
  auto_refers_to_legal?: false;
  error?: string;
}

/** Officer / inspector submits a recommendation. Never escalates by itself. */
export async function recommendLegal(input: RecommendLegalInput): Promise<RecommendLegalResult> {
  const { data, error } = await sb.rpc('ce_recommend_legal_v1', {
    p_employer_id: input.employerId,
    p_reason: input.reason,
    p_case_id: input.caseId ?? null,
    p_entry_path: input.entryPath ?? 'RECOMMEND_LEGAL',
    p_early_rule_code: input.earlyRuleCode ?? null,
    p_violation_id: input.violationId ?? null,
  });
  if (error) throw error;
  return data as RecommendLegalResult;
}

/** Management approval — creates the referral in DRAFT (Pack Preparation). */
export async function approveLegalReferral(
  recommendationId: string,
  comments?: string | null,
): Promise<{ status: string; referral_id: string; referral_number: string; next_stage: string }> {
  const { data, error } = await sb.rpc('ce_approve_legal_referral_v1', {
    p_recommendation_id: recommendationId,
    p_comments: comments ?? null,
  });
  if (error) throw error;
  return data as { status: string; referral_id: string; referral_number: string; next_stage: string };
}

export async function rejectLegalReferral(
  recommendationId: string,
  reason: string,
): Promise<{ status: string }> {
  const { data, error } = await sb.rpc('ce_reject_legal_referral_v1', {
    p_recommendation_id: recommendationId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { status: string };
}

/** Canonical financial position — never `ce_ledger_periods.balance`. */
export async function canonicalFinancialSnapshot(
  employerId: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await sb.rpc('ce_canonical_financial_snapshot', {
    p_employer_id: employerId,
  });
  if (error) throw error;
  return (data || {}) as Record<string, unknown>;
}

/** Average of the latest N valid monthly liabilities × multiplier. */
export async function evaluateArrearsThreshold(
  employerId: string,
  persist = true,
): Promise<ArrearsThresholdEvaluation> {
  const { data, error } = await sb.rpc('ce_evaluate_arrears_threshold_v1', {
    p_employer_id: employerId,
    p_persist: persist,
  });
  if (error) throw error;
  return data as ArrearsThresholdEvaluation;
}

/** Approved recommendation for a case, if one exists (drives "Refer to Legal"). */
export async function findApprovedRecommendation(caseId: string): Promise<{
  id: string;
  status: string;
  legal_referral_id: string | null;
} | null> {
  const { data, error } = await sb
    .from('ce_legal_recommendations')
    .select('id, status, legal_referral_id')
    .eq('source_case_id', caseId)
    .in('status', ['APPROVED', 'REFERRAL_CREATED'])
    .order('reviewed_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as any) ?? null;
}

/** Is the expedited path switched on for this deployment? */
export async function isQuickForwardEnabled(): Promise<boolean> {
  const { data } = await sb
    .from('feature_flags')
    .select('is_enabled')
    .eq('flag_key', 'compliance.legal.quick_forward')
    .maybeSingle();
  return Boolean(data?.is_enabled);
}
