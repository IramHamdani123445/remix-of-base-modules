import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  normalizeObligationPolicy,
  resolveObligationTimeline,
} from "../_shared/compliance/obligationDeadlineResolver.ts";
import {
  CALCULATION_PARAM_SPEC,
  isRetiredCalculationRule,
  resolveRuleParameters,
} from "../_shared/compliance/detectionRuleParameterSpec.ts";
import {
  computeInterest,
  type CeCompoundingBasis,
  type CeInterestAccrualStart,
  type CeInterestPolicy,
} from "../_shared/compliance/calculation/interestEngine.ts";
import { calculationIdempotencyKey } from "../_shared/compliance/calculation/calculationTrace.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Interest Accrual Job (CR-002) — Checkpoint C.
 *
 * Interest is a SEPARATE financial component. There is no generic
 * late-payment penalty here: CR-001 is retired and fund-specific fines /
 * penalties are produced by their own rules.
 *
 * Every figure is:
 *  - configured (CR-002 parameters; nothing hard-coded),
 *  - anchored on the authoritative obligation timeline (never recomputed),
 *  - traced in ce_calculation_audit so it can be reproduced,
 *  - idempotent (INTEREST:CR-002:<employer>:<period>:<fund>:<as_of>).
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run ?? false;
    const triggeredBy = body.triggered_by ?? "SYSTEM";
    const accrualDate: string = body.accrual_date ?? new Date().toISOString().slice(0, 10);

    const runId = crypto.randomUUID();
    await supabase.from("ce_job_run_log").insert({
      id: runId,
      job_name: "Interest Accrual (CR-002)",
      job_code: "LEDGER-PENALTY-ACCRUAL",
      run_type: "scheduled",
      parameters: { dry_run: dryRun, accrual_date: accrualDate },
      triggered_by: triggeredBy,
    });

    const finish = async (status: string, counts: Record<string, number>, message: string) => {
      await supabase
        .from("ce_job_run_log")
        .update({
          run_end: new Date().toISOString(),
          status,
          records_read: counts.read ?? 0,
          records_posted: counts.posted ?? 0,
          records_failed: counts.failed ?? 0,
          records_skipped: counts.skipped ?? 0,
          summary_message: message,
        })
        .eq("id", runId);
    };

    /* ── configuration truth: CR-002 ── */
    const { data: rule } = await supabase
      .from("ce_calculation_rules")
      .select("*")
      .eq("rule_code", "CR-002")
      .maybeSingle();

    if (!rule || !rule.is_enabled || isRetiredCalculationRule("CR-002")) {
      await finish("COMPLETED", {}, "CR-002 interest rule is not enabled — nothing accrued");
      return json({ run_id: runId, skipped: "CR-002 disabled" });
    }

    const resolved = resolveRuleParameters(CALCULATION_PARAM_SPEC["CR-002"], rule.parameters, null);
    if (resolved.errors.length > 0) {
      await finish("FAILED", {}, `CR-002 configuration error: ${resolved.errors.join("; ")}`);
      return json({ run_id: runId, configuration_error: resolved.errors }, 200);
    }

    const firstOf = (v: unknown, fallback: string): string =>
      Array.isArray(v) && v.length > 0 ? String(v[0]) : String(v ?? fallback);

    const policy: CeInterestPolicy = {
      annual_rate_percent: Number(resolved.values.annual_rate_percent),
      compounding_basis: firstOf(resolved.values.compounding_basis, "monthly_compound") as CeCompoundingBasis,
      minimum_interest_principal: Number(resolved.values.minimum_interest_principal),
      accrual_start: firstOf(resolved.values.accrual_start, "grace_end") as CeInterestAccrualStart,
      max_accrual_months: resolved.values.max_accrual_months ?? null,
      policy_version: `CR-002@${rule.updated_at ?? rule.created_at ?? "v1"}`,
    };

    /* ── authoritative obligation timeline ── */
    const { data: compliancePolicy } = await supabase
      .from("ce_compliance_policies")
      .select("*")
      .eq("is_active", true)
      .maybeSingle();

    if (!compliancePolicy) {
      await finish("FAILED", {}, "No active compliance policy — the obligation timeline is unresolvable");
      return json({ run_id: runId, configuration_error: ["no active ce_compliance_policies row"] }, 200);
    }
    const obligationPolicy = normalizeObligationPolicy({
      deadline_basis: compliancePolicy.deadline_basis,
      reporting_offset_months: compliancePolicy.reporting_offset_months,
      deadline_fixed_day: compliancePolicy.deadline_fixed_day,
      grace_days: compliancePolicy.payment_grace_period_days ?? 0,
    });

    /* ── outstanding contribution balances ── */
    const { data: periods } = await supabase
      .from("ce_ledger_periods")
      .select("employer_id, period, fund_type, principal_due, penalties, interest, payments, balance")
      .gt("balance", 0);

    let read = 0, posted = 0, skipped = 0, failed = 0;

    for (const row of periods ?? []) {
      read++;
      const wagePeriod = normalisePeriod(row.period);
      if (!wagePeriod) { skipped++; continue; }

      // Interest is charged on the contribution principal outstanding — never
      // on accumulated interest posted as a separate component.
      const principal = Math.max(
        Number(row.balance || 0) - Number(row.interest || 0),
        0,
      );

      let timeline;
      try {
        timeline = resolveObligationTimeline({
          obligation_type: "CONTRIBUTION_PAYMENT",
          wage_period: wagePeriod,
          policy: obligationPolicy,
        });
      } catch { skipped++; continue; }

      const { data: prior } = await supabase
        .from("ce_interest_accruals")
        .select("cumulative_interest")
        .eq("employer_id", row.employer_id)
        .eq("wage_period", wagePeriod)
        .eq("fund_code", row.fund_type ?? "ALL")
        .order("as_of_date", { ascending: false })
        .limit(1);

      const alreadyAccrued = Number(prior?.[0]?.cumulative_interest ?? 0);

      const result = computeInterest({
        employer_id: row.employer_id,
        fund_code: row.fund_type ?? null,
        principal,
        anchor: {
          due_date: timeline.due_date,
          grace_end_date: timeline.grace_end_date,
          wage_period: wagePeriod,
        },
        as_of_date: accrualDate,
        policy,
        already_accrued: alreadyAccrued,
      });

      const idemKey = calculationIdempotencyKey({
        component: "INTEREST",
        rule_code: "CR-002",
        employer_id: row.employer_id,
        period: wagePeriod,
        fund_code: row.fund_type ?? "ALL",
        as_of: accrualDate,
      });

      if (result.amount <= 0) { skipped++; continue; }
      if (dryRun) { posted++; continue; }

      const { data: audit, error: auditErr } = await supabase
        .from("ce_calculation_audit")
        .insert({
          rule_code: "CR-002",
          component: "INTEREST",
          policy_version: policy.policy_version,
          employer_id: row.employer_id,
          wage_period: wagePeriod,
          fund_code: row.fund_type ?? null,
          principal: result.trace.principal,
          rate: result.trace.rate,
          rate_basis: result.trace.rate_basis,
          period_count: result.trace.period_count,
          compounding_basis: result.trace.compounding_basis,
          source_periods: result.trace.source_periods,
          rounding: result.trace.rounding,
          raw_amount: result.trace.raw_amount,
          amount: result.trace.amount,
          suppressed_reason: result.trace.suppressed_reason ?? null,
          steps: result.trace.steps,
          inputs: result.trace.inputs,
          idempotency_key: idemKey,
          reference_type: "interest_accrual",
          calculated_by: triggeredBy,
        })
        .select("id")
        .maybeSingle();

      if (auditErr && !String(auditErr.message).includes("duplicate")) { failed++; continue; }
      if (!audit) { skipped++; continue; } // already accrued for this as_of date

      const { error: accrualErr } = await supabase.from("ce_interest_accruals").insert({
        employer_id: row.employer_id,
        wage_period: wagePeriod,
        fund_code: row.fund_type ?? "ALL",
        as_of_date: accrualDate,
        accrual_start_date: result.accrual_start_date,
        principal: result.trace.principal,
        annual_rate_percent: policy.annual_rate_percent,
        compounding_basis: policy.compounding_basis,
        elapsed_months: result.elapsed_months,
        cumulative_interest: result.cumulative_amount,
        posted_interest: result.amount,
        policy_version: policy.policy_version,
        calculation_audit_id: audit.id,
        idempotency_key: idemKey,
      });
      if (accrualErr) { failed++; continue; }

      const { error: ledgerErr } = await supabase.rpc("ce_post_ledger_entry", {
        p_employer_id: row.employer_id,
        p_entry_type: "INTEREST_ACCRUED",
        p_fund_type: row.fund_type ?? "SS",
        p_period: row.period,
        p_amount: result.amount,
        p_description:
          `Interest (CR-002) @ ${policy.annual_rate_percent}% p.a. ${policy.compounding_basis}, ` +
          `${result.elapsed_months} month(s) from ${result.accrual_start_date} on ${result.trace.principal.toFixed(2)}`,
        p_reference_type: "interest_accrual",
        p_idempotency_key: idemKey,
        p_posted_by: triggeredBy,
      });

      if (ledgerErr) { failed++; } else { posted++; }
    }

    const message =
      `Interest accrual @ ${policy.annual_rate_percent}% p.a. (${policy.compounding_basis}, min ${policy.minimum_interest_principal}): ` +
      `${posted} posted, ${skipped} skipped, ${failed} failed`;
    await finish(failed > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED", { read, posted, skipped, failed }, message);

    return json({
      run_id: runId,
      dry_run: dryRun,
      rule_code: "CR-002",
      policy_version: policy.policy_version,
      annual_rate_percent: policy.annual_rate_percent,
      compounding_basis: policy.compounding_basis,
      minimum_interest_principal: policy.minimum_interest_principal,
      accrual_start: policy.accrual_start,
      records_read: read,
      records_posted: posted,
      records_skipped: skipped,
      records_failed: failed,
    });
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

/** Ledger periods are stored as "YYYYMM" or "YYYY-MM". */
function normalisePeriod(period: string | null): string | null {
  if (!period) return null;
  const raw = String(period).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{6}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  return null;
}
