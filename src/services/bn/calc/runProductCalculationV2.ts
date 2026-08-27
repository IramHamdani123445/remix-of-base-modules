/**
 * Top-level orchestrator for BN Calculation Engine v2.
 *
 * Loads all active bindings for a product version, runs them in
 * (calculation_stage, sequence_no) order, accumulates `priorResults`, and
 * writes a `bn_calculation_trace` row per binding.
 *
 * Stages applied:
 *   PRIMARY -> CAP -> ARREARS -> PRORATION -> BENEFICIARY_SPLIT -> FINAL
 *
 * CAP stage: result of CAP formula is min/max-applied to prior PRIMARY output.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  type CalculationContext,
  emptyContext,
  resolveVariables,
  type VariableMapping,
} from './variableResolver';
import { runFormula, applyRounding, type FormulaVersionRow } from './formulaRunner';
import type { LookupTraceEntry } from './rateTableLookup';
import { resolveRealFact, type RealClaimContext } from '../runProductCalculation';

const STAGE_ORDER = ['PRIMARY','CAP','ARREARS','PRORATION','BENEFICIARY_SPLIT','FINAL'] as const;

export interface BindingRow {
  id: string;
  product_id: string | null;
  product_version_id: string | null;
  formula_template_id: string;
  formula_version_id: string | null;
  calculation_stage: typeof STAGE_ORDER[number];
  sequence_no: number;
  output_variable: string | null;
  rounding_rule: string | null;
  cap_min: number | null;
  cap_max: number | null;
  is_active: boolean;
}

export interface ProductCalculationResult {
  bindings: Array<{
    binding_id: string;
    formula_code: string;
    formula_version: number;
    calculation_stage: string;
    sequence_no: number;
    raw_output: unknown;
    rounded_output: number | null;
    output_variable: string | null;
    lookup_trace: LookupTraceEntry[];
    expression_trace: unknown[];
    status: 'OK' | 'ERROR';
    error?: string;
  }>;
  finalScope: Record<string, unknown>;
  finalAmount: number | null;
}

export interface RunOptions {
  productId?: string;
  productVersionId: string;
  claimId?: string;
  runMode?: 'PRODUCTION' | 'SIMULATION' | 'WHAT_IF';
  context: CalculationContext;
  writeTrace?: boolean;
  createdBy?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export async function loadProductBindings(productVersionId: string): Promise<BindingRow[]> {
  const { data, error } = await sb
    .from('bn_product_formula_binding')
    .select('id, product_id, product_version_id, formula_template_id, formula_version_id, calculation_stage, sequence_no, output_variable, rounding_rule, cap_min, cap_max, is_active')
    .eq('product_version_id', productVersionId)
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []) as BindingRow[];
}

export async function loadFormulaVersion(versionId: string | null, templateId: string): Promise<FormulaVersionRow> {
  let q = sb.from('bn_formula_version')
    .select('id, formula_code, version_no, expression_type, expression, steps_json, output_variable, rounding_rule');
  if (versionId) q = q.eq('id', versionId);
  else q = q.eq('formula_template_id', templateId).eq('is_active', true).order('version_no', { ascending: false }).limit(1);
  const { data, error } = await q;
  if (error) throw error;
  const row = (data ?? [])[0];
  if (!row) throw new Error(`No active formula version for template ${templateId}`);
  return row as FormulaVersionRow;
}

export async function loadMappings(bindingId: string): Promise<VariableMapping[]> {
  const { data, error } = await sb
    .from('bn_product_formula_variable_mapping')
    .select('variable_name, source_type, source_key, rate_table_code, required, default_value')
    .eq('binding_id', bindingId);
  if (error) throw error;
  return (data ?? []) as VariableMapping[];
}

/**
 * Build a real CalculationContext for an actual claim — resolves every FACT
 * variable a set of bindings needs from this claimant's real data (the same
 * resolver Eligibility rules already use), product parameters from their
 * real registered default, and raw claim fields from the claim row itself.
 *
 * Without this, running these bindings for a real claim had no way to reach
 * real per-claimant data at all — resolveVariables() only ever sees whatever
 * is already in ctx.facts, and nothing populated it for a real claim.
 */
export async function buildRealCalculationContext(
  bindingIds: string[],
  claim: RealClaimContext,
): Promise<CalculationContext> {
  const ctx = emptyContext();
  if (!bindingIds.length) return ctx;

  const allMappings = (
    await Promise.all(bindingIds.map((id) => loadMappings(id)))
  ).flat();

  const factKeys = [...new Set(
    allMappings.filter((m) => m.source_type === 'FACT').map((m) => m.source_key ?? m.variable_name),
  )];
  await Promise.all(factKeys.map(async (k) => {
    const v = await resolveRealFact(k, claim);
    if (v !== null) ctx.facts[k] = v;
  }));

  const paramKeys = [...new Set(
    allMappings.filter((m) => m.source_type === 'PRODUCT_PARAMETER').map((m) => m.source_key ?? m.variable_name),
  )];
  if (paramKeys.length) {
    const { data: params } = await sb
      .from('bn_product_parameter')
      .select('code, default_value')
      .in('code', paramKeys);
    for (const p of params ?? []) {
      if (p.default_value !== null && p.default_value !== undefined) ctx.productParameters[p.code] = Number(p.default_value);
    }
  }

  const fieldKeys = [...new Set(
    allMappings.filter((m) => m.source_type === 'CLAIM_FIELD').map((m) => m.source_key ?? m.variable_name),
  )];
  if (fieldKeys.length && claim.claimId) {
    const { data: claimRow } = await sb.from('bn_claim').select('*').eq('id', claim.claimId).maybeSingle();
    for (const f of fieldKeys) {
      if (claimRow && claimRow[f] !== undefined) ctx.claimFields[f] = claimRow[f];
    }
  }

  return ctx;
}

