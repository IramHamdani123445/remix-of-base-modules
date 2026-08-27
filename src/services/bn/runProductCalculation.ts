/**
 * runProductCalculation
 *
 * Phase B of the Formula Library cutover. Every runtime consumer that needs
 * to evaluate a product's formula MUST go through this helper:
 *
 *   workbench / entitlement / award / payment / simulation
 *        ↓
 *   runProductCalculation(productVersionId, claimContext)
 *        ↓
 *   loadProductCalculationConfig  (Formula Library + product overrides)
 *   loadResolverMap               (Fact / Derived Fact / Parameter / Prior)
 *   parseFormula + evaluateFormula
 *   applyCapsAndRounding
 *
 * No other path may read formula expressions or evaluate them directly.
 */
import {
  loadProductCalculationConfig,
  applyCapsAndRounding,
  type ProductCalculationConfig,
} from './productCalculationLoader';
import {
  loadResolverMap,
  classifyVariables,
  type ResolverMap,
  type ResolvedVariable,
  type UnresolvedVariable,
} from './variableResolverService';
import { parseFormula, evaluateFormula } from '@/lib/bn/formulaParser';
import { resolveField } from './eligibility/fieldResolver';
import { resolveFact } from './eligibility/eligibilityFactResolver';

export interface RealClaimContext {
  ssn: string;
  claimId?: string | null;
  claimDate: string;
  employerRegNo?: string | null;
}

export interface ProductCalculationContext {
  /** Values the resolver could not infer (claim-supplied, prior result, etc.). */
  inputs?: Record<string, number>;
  /** When true, missing variables are auto-filled with 0 / sample. Used by the simulator. */
  useSamples?: boolean;
  /**
   * A real claim to resolve FACT-sourced variables against. When present,
   * a FACT variable is resolved from this claimant's actual data (via the
   * same resolver Eligibility rules use) instead of the fact's registered
   * sample value. Without this, every real claim run of this fallback was
   * silently using placeholder numbers for every claimant, regardless of
   * their real circumstances — see BUG log for the trace that found this.
   */
  claimContext?: RealClaimContext;
}

/** Resolve one FACT-sourced variable for a real claim. Returns null (not 0)
 * when it genuinely cannot be resolved, so the caller can tell "no real
 * value" apart from "the real value is zero". Exported so the Formula
 * Bindings (v2) calculation path can reuse the same real resolution instead
 * of re-implementing it. */
