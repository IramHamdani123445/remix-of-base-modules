import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DetectionRule {
  id: string;
  rule_code: string;
  name: string;
  violation_type_id: string;
  auto_create_violation: boolean;
  trigger_event: string;
  parameters: Record<string, any> | null;
  priority: string;
  violation_type_code?: string;
}

interface DetectedViolation {
  rule_code: string;
  rule_name: string;
  employer_id: string;
  employer_name: string;
  violation_type_id: string;
  violation_type_code: string;
  status: string;
  priority: string;
  summary: string;
  period_from?: string;
  period_to?: string;
  source_type: string;
  source_rule_id: string;
  principal_amount?: number;
  penalty_amount?: number;
  interest_amount?: number;
  total_amount?: number;
  skipped?: boolean;
  skip_reason?: string;
}

/**
 * SSB penalty policy resolver — computes principal/penalty/interest for a
 * detected violation using the active ce_compliance_policies row and the
 * employer's last-3 known C3 totals (ce_calculation_rules CR-003).
 *
 *   principal = avg(last_3_c3_totals) × 1.5   (fallback: 0 when no history)
 *   penalty   = principal × penalty_rate_percent% × months_overdue
 *   interest  = principal × (interest_rate_percent% / 12) × months_overdue
 *   total     = principal + penalty + interest
 *
 * Non-Filing / Non-Payment / Late-C3 rules all use this policy. Rules with
 * an explicitly known principal (e.g. arrears) override the estimate.
 */
function computeViolationAmounts(opts: {
  policy: any;
  history: number[];
  periodFrom?: string;
  asOfDate: string;
  knownPrincipal?: number;
}): { principal: number; penalty: number; interest: number; total: number } {
  const penaltyRate = Number(opts.policy?.penalty_rate_percent ?? 0) / 100;
  const interestRate = Number(opts.policy?.interest_rate_percent ?? 0) / 100;

  let principal = Number(opts.knownPrincipal ?? 0);
  if (!principal) {
    const hist = (opts.history || []).filter((v) => Number.isFinite(v) && v > 0);
    if (hist.length > 0) {
      const avg = hist.reduce((a, b) => a + b, 0) / hist.length;
      principal = Math.round(avg * 1.5 * 100) / 100;
    }
  }

  let monthsOverdue = 1;
  if (opts.periodFrom) {
    const [py, pm] = opts.periodFrom.split("-").map((n) => parseInt(n, 10));
    const [ay, am] = opts.asOfDate.slice(0, 7).split("-").map((n) => parseInt(n, 10));
    if (py && pm && ay && am) {
      monthsOverdue = Math.max(1, (ay - py) * 12 + (am - pm));
    }
  }

  const penalty = Math.round(principal * penaltyRate * monthsOverdue * 100) / 100;
  const interest = Math.round(principal * (interestRate / 12) * monthsOverdue * 100) / 100;
  const total = Math.round((principal + penalty + interest) * 100) / 100;

  return { principal, penalty, interest, total };
}

/** Parse a leading "$1,234.56" out of a rule-generated summary string. */
function extractLeadingCurrency(text: string): number | undefined {
  const m = text.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}


function generateViolationNumber(): string {
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `VIO-${dateStr}-${rand}`;
}

/**
 * Paginated fetch — fetches ALL rows from a view/table, bypassing the 1,000-row default.
 */
