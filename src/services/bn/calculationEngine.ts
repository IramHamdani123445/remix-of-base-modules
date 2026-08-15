// ============================================================
// BN Calculation Engine - 10-Layer Processing Pipeline
// ============================================================
// This is the client-side engine. In production, the heavy lifting
// would move to a backend function/RPC. This keeps the logic
// transparent, auditable, and portable.
// ============================================================

import { supabase } from '@/integrations/supabase/client';
import type {
  BnCalcEngineInput,
  BnCalcEngineOutput,
  BnCalcTraceEntry,
  BnEligibilityResult,
  BnEligibilityRuleResult,
  BnContributionWindow,
  BnWageAggregation,
  BnFormulaResult,
  BnFormulaStep,
  BnBeneficiarySplit,
  BnPaymentScheduleEntry,
  BnValidationResult,
  BnValidationMessage,
  BnLegacyComparison,
  BnComparisonDiff,
  BnFormulaConfig,
  BnEngineLayer,
  BnTraceSeverity,
  BnCalcRun,
} from '@/types/bnCalcEngine';
import type { BnEligibilityRule, BnCalculationRule, BnTimelineRule } from '@/types/bn';
import { computeClaimReimbursement } from './calc/reimbursementCalculator';

const db = supabase as any;

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function runCalculationEngine(input: BnCalcEngineInput): Promise<BnCalcEngineOutput> {
  const trace: BnCalcTraceEntry[] = [];
  const startTime = Date.now();
  let stepCounter = 0;

  const addTrace = (
    layer: BnEngineLayer,
    stepCode: string,
    stepLabel: string,
    data: Partial<BnCalcTraceEntry> = {}
  ): BnCalcTraceEntry => {
    stepCounter++;
    const entry: BnCalcTraceEntry = {
      engineLayer: layer,
      stepNumber: stepCounter,
      stepCode,
      stepLabel,
      severity: 'INFO',
      inputs: {},
      ...data,
    };
    trace.push(entry);
    return entry;
  };

  // Create the run record
  const runRow = await createCalcRun(input);
  const runId = runRow.id;

  try {
    // Load product version config
    const [eligRules, calcRules, timelineRules] = await Promise.all([
      loadEligibilityRules(input.productVersionId),
      loadCalculationRules(input.productVersionId),
      loadTimelineRules(input.productVersionId),
    ]);

    addTrace('ELIGIBILITY', 'LOAD_CONFIG', 'Loaded product version configuration', {
      inputs: { eligRules: eligRules.length, calcRules: calcRules.length, timelineRules: timelineRules.length },
      severity: 'INFO',
    });

    // ---- Layer 1: Eligibility Engine ----
    const eligibility = await runEligibilityEngine(input, eligRules, addTrace);

    // ---- Layer 2: Contribution Window Engine ----
    const contributionWindow = await runContributionWindowEngine(input, eligRules, addTrace);

    // ---- Layer 3: Wage Aggregation Engine ----
    const wageAggregation = await runWageAggregationEngine(input, contributionWindow, addTrace);

    // ---- Layer 4: Formula Engine ----
    const formulaResult = await runFormulaEngine(input, calcRules, wageAggregation, timelineRules, addTrace);

    // ---- Layer 5: Beneficiary Allocation Engine ----
    const beneficiarySplits = await runBeneficiaryAllocationEngine(input, formulaResult, addTrace);

    // ---- Layer 6: Payment Schedule Engine ----
    const paymentSchedule = await runPaymentScheduleEngine(input, formulaResult, timelineRules, addTrace);

    // ---- Layer 7: Validation Engine ----
    const validation = runValidationEngine(eligibility, contributionWindow, wageAggregation, formulaResult, paymentSchedule, addTrace);

    // ---- Layer 8: Override handling ----
    // Override is handled externally via bn_calc_override table; trace it
    addTrace('OVERRIDE', 'OVERRIDE_CHECK', 'Override checkpoint reached', {
      inputs: { overrideParamsProvided: !!input.overrideParams },
      severity: 'INFO',
      message: input.overrideParams ? 'Override parameters supplied — manual review required' : 'No overrides requested',
    });

    // ---- Layer 10: Comparison Mode ----
    let comparison: BnLegacyComparison | undefined;
    if (input.mode === 'COMPARISON' && input.legacySnapshotId) {
      comparison = await runComparisonEngine(input.legacySnapshotId, formulaResult, addTrace);
    }

    const completedAt = new Date().toISOString();
    const status = validation.isValid ? 'COMPLETED' : (validation.errors.some(e => e.severity === 'FATAL') ? 'FAILED' : 'COMPLETED');

    // Persist results
    await updateCalcRun(runId, {
      run_status: status,
      completed_at: completedAt,
      eligibility_passed: eligibility.passed,
      eligibility_results: eligibility.rules,
      contribution_window: contributionWindow as any,
      wage_summary: wageAggregation as any,
      weekly_rate: formulaResult.finalWeeklyRate,
      monthly_rate: formulaResult.finalMonthlyRate,
      lump_sum: formulaResult.finalLumpSum,
      annual_amount: formulaResult.finalAnnualAmount,
      beneficiary_splits: beneficiarySplits as any,
      payment_schedule: paymentSchedule as any,
      payment_frequency: formulaResult.finalWeeklyRate > 0 ? 'WEEKLY' : (formulaResult.finalMonthlyRate > 0 ? 'MONTHLY' : 'ONE_OFF'),
      variables_snapshot: { wageAggregation, contributionWindow },
      errors: validation.errors,
      warnings: validation.warnings,
      legacy_result: comparison?.legacyRawOutput ?? null,
      comparison_diff: comparison ? { diffs: comparison.diffs } : null,
      comparison_match: comparison?.overallMatch ?? null,
    });

    // Persist trace
    await persistTrace(runId, trace);

    const output: BnCalcEngineOutput = {
      runId,
      status: status as any,
      eligibility,
      contributionWindow,
      wageAggregation,
      formulaResult,
      beneficiarySplits,
      paymentSchedule,
      validation,
      trace,
      comparison,
      variables: { wageAggregation, contributionWindow },
      startedAt: runRow.started_at,
      completedAt,
    };

    return output;
  } catch (err: any) {
    addTrace('VALIDATION', 'ENGINE_ERROR', 'Engine execution failed', {
      severity: 'FATAL',
      message: err?.message || 'Unknown error',
    });
    await updateCalcRun(runId, { run_status: 'FAILED', errors: [{ code: 'ENGINE_CRASH', layer: 'VALIDATION', message: err?.message, severity: 'FATAL' }] });
    await persistTrace(runId, trace);
    throw err;
  }
}

