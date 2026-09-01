/**
 * Checkpoint D — the single authoritative escalation-stage configuration.
 *
 * Every consumer (notice generation, escalation evaluation, legal eligibility)
 * reads `ce_escalation_stage_config` through this module. No 7/21/45-day style
 * literal may exist in any runtime path: an unconfigured stage fails visibly.
 */
import { supabase } from '@/integrations/supabase/client';

const sb = supabase as any;

export type DelayBasis =
  | 'PREREQUISITE_NOTICE_DATE'
  | 'VIOLATION_CREATED'
  | 'OBLIGATION_DUE_DATE';

export interface EscalationStageConfig {
  id: string;
  stage_code: string;
  stage_name: string;
  stage_order: number;
  prerequisite_stage_code: string | null;
  delay_days: number | null;
  delay_basis: DelayBasis;
  notice_template_code: string | null;
  requires_approval: boolean;
  target_state: string | null;
  is_enabled: boolean;
  retired_at: string | null;
  retired_reason: string | null;
  applicable_funds: string[];
  applicable_violation_type_ids: string[];
  min_outstanding_amount: number;
  open_decision_code: string | null;
  notes: string | null;
  updated_at: string;
}

export interface StageEligibility {
  eligible: boolean;
  status:
    | 'eligible'
    | 'waiting'
    | 'stage_disabled'
    | 'prerequisite_missing'
    | 'configuration_error'
    | 'not_found';
  stage_code?: string;
  stage_order?: number;
  requires_approval?: boolean;
  basis_date?: string;
  delay_days?: number;
  delay_basis?: DelayBasis;
  eligible_from?: string;
  open_decision?: string | null;
  reasons: string[];
  stage_snapshot?: EscalationStageConfig;
}

/** Active St Kitts sequence, ordered. Retired stages are excluded. */
export async function listActiveStages(): Promise<EscalationStageConfig[]> {
  const { data, error } = await sb
    .from('ce_escalation_stage_config')
    .select('*')
    .eq('is_enabled', true)
    .order('stage_order', { ascending: true });
  if (error) throw error;
  return (data || []) as EscalationStageConfig[];
}

/** All stages including retired ones — configuration screen + history. */
export async function listAllStages(): Promise<EscalationStageConfig[]> {
  const { data, error } = await sb
    .from('ce_escalation_stage_config')
    .select('*')
    .order('stage_order', { ascending: true });
  if (error) throw error;
  return (data || []) as EscalationStageConfig[];
}

export async function updateStage(
  id: string,
  patch: Partial<EscalationStageConfig>,
  userCode: string | null,
): Promise<void> {
  const { error } = await sb
    .from('ce_escalation_stage_config')
    .update({ ...patch, updated_by: userCode, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Stage eligibility for a violation, evaluated server-side against the config. */
export async function evaluateStage(
  violationId: string,
  stageCode: string,
): Promise<StageEligibility> {
  const { data, error } = await sb.rpc('ce_evaluate_stage_eligibility_v1', {
    p_violation_id: violationId,
    p_stage_code: stageCode,
  });
  if (error) throw error;
  return data as StageEligibility;
}

/** Governed notice generation — idempotent per violation + stage. */
export async function generateStageNotice(
  violationId: string,
  stageCode: string,
  deliveryMethod = 'EMAIL',
): Promise<{ status: string; generated: boolean; notice_id?: string; notice_number?: string }> {
  const { data, error } = await sb.rpc('ce_generate_stage_notice_v1', {
    p_violation_id: violationId,
    p_stage_code: stageCode,
    p_delivery_method: deliveryMethod,
  });
  if (error) throw error;
  return data as { status: string; generated: boolean };
}

/**
 * Pure helper: the date a stage becomes eligible. Used by UI previews only —
 * the database evaluation above stays authoritative.
 */
export function stageEligibleFrom(basisDate: string | Date, delayDays: number): Date {
  const d = new Date(basisDate);
  d.setUTCDate(d.getUTCDate() + delayDays);
  return d;
}
