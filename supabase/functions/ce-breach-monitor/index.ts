/**
 * ce-breach-monitor — Arrangement Breach/Default Evaluation
 *
 * Passive automation job that evaluates ACTIVE payment arrangements
 * for overdue installments, breach thresholds, and DEFAULTED transitions.
 *
 * Does NOT modify payment screens or posting flows.
 * Reads ce_installments + ce_payment_arrangements as source of truth.
 *
 * Supports:
 *  - Daily scheduled runs via ce_automation_jobs
 *  - On-demand invocation with optional parameters
 *  - Idempotent execution (one run per date)
 *  - Dry-run mode (no data changes)
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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
    const asOfDate = body.as_of_date || new Date().toISOString().slice(0, 10);
    const actor = body.checked_by || "SYSTEM";
    const isDryRun = body.dry_run ?? false;
    const force = body.force ?? false;

    // ── Grace period is owned by configuration (ce_arrangement_policies).
    //    Explicit request override wins; otherwise the active policy governs.
    //    No hard-coded business fallback: if nothing is configured we fail closed.
    let graceSource = "request";
    let gracePolicyCode: string | null = null;
    let graceDays: number | null =
      body.grace_days === undefined || body.grace_days === null
        ? null
        : Number(body.grace_days);

    if (graceDays === null) {
      const { data: policy } = await supabase
        .from("ce_arrangement_policies")
        .select("policy_code, breach_grace_days")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (policy && policy.breach_grace_days !== null) {
        graceDays = Number(policy.breach_grace_days);
        gracePolicyCode = policy.policy_code;
        graceSource = "ce_arrangement_policies";
      }
    }

    if (graceDays === null || Number.isNaN(graceDays)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "configuration_error",
          message:
            "No active ce_arrangement_policies row with breach_grace_days; configure Payment Arrangement Rules before running the breach monitor.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Idempotency ──────────────────────────────────────
    const runKey = isDryRun
      ? `BREACH-MONITOR-DRY-${Date.now()}`
      : `BREACH-MONITOR-${asOfDate}`;

    if (!force && !isDryRun) {
      const { data: existingRun } = await supabase
        .from("ce_automation_runs")
        .select("id")
        .eq("idempotency_key", runKey)
        .eq("status", "Completed")
        .maybeSingle();

      if (existingRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            already_completed: true,
            run_id: existingRun.id,
            message: "Already evaluated today",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Auto-heal stale runs ─────────────────────────────
    if (!isDryRun) {
      await supabase
        .from("ce_automation_runs")
        .delete()
        .eq("idempotency_key", runKey)
        .in("status", ["Running", "Failed"]);
    }

    // ── Resolve automation job ───────────────────────────
    const { data: job } = await supabase
      .from("ce_automation_jobs")
      .select("id")
      .eq("job_code", "JOB-BREACH-MONITOR")
      .maybeSingle();

    // ── Create run record ────────────────────────────────
    const { data: run, error: runError } = await supabase
      .from("ce_automation_runs")
      .insert({
        job_id: job?.id,
        started_at: new Date().toISOString(),
        status: "Running",
        triggered_by: actor,
        idempotency_key: runKey,
        is_dry_run: isDryRun,
        parameters: {
          as_of_date: asOfDate,
          grace_days: graceDays,
          grace_days_source: graceSource,
          grace_policy_code: gracePolicyCode,
        },
      })
      .select("id")
      .single();

    if (runError) throw runError;

    // ── Execute breach evaluation RPC ────────────────────
    // In dry-run mode we still call it but wrap in a transaction
    // that we roll back. Since Supabase RPCs auto-commit,
    // dry-run just reports what *would* happen by reading state.
    let result: Record<string, unknown>;

    if (isDryRun) {
      // Dry run: just count what would be affected without mutations
      const { data: activeArrangements } = await supabase
        .from("ce_payment_arrangements")
        .select("id, arrangement_number, missed_payments, max_missed_before_breach, breach_detected")
        .eq("status", "ACTIVE");

      const { data: overdueInstallments } = await supabase
        .from("ce_installments")
        .select("id, arrangement_id, due_date, amount, paid_amount, status")
        .in("status", ["PENDING", "PARTIAL"])
        .lt("due_date", asOfDate);

      result = {
        dry_run: true,
        active_arrangements: activeArrangements?.length ?? 0,
        potentially_overdue_installments: overdueInstallments?.length ?? 0,
        as_of_date: asOfDate,
        grace_days: graceDays,
        grace_days_source: graceSource,
        grace_policy_code: gracePolicyCode,
      };
    } else {
      // Live execution — canonical installment-level, idempotent detection.
      // ce_breach_detect_v1 owns grace-period resolution, occurrence keys,
      // payment-driven cures and arrangement default transitions.
      const { data, error } = await supabase.rpc("ce_breach_detect_v1", {
        p_actor: actor,
        p_as_of_date: asOfDate,
        p_dry_run: false,
      });

      if (error) throw error;
      result = data as Record<string, unknown>;
    }


    // ── Finalize run record ──────────────────────────────
    const affectedCount = isDryRun
      ? 0
      : ((result.breaches_created as number) ?? 0) +
        ((result.arrangements_defaulted as number) ?? 0);

    await supabase
      .from("ce_automation_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "Completed",
        records_processed: (result.arrangements_scanned as number) ?? 0,
        records_affected: affectedCount,
        execution_log: result,
      })
      .eq("id", run.id);

    // Update job last_run metadata
    if (job?.id) {
      await supabase
        .from("ce_automation_jobs")
        .update({
          last_run_at: new Date().toISOString(),
          last_run_status: "Completed",
        })
        .eq("id", job.id);
    }

    return new Response(
      JSON.stringify({ ok: true, run_id: run.id, result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