// ============================================================
// LAYER 1: ELIGIBILITY ENGINE
// ============================================================

async function runEligibilityEngine(
  input: BnCalcEngineInput,
  rules: BnEligibilityRule[],
  addTrace: Function
): Promise<BnEligibilityResult> {
  addTrace('ELIGIBILITY', 'ELIG_START', 'Starting eligibility checks', { inputs: { ruleCount: rules.length } });

  const results: BnEligibilityRuleResult[] = [];

  for (const rule of rules.filter(r => r.is_active)) {
    const t0 = Date.now();
    const result = await evaluateEligibilityRule(input, rule);
    results.push(result);

    addTrace('ELIGIBILITY', `ELIG_${rule.rule_code}`, rule.rule_name, {
      ruleCode: rule.rule_code,
      inputs: { actualValue: result.actualValue, requiredValue: result.requiredValue },
      passed: result.passed,
      severity: result.passed ? 'INFO' : (result.failAction === 'REJECT' ? 'ERROR' : 'WARN'),
      message: result.message,
      durationMs: Date.now() - t0,
    });
  }

  const hardFails = results.filter(r => !r.passed && r.failAction === 'REJECT');
  const passed = hardFails.length === 0;

  addTrace('ELIGIBILITY', 'ELIG_SUMMARY', 'Eligibility check complete', {
    passed,
    severity: passed ? 'INFO' : 'ERROR',
    message: passed ? 'All eligibility criteria met' : `${hardFails.length} eligibility rule(s) failed`,
  });

  return { passed, rules: results, overrideApplied: false };
}

async function evaluateEligibilityRule(input: BnCalcEngineInput, rule: BnEligibilityRule): Promise<BnEligibilityRuleResult> {
  const def = (rule.rule_definition || {}) as Record<string, any>;
  const base: Omit<BnEligibilityRuleResult, 'passed' | 'actualValue' | 'message'> = {
    ruleCode: rule.rule_code,
    ruleName: rule.rule_name,
    ruleGroup: rule.rule_group,
    requiredValue: def.value ?? def.required_value ?? def.min_weeks ?? def.min_age ?? null,
    failAction: (rule.fail_action as any) || 'REJECT',
    severity: rule.fail_action === 'WARN' ? 'WARN' : 'ERROR',
  };

  // Preferred path: registry-driven evaluation via field_key
  if (def.field_key) {
    try {
      const { resolveField } = await import('./eligibility/fieldResolver');
      const { evaluateOperator } = await import('./eligibility/operatorEvaluator');
      const { getFieldDef } = await import('./eligibility/fieldRegistry');
      const fieldDef = getFieldDef(def.field_key);
      if (!fieldDef) {
        return { ...base, actualValue: null, passed: false, message: `Unknown field_key: ${def.field_key}` };
      }
      const resolved = await resolveField(def.field_key, {
        ssn: input.ssn,
        claimId: (input as any).claimId,
        claimDate: input.claimDate,
        benefitType: (input as any).benefitType,
        employerRegNo: (input as any).employerRegNo,
      }, {
        windowType: def.window_type,
        windowFrom: def.window_from,
        windowTo: def.window_to,
        documentTypeCode: def.document_type_code,
      });
      const operator = def.operator || '==';
      const evalResult = evaluateOperator(resolved.value, operator, def.value, fieldDef.valueType, {
        rangeFrom: def.range_from,
        rangeTo: def.range_to,
      });
      return {
        ...base,
        actualValue: resolved.value as any,
        passed: evalResult.passed,
        message: evalResult.passed
          ? `${fieldDef.label}: ${evalResult.reason} — pass`
          : (rule.fail_message || `${fieldDef.label}: ${evalResult.reason}`),
      };
    } catch (err: any) {
      return { ...base, actualValue: null, passed: false, message: `Evaluation error: ${err?.message || err}` };
    }
  }

  // Legacy fallback (no field_key on rule_definition)
  switch (rule.rule_type) {
    case 'CONTRIBUTION': {
      const summary = await getContributionSummary(input.ssn, def.window_from, def.window_to);
      const actual = summary.total_weeks;
      const required = def.min_weeks || 0;
      return { ...base, actualValue: actual, passed: actual >= required, message: actual >= required ? `Has ${actual} contribution weeks (need ${required})` : `Only ${actual} contribution weeks (need ${required})` };
    }
    case 'AGE': {
      const age = await calculateAge(input.ssn, input.claimDate);
      const minAge = def.min_age || 0;
      const maxAge = def.max_age || 999;
      const passed = age != null && age >= minAge && age <= maxAge;
      return { ...base, actualValue: age, passed, message: passed ? `Age ${age} within range [${minAge}-${maxAge}]` : `Age ${age ?? 'unknown'} outside required range [${minAge}-${maxAge}]` };
    }
    default: {
      return { ...base, actualValue: null, passed: false, message: `Rule ${rule.rule_code} has no field_key — please reconfigure using the field catalogue.` };
    }
  }
}