async function fetchAllRows(
  supabase: any,
  table: string,
  filterCol?: string,
  filterVal?: string
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allRows: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select("*").range(from, from + PAGE_SIZE - 1);
    if (filterCol && filterVal) {
      query = query.eq(filterCol, filterVal);
    }
    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allRows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Watchdog: retire any prior Running run older than 30 minutes.
    // Because the scan is offloaded via EdgeRuntime.waitUntil, the worker can
    // be recycled mid-scan without ever flipping the row to Failed. Sweep on
    // every invocation so stranded runs don't block the idempotency key.
    try {
      const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      await supabase
        .from("ce_automation_runs")
        .update({
          status: "Failed",
          completed_at: new Date().toISOString(),
          error_message: "watchdog: exceeded 30m wall-clock without completion",
          execution_log: { watchdog_reason: "exceeded_30m_wall_clock", retired_at: new Date().toISOString() },
        })
        .ilike("status", "running")
        .lt("started_at", cutoff);
    } catch (wdErr) {
      console.error("watchdog sweep failed (non-fatal):", (wdErr as Error).message);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run ?? false;
    const force: boolean = body.force ?? false;
    const asOfDate: string =
      body.as_of_date || new Date().toISOString().slice(0, 10);
    const employerFilter: string | null = body.employer_id || null;
    const employerLimit: number | null = body.limit ? Number(body.limit) : null;
    const triggeredBy: string = body.triggered_by || "SYSTEM";

    // Idempotency check (skip if force=true or dry_run)
    const runKey = `VIOLATION-SCAN-${asOfDate}`;

    if (!dryRun && !force) {
      // Check for any existing run with same key (any status)
      const { data: existingRuns } = await supabase
        .from("ce_automation_runs")
        .select("id, status")
        .eq("idempotency_key", runKey);

      if (existingRuns && existingRuns.length > 0) {
        const completedRun = existingRuns.find((r: any) => r.status === "Completed");
        if (completedRun) {
          return new Response(
            JSON.stringify({
              message: "Already completed for this date. Use force=true to re-run.",
              run_id: completedRun.id,
              dry_run: false,
              total_employers_scanned: 0,
              rules_evaluated: 0,
              violations_detected: 0,
              violations_created: 0,
              violations_skipped_dedupe: 0,
              by_rule: [],
              already_completed: true,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
          );
        }
        // Delete all non-completed runs (Failed, Running) to free the idempotency key
        const idsToRemove = existingRuns.map((r: any) => r.id);
        for (const rid of idsToRemove) {
          await supabase.from("ce_automation_runs").delete().eq("id", rid);
        }
      }
    }

    // For force re-runs, clean up ALL existing records with same base key
    if (force && !dryRun) {
      const { data: existingForce } = await supabase
        .from("ce_automation_runs")
        .select("id")
        .eq("idempotency_key", runKey);
      if (existingForce && existingForce.length > 0) {
        for (const r of existingForce) {
          await supabase.from("ce_automation_runs").delete().eq("id", r.id);
        }
      }
    }

    // Get the job record
    const { data: job } = await supabase
      .from("ce_automation_jobs")
      .select("id")
      .eq("job_code", "JOB-VIOLATION-SCAN")
      .maybeSingle();

    // Create run record
    const idempKey = dryRun ? `${runKey}-DRY-${Date.now()}` : force ? `${runKey}-FORCE-${Date.now()}` : runKey;
    const { data: run, error: runError } = await supabase
      .from("ce_automation_runs")
      .insert({
        job_id: job?.id,
        started_at: new Date().toISOString(),
        status: "Running",
        triggered_by: triggeredBy,
        idempotency_key: idempKey,
        is_dry_run: dryRun,
        parameters: { as_of_date: asOfDate, employer_id: employerFilter, force, limit: employerLimit },
      })
      .select("id")
      .single();

    if (runError) throw runError;

    // ── Run the heavy scan in the background and return immediately. ──
    // The synchronous version exceeds the edge function wall-clock budget
    // on full-tenant scans (4k+ employers × rules with per-employer queries),
    // which leaves the client hanging on a dropped connection. The UI now
    // polls ce_automation_runs by id and renders results when status flips
    // off "Running".
    const scanPromise = (async () => {
      try {
        await executeScan({
          supabase,
          runId: run.id,
          jobId: job?.id,
          dryRun,
          force,
          asOfDate,
          employerFilter,
          employerLimit,
        });
      } catch (err) {
        await supabase
          .from("ce_automation_runs")
          .update({
            completed_at: new Date().toISOString(),
            status: "Failed",
            execution_log: { error: (err as Error).message },
          })
          .eq("id", run.id);
      }
    })();

    // @ts-ignore — EdgeRuntime is provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(scanPromise);
    }

    return new Response(
      JSON.stringify({
        run_id: run.id,
        status: "Running",
        dry_run: dryRun,
        force,
        accepted: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

interface ExecuteScanArgs {
  supabase: any;
  runId: string;
  jobId: string | undefined;
  dryRun: boolean;
  force: boolean;
  asOfDate: string;
  employerFilter: string | null;
  employerLimit: number | null;
}

async function executeScan(args: ExecuteScanArgs): Promise<void> {
  const { supabase, runId, jobId, dryRun, force, asOfDate, employerFilter, employerLimit } = args;


    // Load enabled detection rules with violation type codes
    const { data: rules, error: rulesError } = await supabase
      .from("ce_detection_rules")
      .select("id, rule_code, name, violation_type_id, auto_create_violation, trigger_event, parameters, priority")
      .eq("is_enabled", true)
      .order("rule_code");

    if (rulesError) throw rulesError;

    // Load violation type codes for mapping
    const vtIds = (rules || []).map((r: any) => r.violation_type_id).filter(Boolean);
    const { data: vtypes } = await supabase
      .from("ce_violation_types")
      .select("id, code")
      .in("id", vtIds);

    const vtMap: Record<string, string> = {};
    (vtypes || []).forEach((vt: any) => {
      vtMap[vt.id] = vt.code;
    });

    const enrichedRules: DetectionRule[] = (rules || []).map((r: any) => ({
      ...r,
      violation_type_code: vtMap[r.violation_type_id] || "UNKNOWN",
    }));

    // Load fact views with FULL pagination
    const filterCol = employerFilter ? "regno" : undefined;
    const filterVal = employerFilter || undefined;

    const [filings, payments, arrears, workforce, legal] = await Promise.all([
      fetchAllRows(supabase, "ce_v_employer_filing_status", filterCol, filterVal),
      fetchAllRows(supabase, "ce_v_employer_payment_status", filterCol, filterVal),
      fetchAllRows(supabase, "ce_v_employer_arrears_summary", filterCol, filterVal),
      fetchAllRows(supabase, "ce_v_employer_workforce", filterCol, filterVal),
      fetchAllRows(supabase, "ce_v_employer_legal_status", filterCol, filterVal),
    ]);

    // Arrangements now use regno column (stripped EMP- prefix)
    const arrangements = await fetchAllRows(
      supabase,
      "ce_v_arrangement_health",
      employerFilter ? "regno" : undefined,
      employerFilter || undefined
    );

    // Index by regno for quick lookup
    const filingMap = new Map(filings.map((f: any) => [f.regno, f]));
    const paymentMap = new Map(payments.map((p: any) => [p.regno, p]));
    const arrearMap = new Map(arrears.map((a: any) => [a.regno, a]));
    const workforceMap = new Map(workforce.map((w: any) => [w.regno, w]));
    const legalMap = new Map(legal.map((l: any) => [l.regno, l]));
    // Index arrangements by regno (was employer_id before fix)
    const arrangementMap = new Map<string, any[]>();
    for (const a of arrangements) {
      const key = a.regno;
      if (!arrangementMap.has(key)) arrangementMap.set(key, []);
      arrangementMap.get(key)!.push(a);
    }

    // Load existing unresolved violations for dedupe (paginated)
    const existingViolations = await fetchAllRows(supabase, "ce_violations");
    const unresolvedViolations = existingViolations.filter(
      (v: any) =>
        ["OPEN", "IN_PROGRESS", "ESCALATED", "UNDER_REVIEW"].includes(v.status) &&
        v.is_deleted === false
    );

    // Period is persisted as 'YYYY-MM'; normalise every key to that form so
    // detection keys ('YYYY-MM-01') and stored keys always compare equal.
    const periodKey = (p?: string | null) => (p ? String(p).slice(0, 7) : "");

    const existingSet = new Set(
      unresolvedViolations.map(
        (v: any) => `${v.employer_id}|${v.violation_type_id}|${periodKey(v.period_from)}`
      )
    );

    const detected: DetectedViolation[] = [];

    // Get all unique employer regnos from filing facts (primary list)
    let allEmployers = filings.map((f: any) => ({
      regno: f.regno,
      name: f.employer_name,
    }));

    // Apply limit/sample if specified
    if (employerLimit && employerLimit > 0 && allEmployers.length > employerLimit) {
      allEmployers = allEmployers.slice(0, employerLimit);
    }

    // ── Compliance start per employer ──
    // Detection must cover every eligible period since the employer began
    // trading (date_wages_first_paid / registration_date), NOT a flat 12-month
    // window. `lookback_months` on a rule now acts only as an absolute safety
    // cap (default 120 months) — the effective window per employer is
    // min(months since compliance start, cap).
    const ABSOLUTE_CAP_MONTHS = 120;
    const monthsBetween = (fromYm: string, to: Date) => {
      const [fy, fm] = fromYm.split("-").map((n) => parseInt(n, 10));
      return (to.getFullYear() - fy) * 12 + (to.getMonth() + 1 - fm);
    };
    const complianceStartByEmp = new Map<string, string>();
    for (const f of filings as any[]) {
      if (f.compliance_start_period) {
        complianceStartByEmp.set(f.regno, String(f.compliance_start_period).slice(0, 7));
      }
    }

    // ── Bulk prefetch of filed C3 periods ──
    // Previously the missing-period rules issued ONE query per employer per
    // rule (thousands of sequential round trips), which blew past the edge
    // worker wall-clock and left the run stuck in "Running" forever. Fetch
    // every relevant period once, paginated, and index it by payer.
    const ruleCap = Math.max(
      12,
      ...enrichedRules.map((r) =>
        Math.min(ABSOLUTE_CAP_MONTHS, Number(r.parameters?.lookback_months ?? ABSOLUTE_CAP_MONTHS)),
      ),
    );
    const asOfRef = new Date(asOfDate);
    let widestLookback = ruleCap;
    for (const ym of complianceStartByEmp.values()) {
      widestLookback = Math.max(widestLookback, Math.min(ruleCap, monthsBetween(ym, asOfRef)));
    }
    const maxLookback = Math.min(ABSOLUTE_CAP_MONTHS, widestLookback);
    const filedCutoff = new Date();
    filedCutoff.setMonth(filedCutoff.getMonth() - (maxLookback + 1));

    const filedPeriodsByEmp = new Map<string, Set<string>>();
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        let q = supabase
          .from("cn_c3_reported")
          .select("payer_id, period")
          .gte("period", filedCutoff.toISOString().slice(0, 10))
          .order("payer_id")
          .range(from, from + PAGE - 1);
        if (employerFilter) q = q.eq("payer_id", employerFilter);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) {
          const key = String(r.payer_id);
          let set = filedPeriodsByEmp.get(key);
          if (!set) {
            set = new Set<string>();
            filedPeriodsByEmp.set(key, set);
          }
          set.add(String(r.period).slice(0, 7));
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // ── Bulk prefetch of per-period C3 declarations and payments ──
    // Late-filing / non-payment / partial-payment detection must be evaluated
    // period-by-period (like non-filing) instead of emitting a single
    // aggregate row at the scan date.
    const c3ByEmp = new Map<string, Map<string, { received: Date | null; declared: number }>>();
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        let q = supabase
          .from("cn_c3_reported")
          .select(
            "payer_id, period, date_received, posting_status, emp_ss_amt_calc, emp_levy_amt_calc, emp_pe_amt_calc",
          )
          .gte("period", filedCutoff.toISOString().slice(0, 10))
          .order("payer_id")
          .range(from, from + PAGE - 1);
        if (employerFilter) q = q.eq("payer_id", employerFilter);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data) {
          if (String(r.posting_status ?? "") === "CANCELLED") continue;
          const key = String(r.payer_id);
          let m = c3ByEmp.get(key);
          if (!m) {
            m = new Map();
            c3ByEmp.set(key, m);
          }
          const ym = String(r.period).slice(0, 7);
          const declared =
            Number(r.emp_ss_amt_calc || 0) +
            Number(r.emp_levy_amt_calc || 0) +
            Number(r.emp_pe_amt_calc || 0);
          const received = r.date_received ? new Date(r.date_received) : null;
          const prev = m.get(ym);
          if (prev) {
            prev.declared += declared;
            if (received && (!prev.received || received > prev.received)) prev.received = received;
          } else {
            m.set(ym, { received, declared });
          }
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    // Payments: cn_payment holds the period + amount, cn_payment_header the payer.
    const payByEmp = new Map<string, Map<string, number>>();
    {
      const PAGE = 1000;
      const payerByPaymentId = new Map<string, string>();
      let from = 0;
      while (true) {
        let q = supabase
          .from("cn_payment_header")
          .select("payment_id, payer_id")
          .order("payment_id")
          .range(from, from + PAGE - 1);
        if (employerFilter) q = q.eq("payer_id", employerFilter);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const h of data) payerByPaymentId.set(String(h.payment_id), String(h.payer_id));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("cn_payment")
          .select("payment_id, period, payment_amount")
          .gte("period", filedCutoff.toISOString().slice(0, 10))
          .order("payment_id")
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const p of data) {
          const regno = payerByPaymentId.get(String(p.payment_id));
          if (!regno || !p.period) continue;
          let m = payByEmp.get(regno);
          if (!m) {
            m = new Map();
            payByEmp.set(regno, m);
          }
          const ym = String(p.period).slice(0, 7);
          m.set(ym, (m.get(ym) || 0) + Number(p.payment_amount || 0));
        }
        if (data.length < PAGE) break;
        from += PAGE;
      }
    }

    /**
     * Period window for an employer: [startYm, lastCompleteYm].
     * Rules driven by actual C3 rows iterate their own (small) period set and
     * only test membership here — iterating up to 120 synthetic months per
     * employer per rule blew the edge CPU budget on full-tenant scans.
     */
    const asOfToday = new Date(asOfDate);
    const lastCompleteYm = (() => {
      const d = new Date(asOfToday.getFullYear(), asOfToday.getMonth() - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    })();
    const windowFor = (regno: string, cap: number): { from: string; to: string } => {
      const startYm = complianceStartByEmp.get(regno);
      const capStart = new Date(asOfToday.getFullYear(), asOfToday.getMonth() - cap, 1);
      const capYm = `${capStart.getFullYear()}-${String(capStart.getMonth() + 1).padStart(2, "0")}`;
      return { from: startYm && startYm > capYm ? startYm : capYm, to: lastCompleteYm };
    };



    // Process each rule
    for (const rule of enrichedRules) {
      const initialStatus = rule.auto_create_violation ? "OPEN" : "UNDER_REVIEW";
      const asOfPeriod = asOfDate.slice(0, 7);

      /** Emit one violation row per qualifying period (deduped). */
      const pushPeriod = (emp: any, ym: string, summary: string) => {
        const periodFromYm = `${ym}-01`;
        const dedupeKey = `${emp.regno}|${rule.violation_type_id}|${periodKey(periodFromYm)}`;
        if (existingSet.has(dedupeKey)) return;
        detected.push({
          rule_code: rule.rule_code,
          rule_name: rule.name,
          employer_id: emp.regno,
          employer_name: emp.name,
          violation_type_id: rule.violation_type_id,
          violation_type_code: rule.violation_type_code || "UNKNOWN",
          status: initialStatus,
          priority: rule.priority || "Medium",
          summary,
          period_from: periodFromYm,
          source_type: "DETECTION_RULE",
          source_rule_id: rule.id,
        });
        existingSet.add(dedupeKey);
      };

      for (const emp of allEmployers) {
        const filing = filingMap.get(emp.regno) as any;
        const payment = paymentMap.get(emp.regno) as any;
        const arrear = arrearMap.get(emp.regno) as any;
        const wf = workforceMap.get(emp.regno) as any;


        let shouldFlag = false;
        let summary = "";
        let periodFrom: string | undefined;

        switch (rule.trigger_event) {
          case "c3_deadline_passed": {
            // Per-period: every C3 that WAS filed but arrived after its
            // statutory deadline (+ grace) raises its own late-filing row.
            const cap = Math.min(
              ABSOLUTE_CAP_MONTHS,
              Number(rule.parameters?.lookback_months ?? ABSOLUTE_CAP_MONTHS),
            );
            const graceDays = Number(rule.parameters?.grace_period_days ?? 0);
            const dueDay = Number(rule.parameters?.submission_due_day ?? 28);
            const c3 = c3ByEmp.get(emp.regno);
            if (c3) {
              const win = windowFor(emp.regno, cap);
              for (const [ym, rec] of c3) {
                if (!rec.received || ym < win.from || ym > win.to) continue;
                const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
                const deadline = new Date(y, m, dueDay + graceDays);
                if (rec.received > deadline) {
                  pushPeriod(
                    emp,
                    ym,
                    `Late filing: C3 for ${ym} received ${rec.received.toISOString().slice(0, 10)}, after the ${deadline.toISOString().slice(0, 10)} deadline (${graceDays}d grace).`,
                  );
                }
              }
            }

            shouldFlag = false;
            break;
          }


          case "c3_missing_30_days":
          case "contribution_gap_detected": {
            // Per-period emission: flag every missing month independently so each
            // gap (e.g. February only) gets its own violation row.
            const cap = Math.min(
              ABSOLUTE_CAP_MONTHS,
              Number(rule.parameters?.lookback_months ?? ABSOLUTE_CAP_MONTHS),
            );
            const minMissed = Number(rule.parameters?.min_missed_months ?? 1);
            const graceDays = Number(rule.parameters?.days_past_deadline ?? 30);
            const dueDay = Number(rule.parameters?.submission_due_day ?? 28);

            // Filed periods come from the bulk prefetch above — no per-employer query.
            const filedSet = filedPeriodsByEmp.get(emp.regno) ?? new Set<string>();

            const today = new Date(asOfDate);
            // Window starts at the employer's compliance start (registration /
            // first wages paid), bounded by the rule's safety cap.
            const startYm = complianceStartByEmp.get(emp.regno);
            const sinceStart = startYm ? monthsBetween(startYm, today) : cap;
            const lookback = Math.max(0, Math.min(cap, sinceStart));
            const missing: string[] = [];
            for (let i = 1; i <= lookback; i++) {
              const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              if (startYm && ym < startYm) continue;
              const deadline = new Date(d.getFullYear(), d.getMonth() + 1, dueDay + graceDays);
              if (today >= deadline && !filedSet.has(ym)) missing.push(ym);
            }


            if (missing.length >= minMissed) {
              for (const ym of missing) {
                const periodFromYm = `${ym}-01`;
                const dedupeKey = `${emp.regno}|${rule.violation_type_id}|${periodKey(periodFromYm)}`;
                if (existingSet.has(dedupeKey)) continue;
                detected.push({
                  rule_code: rule.rule_code,
                  rule_name: rule.name,
                  employer_id: emp.regno,
                  employer_name: emp.name,
                  violation_type_id: rule.violation_type_id,
                  violation_type_code: rule.violation_type_code || "UNKNOWN",
                  status: initialStatus,
                  priority: rule.priority,
                  summary: `Non-filing: C3 not submitted for ${ym} (deadline + ${graceDays}d grace passed).`,
                  period_from: periodFromYm,
                  source_type: "AUTOMATED",
                  source_rule_id: rule.id,
                });
                existingSet.add(dedupeKey);
              }
            }
            // Skip the legacy single-row insertion below by marking handled
            shouldFlag = false;
            break;
          }

          case "payment_not_received": {
            // Per-period: a declared C3 with no money received for that period
            // once the payment due date (+ grace) has passed.
            const cap = Math.min(
              ABSOLUTE_CAP_MONTHS,
              Number(rule.parameters?.lookback_months ?? ABSOLUTE_CAP_MONTHS),
            );
            const graceDays = Number(rule.parameters?.grace_period_days ?? 0);
            const dueDay = Number(rule.parameters?.payment_due_day ?? 28);
            const today = new Date(asOfDate);
            const c3 = c3ByEmp.get(emp.regno);
            const paid = payByEmp.get(emp.regno);
            if (c3) {
              for (const ym of periodsInScope(emp.regno, cap)) {
                const rec = c3.get(ym);
                if (!rec || rec.declared <= 0) continue;
                const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
                const dueDate = new Date(y, m, dueDay + graceDays);
                if (today < dueDate) continue;
                const amountPaid = paid?.get(ym) || 0;
                if (amountPaid <= 0) {
                  pushPeriod(
                    emp,
                    ym,
                    `Non-payment: contributions of $${rec.declared.toLocaleString()} declared for ${ym} but no payment received by ${dueDate.toISOString().slice(0, 10)}.`,
                  );
                }
              }
            }
            shouldFlag = false;
            break;
          }

          case "payment_partial": {
            // Per-period shortfall between declared C3 and money received.
            const cap = Math.min(
              ABSOLUTE_CAP_MONTHS,
              Number(rule.parameters?.lookback_months ?? ABSOLUTE_CAP_MONTHS),
            );
            const minAmt = Number(rule.parameters?.min_shortfall_amount_xcd ?? 0);
            const minPct = Number(rule.parameters?.min_shortfall_percent ?? 0);
            const c3 = c3ByEmp.get(emp.regno);
            const paid = payByEmp.get(emp.regno);
            if (c3 && paid) {
              for (const ym of periodsInScope(emp.regno, cap)) {
                const rec = c3.get(ym);
                if (!rec || rec.declared <= 0) continue;
                const amountPaid = paid.get(ym) || 0;
                if (amountPaid <= 0) continue; // handled by non-payment rule
                const shortfall = rec.declared - amountPaid;
                if (shortfall <= 0) continue;
                const pct = (shortfall / rec.declared) * 100;
                if (shortfall < minAmt || pct < minPct) continue;
                pushPeriod(
                  emp,
                  ym,
                  `Partial payment: ${ym} declared $${rec.declared.toLocaleString()}, paid $${amountPaid.toLocaleString()}, shortfall $${shortfall.toLocaleString()} (${pct.toFixed(1)}%).`,
                );
              }
            }
            shouldFlag = false;
            break;
          }


          case "repeat_violation_check": {
            const threshold = rule.parameters?.repeat_threshold ?? 3;
            const empViolations = unresolvedViolations.filter(
              (v: any) => v.employer_id === emp.regno
            );
            if (empViolations.length >= threshold) {
              shouldFlag = true;
              summary = `Repeat offender: ${empViolations.length} unresolved violations detected (threshold: ${threshold}).`;
              periodFrom = asOfPeriod;
            }
            break;
          }

          case "installment_overdue": {
            const empArrangements = (arrangementMap.get(emp.regno) || []).filter(
              (a: any) => a.health_status !== "HEALTHY" && a.health_status !== "INACTIVE"
            );
            if (empArrangements.length > 0) {
              const worst = empArrangements[0];
              shouldFlag = true;
              summary = `Arrangement breach: ${worst.health_status} status. Missed ${worst.missed_payments || 0} payments.`;
              periodFrom = asOfPeriod;
            }
            break;
          }

          case "levy_omission_check": {
            if (arrear?.has_arrears && arrear.total_outstanding > 500) {
              shouldFlag = true;
              summary = `Levy/severance contribution omission suspected. Outstanding: $${Number(arrear.total_outstanding).toLocaleString()}.`;
              periodFrom = asOfPeriod;
            }
            break;
          }

          case "registration_not_found": {
            break;
          }

          case "employee_underreporting": {
            const minDelta = rule.parameters?.min_employee_delta ?? 3;
            if (wf && wf.employee_delta < -minDelta) {
              shouldFlag = true;
              summary = `Employee discrepancy: Registered ${wf.registered_total} but last reported ${wf.last_reported_employees} (delta: ${wf.employee_delta}).`;
              periodFrom = wf.last_reported_period || asOfPeriod;
            }
            break;
          }

          case "wage_underreporting": {
            const minWage = rule.parameters?.min_wage_weekly_xcd;
            if (!minWage) break;
            break;
          }

          case "employer_cessation": {
            if (arrear?.has_arrears && filing?.employer_status && ["I", "D"].includes(filing.employer_status)) {
              shouldFlag = true;
              summary = `Cessation without clearance: Employer status '${filing.employer_status}' with outstanding balance $${Number(arrear.total_outstanding).toLocaleString()}.`;
              periodFrom = asOfPeriod;
            }
            break;
          }

          case "severance_omission_check": {
            break;
          }

          default:
            break;
        }

        if (shouldFlag) {
          const dedupeKey = `${emp.regno}|${rule.violation_type_id}|${periodKey(periodFrom)}`;
          if (existingSet.has(dedupeKey)) {
            detected.push({
              rule_code: rule.rule_code,
              rule_name: rule.name,
              employer_id: emp.regno,
              employer_name: emp.name,
              violation_type_id: rule.violation_type_id,
              violation_type_code: rule.violation_type_code || "UNKNOWN",
              status: initialStatus,
              priority: rule.priority || "Medium",
              summary,
              period_from: periodFrom,
              source_type: "DETECTION_RULE",
              source_rule_id: rule.id,
              skipped: true,
              skip_reason: "Unresolved violation already exists",
            });
          } else {
            detected.push({
              rule_code: rule.rule_code,
              rule_name: rule.name,
              employer_id: emp.regno,
              employer_name: emp.name,
              violation_type_id: rule.violation_type_id,
              violation_type_code: rule.violation_type_code || "UNKNOWN",
              status: initialStatus,
              priority: rule.priority || "Medium",
              summary,
              period_from: periodFrom,
              source_type: "DETECTION_RULE",
              source_rule_id: rule.id,
            });
            existingSet.add(dedupeKey);
          }
        }
      }
    }

    const newViolations = detected.filter((d) => !d.skipped);
    const skippedCount = detected.filter((d) => d.skipped).length;

    // ── SSB penalty policy: enrich each detected row with principal/penalty/
    // interest/total using the active ce_compliance_policies row and each
    // employer's last-3 C3 totals (ce_calculation_rules CR-003).
    const { data: activePolicyRows } = await supabase
      .from("ce_compliance_policies")
      .select("penalty_rate_percent, interest_rate_percent, penalty_calc_frequency, c3_grace_period_days")
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1);
    const activePolicy = activePolicyRows?.[0] ?? null;

    const empIds = Array.from(new Set(newViolations.map((v) => v.employer_id).filter(Boolean)));
    const historyByEmp = new Map<string, number[]>();
    if (empIds.length > 0) {
      // Pull the employer's most recent known C3 filings. Rows are aggregated
      // per (employer, period) first — a period can carry several C3 lines —
      // then the 3 most recent periods form the CR-003 basis.
      // The employer id list is chunked: a single .in() with thousands of ids
      // overflows the request URL and silently returns no rows (which is what
      // caused every violation to be priced at 0).
      const CHUNK = 100;
      const periodTotals = new Map<string, Map<string, number>>();
      for (let i = 0; i < empIds.length; i += CHUNK) {
        const chunk = empIds.slice(i, i + CHUNK);
        const { data: c3Rows, error: c3Err } = await supabase
          .from("cn_c3_reported")
          .select("payer_id, period, emp_ss_amt_calc, emp_levy_amt_calc, emp_pe_amt_calc")
          .in("payer_id", chunk)
          .order("period", { ascending: false })
          .limit(20000);
        if (c3Err) {
          console.error("[ce-violation-scan] C3 history lookup failed", c3Err.message);
          continue;
        }
        for (const r of (c3Rows || [])) {
          const total =
            Number(r.emp_ss_amt_calc || 0) +
            Number(r.emp_levy_amt_calc || 0) +
            Number(r.emp_pe_amt_calc || 0);
          if (!(total > 0)) continue;
          const byPeriod = periodTotals.get(r.payer_id) || new Map<string, number>();
          const key = String(r.period).slice(0, 10);
          byPeriod.set(key, (byPeriod.get(key) || 0) + total);
          periodTotals.set(r.payer_id, byPeriod);
        }
      }
      for (const [empId, byPeriod] of periodTotals) {
        const last3 = Array.from(byPeriod.entries())
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .slice(0, 3)
          .map(([, v]) => v);
        if (last3.length > 0) historyByEmp.set(empId, last3);
      }
    }

    for (const v of newViolations) {
      const known = /arrears|outstanding|arrangement/i.test(v.summary)
        ? extractLeadingCurrency(v.summary)
        : undefined;
      const amounts = computeViolationAmounts({
        policy: activePolicy,
        history: historyByEmp.get(v.employer_id) || [],
        periodFrom: v.period_from,
        asOfDate,
        knownPrincipal: known,
      });
      v.principal_amount = amounts.principal;
      v.penalty_amount = amounts.penalty;
      v.interest_amount = amounts.interest;
      v.total_amount = amounts.total;
    }


    // Insert violations if not dry run, then auto-route each one
    let insertedCount = 0;
    let routedCount = 0;
    if (!dryRun && newViolations.length > 0) {
      // Insert in batches of 200
      const BATCH = 200;
      for (let i = 0; i < newViolations.length; i += BATCH) {
        const batch = newViolations.slice(i, i + BATCH);
        const rows = batch.map((v) => ({
          violation_number: generateViolationNumber(),
          employer_id: v.employer_id,
          employer_name: v.employer_name,
          territory: "St Kitts",
          violation_type_id: v.violation_type_id,
          status: v.status,
          priority: v.priority,
          summary: v.summary,
          source_type: v.source_type,
          source_rule_id: v.source_rule_id,
          period_from: v.period_from ? v.period_from.slice(0, 7) : null,
          discovered_date: asOfDate,
          discovered_by: "VIOLATION-SCAN",
          created_by: "VIOLATION-SCAN",
          principal_amount: v.principal_amount ?? 0,
          penalty_amount: v.penalty_amount ?? 0,
          interest_amount: v.interest_amount ?? 0,
          total_amount: v.total_amount ?? 0,
          is_unlinked: false,
          is_deleted: false,
        }));

        const { data: inserted, error: insertError } = await supabase
          .from("ce_violations")
          .insert(rows)
          .select("id");

        if (insertError) throw insertError;
        insertedCount += inserted?.length || 0;

        // Auto-route each newly created violation
        for (const ins of (inserted || [])) {
          const { error: routeErr } = await supabase.rpc("fn_ce_route_violation", {
            p_violation_id: ins.id,
          });
          if (!routeErr) routedCount++;
        }
      }
    }

    // Build by-rule breakdown
    const byRule = enrichedRules.map((r) => ({
      rule_code: r.rule_code,
      rule_name: r.name,
      detected: detected.filter((d) => d.rule_code === r.rule_code && !d.skipped).length,
      skipped: detected.filter((d) => d.rule_code === r.rule_code && d.skipped).length,
      total: detected.filter((d) => d.rule_code === r.rule_code).length,
    }));

    const runResult = {
      total_employers_scanned: allEmployers.length,
      rules_evaluated: enrichedRules.length,
      violations_detected: detected.length,
      violations_created: dryRun ? 0 : insertedCount,
      violations_routed: dryRun ? 0 : routedCount,
      violations_skipped_dedupe: skippedCount,
      violations_would_create: newViolations.length,
      by_rule: byRule,
    };

  // Update run record
  await supabase
    .from("ce_automation_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "Completed",
      records_processed: allEmployers.length,
      records_affected: dryRun ? 0 : insertedCount,
      execution_log: {
        ...runResult,
        dry_run: dryRun,
        force,
        sample_violations: detected.slice(0, 20),
        details: detected.slice(0, 100),
      },
    })
    .eq("id", runId);

  // Update job last run
  if (jobId && !dryRun) {
    await supabase
      .from("ce_automation_jobs")
      .update({
        last_run_at: new Date().toISOString(),
        last_run_status: "Completed",
      })
      .eq("id", jobId);
  }
}