function sortBindings(bindings: BindingRow[]): BindingRow[] {
  return [...bindings].sort((a, b) => {
    const sa = STAGE_ORDER.indexOf(a.calculation_stage);
    const sb_ = STAGE_ORDER.indexOf(b.calculation_stage);
    if (sa !== sb_) return sa - sb_;
    return a.sequence_no - b.sequence_no;
  });
}

export async function runProductCalculationV2(opts: RunOptions): Promise<ProductCalculationResult> {
  const bindings = sortBindings(await loadProductBindings(opts.productVersionId));
  const ctx = opts.context ?? emptyContext();
  const priorResults: Record<string, unknown> = { ...ctx.priorResults };
  const finalScope: Record<string, unknown> = {};

  const out: ProductCalculationResult = { bindings: [], finalScope, finalAmount: null };
  let primaryAmount: number | null = null;

  for (const b of bindings) {
    const tStart = Date.now();
    try {
      const [formula, mappings] = await Promise.all([
        loadFormulaVersion(b.formula_version_id, b.formula_template_id),
        loadMappings(b.id),
      ]);
      const { scope, rateTableRefs, missing } = resolveVariables(mappings, { ...ctx, priorResults });
      if (missing.length) throw new Error(`Missing required variables: ${missing.join(', ')}`);

      const res = await runFormula(formula, scope, rateTableRefs);
      let rawOut = res.output;
      let rounded = applyRounding(rawOut, b.rounding_rule ?? formula.rounding_rule);

      // CAP stage applies cap_min/cap_max to the prior PRIMARY value
      if (b.calculation_stage === 'CAP' && primaryAmount != null) {
        let v = primaryAmount;
        if (b.cap_min != null) v = Math.max(v, b.cap_min);
        if (b.cap_max != null) v = Math.min(v, b.cap_max);
        // If formula returned a number, that takes precedence as the cap value applied
        if (rounded != null) v = Math.min(v, rounded);
        rounded = v;
        rawOut = v;
      }
      if (b.calculation_stage === 'PRIMARY' && rounded != null) primaryAmount = rounded;

      if (b.output_variable) priorResults[b.output_variable] = rounded ?? rawOut;
      Object.assign(finalScope, res.scope);

      out.bindings.push({
        binding_id: b.id, formula_code: formula.formula_code, formula_version: formula.version_no,
        calculation_stage: b.calculation_stage, sequence_no: b.sequence_no,
        raw_output: rawOut, rounded_output: rounded,
        output_variable: b.output_variable,
        lookup_trace: res.lookupTrace, expression_trace: res.expressionTrace,
        status: 'OK',
      });

      if (opts.writeTrace !== false) {
        await sb.from('bn_calculation_trace').insert({
          claim_id: opts.claimId ?? null,
          product_id: opts.productId ?? null,
          product_version_id: opts.productVersionId,
          formula_binding_id: b.id,
          formula_code: formula.formula_code,
          formula_version: formula.version_no,
          calculation_stage: b.calculation_stage,
          sequence_no: b.sequence_no,
          input_values_json: scope,
          lookup_trace_json: res.lookupTrace,
          expression_trace_json: res.expressionTrace,
          result_value: typeof rawOut === 'number' ? rawOut : null,
          rounded_value: rounded,
          status: 'OK',
          duration_ms: Date.now() - tStart,
          run_mode: opts.runMode ?? 'PRODUCTION',
          created_by: opts.createdBy ?? null,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      out.bindings.push({
        binding_id: b.id, formula_code: '?', formula_version: 0,
        calculation_stage: b.calculation_stage, sequence_no: b.sequence_no,
        raw_output: null, rounded_output: null, output_variable: b.output_variable,
        lookup_trace: [], expression_trace: [], status: 'ERROR', error: msg,
      });
      if (opts.writeTrace !== false) {
        await sb.from('bn_calculation_trace').insert({
          claim_id: opts.claimId ?? null, product_id: opts.productId ?? null,
          product_version_id: opts.productVersionId, formula_binding_id: b.id,
          calculation_stage: b.calculation_stage, sequence_no: b.sequence_no,
          status: 'ERROR', error_message: msg,
          duration_ms: Date.now() - tStart, run_mode: opts.runMode ?? 'PRODUCTION',
          created_by: opts.createdBy ?? null,
        });
      }
    }
  }

  // finalAmount = last successful PRIMARY/FINAL value
  const finals = out.bindings.filter((b) => b.status === 'OK' && (b.calculation_stage === 'FINAL' || b.calculation_stage === 'PRIMARY' || b.calculation_stage === 'CAP'));
  out.finalAmount = finals.length ? (finals[finals.length - 1].rounded_output ?? null) : null;

  return out;
}
