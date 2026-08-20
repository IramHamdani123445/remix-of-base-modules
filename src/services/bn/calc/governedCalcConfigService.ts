/**
 * governedCalcConfigService — the ONLY client entrypoint for writing
 * calculation configuration (formula versions, rate / matrix table rows).
 *
 * Direct PostgREST writes on `bn_formula_version` / `bn_rate_table_row` are
 * governed by BEFORE triggers that refuse anything outside the server-side
 * calculation boundary. The boundary can only be entered by the SECURITY
 * DEFINER RPCs below, so every configuration write must go through here.
 */
import { supabase } from '@/integrations/supabase/client';

const rpc = (supabase.rpc as any).bind(supabase);

/**
 * Translates governed-boundary errors into the intended business message.
 * Permission errors from the internal helpers are a defect, not a rule, and
 * are surfaced as such rather than as a raw SQL failure.
 */
export function mapBnCalcError(error: any): string {
  const raw = String(error?.message ?? error ?? 'Save failed');

  if (raw.includes('BN_CALC_IMMUTABLE_FORMULA_VERSION')) {
    return 'This formula version is no longer a draft. Its calculation semantics are frozen — create a successor version to change the expression, steps, output or rounding.';
  }
  if (raw.includes('BN_CALC_IMMUTABLE_RATE_TABLE')) {
    return 'This table is no longer a draft. Its rows are historical calculation logic — create a successor version to change them.';
  }
  if (raw.includes('BN_CALC_ACTOR_REQUIRED')) {
    return 'An authenticated user code is required for BN audit before this can be saved.';
  }
  if (raw.includes('BN_CALC_FORMULA_VERSION_NOT_FOUND')) return 'That formula version no longer exists.';
  if (raw.includes('BN_CALC_RATE_TABLE_NOT_FOUND')) return 'That table no longer exists.';
  if (raw.includes('BN_CALC_RATE_ROW_NOT_FOUND')) return 'That row no longer exists.';
  if (raw.includes('_bn_calc_in_boundary') || raw.includes('_bn_calc_boundary_enter')) {
    return 'The governed calculation boundary rejected this write. Please report this — the save was not attempted through the governed path.';
  }
  return raw;
}

export interface SaveFormulaVersionInput {
  versionId: string;
  expressionType: string;
  stepsJson: Record<string, unknown>;
  expression: string | null;
  userCode: string;
}

export async function saveFormulaVersion(input: SaveFormulaVersionInput): Promise<void> {
  const { error } = await rpc('bn_calc_config_save_formula_version_v1', {
    p_version_id: input.versionId,
    p_expression_type: input.expressionType,
    p_steps_json: input.stepsJson,
    p_expression: input.expression,
    p_user_code: input.userCode,
  });
  if (error) throw new Error(mapBnCalcError(error));
}

export interface SaveRateTableRowInput {
  rowId?: string | null;
  rateTableId: string;
  rowOrder: number;
  dimensionValues: Record<string, unknown>;
  outputKey?: string | null;
  outputValue: number | null;
  outputText?: string | null;
  outputType: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  notes?: string | null;
  userCode: string;
}

export async function saveRateTableRow(input: SaveRateTableRowInput): Promise<string> {
  const { data, error } = await rpc('bn_calc_config_save_rate_table_row_v2', {
    p_row_id: input.rowId ?? null,
    p_rate_table_id: input.rateTableId,
    p_row_order: input.rowOrder,
    p_dimension_values: input.dimensionValues,
    p_output_key: input.outputKey ?? null,
    p_output_value: input.outputValue,
    p_output_text: input.outputText ?? null,
    p_output_type: input.outputType,
    p_effective_from: input.effectiveFrom ?? null,
    p_effective_to: input.effectiveTo ?? null,
    p_notes: input.notes ?? null,
    p_user_code: input.userCode,
  });
  if (error) throw new Error(mapBnCalcError(error));
  return data as string;
}

export async function deleteRateTableRow(rowId: string, userCode: string): Promise<void> {
  const { error } = await rpc('bn_calc_config_delete_rate_table_row_v1', {
    p_row_id: rowId,
    p_user_code: userCode,
  });
  if (error) throw new Error(mapBnCalcError(error));
}
