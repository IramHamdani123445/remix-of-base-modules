/**
 * ce-obligation-lifecycle — Checkpoint A runtime worker.
 *
 * Materialises the authoritative obligation timeline (wage period, reporting
 * period, due date, reminder dates, violation-effective date, actual filing and
 * payment dates), resolves unreported obligations when a filing arrives, and
 * issues ONE consolidated reminder per employer per reminder cycle.
 *
 * All calendar/policy decisions come from the shared resolver. There is no
 * hard-coded due day, no hard-coded day 3 / day 20, and no 7/21/45 fallback.
 * Missing configuration fails visibly instead of guessing.
 *
 * Invoked by the scheduler (Step 2 reconciliation) and, identically, by the
 * manual "Run now" administration action.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  CeObligationPolicyError,
  type CeReminderRule,
  addMonths,
  normalizeObligationPolicy,
  toYearMonth,
} from "../_shared/compliance/obligationDeadlineResolver.ts";
import {
  type CeObligationRow,
  buildObligationRows,
  describeOutstandingPeriods,
  enumerateWagePeriods,
  planReminderNotices,
} from "../_shared/compliance/obligationLifecycle.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Technical safety cap (not business policy). */
const ABSOLUTE_CAP_MONTHS = 120;
const PAGE = 1000;
const UPSERT_BATCH = 200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  filter?: { col: string; val: string },
  gte?: { col: string; val: string },
) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(columns).range(from, from + PAGE - 1);
    if (filter) q = q.eq(filter.col, filter.val);
    if (gte) q = q.gte(gte.col, gte.val);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let runId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run === true;
    const asOf: string = String(body.as_of_date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const employerFilter: string | null = body.employer_id ?? null;
    const employerLimit: number = Number(body.employer_limit ?? 0);
    const triggeredBy: string = String(body.triggered_by ?? "scheduler");

    // ── 1. Authoritative policy (single owner of the deadline basis) ──
    const { data: policyRows, error: policyErr } = await supabase
      .from("ce_compliance_policies")
      .select(
        "policy_code, policy_version, deadline_basis, reporting_offset_months, deadline_fixed_day, c3_grace_period_days, payment_grace_period_days",
      )
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1);
    if (policyErr) throw policyErr;
    const activePolicy = policyRows?.[0] ?? null;

    const filingPolicy = normalizeObligationPolicy(activePolicy, {
      grace_days: activePolicy?.c3_grace_period_days ?? 0,
    });
    const paymentPolicy = normalizeObligationPolicy(activePolicy, {
      grace_days: activePolicy?.payment_grace_period_days ?? 0,
    });

    // ── 2. Reminder configuration — fail visibly when absent ──
    const { data: ruleRows, error: ruleErr } = await supabase
      .from("ce_obligation_reminder_rules")
      .select(
        "rule_code, label, obligation_type, is_enabled, offset_type, offset_value, audience, template_code, channels, consolidate_periods, sequence",
      )
      .order("sequence");
    if (ruleErr) throw ruleErr;
    const reminderRules: CeReminderRule[] = (ruleRows ?? []).map((r: any) => ({
      ...r,
      channels: Array.isArray(r.channels) ? r.channels : [],
    }));
    const enabledRules = reminderRules.filter((r) => r.is_enabled);
    if (reminderRules.length === 0) {
      return json({
        ok: false,
        status: "configuration_error",
        error:
          "No obligation reminder rules configured. Reminder timing has no authoritative source — configure Compliance → Reminder Notices. No default schedule is applied.",
      });
    }

    // ── 3. Run record ──
    const { data: jobRecord } = await supabase
      .from("ce_automation_jobs")
      .select("id")
      .eq("job_code", "JOB-OBLIGATION-LIFECYCLE")
      .maybeSingle();
    const jobId = jobRecord?.id ?? null;
    const idempotencyKey = dryRun
      ? `OBL-LIFECYCLE-DRY-${Date.now()}`
      : `OBL-LIFECYCLE-${asOf}${employerFilter ? `-${employerFilter}` : ""}`;

    if (!dryRun && jobId) {
      const { data: run } = await supabase
        .from("ce_automation_job_runs")
        .insert({
          job_id: jobId,
          run_status: "RUNNING",
          is_dry_run: dryRun,
          idempotency_key: idempotencyKey,
          triggered_by: triggeredBy,
          started_at: new Date().toISOString(),
        } as any)
        .select("id")
        .maybeSingle();
      runId = run?.id ?? null;
    }

    // ── 4. Employer population + facts ──
    let employers = await fetchAll(
      supabase,
      "ce_v_employer_filing_status",
      "regno, employer_name, employer_status, compliance_start_period",
      employerFilter ? { col: "regno", val: employerFilter } : undefined,
    );
    employers.sort((a: any, b: any) => (String(a.regno) < String(b.regno) ? -1 : 1));
    if (employerLimit > 0) employers = employers.slice(0, employerLimit);

    const asOfMonth = toYearMonth(asOf);
    const lastCompletePeriod = addMonths(asOfMonth, -1);
    const oldestCutoff = `${addMonths(asOfMonth, -(ABSOLUTE_CAP_MONTHS + 1))}-01`;

    const c3Rows = await fetchAll(
      supabase,
      "cn_c3_reported",
      "payer_id, period, date_received, posting_status, emp_ss_amt_calc, emp_levy_amt_calc, emp_pe_amt_calc",
      employerFilter ? { col: "payer_id", val: employerFilter } : undefined,
      { col: "period", val: oldestCutoff },
    );
    const c3ByEmp = new Map<string, Map<string, { received: string | null; declared: number; nil: boolean }>>();
    for (const r of c3Rows) {
      if (String(r.posting_status ?? "") === "CANCELLED") continue;
      const key = String(r.payer_id);
      const ym = String(r.period).slice(0, 7);
      let m = c3ByEmp.get(key);
      if (!m) {
        m = new Map();
        c3ByEmp.set(key, m);
      }
      const declared =
        Number(r.emp_ss_amt_calc || 0) + Number(r.emp_levy_amt_calc || 0) + Number(r.emp_pe_amt_calc || 0);
      const received = r.date_received ? String(r.date_received).slice(0, 10) : null;
      const prev = m.get(ym);
      if (prev) {
        prev.declared += declared;
        if (received && (!prev.received || received > prev.received)) prev.received = received;
        prev.nil = prev.declared <= 0;
      } else {
        m.set(ym, { received, declared, nil: declared <= 0 });
      }
    }

    // Payments (cn_payment holds the period, cn_payment_header the payer).
    const headers = await fetchAll(
      supabase,
      "cn_payment_header",
      "payment_id, payer_id",
      employerFilter ? { col: "payer_id", val: employerFilter } : undefined,
    );
    const payerByPaymentId = new Map<string, string>();
    for (const h of headers) payerByPaymentId.set(String(h.payment_id), String(h.payer_id));
    const payRows = await fetchAll(
      supabase,
      "cn_payment",
      "payment_id, period, payment_amount, payment_date",
      undefined,
      { col: "period", val: oldestCutoff },
    );
    const payByEmp = new Map<string, Map<string, { amount: number; last: string | null }>>();
    for (const p of payRows) {
      const regno = payerByPaymentId.get(String(p.payment_id));
      if (!regno || !p.period) continue;
      const ym = String(p.period).slice(0, 7);
      let m = payByEmp.get(regno);
      if (!m) {
        m = new Map();
        payByEmp.set(regno, m);
      }
      const prev = m.get(ym) ?? { amount: 0, last: null };
      prev.amount += Number(p.payment_amount || 0);
      const pd = p.payment_date ? String(p.payment_date).slice(0, 10) : null;
      if (pd && (!prev.last || pd > prev.last)) prev.last = pd;
      m.set(ym, prev);
    }

    // Employer statuses that make the obligation inapplicable (dormant/ceased).
    const inapplicableStatuses = new Set(["I", "D", "C"]);

    // ── 5. Build obligation rows ──
    const rows: CeObligationRow[] = [];
    for (const emp of employers) {
      const regno = String(emp.regno);
      const start = emp.compliance_start_period ? String(emp.compliance_start_period).slice(0, 7) : null;
      if (!start) continue;
      const applicable = !inapplicableStatuses.has(String(emp.employer_status ?? ""));
      const periods = enumerateWagePeriods(start, lastCompletePeriod, ABSOLUTE_CAP_MONTHS);
      const c3 = c3ByEmp.get(regno);
      const pay = payByEmp.get(regno);
      for (const ym of periods) {
        const c3rec = c3?.get(ym);
        const payrec = pay?.get(ym);
        rows.push(
          ...buildObligationRows({
            employerId: regno,
            employerName: emp.employer_name ?? null,
            wagePeriod: ym,
            facts: {
              filing_received_date: c3rec?.received ?? null,
              filing_is_nil: c3rec ? c3rec.declared <= 0 : false,
              declared_amount: c3rec?.declared ?? 0,
              paid_amount: payrec?.amount ?? 0,
              last_payment_date: payrec?.last ?? null,
            },
            filingPolicy,
            paymentPolicy,
            reminderRules,
            asOf,
            applicable,
          }),
        );
      }
    }

    // ── 6. Idempotent persistence (one row per employer/type/period) ──
    // Collapse duplicates first: the employer view can legitimately return more
    // than one row per registration number, and a batch upsert may not touch
    // the same conflict target twice.
    const uniqueRows = Array.from(
      new Map(rows.map((r) => [`${r.employer_id}|${r.obligation_type}|${r.wage_period}`, r])).values(),
    );
    let persisted = 0;
    if (!dryRun) {
      for (let i = 0; i < uniqueRows.length; i += UPSERT_BATCH) {
        const slice = uniqueRows.slice(i, i + UPSERT_BATCH).map((r) => ({
          employer_id: r.employer_id,
          employer_name: r.employer_name,
          obligation_type: r.obligation_type,
          wage_period: `${r.wage_period}-01`,
          reporting_period: `${r.reporting_period}-01`,
          due_date: r.due_date,
          grace_days: r.grace_days,
          grace_end_date: r.grace_end_date,
          violation_effective_date: r.violation_effective_date,
          deadline_basis: r.deadline_basis,
          reminder_schedule: r.reminder_schedule,
          filing_received_date: r.filing_received_date,
          filing_is_nil: r.filing_is_nil,
          declared_amount: r.declared_amount,
          paid_amount: r.paid_amount,
          last_payment_date: r.last_payment_date,
          filing_status: r.filing_status,
          payment_status: r.payment_status,
          is_outstanding: r.is_outstanding,
          resolved_at: r.is_outstanding ? null : new Date().toISOString(),
          resolution_reason: r.is_outstanding
            ? null
            : r.obligation_type === "C3_FILING"
              ? `Filing state ${r.filing_status}`
              : `Payment state ${r.payment_status}`,
          last_evaluated_at: new Date().toISOString(),
        }));
        const { error } = await supabase
          .from("ce_obligation_periods")
          .upsert(slice, { onConflict: "employer_id,obligation_type,wage_period" });
        if (error) throw error;
        persisted += slice.length;
      }
    }

    // ── 7. Resolve unreported violations superseded by an actual filing ──
    let violationsResolved = 0;
    if (!dryRun) {
      const nowFiled = rows.filter(
        (r) => r.obligation_type === "C3_FILING" && r.filing_received_date && r.filing_status !== "UNREPORTED",
      );
      for (const r of nowFiled) {
        const { data: open } = await supabase
          .from("ce_violations")
          .select("id, status, ce_violation_types!inner(code)")
          .eq("employer_id", r.employer_id)
          .eq("period_from", `${r.wage_period}-01`)
          .in("status", ["OPEN", "UNDER_REVIEW"])
          .eq("is_deleted", false)
          .eq("ce_violation_types.code", "C3_NOT_SUBMITTED");
        for (const v of open ?? []) {
          const { error } = await supabase
            .from("ce_violations")
            .update({
              status: "RESOLVED",
              resolution_notes: `Superseded by actual C3 filing received ${r.filing_received_date} for ${r.wage_period}; filing evaluated as ${r.filing_status}.`,
              resolved_at: new Date().toISOString(),
            } as any)
            .eq("id", v.id);
          if (!error) violationsResolved++;
        }
      }
    }

    // ── 8. Consolidated reminder notices ──
    const plans = planReminderNotices({
      asOf,
      rules: enabledRules,
      obligations: rows,
      filingPolicy,
      paymentPolicy,
    });

    let noticesCreated = 0;
    let noticesSkipped = 0;
    const sample: any[] = [];
    if (!dryRun) {
      for (const plan of plans) {
        const noticeNumber = `OBN-${asOf.replace(/-/g, "")}-${plan.rule_code}-${plan.employer_id}`;
        const { data: notice, error: noticeErr } = await supabase
          .from("ce_obligation_notices")
          .insert({
            notice_number: noticeNumber,
            employer_id: plan.employer_id,
            employer_name: plan.employer_name,
            reminder_rule_code: plan.rule_code,
            notice_stage: "REMINDER",
            obligation_type: plan.obligation_type,
            audience: plan.audience,
            cycle_key: plan.cycle_key,
            template_code: plan.template_code,
            channels: plan.channels,
            period_count: plan.periods.length,
            delivery_status: "PENDING",
          } as any)
          .select("id")
          .maybeSingle();

        if (noticeErr) {
          // Unique (employer, rule, cycle) — already issued for this cycle.
          noticesSkipped++;
          continue;
        }

        const { data: periodRows } = await supabase
          .from("ce_obligation_periods")
          .select("id, wage_period, obligation_type")
          .eq("employer_id", plan.employer_id)
          .in(
            "wage_period",
            plan.periods.map((p) => `${p.wage_period}-01`),
          );
        const links = (periodRows ?? [])
          .filter((pr: any) =>
            plan.periods.some(
              (p) => p.obligation_type === pr.obligation_type && `${p.wage_period}-01` === String(pr.wage_period).slice(0, 10),
            ),
          )
          .map((pr: any) => ({
            notice_id: notice!.id,
            obligation_period_id: pr.id,
            wage_period: pr.wage_period,
            obligation_type: pr.obligation_type,
            outstanding_state:
              plan.periods.find(
                (p) => `${p.wage_period}-01` === String(pr.wage_period).slice(0, 10) && p.obligation_type === pr.obligation_type,
              )?.state ?? null,
          }));
        if (links.length > 0) {
          await supabase.from("ce_obligation_notice_periods").insert(links);
        }

        // Delivery via the existing Omni-Comms spine — no Compliance-specific
        // email text, no direct provider or queue access.
        const { data: emitted, error: emitErr } = await supabase.rpc(
          "omni_comms_priv_enqueue_business_event",
          {
            p_organization_id: null,
            p_module_code: "COMPLIANCE",
            // Reuse of the existing published Compliance employer event and its
            // published contract (reference / subjectName / outstandingSummary).
            // No new Compliance-specific communication event or template path.
            p_event_code: "COMPLIANCE.EMPLOYER.NONCOMPLIANCE_NOTICE",
            p_entity_type: "employer",
            p_entity_id: plan.employer_id,
            p_occurrence: `${plan.rule_code}:${plan.cycle_key}`,
            p_product_id: null,
            p_department_context_id: null,
            p_recipient_facts: {
              audience: plan.audience,
              employer_id: plan.employer_id,
              reminder_rule: plan.rule_code,
              cycle: plan.cycle_key,
              notice_number: noticeNumber,
              outstanding_periods: plan.periods.map((p) => p.wage_period),
            },
            p_payload: {
              reference: plan.employer_id,
              subjectName: plan.employer_name ?? plan.employer_id,
              outstandingSummary: describeOutstandingPeriods(plan.periods).slice(0, 240),
            },
            p_correlation_id: noticeNumber,
          },
        );

        await supabase
          .from("ce_obligation_notices")
          .update({
            delivery_status: emitErr ? "HANDOFF_FAILED" : "HANDED_OFF",
            delivery_detail: emitErr ? { error: emitErr.message } : (emitted ?? {}),
            business_event_id: (emitted as any)?.id ?? null,
          } as any)
          .eq("id", notice!.id);

        noticesCreated++;
        if (sample.length < 10) {
          sample.push({
            employer: plan.employer_id,
            rule: plan.rule_code,
            cycle: plan.cycle_key,
            periods: plan.periods.map((p) => p.wage_period),
          });
        }
      }
    }

    const summary = {
      ok: true,
      as_of_date: asOf,
      dry_run: dryRun,
      deadline_basis: filingPolicy.deadline_basis,
      reporting_offset_months: filingPolicy.reporting_offset_months,
      filing_grace_days: filingPolicy.grace_days,
      payment_grace_days: paymentPolicy.grace_days,
      reminder_rules: enabledRules.map((r) => ({
        rule_code: r.rule_code,
        offset_type: r.offset_type,
        offset_value: r.offset_value,
        consolidate: r.consolidate_periods,
      })),
      employers_evaluated: employers.length,
      obligations_evaluated: rows.length,
      obligations_persisted: persisted,
      outstanding_filings: rows.filter((r) => r.obligation_type === "C3_FILING" && r.is_outstanding).length,
      late_filings: rows.filter((r) => r.filing_status === "FILED_LATE").length,
      outstanding_payments: rows.filter((r) => r.obligation_type === "CONTRIBUTION_PAYMENT" && r.is_outstanding).length,
      violations_resolved_by_filing: violationsResolved,
      notice_plans: plans.length,
      notices_created: noticesCreated,
      notices_skipped_existing: noticesSkipped,
      sample_notices: sample,
    };

    if (runId) {
      await supabase
        .from("ce_automation_job_runs")
        .update({
          run_status: "COMPLETED",
          completed_at: new Date().toISOString(),
          records_processed: rows.length,
          records_affected: persisted + noticesCreated,
          summary,
          execution_log: summary,
        } as any)
        .eq("id", runId);
    }
    if (jobId && !dryRun) {
      await supabase
        .from("ce_automation_jobs")
        .update({ last_run_at: new Date().toISOString(), last_run_status: "COMPLETED" } as any)
        .eq("id", jobId);
    }

    return json(summary);
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null
          ? JSON.stringify(err)
          : String(err);
    const configurationError = err instanceof CeObligationPolicyError;
    if (runId) {
      await supabase
        .from("ce_automation_job_runs")
        .update({
          run_status: "FAILED",
          completed_at: new Date().toISOString(),
          errors_count: 1,
          error_details: { message, configuration_error: configurationError },
        } as any)
        .eq("id", runId);
    }
    return json({ ok: false, status: configurationError ? "configuration_error" : "error", error: message });
  }
});