// ============================================================
// LAYER 2: CONTRIBUTION WINDOW ENGINE
// ============================================================

async function runContributionWindowEngine(
  input: BnCalcEngineInput,
  eligRules: BnEligibilityRule[],
  addTrace: Function
): Promise<BnContributionWindow> {
  // Determine window from product config or eligibility rules
  const contribRule = eligRules.find(r => r.rule_type === 'CONTRIBUTION' && r.is_active);
  const def = (contribRule?.rule_definition || {}) as Record<string, any>;

  const windowType = def.window_type || 'LIFETIME';
  const requiredWeeks = def.min_weeks || 0;

  let fromDate = def.window_from || '1900-01-01';
  let toDate = def.window_to || input.claimDate;

  if (windowType === 'LAST_52_WEEKS') {
    const d = new Date(input.claimDate);
    d.setDate(d.getDate() - 364);
    fromDate = d.toISOString().substring(0, 10);
    toDate = input.claimDate;
  } else if (windowType === 'LAST_3_YEARS') {
    const d = new Date(input.claimDate);
    d.setFullYear(d.getFullYear() - 3);
    fromDate = d.toISOString().substring(0, 10);
    toDate = input.claimDate;
  }

  const summary = await getContributionSummary(input.ssn, fromDate, toDate);

  const result: BnContributionWindow = {
    fromDate,
    toDate,
    windowType,
    totalWeeks: summary.total_weeks,
    qualifyingWeeks: summary.total_weeks,
    requiredWeeks,
    met: summary.total_weeks >= requiredWeeks,
  };

  addTrace('CONTRIBUTION_WINDOW', 'CW_RESULT', 'Contribution window resolved', {
    inputs: { windowType, fromDate, toDate, requiredWeeks },
    outputValue: summary.total_weeks,
    passed: result.met,
    severity: result.met ? 'INFO' : 'WARN',
    message: `${summary.total_weeks} qualifying weeks in ${windowType} window`,
  });

  return result;
}

// ============================================================
// LAYER 3: WAGE AGGREGATION ENGINE
// ============================================================

async function runWageAggregationEngine(
  input: BnCalcEngineInput,
  window: BnContributionWindow,
  addTrace: Function
): Promise<BnWageAggregation> {
  const summary = await getContributionSummary(input.ssn, window.fromDate, window.toDate);

  // Check country ceiling
  const { data: countryData } = await db.from('bn_country').select('contribution_ceiling_weekly, contribution_ceiling_annual').eq('country_code', input.countryCode).maybeSingle();
  const weeklyCeiling = countryData?.contribution_ceiling_weekly;
  const annualCeiling = countryData?.contribution_ceiling_annual;

  let avgWeekly = summary.total_weeks > 0 ? summary.total_wages / summary.total_weeks : 0;
  let wagesCapped = false;
  let cappedAmount: number | undefined;

  if (weeklyCeiling && avgWeekly > weeklyCeiling) {
    cappedAmount = weeklyCeiling;
    avgWeekly = weeklyCeiling;
    wagesCapped = true;
  }

  const avgAnnual = avgWeekly * 52;

  const result: BnWageAggregation = {
    totalWages: summary.total_wages,
    totalWeeks: summary.total_weeks,
    averageWeeklyWage: round2(avgWeekly),
    averageAnnualWage: round2(avgAnnual),
    wagesCapped,
    cappedAmount,
  };

  addTrace('WAGE_AGGREGATION', 'WAGE_RESULT', 'Wages aggregated', {
    inputs: { totalWages: summary.total_wages, totalWeeks: summary.total_weeks, weeklyCeiling },
    outputValue: avgWeekly,
    severity: 'INFO',
    message: `Avg weekly wage: ${round2(avgWeekly)} | Avg annual: ${round2(avgAnnual)}${wagesCapped ? ' (capped)' : ''}`,
  });

  return result;
}

