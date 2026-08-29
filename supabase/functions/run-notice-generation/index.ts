import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Notice-stage timing is CONFIGURATION, not code. The stages (1st notice, 2nd
 * notice, final warning) are owned by the JOB-NOTICE-GENERATION job parameters
 * and administered from Compliance → Automation → Notice Generation. No default
 * schedule is embedded here: an unconfigured job fails visibly so a notice can
 * never be issued on a timing nobody approved.
 */
interface NoticeStageRule {
  days_open: number;
  template_code: string;
  label: string;
}

function validateStageRules(raw: unknown): { rules: NoticeStageRule[]; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      rules: [],
      errors: [
        'No notice stage rules configured on JOB-NOTICE-GENERATION (parameters.notice_rules). Configure the notice stages and their day thresholds before running notice generation.',
      ],
    };
  }
  const rules: NoticeStageRule[] = [];
  raw.forEach((r: any, i: number) => {
    const days = Number(r?.days_open);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      errors.push(`notice_rules[${i}].days_open must be a whole number of days (0-3650).`);
    }
    if (!r?.template_code) errors.push(`notice_rules[${i}].template_code is required.`);
    if (!r?.label) errors.push(`notice_rules[${i}].label is required.`);
    if (errors.length === 0) {
      rules.push({ days_open: days, template_code: String(r.template_code), label: String(r.label) });
    }
  });
  return { rules: rules.sort((a, b) => a.days_open - b.days_open), errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { dry_run = false, force = false, triggered_by = 'system', employer_ids = null } = await req.json();
    const today = new Date().toISOString().slice(0, 10);
    const idempotencyKey = dry_run
      ? `NOTICE-GEN-DRY-${Date.now()}`
      : `NOTICE-GEN-${today}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Auto-heal: clear stale runs with same idempotency key ──
    if (!dry_run) {
      await supabase
        .from('ce_automation_job_runs')
        .delete()
        .eq('idempotency_key', idempotencyKey)
        .in('run_status', ['RUNNING', 'FAILED']);
    }

    // ── Idempotency check ──
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

    // ── Get job record for rules ──
    const { data: jobRecord } = await supabase
      .from('ce_automation_jobs')
      .select('id, parameters')
      .eq('job_code', 'JOB-NOTICE-GENERATION')
      .single();

    const jobId = jobRecord?.id;
    const { rules, errors: ruleErrors } = validateStageRules(jobRecord?.parameters?.notice_rules);
    if (ruleErrors.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          status: 'configuration_error',
          errors: ruleErrors,
          notice_rule_source: 'ce_automation_jobs.parameters.notice_rules',
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── Create run record ──
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
      .select('id')
      .single();

    const runId = runRecord?.id;

    // ── Load templates ──
    const { data: templates } = await supabase
      .from('ce_notice_templates')
      .select('id, template_code, template_name, category, subject, body, variables')
      .eq('is_active', true);

    const templateMap = new Map(
      (templates || []).map((t: any) => [t.template_code, t])
    );

    // ── Fetch open violations with aging (paginated to bypass 1000-row cap,
    //    ordered by created_at DESC so newest UAT rows are always considered) ──
    const violations: any[] = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      let q = supabase
        .from('ce_violations')
        .select('id, violation_number, employer_id, employer_name, status, created_at, ce_violation_types(code, name, category)')
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

    const now = Date.now();
    const results = {
      violations_scanned: violations?.length || 0,
      notices_generated: 0,
      notices_skipped_dedupe: 0,
      notices_skipped_no_template: 0,
      by_rule: {} as Record<string, { generated: number; skipped: number }>,
      sample_notices: [] as any[],
      dry_run,
    };

    for (const rule of rules) {
      results.by_rule[rule.label] = { generated: 0, skipped: 0 };
    }

    // ── Process each violation against rules ──
    for (const v of (violations || [])) {
      const ageMs = now - new Date(v.created_at).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      for (const rule of rules) {
        if (ageDays < rule.days_open) continue;

        const template = templateMap.get(rule.template_code);
        if (!template) {
          results.notices_skipped_no_template++;
          continue;
        }

        // ── Dedupe check: skip if active notice with same template exists ──
        const { data: existingNotice } = await supabase
          .from('ce_notices')
          .select('id')
          .eq('violation_id', v.id)
          .eq('template_id', template.id)
          .not('status', 'eq', 'CANCELLED')
          .maybeSingle();

        if (existingNotice) {
          results.notices_skipped_dedupe++;
          results.by_rule[rule.label].skipped++;
          continue;
        }

        // ── Generate notice ──
        if (!dry_run) {
          const year = new Date().getFullYear();
          const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
          const noticeNumber = `CN-${year}-AUTO-${suffix}`;

          const body = (template.body || '')
            .replace(/\{\{employer_name\}\}/g, v.employer_name || '')
            .replace(/\{\{violation_number\}\}/g, v.violation_number || '')
            .replace(/\{\{current_date\}\}/g, new Date().toLocaleDateString('en-GB'));

          const { error: insErr } = await supabase.from('ce_notices').insert({
            notice_number: noticeNumber,
            employer_id: v.employer_id,
            employer_name: v.employer_name,
            violation_id: v.id,
            notice_type: template.category || 'C3_NOT_SUBMITTED',
            status: 'DRAFT',
            subject: template.subject || `Compliance Notice — ${rule.label}`,
            body,
            template_id: template.id,
            delivery_method: 'EMAIL',
            due_response_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
            created_by: `AUTO:${triggered_by}`,
          } as any);
          if (insErr) {
            console.error('[notice-insert-failed]', { violation: v.violation_number, employer: v.employer_id, error: insErr.message });
            continue; // do NOT increment generated counter on failed insert
          }
        }

        results.notices_generated++;
        results.by_rule[rule.label].generated++;

        if (results.sample_notices.length < 10) {
          results.sample_notices.push({
            violation: v.violation_number,
            employer: v.employer_name,
            rule: rule.label,
            template: rule.template_code,
            age_days: ageDays,
          });
        }
      }
    }

    // ── Finalize run ──
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

    // ── Update job last_run ──
    if (jobId) {
      await supabase
        .from('ce_automation_jobs')
        .update({
          last_run_at: completedAt,
          last_run_status: 'COMPLETED',
        } as any)
        .eq('id', jobId);
    }

    return new Response(JSON.stringify({
      run_id: runId,
      ...results,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
