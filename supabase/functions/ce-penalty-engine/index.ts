import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { isRetiredCalculationRule } from "../_shared/compliance/detectionRuleParameterSpec.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json().catch(() => ({}));
    const period = body.period || new Date().toISOString().slice(0, 7).replace("-", "");
    const fundType = body.fund_type || "SS";
    const ruleCode = body.rule_code;
    const triggeredBy = body.triggered_by || "SYSTEM";

    // Generate idempotency key for this run
    const runKey = `penalty-engine-${period}-${fundType}-${new Date().toISOString().slice(0, 10)}`;

    // Check if already run today
    const { data: existingRun } = await supabase
      .from("ce_automation_runs")
      .select("id")
      .eq("idempotency_key", runKey)
      .maybeSingle();

    if (existingRun) {
      return new Response(
        JSON.stringify({ message: "Already run today", run_id: existingRun.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Get the automation job for penalty engine
    const { data: job } = await supabase
      .from("ce_automation_jobs")
      .select("id")
      .eq("job_code", "PENALTY_ENGINE")
      .maybeSingle();

    // Create automation run record
    const { data: run, error: runError } = await supabase
      .from("ce_automation_runs")
      .insert({
        job_id: job?.id,
        started_at: new Date().toISOString(),
        status: "Running",
        triggered_by: triggeredBy,
        idempotency_key: runKey,
      })
      .select("id")
      .single();

    if (runError) throw runError;

    // ── Checkpoint C: NO generic universal late-payment penalty. ──
    // CR-001 is retired. A penalty may only be raised by a fund-specific
    // calculation rule that carries a configured rate; there is no code
    // default and lateness alone never produces a charge. Interest is a
    // separate component handled by CR-002 (ce-ledger-penalty-accrual).
    let ruleQuery = supabase
      .from("ce_calculation_rules")
      .select("*")
      .eq("is_enabled", true)
      .in("applies_to", ["penalty", "fine"])
      .not("fund_type", "is", null);

    if (ruleCode) {
      ruleQuery = ruleQuery.eq("rule_code", ruleCode);
    }

    const { data: allRules, error: rulesError } = await ruleQuery;
    if (rulesError) throw rulesError;

    const rules = (allRules ?? []).filter(
      (r: any) => !isRetiredCalculationRule(r.rule_code) && r.fund_type === fundType,
    );
    const retiredSkipped = (allRules ?? [])
      .filter((r: any) => isRetiredCalculationRule(r.rule_code))
      .map((r: any) => r.rule_code);

    if (!rules || rules.length === 0) {
      // No active rules, mark as completed
      await supabase
        .from("ce_automation_runs")
        .update({
          completed_at: new Date().toISOString(),
          status: "Completed",
          records_processed: 0,
          records_affected: 0,
          execution_log: {
            message:
              "No fund-specific penalty/fine calculation rule is configured for this fund. " +
              "A generic late-payment penalty is deliberately not available (CR-001 retired at Checkpoint C).",
            retired_rules_skipped: retiredSkipped,
          },
        })
        .eq("id", run.id);

      return new Response(
        JSON.stringify({ message: "No active fund-specific rules", run_id: run.id, retired_rules_skipped: retiredSkipped }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // Employers with outstanding contribution PRINCIPAL.
    // Checkpoint C-L1: penalties are charged on unpaid principal, never on the
    // generic cached balance (which also contains penalties and interest).
    const { data: employers, error: empError } = await supabase
      .from("ce_v_ledger_period_balances")
      .select("employer_id, principal_due, principal_outstanding, total_outstanding")
      .eq("fund_type", fundType)
      .gt("principal_outstanding", 0);


    if (empError) throw empError;

    let processed = 0;
    let affected = 0;
    const errors: string[] = [];
    const configurationErrors: string[] = [];

    for (const emp of employers || []) {
      try {
        for (const rule of rules) {
          const params = rule.parameters || {};
          const configuredRate = Number(
            params.penalty_rate ?? params.initial_rate ?? params.rate,
          );

          // No configured rate → configuration error, never a code default.
          if (!Number.isFinite(configuredRate) || configuredRate <= 0) {
            const msg = `${rule.rule_code}: no configured penalty rate — rule skipped (no code default exists)`;
            if (!configurationErrors.includes(msg)) configurationErrors.push(msg);
            continue;
          }

          const minAmount = Number(params.min_amount ?? 0);
          const penaltyAmount = Math.max(Number(emp.principal_due) * configuredRate, minAmount);

          if (penaltyAmount > 0) {
            const idemKey = `penalty-${emp.employer_id}-${period}-${fundType}-${rule.rule_code}`;

            const { error: postError } = await supabase.rpc("ce_post_ledger_entry", {
              p_employer_id: emp.employer_id,
              p_entry_type: "PENALTY_ASSESSED",
              p_fund_type: fundType,
              p_period: period,
              p_amount: penaltyAmount,
              p_description: `${rule.fund_type} ${rule.applies_to}: ${rule.name} (${(configuredRate * 100).toFixed(1)}% of ${emp.principal_due})`,
              p_reference_type: "calculation_rule",
              p_idempotency_key: idemKey,
              p_posted_by: triggeredBy,
            });

            if (postError) {
              errors.push(`${emp.employer_id}: ${postError.message}`);
            } else {
              affected++;
            }
          }
        }
        processed++;
      } catch (e) {
        errors.push(`${emp.employer_id}: ${e.message}`);
      }

    }

    // Update run record
    await supabase
      .from("ce_automation_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: errors.length > 0 ? "CompletedWithErrors" : "Completed",
        records_processed: processed,
        records_affected: affected,
        error_message: errors.length > 0 ? errors.slice(0, 10).join("; ") : null,
        execution_log: {
          period, fund_type: fundType, rules_applied: rules.length,
          employers_processed: processed, penalties_posted: affected,
          errors: errors.slice(0, 20),
          configuration_errors: configurationErrors,
          retired_rules_skipped: retiredSkipped,
          generic_late_payment_penalty: "retired (CR-001) — not applied",
        },
      })
      .eq("id", run.id);

    // Update job last run
    if (job?.id) {
      await supabase
        .from("ce_automation_jobs")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: errors.length > 0 ? "CompletedWithErrors" : "Completed",
        })
        .eq("id", job.id);
    }

    return new Response(
      JSON.stringify({
        run_id: run.id,
        processed,
        affected,
        errors: errors.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