// ============================================================
// LAYER 4: FORMULA ENGINE
// ============================================================

async function runFormulaEngine(
  input: BnCalcEngineInput,
  calcRules: BnCalculationRule[],
  wages: BnWageAggregation,
  timelineRules: BnTimelineRule[],
  addTrace: Function
): Promise<BnFormulaResult> {
  const primaryRule = calcRules.find(r => r.is_active) || calcRules[0];
  if (!primaryRule) {
    addTrace('FORMULA', 'FORMULA_NONE', 'No calculation rules found', { severity: 'ERROR' });
    return emptyFormulaResult();
  }

  const config = primaryRule.formula_definition as unknown as BnFormulaConfig;
  const steps: BnFormulaStep[] = [];
  let rawResult = 0;
  let stepNum = 0;
  let paymentTypeOverride: string | null = null;

  const addStep = (desc: string, formula: string, inputs: Record<string, number>, result: number): BnFormulaStep => {
    stepNum++;
    const step: BnFormulaStep = { stepNumber: stepNum, description: desc, formula, inputs, result };
    steps.push(step);
    return step;
  };

  addTrace('FORMULA', 'FORMULA_START', `Applying ${primaryRule.calc_type} formula`, {
    ruleCode: primaryRule.rule_code,
    formulaExpression: config.expression || primaryRule.calc_type,
    inputs: { calcType: config.type || primaryRule.calc_type, rate: config.rate },
  });

  const calcType = config.type || primaryRule.calc_type;

  switch (calcType) {
    case 'PERCENTAGE_AWW':
    case 'PERCENTAGE':
    case 'FORMULA': {
      const rate = (config.rate || 66.67) / 100;
      rawResult = wages.averageWeeklyWage * rate;
      addStep('Apply rate to average weekly wage', `${wages.averageWeeklyWage} × ${rate * 100}%`, { avg_weekly_wage: wages.averageWeeklyWage, rate_pct: config.rate || 66.67 }, rawResult);
      break;
    }
    case 'PERCENTAGE_AAW': {
      const rate = (config.rate || 50) / 100;
      rawResult = (wages.averageAnnualWage * rate) / 12; // monthly
      addStep('Apply rate to average annual wage (monthly)', `(${wages.averageAnnualWage} × ${rate * 100}%) / 12`, { avg_annual_wage: wages.averageAnnualWage, rate_pct: config.rate || 50 }, rawResult);
      break;
    }
    case 'FLAT_GRANT':
    case 'FLAT_RATE': {
      rawResult = config.flatAmount || 0;
      addStep('Apply flat grant amount', `flat = ${rawResult}`, { flat_amount: rawResult }, rawResult);
      break;
    }
    case 'CONTRIBUTION_SCHEDULE': {
      const schedRules = config.scheduleRules || [];
      const totalWeeks = wages.totalWeeks;
      let matchedRate = 0;
      let matchedDesc = 'No matching tier';
      for (const sr of schedRules) {
        const [min, max] = sr.weekRange;
        if (totalWeeks >= min && (max === null || totalWeeks <= max)) {
          matchedRate = sr.rate;
          matchedDesc = sr.description;
          break;
        }
      }
      rawResult = (wages.averageAnnualWage * matchedRate / 100) / 12;
      addStep(`Schedule lookup: ${matchedDesc}`, `(${wages.averageAnnualWage} × ${matchedRate}%) / 12`, { total_weeks: totalWeeks, matched_rate: matchedRate }, rawResult);
      break;
    }
    case 'TIER_TABLE':
    case 'LOOKUP': {
      const tiers = config.tiers || [];
      const weeks = wages.totalWeeks;
      let matchedTier = tiers.find(t => weeks >= t.fromWeeks && (t.toWeeks === null || weeks <= t.toWeeks));
      if (matchedTier) {
        rawResult = matchedTier.flatAmount || (wages.averageWeeklyWage * matchedTier.rate / 100);
        addStep(`Tier lookup: ${matchedTier.fromWeeks}-${matchedTier.toWeeks ?? '∞'} weeks`, `rate = ${matchedTier.rate}%`, { weeks, rate: matchedTier.rate }, rawResult);
      }
      break;
    }
    case 'REIMBURSEMENT':
    case 'MEDICAL_REIMBURSEMENT':
    case 'ACTUAL_COST': {
      const reimbursement = await computeClaimReimbursement(input.claimId, input.claimDate);
      rawResult = reimbursement.total;
      paymentTypeOverride = 'ONE_OFF';
      for (const line of reimbursement.lines) {
        addStep(
          `Expense ${line.procedureCode ?? 'UNCODED'} (${line.jurisdiction})`,
          line.note,
          { claimed: line.claimedAmount, approved: line.approvedAmount },
          line.payableAmount,
        );
      }
      addStep(
        'Total reimbursable medical expenses',
        `sum(${reimbursement.expenseCount} line(s))`,
        { expense_lines: reimbursement.expenseCount },
        rawResult,
      );
      addTrace('FORMULA', 'REIMBURSEMENT_RESOLVED', 'Medical reimbursement resolved', {
        inputs: { expenseLines: reimbursement.expenseCount, total: reimbursement.total },
        severity: reimbursement.blockingReason ? 'ERROR' : 'INFO',
        message: reimbursement.blockingReason
          ? reimbursement.blockingReason === 'NO_MEDICAL_EXPENSE_LINES_CAPTURED'
            ? 'No medical expense lines captured on this claim — capture receipts on the Calculation tab before approval.'
            : 'All captured expense lines resolved to zero under the medical policy library.'
          : `Reimbursable total ${reimbursement.total.toFixed(2)} from ${reimbursement.expenseCount} line(s)`,
      });
      break;
    }
  }


  // Apply min/max caps
  let afterMinMax = rawResult;
  let minApplied = false;
  let maxApplied = false;
  const limits = primaryRule.limits as Record<string, any> || {};
  const minAmount = config.minAmount ?? limits.min_amount;
  const maxAmount = config.maxAmount ?? limits.max_amount;

  if (minAmount != null && afterMinMax < minAmount) {
    afterMinMax = minAmount;
    minApplied = true;
    addStep('Apply minimum cap', `max(${rawResult}, ${minAmount})`, { raw: rawResult, min: minAmount }, afterMinMax);
  }
  if (maxAmount != null && afterMinMax > maxAmount) {
    afterMinMax = maxAmount;
    maxApplied = true;
    addStep('Apply maximum cap', `min(${afterMinMax}, ${maxAmount})`, { raw: afterMinMax, max: maxAmount }, afterMinMax);
  }

  // Apply rounding
  const roundingRule = config.roundingRule || primaryRule.rounding_rule || 'ROUND_NEAREST_CENT';
  const afterRounding = applyRounding(afterMinMax, roundingRule);
  if (afterRounding !== afterMinMax) {
    addStep('Apply rounding', `round(${afterMinMax}, ${roundingRule})`, { value: afterMinMax }, afterRounding);
  }

  // Determine payment type outputs
  const paymentType = paymentTypeOverride || config.paymentConstruction || 'WEEKLY';
  let finalWeekly = 0, finalMonthly = 0, finalLumpSum = 0, finalAnnual = 0;

  if (paymentType === 'ONE_OFF') {
    finalLumpSum = afterRounding;
  } else if (paymentType === 'MONTHLY') {
    finalMonthly = afterRounding;
    finalAnnual = afterRounding * 12;
    finalWeekly = round2(afterRounding * 12 / 52);
  } else {
    finalWeekly = afterRounding;
    finalMonthly = round2(afterRounding * 52 / 12);
    finalAnnual = round2(afterRounding * 52);
  }

  const result: BnFormulaResult = {
    calcType: calcType,
    formulaExpression: config.expression || calcType,
    steps,
    rawResult: round2(rawResult),
    afterMinMax: round2(afterMinMax),
    afterRounding,
    finalWeeklyRate: finalWeekly,
    finalMonthlyRate: finalMonthly,
    finalLumpSum: finalLumpSum,
    finalAnnualAmount: finalAnnual,
    roundingRule,
    minApplied,
    maxApplied,
    minAmount,
    maxAmount,
  };

  addTrace('FORMULA', 'FORMULA_RESULT', 'Formula engine complete', {
    formulaExpression: config.expression || calcType,
    outputValue: afterRounding,
    severity: 'INFO',
    message: `Final: W=${finalWeekly} M=${finalMonthly} L=${finalLumpSum} A=${finalAnnual}`,
  });

  return result;
}

