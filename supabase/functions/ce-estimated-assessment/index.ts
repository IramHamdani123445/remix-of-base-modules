import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  CALCULATION_PARAM_SPEC,
  isRetiredCalculationRule,
  resolveRuleParameters,
} from "../_shared/compliance/detectionRuleParameterSpec.ts";
import {
  computeEstimatedAssessment,
  reconcileEstimatedAssessment,
  type CeEstimateParameters,
  type CeHistoryPeriod,
} from "../_shared/compliance/calculation/estimatedAssessment.ts";
import {
  allocateEstimateToEmployees,
  CE_SYSTEM_ESTIMATED_MARKER,
  type CeEmployeeHistory,
} from "../_shared/compliance/calculation/employeeAllocation.ts";
import {
  calculationIdempotencyKey,
  type CeCalculationTrace,
} from "../_shared/compliance/calculation/calculationTrace.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Estimated Assessment lifecycle (CR-003) — Checkpoint C.
 *
 * actions:
 *   raise      — estimate a non-filer's liability from configured valid history
 *   reconcile  — employer later files the actual C3 (path A)
 *   allocate   — employer paid the estimate but never filed (path B):
 *                spread the payment across employees by historical wage ratio,
 *                marked SYSTEM_ESTIMATED, ambiguity to the review queue
 *
 * Everything is configuration-driven, traced in ce_calculation_audit and
 * idempotent: repeating a call never creates a second assessment, credit,
 * exception or employee line.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = body.action ?? "raise";
    const actor: string = body.triggered_by ?? "SYSTEM";

    if (isRetiredCalculationRule("CR-003")) {
      return json({ error: "CR-003 is retired in this deployment" }, 200);
    }

    if (action === "raise") return await raise(supabase, body, actor);
    if (action === "reconcile") return await reconcile(supabase, body, actor);
    if (action === "allocate") return await allocate(supabase, body, actor);
    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function loadEstimateParams(supabase: any): Promise<
  { params?: CeEstimateParameters; errors?: string[] }
> {
  const { data: rule } = await supabase
    .from("ce_calculation_rules")
    .select("*")
    .eq("rule_code", "CR-003")
    .maybeSingle();

  if (!rule || !rule.is_enabled) return { errors: ["CR-003 is not enabled"] };

  const resolved = resolveRuleParameters(CALCULATION_PARAM_SPEC["CR-003"], rule.parameters, null);
  if (resolved.errors.length > 0) return { errors: resolved.errors };

  return {
    params: {
      history_period_count: Number(resolved.values.history_period_count),
      estimate_multiplier: Number(resolved.values.estimate_multiplier),
      minimum_history_periods: Number(resolved.values.minimum_history_periods),
      exclude_zero_periods: Boolean(resolved.values.exclude_zero_periods),
      exclude_amended_periods: Boolean(resolved.values.exclude_amended_periods),
      exclude_statuses: (resolved.values.exclude_statuses ?? []) as string[],
      outlier_deviation_multiple: resolved.values.outlier_deviation_multiple ?? null,
      policy_version: `CR-003@${rule.updated_at ?? rule.created_at ?? "v1"}`,
    },
  };
}

async function writeAudit(
  supabase: any,
  trace: CeCalculationTrace,
  extra: Record<string, unknown>,
): Promise<string | null> {
  const { data } = await supabase
    .from("ce_calculation_audit")
    .insert({
      rule_code: trace.rule_code,
      component: trace.component,
      policy_version: trace.policy_version,
      principal: trace.principal,
      rate: trace.rate,
      rate_basis: trace.rate_basis,
      period_count: trace.period_count,
      multiplier: trace.multiplier,
      compounding_basis: trace.compounding_basis,
      source_periods: trace.source_periods,
      allocation_basis: trace.allocation_basis,
      rounding: trace.rounding,
      raw_amount: trace.raw_amount,
      amount: trace.amount,
      suppressed_reason: trace.suppressed_reason ?? null,
      steps: trace.steps,
      inputs: trace.inputs,
      ...extra,
    })
    .select("id")
    .maybeSingle();
  return data?.id ?? null;
}

/** Historical C3 periods for an employer, newest first. */
async function loadHistory(supabase: any, employerId: string, before: string, limit: number) {
  const { data } = await supabase
    .from("cn_c3_reported")
    .select("*")
    .eq("regno", employerId)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false })
    .limit(Math.max(limit * 4, 12));

  const candidates: CeHistoryPeriod[] = [];
  for (const row of data ?? []) {
    const period = `${row.period_year}-${String(row.period_month).padStart(2, "0")}`;
    if (period >= before) continue;
    const liability =
      Number(row.emp_ss_amt_calc ?? 0) +
      Number(row.emp_levy_amt_calc ?? 0) +
      Number(row.emp_pe_amt_calc ?? 0);
    candidates.push({
      wage_period: period,
      total_liability: liability,
      employee_count: row.employee_count ?? null,
      status: row.status ?? null,
      is_amended: Boolean(row.is_amended ?? false),
    });
  }
  return candidates;
}

