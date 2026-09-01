/**
 * Checkpoint E — Compliance Risk Scoring service.
 *
 * Single access point to the canonical database engine
 * (`ce_score_employer_risk_v1`, `ce_run_risk_recalculation_v1`,
 * `ce_validate_risk_policy_v1`). Manual, scheduled and preview scoring all run
 * through these RPCs so the semantics can never diverge.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  CanonicalFactor,
  RiskBandDefinition,
  RiskFactorDefinition,
} from '@/lib/compliance/risk/riskModel';

export interface RiskPolicySummary {
  id: string;
  policy_code: string;
  policy_name: string;
  status: string;
  version_no: number;
  effective_from: string;
  effective_to: string | null;
  weights_confirmation: string;
  source_policy: Record<string, unknown>;
}

export interface PolicyFactorRow extends RiskFactorDefinition {
  policy_factor_id: string;
  factor_id: string;
  measurement_params: Record<string, unknown> | null;
  description: string | null;
}

export interface ValidationResponse {
  valid: boolean;
  policy_code?: string;
  version_no?: number;
  weights_confirmation?: string;
  weight_total: number;
  errors: string[];
  factors: {
    factor_code: string;
    factor_name: string;
    canonical_factor: CanonicalFactor | null;
    measurement_code: string | null;
    weight: number;
    status: 'configured' | 'operational' | 'configuration_error';
    reason: string;
  }[];
  bands: { band_name: string; min: number; max: number }[];
}

export interface ScoredFactor {
  factor_code: string;
  factor_name: string;
  canonical_factor: CanonicalFactor | null;
  status: 'configured' | 'operational' | 'configuration_error';
  measurement_code: string | null;
  raw_measurement: number;
  raw_detail: string;
  evidence: Record<string, unknown>;
  scoring_method: string | null;
  threshold_used: { min: number; max: number; score: number; label?: string } | null;
  factor_score: number;
  weight_pct: number;
  weighted_contribution: number;
  explanation: string;
}

export interface EmployerRiskScore {
  ok: boolean;
  employer_id: string;
  as_of: string;
  policy_id: string;
  policy_code: string;
  policy_version: number;
  weights_confirmation: string;
  weight_total: number;
  total_score: number;
  risk_band: string | null;
  band_color: string | null;
  calculation_status: 'OPERATIONAL' | 'CONFIGURATION_ERROR';
  errors: string[];
  engine_version: string;
  persisted: boolean;
  score_hash: string;
  factors: ScoredFactor[];
  error?: string;
}

export async function getActiveRiskPolicy(): Promise<RiskPolicySummary | null> {
  const { data, error } = await supabase
    .from('ce_risk_policies')
    .select('*')
    .eq('status', 'ACTIVE')
    .order('effective_from', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as RiskPolicySummary) ?? null;
}

export async function getPolicyFactors(policyId: string): Promise<PolicyFactorRow[]> {
  const { data, error } = await supabase
    .from('ce_risk_policy_factors')
    .select('id, factor_id, weight_override, is_active, ce_risk_config(*)')
    .eq('policy_id', policyId);
  if (error) throw error;

  return ((data as unknown as any[]) || [])
    .filter((row) => row.ce_risk_config)
    .map((row) => {
      const cfg = row.ce_risk_config;
      return {
        policy_factor_id: row.id,
        factor_id: row.factor_id,
        factor_code: cfg.factor_code,
        factor_name: cfg.factor_name,
        description: cfg.description ?? null,
        canonical_factor: cfg.canonical_factor ?? null,
        measurement_code: cfg.measurement_code ?? null,
        measurement_params: cfg.measurement_params ?? null,
        scoring_method: cfg.scoring_method ?? null,
        thresholds: cfg.thresholds ?? null,
        max_score: cfg.max_score ?? 100,
        lifecycle_status: cfg.lifecycle_status ?? 'ACTIVE',
        weight: Number(row.weight_override ?? cfg.weight ?? 0),
        is_active: row.is_active !== false,
      } as PolicyFactorRow;
    })
    .sort((a, b) => (a.canonical_factor ?? '').localeCompare(b.canonical_factor ?? ''));
}

export async function getPolicyBands(policyId: string): Promise<RiskBandDefinition[]> {
  const { data, error } = await supabase
    .from('ce_risk_bands')
    .select('band_name, score_range_min, score_range_max, color')
    .eq('policy_id', policyId)
    .order('score_range_min');
  if (error) throw error;
  return ((data as unknown as any[]) || []).map((b) => ({
    band_name: b.band_name,
    score_range_min: Number(b.score_range_min),
    score_range_max: Number(b.score_range_max),
    color: b.color,
  }));
}

export async function validateRiskPolicyRpc(policyId: string): Promise<ValidationResponse> {
  const { data, error } = await supabase.rpc('ce_validate_risk_policy_v1' as any, {
    p_policy_id: policyId,
  });
  if (error) throw error;
  return data as unknown as ValidationResponse;
}

/** Preview scoring — never writes to production risk scores. */
export async function previewEmployerScore(
  employerId: string,
  policyId?: string,
): Promise<EmployerRiskScore> {
  const { data, error } = await supabase.rpc('ce_score_employer_risk_v1' as any, {
    p_employer_id: employerId,
    p_policy_id: policyId ?? null,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_persist: false,
    p_triggered_by: 'UI_PREVIEW',
    p_run_id: null,
  });
  if (error) throw error;
  return data as unknown as EmployerRiskScore;
}