// ============================================================
// LAYER 5: BENEFICIARY ALLOCATION ENGINE
// ============================================================

async function runBeneficiaryAllocationEngine(
  input: BnCalcEngineInput,
  formula: BnFormulaResult,
  addTrace: Function
): Promise<BnBeneficiarySplit[]> {
  // In a full implementation, look up beneficiary records for the claim.
  // For now, default to 100% to primary claimant.
  const totalAmount = formula.finalMonthlyRate || formula.finalWeeklyRate || formula.finalLumpSum;

  const splits: BnBeneficiarySplit[] = [
    {
      beneficiarySSN: input.ssn,
      beneficiaryName: 'Primary Claimant',
      relationship: 'SELF',
      percentage: 100,
      amount: totalAmount,
      startDate: input.claimDate,
    },
  ];

  addTrace('BENEFICIARY_ALLOCATION', 'BENEF_RESULT', 'Beneficiary allocation complete', {
    inputs: { beneficiaryCount: splits.length, totalAmount },
    severity: 'INFO',
    message: `${splits.length} beneficiary(ies) allocated`,
  });

  return splits;
}

// ============================================================
// LAYER 6: PAYMENT SCHEDULE ENGINE
// ============================================================

async function runPaymentScheduleEngine(
  input: BnCalcEngineInput,
  formula: BnFormulaResult,
  timelineRules: BnTimelineRule[],
  addTrace: Function
): Promise<BnPaymentScheduleEntry[]> {
  const entries: BnPaymentScheduleEntry[] = [];
  const waitingRule = timelineRules.find(r => r.timeline_type === 'WAITING_PERIOD' && r.is_active);
  const maxDurationRule = timelineRules.find(r => r.timeline_type === 'MAX_DURATION' && r.is_active);
  const waitingDays = waitingRule?.days_value || 0;
  const maxWeeks = maxDurationRule?.weeks_value || 52;

  if (formula.finalLumpSum > 0) {
    entries.push({
      sequenceNumber: 1,
      paymentDate: input.claimDate,
      periodFrom: input.claimDate,
      periodTo: input.claimDate,
      grossAmount: formula.finalLumpSum,
      deductions: 0,
      netAmount: formula.finalLumpSum,
      paymentType: 'ONE_OFF',
      isRetroactive: false,
    });
  } else if (formula.finalWeeklyRate > 0) {
    const startDate = new Date(input.claimDate);
    startDate.setDate(startDate.getDate() + waitingDays);
    const scheduleWeeks = Math.min(maxWeeks, 13); // show first 13 weeks

    for (let i = 0; i < scheduleWeeks; i++) {
      const periodFrom = new Date(startDate);
      periodFrom.setDate(periodFrom.getDate() + i * 7);
      const periodTo = new Date(periodFrom);
      periodTo.setDate(periodTo.getDate() + 6);

      entries.push({
        sequenceNumber: i + 1,
        paymentDate: periodTo.toISOString().substring(0, 10),
        periodFrom: periodFrom.toISOString().substring(0, 10),
        periodTo: periodTo.toISOString().substring(0, 10),
        grossAmount: formula.finalWeeklyRate,
        deductions: 0,
        netAmount: formula.finalWeeklyRate,
        paymentType: 'WEEKLY',
        isRetroactive: i === 0 && waitingDays > 0,
      });
    }
  } else if (formula.finalMonthlyRate > 0) {
    const startDate = new Date(input.claimDate);
    const scheduleMonths = 6; // show first 6 months

    for (let i = 0; i < scheduleMonths; i++) {
      const periodFrom = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
      const periodTo = new Date(startDate.getFullYear(), startDate.getMonth() + i + 1, 0);

      entries.push({
        sequenceNumber: i + 1,
        paymentDate: periodTo.toISOString().substring(0, 10),
        periodFrom: periodFrom.toISOString().substring(0, 10),
        periodTo: periodTo.toISOString().substring(0, 10),
        grossAmount: formula.finalMonthlyRate,
        deductions: 0,
        netAmount: formula.finalMonthlyRate,
        paymentType: 'MONTHLY',
        isRetroactive: false,
      });
    }
  }

  addTrace('PAYMENT_SCHEDULE', 'PAY_RESULT', 'Payment schedule generated', {
    inputs: { waitingDays, maxWeeks, entryCount: entries.length },
    severity: 'INFO',
    message: `${entries.length} payment entries generated`,
  });

  return entries;
}