export async function resolveRealFact(factKey: string, claim: RealClaimContext): Promise<number | null> {
  // Eligibility rules and Calculation variables both draw from the same
  // bn_eligibility_fact registry — eligibilityFactResolver is the real,
  // per-claim resolver already proven correct for Eligibility.
  try {
    const r = await resolveFact(factKey, {
      ssn: claim.ssn, claimId: claim.claimId ?? null, claimDate: claim.claimDate,
      employerRegno: claim.employerRegNo ?? null,
    });
    const n = Number(r.value);
    return Number.isFinite(n) ? n : null;
  } catch {
    // Not every fact_key in bn_eligibility_fact also exists in the older,
    // hardcoded eligibility/fieldRegistry — try that resolver as a fallback
    // before giving up.
    try {
      const r = await resolveField(factKey, { ssn: claim.ssn, claimId: claim.claimId ?? undefined, claimDate: claim.claimDate, employerRegNo: claim.employerRegNo ?? undefined });
      const n = Number(r.value);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
}

export interface ProductCalculationTraceEntry {
  variable: string;
  source: ResolvedVariable['source'] | 'INPUT' | 'PARAMETER' | 'UNRESOLVED';
  value: number | null;
  resolverPath: string;
}

export interface ProductCalculationResult {
  productVersionId: string;
  template: ProductCalculationConfig['template'];
  rawValue: number;
  finalValue: number;
  variablesUsed: string[];
  unresolved: UnresolvedVariable[];
  trace: ProductCalculationTraceEntry[];
  warnings: string[];
  errors: string[];
}

export async function runProductCalculation(
  productVersionId: string,
  ctx: ProductCalculationContext = {},
): Promise<ProductCalculationResult> {
  const config = await loadProductCalculationConfig(productVersionId);
  const resolver: ResolverMap = await loadResolverMap();

  const parsed = parseFormula(config.template.formula_expression, resolver);
  const variablesUsed = parsed.variablesUsed;

  const { unresolved } = classifyVariables(variablesUsed, resolver);

  // Build evaluation context: parameter values > caller inputs > resolver sample.
  const evalCtx: Record<string, number> = {};
  const trace: ProductCalculationTraceEntry[] = [];
  const warnings: string[] = [];

  const errors: string[] = [];

  for (const v of variablesUsed) {
    const fromParam = config.parameters[v];
    if (fromParam !== undefined && fromParam !== null) {
      const n = Number(fromParam);
      evalCtx[v] = n;
      trace.push({ variable: v, source: 'PARAMETER', value: n, resolverPath: `bn_product_version.formula_parameter_values.${v}` });
      continue;
    }
    const fromInput = ctx.inputs?.[v];
    if (typeof fromInput === 'number' && Number.isFinite(fromInput)) {
      evalCtx[v] = fromInput;
      trace.push({ variable: v, source: 'INPUT', value: fromInput, resolverPath: `context.inputs.${v}` });
      continue;
    }
    const resolved = resolver.get(v);

    // A real claim is being calculated and this variable is a FACT — resolve
    // it against this specific claimant's real data, the same way Eligibility
    // rules already do, instead of the fact's registered sample value.
    if (ctx.claimContext && resolved?.source === 'FACT') {
      const real = await resolveRealFact(v, ctx.claimContext);
      if (real !== null) {
        evalCtx[v] = real;
        trace.push({ variable: v, source: 'FACT', value: real, resolverPath: `FACT (real, SSN ${ctx.claimContext.ssn}):${v}` });
        continue;
      }
      // Could not resolve this claimant's real value — fall through. Only a
      // caller that explicitly opted into sample fallback (ctx.useSamples)
      // may still use the sample below; a real claim run should not.
    }

    if (resolved) {
      const n = resolved.sampleValue !== null && resolved.sampleValue !== undefined ? Number(resolved.sampleValue) : NaN;
      const samplesAllowedHere = ctx.useSamples || !ctx.claimContext;
      if (Number.isFinite(n) && samplesAllowedHere) {
        evalCtx[v] = n;
        trace.push({ variable: v, source: resolved.source, value: n, resolverPath: `${resolved.source}:${resolved.code}${ctx.claimContext ? ' (SAMPLE — could not resolve a real value)' : ''}` });
        continue;
      }
      if (ctx.useSamples) {
        evalCtx[v] = 0;
        trace.push({ variable: v, source: resolved.source, value: 0, resolverPath: `${resolved.source}:${resolved.code} (no sample, filled 0)` });
        warnings.push(`Variable "${v}" has no sample value; defaulted to 0.`);
        continue;
      }
    }
    trace.push({ variable: v, source: 'UNRESOLVED', value: null, resolverPath: 'unresolved' });
    if (ctx.claimContext && resolved?.source === 'FACT') {
      errors.push(`Variable "${v}" is a real claim fact but could not be resolved for SSN ${ctx.claimContext.ssn} — the calculation cannot proceed with a placeholder value.`);
    }
  }

  if (parsed.errors.length) errors.push(...parsed.errors);
  if (unresolved.length) errors.push(`Unresolved variables: ${unresolved.map((u) => u.variable).join(', ')}`);

  let rawValue = NaN;
  if (parsed.ast) {
    try {
      rawValue = evaluateFormula(parsed.ast, evalCtx);
    } catch (e: any) {
      errors.push(`evaluateFormula failed: ${e?.message ?? 'unknown'}`);
    }
  }

  const finalValue = Number.isFinite(rawValue)
    ? applyCapsAndRounding(rawValue, config.capRules, config.rounding)
    : rawValue;

  return {
    productVersionId,
    template: config.template,
    rawValue,
    finalValue,
    variablesUsed,
    unresolved,
    trace,
    warnings,
    errors,
  };
}