/** Persisted recalculation for one employer — identical engine to the scheduler. */
export async function recalculateEmployer(
  employerId: string,
  triggeredBy = 'UI_MANUAL',
): Promise<EmployerRiskScore> {
  const { data, error } = await supabase.rpc('ce_score_employer_risk_v1' as any, {
    p_employer_id: employerId,
    p_policy_id: null,
    p_as_of: new Date().toISOString().slice(0, 10),
    p_persist: true,
    p_triggered_by: triggeredBy,
    p_run_id: null,
  });
  if (error) throw error;
  return data as unknown as EmployerRiskScore;
}

export async function runRiskRecalculation(options?: {
  employerId?: string | null;
  limit?: number;
  dryRun?: boolean;
  triggeredBy?: string;
}) {
  const { data, error } = await supabase.rpc('ce_run_risk_recalculation_v1' as any, {
    p_employer_id: options?.employerId ?? null,
    p_limit: options?.limit ?? 1000,
    p_dry_run: options?.dryRun ?? false,
    p_triggered_by: options?.triggeredBy ?? 'UI_MANUAL',
    p_as_of: new Date().toISOString().slice(0, 10),
  });
  if (error) throw error;
  return data as unknown as {
    ok: boolean;
    run_id: string | null;
    policy_code: string;
    policy_version: number;
    processed: number;
    scored: number;
    errors: number;
    dry_run: boolean;
    error?: string;
    validation?: ValidationResponse;
  };
}

export async function updatePolicyFactorWeights(
  updates: { policy_factor_id: string; weight: number; is_active: boolean }[],
): Promise<void> {
  for (const update of updates) {
    const { error } = await supabase
      .from('ce_risk_policy_factors')
      .update({ weight_override: update.weight, is_active: update.is_active } as any)
      .eq('id', update.policy_factor_id);
    if (error) throw error;
  }
}

/** Bumping the version re-runs the activation guard: an invalid policy is rejected. */
export async function commitPolicyVersion(policyId: string, currentVersion: number): Promise<void> {
  const { error } = await supabase
    .from('ce_risk_policies')
    .update({ version_no: currentVersion + 1, updated_at: new Date().toISOString() } as any)
    .eq('id', policyId);
  if (error) throw error;
}

export async function getRiskScoreHistory(employerId: string, limit = 20) {
  const { data: profile } = await supabase
    .from('ce_risk_profiles')
    .select('id')
    .eq('employer_id', employerId)
    .maybeSingle();
  if (!profile) return [];
  const { data, error } = await supabase
    .from('ce_risk_score_history')
    .select('*')
    .eq('risk_profile_id', (profile as any).id)
    .order('calculated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as unknown as any[]) || [];
}