// ============================================================
// LAYER 7: VALIDATION ENGINE
// ============================================================

function runValidationEngine(
  eligibility: BnEligibilityResult,
  contributionWindow: BnContributionWindow,
  wages: BnWageAggregation,
  formula: BnFormulaResult,
  schedule: BnPaymentScheduleEntry[],
  addTrace: Function
): BnValidationResult {
  const errors: BnValidationMessage[] = [];
  const warnings: BnValidationMessage[] = [];

  // Eligibility failures
  for (const r of eligibility.rules.filter(r => !r.passed)) {
    if (r.failAction === 'REJECT') {
      errors.push({ code: `ELIG_${r.ruleCode}`, layer: 'ELIGIBILITY', message: r.message, severity: 'ERROR', ruleCode: r.ruleCode });
    } else {
      warnings.push({ code: `ELIG_${r.ruleCode}`, layer: 'ELIGIBILITY', message: r.message, severity: 'WARN', ruleCode: r.ruleCode });
    }
  }

  // Zero wage check
  if (wages.totalWeeks === 0 && formula.calcType !== 'FLAT_GRANT' && formula.calcType !== 'FLAT_RATE') {
    errors.push({ code: 'WAGE_ZERO', layer: 'WAGE_AGGREGATION', message: 'No wages found in contribution window', severity: 'ERROR' });
  }

  // Zero result check
  if (formula.finalWeeklyRate === 0 && formula.finalMonthlyRate === 0 && formula.finalLumpSum === 0) {
    warnings.push({ code: 'CALC_ZERO', layer: 'FORMULA', message: 'Calculated benefit amount is zero', severity: 'WARN' });
  }

  // Schedule empty
  if (schedule.length === 0) {
    warnings.push({ code: 'SCHED_EMPTY', layer: 'PAYMENT_SCHEDULE', message: 'No payment schedule entries generated', severity: 'WARN' });
  }

  const isValid = errors.filter(e => e.severity === 'FATAL' || e.severity === 'ERROR').length === 0;

  addTrace('VALIDATION', 'VALID_RESULT', 'Validation complete', {
    passed: isValid,
    severity: isValid ? 'INFO' : 'ERROR',
    message: `${errors.length} errors, ${warnings.length} warnings`,
  });

  return { isValid, errors, warnings };
}

