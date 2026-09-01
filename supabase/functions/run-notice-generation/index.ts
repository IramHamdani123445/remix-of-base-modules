import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Checkpoint D — escalation notice generation.
 *
 * There is exactly ONE escalation-stage configuration: the table
 * `ce_escalation_stage_config` (Administration → Escalation Stage
 * Configuration). This worker no longer reads notice timings from
 * `ce_automation_jobs.parameters.notice_rules`, and it contains no day
 * literals of its own. Eligibility, the financial snapshot and the duplicate
 * guard are all evaluated inside the database
 * (`ce_generate_stage_notice_system_v1`), so scheduled runs and screen actions
 * behave identically.
 *
 * A stage with no configured waiting period fails visibly instead of issuing a
 * notice on a timing nobody approved.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { dry_run = false, force = false, triggered_by = 'system', employer_ids = null } =
      await req.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = dry_run ? `NOTICE-GEN-DRY-${Date.now()}` : `NOTICE-GEN-${today}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!dry_run) {
      await supabase
        .from('ce_automation_job_runs')
        .delete()
        .eq('idempotency_key', idempotencyKey)
        .in('run_status', ['RUNNING', 'FAILED']);
    }

    if (!dry_run && !force) {
      const { data: existing } = await supabase
        .from('ce_automation_job_runs')
        .select('id')
        .eq('idempotency_key', idempotencyKey)
        .eq('run_status', 'COMPLETED')
        .maybeSingle();
      if (existing) {
        return new Response(JSON.stringify({
          already_completed: true,
          run_id: existing.id,
          message: `Notice generation already completed for ${today}`,
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // ── Authoritative stage configuration ──────────────────────────────────
    const { data: stages, error: stageErr } = await supabase
      .from('ce_escalation_stage_config')
      .select('*')
      .eq('is_enabled', true)
      .not('notice_template_code', 'is', null)
      .order('stage_order', { ascending: true });

    if (stageErr) {
      return new Response(JSON.stringify({
        success: false, status: 'configuration_error', errors: [stageErr.message],
        stage_source: 'ce_escalation_stage_config',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const activeStages = stages || [];
    if (activeStages.length === 0) {
      return new Response(JSON.stringify({
        success: false,
        status: 'configuration_error',
        errors: ['No enabled escalation stages with a notice template are configured.'],
        stage_source: 'ce_escalation_stage_config',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const unconfigured = activeStages.filter((s: any) => s.delay_days === null);

    const { data: jobRecord } = await supabase
      .from('ce_automation_jobs')
      .select('id')
      .eq('job_code', 'JOB-NOTICE-GENERATION')
      .maybeSingle();
    const jobId = jobRecord?.id;

    const { data: runRecord } = await supabase
      .from('ce_automation_job_runs')
      .insert({
        job_id: jobId,
        run_status: 'RUNNING',
        is_dry_run: dry_run,
        idempotency_key: idempotencyKey,
        triggered_by,
        started_at: new Date().toISOString(),
      } as any)
      .select('id, started_at')
      .single();
    const runId = runRecord?.id;

    // ── Candidate violations ───────────────────────────────────────────────
    const violations: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      let q = supabase
        .from('ce_violations')
        .select('id, violation_number, employer_id, employer_name, status, created_at')
        .in('status', ['OPEN', 'UNDER_REVIEW', 'ESCALATED'])
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);
      if (Array.isArray(employer_ids) && employer_ids.length > 0) {
        q = q.in('employer_id', employer_ids);
      }
      const { data: page, error: pageErr } = await q;
      if (pageErr) break;
      if (!page || page.length === 0) break;
      violations.push(...page);
      if (page.length < pageSize) break;
    }

    const results = {
      stage_source: 'ce_escalation_stage_config',
      active_stages: activeStages.map((s: any) => ({
        stage_code: s.stage_code,
        stage_order: s.stage_order,
        prerequisite: s.prerequisite_stage_code,
        delay_days: s.delay_days,
        delay_basis: s.delay_basis,
      })),
      unconfigured_stages: unconfigured.map((s: any) => ({
        stage_code: s.stage_code, open_decision: s.open_decision_code,
      })),
      violations_scanned: violations.length,
      notices_generated: 0,
      notices_skipped_dedupe: 0,
      notices_skipped_waiting: 0,
      notices_skipped_prerequisite: 0,
      notices_skipped_no_template: 0,
      notices_skipped_unconfigured: 0,
      by_stage: {} as Record<string, { generated: number; skipped: number }>,
      sample_notices: [] as any[],
      dry_run,
    };
    for (const s of activeStages) results.by_stage[s.stage_code] = { generated: 0, skipped: 0 };

    for (const v of violations) {
      for (const stage of activeStages) {
        const rpc = dry_run ? 'ce_evaluate_stage_eligibility_v1' : 'ce_generate_stage_notice_system_v1';
        const args = dry_run
          ? { p_violation_id: v.id, p_stage_code: stage.stage_code }
          : { p_violation_id: v.id, p_stage_code: stage.stage_code, p_delivery_method: 'EMAIL' };
        const { data, error } = await supabase.rpc(rpc, args as any);
        if (error) {
          console.error('[stage-notice-failed]', stage.stage_code, v.violation_number, error.message);
          results.by_stage[stage.stage_code].skipped++;
          continue;
        }
        const status = (data as any)?.status;
        const generated = dry_run ? (data as any)?.eligible === true : (data as any)?.generated === true;

        if (generated) {
          results.notices_generated++;
          results.by_stage[stage.stage_code].generated++;
          if (results.sample_notices.length < 10) {
            results.sample_notices.push({
              violation: v.violation_number,
              employer: v.employer_name,
              stage: stage.stage_code,
              notice_number: (data as any)?.notice_number ?? null,
            });
          }
          continue;
        }

        results.by_stage[stage.stage_code].skipped++;
        if (status === 'already_generated') results.notices_skipped_dedupe++;
        else if (status === 'waiting') results.notices_skipped_waiting++;
        else if (status === 'prerequisite_missing') results.notices_skipped_prerequisite++;
        else if (status === 'template_missing') results.notices_skipped_no_template++;
        else if (status === 'configuration_error') results.notices_skipped_unconfigured++;
      }
    }

    const completedAt = new Date().toISOString();
    if (runId) {
      await supabase
        .from('ce_automation_job_runs')
        .update({
          run_status: 'COMPLETED',
          completed_at: completedAt,
          records_processed: results.violations_scanned,
          records_affected: results.notices_generated,
          duration_ms: Date.now() - new Date(runRecord?.started_at || completedAt).getTime(),
          execution_log: { scan_details: results },
        } as any)
        .eq('id', runId);
    }
    if (jobId) {
      await supabase
        .from('ce_automation_jobs')
        .update({ last_run_at: completedAt, last_run_status: 'COMPLETED' } as any)
        .eq('id', jobId);
    }

    return new Response(JSON.stringify({ run_id: runId, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