async function raise(supabase: any, body: any, actor: string) {
  const employerId = String(body.employer_id ?? "");
  const wagePeriod = String(body.wage_period ?? "");
  if (!employerId || !/^\d{4}-\d{2}$/.test(wagePeriod)) {
    return json({ error: "employer_id and wage_period (YYYY-MM) are required" }, 400);
  }

  const { params, errors } = await loadEstimateParams(supabase);
  if (!params) return json({ configuration_error: errors }, 200);

  const idemKey = calculationIdempotencyKey({
    component: "ESTIMATED_ASSESSMENT",
    rule_code: "CR-003",
    employer_id: employerId,
    period: wagePeriod,
    fund_code: body.fund_code ?? "ALL",
  });

  const { data: existing } = await supabase
    .from("ce_estimated_assessments")
    .select("*")
    .eq("idempotency_key", idemKey)
    .maybeSingle();
  if (existing) return json({ idempotent: true, assessment: existing });

  const candidates =
    (body.candidates as CeHistoryPeriod[] | undefined) ??
    (await loadHistory(supabase, employerId, wagePeriod, params.history_period_count));

  const result = computeEstimatedAssessment({
    employer_id: employerId,
    wage_period: wagePeriod,
    candidates,
    params,
  });

  const auditId = await writeAudit(supabase, result.trace, {
    employer_id: employerId,
    wage_period: wagePeriod,
    fund_code: body.fund_code ?? null,
    idempotency_key: idemKey,
    reference_type: "estimated_assessment",
    calculated_by: actor,
  });

  const { data: assessment, error } = await supabase
    .from("ce_estimated_assessments")
    .insert({
      employer_id: employerId,
      wage_period: wagePeriod,
      fund_code: body.fund_code ?? null,
      status: result.outcome === "exception" ? "EXCEPTION" : "RAISED",
      estimated_amount: result.amount,
      history_period_count: params.history_period_count,
      estimate_multiplier: params.estimate_multiplier,
      average_liability: result.average_liability,
      basis_periods: result.basis.selected.map((p) => p.wage_period),
      excluded_periods: result.basis.excluded,
      policy_version: params.policy_version,
      calculation_audit_id: auditId,
      idempotency_key: idemKey,
      created_by: actor,
    })
    .select("*")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);

  if (result.outcome === "exception" && result.exception) {
    await supabase.from("ce_calculation_exceptions").upsert(
      {
        exception_type: "ESTIMATED_ASSESSMENT",
        rule_code: "CR-003",
        employer_id: employerId,
        wage_period: wagePeriod,
        reason_code: result.exception.reason,
        detail: result.exception.detail,
        assessment_id: assessment?.id ?? null,
        calculation_audit_id: auditId,
        idempotency_key: `EXC:CR-003:${employerId}:${wagePeriod}:insufficient_history`,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
  }

  return json({
    outcome: result.outcome,
    assessment,
    calculation_audit_id: auditId,
    trace: result.trace,
  });
}

async function reconcile(supabase: any, body: any, actor: string) {
  const assessmentId = String(body.assessment_id ?? "");
  const actualAmount = Number(body.actual_amount);
  if (!assessmentId || !Number.isFinite(actualAmount)) {
    return json({ error: "assessment_id and actual_amount are required" }, 400);
  }

  const { data: assessment } = await supabase
    .from("ce_estimated_assessments")
    .select("*")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!assessment) return json({ error: "Assessment not found" }, 404);
  if (assessment.status === "RECONCILED") {
    return json({ idempotent: true, assessment });
  }

  const result = reconcileEstimatedAssessment({
    employer_id: assessment.employer_id,
    wage_period: assessment.wage_period,
    estimated_amount: Number(assessment.estimated_amount),
    actual_amount: actualAmount,
    paid_against_estimate: Number(assessment.paid_amount ?? 0),
    policy_version: assessment.policy_version,
    tolerance: Number(body.tolerance ?? 0),
  });

  const auditId = await writeAudit(supabase, result.trace, {
    employer_id: assessment.employer_id,
    wage_period: assessment.wage_period,
    fund_code: assessment.fund_code,
    idempotency_key: `RECON:CR-003:${assessment.id}`,
    reference_type: "estimate_reconciliation",
    reference_id: assessment.id,
    calculated_by: actor,
  });

  // Estimated, actual, difference and the audit trail are all preserved.
  const { data: updated, error } = await supabase
    .from("ce_estimated_assessments")
    .update({
      status: "RECONCILED",
      actual_amount: result.actual_amount,
      difference_amount: result.difference,
      credit_amount: result.credit_amount,
      additional_liability: result.additional_liability,
      reconciliation_outcome: result.outcome,
      reconciled_at: new Date().toISOString(),
      reconciled_by: actor,
    })
    .eq("id", assessment.id)
    .eq("status", assessment.status) // optimistic guard — no double reconciliation
    .select("*")
    .maybeSingle();

  if (error) return json({ error: error.message }, 500);
  if (!updated) return json({ idempotent: true, message: "Already reconciled" });

  if (result.credit_amount > 0) {
    await supabase.from("ce_contribution_credits").upsert(
      {
        employer_id: assessment.employer_id,
        wage_period: `${assessment.wage_period}-01`,
        source_type: "ESTIMATE_RECONCILIATION",
        credit_type: "ESTIMATE_RECONCILIATION",
        fund_code: assessment.fund_code,
        amount: result.credit_amount,
        applied_amount: 0,
        status: "AVAILABLE",
        source_reference: `estimated_assessment:${assessment.id}`,
        source_assessment_id: assessment.id,
        calculation_audit_id: auditId,
        idempotency_key: `CREDIT:RECON:${assessment.id}`,
        notes:
          "Over-assessment credit — offsets future liabilities. Cash refund is a separate Finance process.",
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
  }

  return json({ outcome: result.outcome, assessment: updated, calculation_audit_id: auditId, trace: result.trace });
}

async function allocate(supabase: any, body: any, actor: string) {
  const assessmentId = String(body.assessment_id ?? "");
  if (!assessmentId) return json({ error: "assessment_id is required" }, 400);

  const { data: assessment } = await supabase
    .from("ce_estimated_assessments")
    .select("*")
    .eq("id", assessmentId)
    .maybeSingle();
  if (!assessment) return json({ error: "Assessment not found" }, 404);

  const { data: already } = await supabase
    .from("ce_estimated_assessment_lines")
    .select("id")
    .eq("assessment_id", assessmentId)
    .limit(1);
  if (already && already.length > 0) {
    return json({ idempotent: true, message: "System-estimated employee lines already exist" });
  }

  const employees: CeEmployeeHistory[] = body.employees ?? [];
  const basisPeriods: string[] = body.basis_periods ?? assessment.basis_periods ?? [];
  if (basisPeriods.length === 0) {
    return json({ error: "No basis periods available for employee allocation" }, 400);
  }

  const target = Number(body.target_amount ?? assessment.paid_amount ?? assessment.estimated_amount);

  const result = allocateEstimateToEmployees({
    employer_id: assessment.employer_id,
    target_period: assessment.wage_period,
    target_amount: target,
    employees,
    params: {
      basis_periods: basisPeriods,
      minimum_periods_present: Number(body.minimum_periods_present ?? 1),
      contribution_ceiling: body.contribution_ceiling ?? null,
      allocate_ceased_employees: Boolean(body.allocate_ceased_employees ?? false),
      allocate_benefit_overlap: Boolean(body.allocate_benefit_overlap ?? false),
      policy_version: assessment.policy_version,
    },
  });

  const auditId = await writeAudit(supabase, result.trace, {
    employer_id: assessment.employer_id,
    wage_period: assessment.wage_period,
    fund_code: assessment.fund_code,
    idempotency_key: `ALLOC:CR-003:${assessment.id}`,
    reference_type: "system_estimated_allocation",
    reference_id: assessment.id,
    calculated_by: actor,
  });

  if (result.allocations.length > 0) {
    await supabase.from("ce_estimated_assessment_lines").upsert(
      result.allocations.map((line) => ({
        assessment_id: assessment.id,
        person_ssn: line.person_ssn,
        wage_period: assessment.wage_period,
        record_marker: CE_SYSTEM_ESTIMATED_MARKER,
        allocation_ratio: line.ratio,
        allocated_amount: line.amount,
        capped_amount: line.capped_amount,
        basis_wage_total: line.basis_wage_total,
        periods_present: line.periods_present,
        basis_periods: basisPeriods,
        calculation_audit_id: auditId,
      })),
      { onConflict: "assessment_id,person_ssn", ignoreDuplicates: true },
    );
  }

  for (const ex of result.exceptions) {
    await supabase.from("ce_calculation_exceptions").upsert(
      {
        exception_type: "EMPLOYEE_ALLOCATION",
        rule_code: "CR-003",
        employer_id: assessment.employer_id,
        person_ssn: ex.person_ssn || null,
        wage_period: assessment.wage_period,
        reason_code: ex.reason,
        detail: ex.detail,
        indicative_amount: ex.indicative_amount,
        assessment_id: assessment.id,
        calculation_audit_id: auditId,
        idempotency_key: `EXC:ALLOC:${assessment.id}:${ex.person_ssn || "UNASSIGNED"}:${ex.reason}`,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    );
  }

  return json({
    record_marker: CE_SYSTEM_ESTIMATED_MARKER,
    allocated_amount: result.allocated_amount,
    unallocated_amount: result.unallocated_amount,
    lines: result.allocations.length,
    exceptions: result.exceptions.length,
    calculation_audit_id: auditId,
    trace: result.trace,
  });
}