// ============================================================
// LAYER 10: COMPARISON ENGINE
// ============================================================

async function runComparisonEngine(
  legacySnapshotId: string,
  formula: BnFormulaResult,
  addTrace: Function
): Promise<BnLegacyComparison> {
  const { data: snapshot } = await db.from('bn_calc_legacy_snapshot').select('*').eq('id', legacySnapshotId).maybeSingle();

  if (!snapshot) {
    addTrace('COMPARISON', 'COMP_NO_DATA', 'No legacy snapshot found', { severity: 'WARN' });
    return { legacyRawOutput: {}, diffs: [], overallMatch: false, matchPercentage: 0 };
  }

  const diffs: BnComparisonDiff[] = [];

  const compareField = (field: string, label: string, engineVal: number, legacyVal: number | null, tolerance = 1) => {
    const match = legacyVal !== null && Math.abs(engineVal - legacyVal) <= tolerance;
    diffs.push({ field, label, engineValue: engineVal, legacyValue: legacyVal, match, tolerancePercent: tolerance });
  };

  compareField('weekly_rate', 'Weekly Rate', formula.finalWeeklyRate, snapshot.legacy_weekly_rate);
  compareField('monthly_rate', 'Monthly Rate', formula.finalMonthlyRate, snapshot.legacy_monthly_rate);
  compareField('lump_sum', 'Lump Sum', formula.finalLumpSum, snapshot.legacy_lump_sum);

  const matchCount = diffs.filter(d => d.match).length;
  const matchPercentage = diffs.length > 0 ? round2((matchCount / diffs.length) * 100) : 100;
  const overallMatch = matchPercentage === 100;

  addTrace('COMPARISON', 'COMP_RESULT', 'Legacy comparison complete', {
    inputs: { legacySnapshotId },
    outputValue: matchPercentage,
    passed: overallMatch,
    severity: overallMatch ? 'INFO' : 'WARN',
    message: `Match: ${matchPercentage}% (${matchCount}/${diffs.length} fields)`,
  });

  return {
    legacyWeeklyRate: snapshot.legacy_weekly_rate,
    legacyMonthlyRate: snapshot.legacy_monthly_rate,
    legacyLumpSum: snapshot.legacy_lump_sum,
    legacyRawOutput: snapshot.legacy_raw_output || {},
    diffs,
    overallMatch,
    matchPercentage,
  };
}

// ============================================================
// HELPERS
// ============================================================

async function getContributionSummary(ssn: string, fromDate?: string, toDate?: string) {
  const { data, error } = await db.rpc('bn_get_contribution_summary', {
    p_ssn: ssn,
    p_from_date: fromDate || null,
    p_to_date: toDate || null,
  });
  if (error) throw error;
  return data?.[0] ?? { total_weeks: 0, total_wages: 0, avg_weekly_wages: 0 };
}

async function calculateAge(ssn: string, refDate: string): Promise<number | null> {
  const { bnPersonAdapter } = await import('./integration/personAdapter');
  const dob = await bnPersonAdapter.getPersonDOB(ssn);
  if (!dob) return null;
  const d = new Date(dob);
  const ref = new Date(refDate);
  if (isNaN(d.getTime()) || isNaN(ref.getTime())) return null;
  let age = ref.getFullYear() - d.getFullYear();
  const m = ref.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age--;
  return age;
}

async function loadEligibilityRules(versionId: string): Promise<BnEligibilityRule[]> {
  const { data, error } = await db.from('bn_eligibility_rule').select('*').eq('product_version_id', versionId).eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnEligibilityRule[];
}

async function loadCalculationRules(versionId: string): Promise<BnCalculationRule[]> {
  const { data, error } = await db.from('bn_calculation_rule').select('*').eq('product_version_id', versionId).eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnCalculationRule[];
}

async function loadTimelineRules(versionId: string): Promise<BnTimelineRule[]> {
  const { data, error } = await db.from('bn_timeline_rule').select('*').eq('product_version_id', versionId).eq('is_active', true).order('sort_order');
  if (error) throw error;
  return (data ?? []) as BnTimelineRule[];
}

async function createCalcRun(input: BnCalcEngineInput): Promise<BnCalcRun> {
  const { requireUserCode } = await import('@/lib/bn/requireUserCode');
  const triggeredBy = requireUserCode((input as any).triggeredBy, 'runCalculationEngine');
  const { data, error } = await db.from('bn_calc_run').insert({
    claim_id: input.claimId,
    product_version_id: input.productVersionId,
    run_mode: input.mode,
    run_status: 'RUNNING',
    triggered_by: triggeredBy,
    country_code: input.countryCode,
  }).select().single();
  if (error) throw error;
  return data as BnCalcRun;
}

async function updateCalcRun(id: string, updates: Partial<BnCalcRun>) {
  const { error } = await db.from('bn_calc_run').update({ ...updates, modified_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

async function persistTrace(runId: string, trace: BnCalcTraceEntry[]) {
  if (trace.length === 0) return;
  const rows = trace.map(t => ({
    calc_run_id: runId,
    engine_layer: t.engineLayer,
    step_number: t.stepNumber,
    step_code: t.stepCode,
    step_label: t.stepLabel,
    rule_code: t.ruleCode || null,
    formula_expression: t.formulaExpression || null,
    inputs: t.inputs,
    output_value: t.outputValue ?? null,
    output_text: t.outputText || null,
    passed: t.passed ?? null,
    severity: t.severity,
    message: t.message || null,
    duration_ms: t.durationMs ?? null,
  }));
  const { error } = await db.from('bn_calc_trace').insert(rows);
  if (error) console.error('Failed to persist trace:', error);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function applyRounding(value: number, rule: string): number {
  switch (rule) {
    case 'ROUND_HALF_UP': return Math.round(value * 100) / 100;
    case 'ROUND_DOWN': return Math.floor(value * 100) / 100;
    case 'ROUND_UP': return Math.ceil(value * 100) / 100;
    case 'ROUND_NEAREST_CENT': return Math.round(value * 100) / 100;
    case 'ROUND_NEAREST_DOLLAR': return Math.round(value);
    default: return Math.round(value * 100) / 100;
  }
}

function emptyFormulaResult(): BnFormulaResult {
  return {
    calcType: 'NONE',
    formulaExpression: '',
    steps: [],
    rawResult: 0,
    afterMinMax: 0,
    afterRounding: 0,
    finalWeeklyRate: 0,
    finalMonthlyRate: 0,
    finalLumpSum: 0,
    finalAnnualAmount: 0,
    roundingRule: 'ROUND_NEAREST_CENT',
    minApplied: false,
    maxApplied: false,
  };
}

// ============================================================
// SIMULATION PRESETS
// ============================================================

export async function fetchSimulationPresets(productId?: string) {
  let query = db.from('bn_calc_simulation_preset').select('*').eq('is_active', true).order('entered_at', { ascending: false });
  if (productId) query = query.eq('product_id', productId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function saveSimulationPreset(preset: Record<string, unknown>) {
  const { data, error } = await db.from('bn_calc_simulation_preset').upsert(preset).select().single();
  if (error) throw error;
  return data;
}

// ============================================================
// LEGACY SNAPSHOTS
// ============================================================

export async function fetchLegacySnapshots(claimId: string) {
  const { data, error } = await db.from('bn_calc_legacy_snapshot').select('*').eq('claim_id', claimId).order('captured_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function saveLegacySnapshot(snapshot: Record<string, unknown>) {
  const { data, error } = await db.from('bn_calc_legacy_snapshot').insert(snapshot).select().single();
  if (error) throw error;
  return data;
}

// ============================================================
// CALC RUNS QUERY
// ============================================================

export async function fetchCalcRuns(claimId: string): Promise<BnCalcRun[]> {
  const { data, error } = await db.from('bn_calc_run').select('*').eq('claim_id', claimId).order('started_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as BnCalcRun[];
}

export async function fetchCalcRunById(id: string): Promise<BnCalcRun | null> {
  const { data, error } = await db.from('bn_calc_run').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data as BnCalcRun | null;
}

export async function fetchCalcTrace(runId: string): Promise<BnCalcTraceEntry[]> {
  const { data, error } = await db.from('bn_calc_trace').select('*').eq('calc_run_id', runId).order('step_number');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    calcRunId: r.calc_run_id,
    engineLayer: r.engine_layer,
    stepNumber: r.step_number,
    stepCode: r.step_code,
    stepLabel: r.step_label,
    ruleCode: r.rule_code,
    formulaExpression: r.formula_expression,
    inputs: r.inputs,
    outputValue: r.output_value,
    outputText: r.output_text,
    passed: r.passed,
    severity: r.severity,
    message: r.message,
    durationMs: r.duration_ms,
  })) as BnCalcTraceEntry[];
}

// ============================================================
// OVERRIDES
// ============================================================

export async function fetchCalcOverrides(runId: string) {
  const { data, error } = await db.from('bn_calc_override').select('*').eq('calc_run_id', runId).order('requested_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCalcOverride(override: Record<string, unknown>) {
  const { data, error } = await db.from('bn_calc_override').insert(override).select().single();
  if (error) throw error;
  return data;
}

export async function approveCalcOverride(id: string, approvedBy: string) {
  const { data, error } = await db.from('bn_calc_override').update({
    approval_status: 'APPROVED',
    approved_by: approvedBy,
    approved_at: new Date().toISOString(),
  }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function rejectCalcOverride(id: string, rejectedBy: string, reason: string) {
  const { data, error } = await db.from('bn_calc_override').update({
    approval_status: 'REJECTED',
    approved_by: rejectedBy,
    approved_at: new Date().toISOString(),
    rejection_reason: reason,
  }).eq('id', id).select().single();
  if (error) throw error;
  return data;
}
