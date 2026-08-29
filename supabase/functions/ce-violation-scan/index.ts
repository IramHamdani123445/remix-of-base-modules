import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  ABSOLUTE_CAP_MONTHS,
  CALCULATION_PARAM_SPEC,
  DETECTION_PARAM_SPEC,
  resolveRuleParameters,
} from "../_shared/compliance/detectionRuleParameterSpec.ts";
import {
  type CeObligationPolicy,
  CeObligationPolicyError,
  addDays,
  evaluateFilingObligation,
  evaluatePaymentObligation,
  normalizeObligationPolicy,
  resolveObligationTimeline,
} from "../_shared/compliance/obligationDeadlineResolver.ts";
import {
  type CePartialPaymentAuthority,
  evaluatePartialPaymentObligation,
  isPartialPaymentViolation,
} from "../_shared/compliance/partialPaymentAllocation.ts";
import { buildReviewFlag, type CeReviewFlagRecord } from "../_shared/compliance/detection/reviewFlag.ts";
import {
  evaluateRepeatOffender,
  buildRepeatOffenderFlag,
  type CeRepeatOccurrence,
} from "../_shared/compliance/detection/repeatOffender.ts";
import {
  evaluateArrangementInstallments,
  planInstallmentReminders,
  isBreach,
  type CeInstallment,
} from "../_shared/compliance/detection/arrangementBreach.ts";
import {
  evaluateFundOmissions,
  type CeC3PersonFundLine,
  type CeContributionExemption,
  type CeFundCode,
} from "../_shared/compliance/detection/fundOmission.ts";
import {
  evaluateLead,
  buildUnregisteredLeadFlag,
  type CeScoutingLead,
  type CeEmployerRegisterEntry,
} from "../_shared/compliance/detection/unregisteredEmployer.ts";
import {
  evaluateHeadcountDiscrepancy,
  evaluateHistoricalHeadcountAnomaly,
  buildHeadcountFlag,
  type CeHeadcountTier,
  type CeHeadcountObservation,
} from "../_shared/compliance/detection/headcountAnomaly.ts";
import {
  evaluateSectorBenchmark,
  evaluateHistoricalWageVariance,
  buildWageFlag,
  type CeSectorBenchmark,
  type CeWageObservation,
} from "../_shared/compliance/detection/wageAnomaly.ts";
import {
  evaluateImproperCessation,
  evaluateContributionGap,
  type CeCessationInput,
  type CeObligationHistoryEntry,
} from "../_shared/compliance/detection/employerStatusRules.ts";
import {
  evaluateSelfEmployedObligation,
  consolidateSelfEmployedReminders,
  computeOverContributionCredits,
  detectEmployerOverlap,
  detectMultiEmployerReporting,
  buildSelfEmployedOverlapFlag,
  buildMultiEmployerFlag,
  type CeSelfEmployedObligation,
  type CeEmployerReportedPeriod,
} from "../_shared/compliance/detection/selfEmployedCompliance.ts";


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
 * employer's most recent known C3 totals (ce_calculation_rules CR-003).
 *
 *   principal = avg(last N c3 totals) × estimate_multiplier   (0 when no history)
 *   penalty   = principal × penalty_rate_percent% × months_overdue
 *   interest  = principal × (interest_rate_percent% / 12) × months_overdue
 *   total     = principal + penalty + interest
 *
 * N (history_period_count) and estimate_multiplier come from CR-003's
 * configuration — there is no hard-coded estimation basis here.
 */
function computeViolationAmounts(opts: {
  policy: any;
  history: number[];
  estimateMultiplier: number;
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
      principal = Math.round(avg * opts.estimateMultiplier * 100) / 100;
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
  filterVal?: string,
  columns = "*"
): Promise<any[]> {
  const PAGE_SIZE = 1000;
  let allRows: any[] = [];
  let from = 0;

  while (true) {
    let query = supabase.from(table).select(columns).range(from, from + PAGE_SIZE - 1);
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

    // ── Resume sweep: a slice worker can be killed by the edge CPU budget
    // ("CPU Time exceeded") after persisting its progress but before chaining
    // the next slice, which left the run stuck on "Running" forever. Any run
    // that reported progress but has not moved for 90s is re-chained from the
    // last completed offset.
    const resumeStranded = async () => {
      const staleBefore = Date.now() - 90_000;
      const { data: liveRuns } = await supabase
        .from("ce_automation_runs")
        .select("id, started_at, execution_log, parameters, is_dry_run")
        .ilike("status", "running")
        .gt("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

      for (const run of liveRuns ?? []) {
        const log: any = run.execution_log ?? {};
        if (!log.in_progress) continue;
        const beat = log.heartbeat_at ? new Date(log.heartbeat_at).getTime() : 0;
        if (beat > staleBefore) continue;
        const resumeCount = Number(log.resume_count ?? 0);
        if (resumeCount > 200) continue;

        const params: any = run.parameters ?? {};
        await supabase
          .from("ce_automation_runs")
          .update({
            execution_log: {
              ...log,
              resume_count: resumeCount + 1,
              heartbeat_at: new Date().toISOString(),
            },
          })
          .eq("id", run.id);

        const carryFromLog = {
          total_employers_scanned: log.total_employers_scanned ?? 0,
          violations_detected: log.violations_detected ?? 0,
          violations_created: log.violations_created ?? 0,
          violations_routed: log.violations_routed ?? 0,
          violations_skipped_dedupe: log.violations_skipped_dedupe ?? 0,
          violations_would_create: log.violations_would_create ?? 0,
          by_rule: log.by_rule ?? [],
          sample_violations: log.sample_violations ?? [],
        };

        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ce-violation-scan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: JSON.stringify({
            continue_run_id: run.id,
            employer_offset: log.employers_done ?? 0,
            batch_size: Number(params.batch_size ?? 100),
            carry: carryFromLog,
            dry_run: run.is_dry_run ?? log.dry_run ?? false,
            force: log.force ?? false,
            as_of_date: params.as_of_date ?? new Date().toISOString().slice(0, 10),
            employer_id: params.employer_id ?? null,
            limit: params.limit ?? null,
            triggered_by: "RESUME-WATCHDOG",
          }),
        }).catch((e) => console.error("resume chain failed:", (e as Error).message));
      }
    };


    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = body.dry_run ?? false;
    const force: boolean = body.force ?? false;
    const asOfDate: string =
      body.as_of_date || new Date().toISOString().slice(0, 10);
    const employerFilter: string | null = body.employer_id || null;
    const employerLimit: number | null = body.limit ? Number(body.limit) : null;
    const triggeredBy: string = body.triggered_by || "SYSTEM";
    // Employers are scanned in slices so no single worker invocation exceeds
    // the edge CPU/wall-clock budget. Each slice chains the next one.
    // 300 employers per slice tripped "CPU Time exceeded" and killed the chain.
    const batchSize: number = Math.max(25, Number(body.batch_size ?? 100));
    const continueRunId: string | null = body.continue_run_id || null;
    const employerOffset: number = Number(body.employer_offset ?? 0);
    const carry = body.carry ?? null;

    // Cron / manual entry point that only revives stranded runs.
    if (body.resume_only) {
      await resumeStranded();
      return new Response(JSON.stringify({ resumed: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }
    if (!continueRunId) {
      await resumeStranded().catch(() => {});
    }


    // ── Continuation invocation: reuse the existing run row, no idempotency ──
    if (continueRunId) {
      const { data: contRun } = await supabase
        .from("ce_automation_runs")
        .select("id, job_id")
        .eq("id", continueRunId)
        .maybeSingle();

      if (!contRun) {
        return new Response(JSON.stringify({ error: "continue_run_id not found" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        });
      }

      const contPromise = (async () => {
        try {
          await executeScan({
            supabase,
            runId: contRun.id,
            jobId: contRun.job_id,
            dryRun,
            force,
            asOfDate,
            employerFilter,
            employerLimit,
            employerOffset,
            batchSize,
            carry,
            triggeredBy,
          });
        } catch (err) {
          await supabase
            .from("ce_automation_runs")
            .update({
              completed_at: new Date().toISOString(),
              status: "Failed",
              error_message: (err as Error).message,
              execution_log: { error: (err as Error).message },
            })
            .eq("id", contRun.id);
        }
      })();

      // @ts-ignore — EdgeRuntime is provided by Supabase Edge Runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(contPromise);
      }

      return new Response(
        JSON.stringify({ run_id: contRun.id, status: "Running", accepted: true, continued: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 }
      );
    }

    // Idempotency check (skip if force=true or dry_run)
    const runKey = `VIOLATION-SCAN-${asOfDate}`;

    // A run that is still Running and was started recently is a LIVE run: a
    // second "Run Detection Now" click must attach to it instead of deleting
    // its row, which used to strand the first client polling a row that no
    // longer existed (VIOLATION_DETECTION_007).
    const liveCutoff = Date.now() - 30 * 60 * 1000;
    const isLive = (r: any) =>
      String(r.status || "").toLowerCase() === "running" &&
      r.started_at && new Date(r.started_at).getTime() > liveCutoff;

    if (!dryRun) {
      const { data: existingRuns } = await supabase
        .from("ce_automation_runs")
        .select("id, status, started_at")
        .eq("idempotency_key", runKey);

      if (existingRuns && existingRuns.length > 0) {
        const liveRun = existingRuns.find(isLive);
        if (liveRun) {
          return new Response(
            JSON.stringify({
              run_id: liveRun.id,
              status: "Running",
              accepted: true,
              attached: true,
              dry_run: false,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 202 }
          );
        }

        if (!force) {
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
        }

        // Only stale/terminal runs are removed, freeing the idempotency key.
        for (const r of existingRuns) {
          if (isLive(r)) continue;
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
        execution_log: {
          in_progress: true,
          heartbeat_at: new Date().toISOString(),
          employers_done: 0,
          dry_run: dryRun,
          force,
        },

        parameters: { as_of_date: asOfDate, employer_id: employerFilter, force, limit: employerLimit, batch_size: batchSize },
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
          employerOffset: 0,
          batchSize,
          carry: null,
          triggeredBy,
        });
      } catch (err) {
        await supabase
          .from("ce_automation_runs")
          .update({
            completed_at: new Date().toISOString(),
            status: "Failed",
            error_message: (err as Error).message,
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

interface ScanCarry {
  total_employers_scanned: number;
  violations_detected: number;
  violations_created: number;
  violations_routed: number;
  violations_skipped_dedupe: number;
  violations_would_create: number;
  by_rule: Array<{ rule_code: string; rule_name: string; detected: number; skipped: number; total: number }>;
  sample_violations: any[];
  review_flags_created: number;
  review_flags_would_create: number;
}

interface ExecuteScanArgs {
  supabase: any;
  runId: string;
  jobId: string | undefined;
  dryRun: boolean;
  force: boolean;
  asOfDate: string;
  employerFilter: string | null;
  employerLimit: number | null;
  employerOffset: number;
  batchSize: number;
  carry: ScanCarry | null;
  triggeredBy: string;
}

function emptyCarry(): ScanCarry {
  return {
    total_employers_scanned: 0,
    violations_detected: 0,
    violations_created: 0,
    violations_routed: 0,
    violations_skipped_dedupe: 0,
    violations_would_create: 0,
    by_rule: [],
    sample_violations: [],
    review_flags_created: 0,
    review_flags_would_create: 0,
  };
}

function mergeByRule(
  prev: ScanCarry["by_rule"],
  next: ScanCarry["by_rule"],
): ScanCarry["by_rule"] {
  const map = new Map<string, ScanCarry["by_rule"][number]>();
  for (const row of [...prev, ...next]) {
    const existing = map.get(row.rule_code);
    if (existing) {
      existing.detected += row.detected;
      existing.skipped += row.skipped;
      existing.total += row.total;
    } else {
      map.set(row.rule_code, { ...row });
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.rule_code < b.rule_code ? -1 : 1));
}

async function executeScan(args: ExecuteScanArgs): Promise<void> {
  const {
    supabase,
    runId,
    jobId,
    dryRun,
    force,
    asOfDate,
    employerFilter,
    employerLimit,
    employerOffset,
    batchSize,
    triggeredBy,
  } = args;
  const carry: ScanCarry = args.carry ?? emptyCarry();



    // Load enabled detection rules with violation type codes
    const { data: rules, error: rulesError } = await supabase
      .from("ce_detection_rules")
      .select("id, rule_code, name, violation_type_id, auto_create_violation, trigger_event, parameters, priority, updated_at")
      .eq("is_enabled", true)
      .order("rule_code");

    if (rulesError) throw rulesError;

    // ── Active compliance policy (cross-rule statutory owner) ──
    // Loaded up front: statutory due days and rates are owned here, and rule
    // parameter resolution falls back to this row before declaring an error.
    const { data: activePolicyRows } = await supabase
      .from("ce_compliance_policies")
      .select(
        "policy_code, policy_version, penalty_rate_percent, interest_rate_percent, penalty_calc_frequency, c3_grace_period_days, c3_submission_deadline_day, payment_due_date_day, payment_grace_period_days, deadline_basis, reporting_offset_months, deadline_fixed_day",
      )
      .eq("is_active", true)
      .order("effective_from", { ascending: false })
      .limit(1);
    const activePolicy = activePolicyRows?.[0] ?? null;

    // The obligation CALENDAR has exactly one owner: the active policy. Rules may
    // override the fixed day / grace days, never the basis. A missing or invalid
    // basis fails the deadline-driven rules visibly instead of assuming a day.
    const obligationPolicyError = (() => {
      try {
        normalizeObligationPolicy(activePolicy, { grace_days: 0 });
        return null;
      } catch (e) {
        return e instanceof CeObligationPolicyError ? e.message : String(e);
      }
    })();
    /** Build the timeline policy for one rule (rule overrides > policy). */
    const timelinePolicyFor = (
      graceDays: number,
      fixedDay?: number | null,
    ): CeObligationPolicy =>
      normalizeObligationPolicy(activePolicy, {
        grace_days: Number.isFinite(graceDays) ? graceDays : 0,
        fixed_day: fixedDay == null || !Number.isFinite(Number(fixedDay)) ? null : Number(fixedDay),
      });
    /** Flag a deadline-driven rule as unrunnable (recorded once per rule). */
    const markObligationConfigError = (ruleCode: string, message: string) => {
      const entry = ruleDiagnostics.find((d) => d.rule_code === ruleCode);
      if (!entry) return;
      entry.status = "configuration_error";
      entry.errors = Array.from(new Set([...(entry.errors ?? []), message]));
    };
    const iso = (d: Date | string | null | undefined): string | null =>
      !d ? null : (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

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

    // ── Runtime parameter resolution against the canonical contract ──
    // No business-policy default is ever substituted in code. A rule with an
    // unresolved required parameter is skipped and reported as a configuration
    // error on the run, so a violation can always be explained later.
    const ruleDiagnostics: Array<{
      rule_code: string;
      rule_id: string;
      trigger_event: string;
      config_updated_at: string | null;
      effective_parameters: Record<string, any>;
      parameter_sources: Record<string, string>;
      status: "ok" | "configuration_error" | "not_implemented";
      errors?: string[];
    }> = [];
    const paramsByRuleId = new Map<string, Record<string, any>>();
    const configErrorRuleIds = new Set<string>();

    for (const rule of enrichedRules) {
      const specs = DETECTION_PARAM_SPEC[rule.trigger_event];
      if (!specs) {
        ruleDiagnostics.push({
          rule_code: rule.rule_code,
          rule_id: rule.id,
          trigger_event: rule.trigger_event,
          config_updated_at: (rule as any).updated_at ?? null,
          effective_parameters: {},
          parameter_sources: {},
          status: "not_implemented",
          errors: [`Trigger "${rule.trigger_event}" has no runtime implementation in the scanner.`],
        });
        configErrorRuleIds.add(rule.id);
        continue;
      }
      const resolved = resolveRuleParameters(specs, rule.parameters, activePolicy);
      if (resolved.errors.length > 0) {
        configErrorRuleIds.add(rule.id);
        console.error(
          `[ce-violation-scan] CONFIGURATION ERROR ${rule.rule_code}: ${resolved.errors.join(" | ")}`,
        );
      }
      paramsByRuleId.set(rule.id, resolved.values);
      ruleDiagnostics.push({
        rule_code: rule.rule_code,
        rule_id: rule.id,
        trigger_event: rule.trigger_event,
        config_updated_at: (rule as any).updated_at ?? null,
        effective_parameters: resolved.values,
        parameter_sources: resolved.sources,
        status: resolved.errors.length > 0 ? "configuration_error" : "ok",
        ...(resolved.errors.length > 0 ? { errors: resolved.errors } : {}),
      });
    }


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

    // Load existing unresolved violations for dedupe (paginated).
    // Only the dedupe key columns are fetched, and the set is scoped to the
    // employer when the scan is employer-scoped — loading every column of the
    // whole violation table blew the edge-function memory limit.
    const existingViolations = await fetchAllRows(
      supabase,
      "ce_violations",
      employerFilter ? "employer_id" : undefined,
      employerFilter || undefined,
      "employer_id, violation_type_id, period_from, status, is_deleted, discovered_date, created_at",
    );
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

    // ── Review-flag accumulator (Checkpoint B2) ──
    // Review flags are NOT violations. Existing OPEN/UNDER_REVIEW dedupe keys
    // are preloaded so re-running the scan against unchanged data never
    // produces a duplicate flag.
    const existingFlagRows = await fetchAllRows(
      supabase,
      "ce_compliance_review_flags",
      employerFilter ? "employer_id" : undefined,
      employerFilter || undefined,
      "dedupe_key, status",
    );
    const existingFlagKeys = new Set<string>(
      existingFlagRows
        .filter((r: any) => r.status === "OPEN" || r.status === "UNDER_REVIEW")
        .map((r: any) => r.dedupe_key),
    );
    const flags: CeReviewFlagRecord[] = [];
    const pushFlag = (record: CeReviewFlagRecord) => {
      if (existingFlagKeys.has(record.dedupe_key)) return;
      existingFlagKeys.add(record.dedupe_key);
      flags.push(record);
    };


    // ── Checkpoint B2 bulk loaders (DR-005..DR-013) ──
    const stripEmpPrefix = (v: any) => String(v ?? "").replace(/^EMP-/, "");

    const installmentRowsAll = await fetchAllRows(
      supabase,
      "ce_v_arrangement_installment_operational",
      employerFilter ? "employer_id" : undefined,
      employerFilter ? `EMP-${employerFilter}` : undefined,
    );
    const installmentsByEmp = new Map<string, any[]>();
    for (const r of installmentRowsAll) {
      const key = stripEmpPrefix(r.employer_id);
      let arr = installmentsByEmp.get(key);
      if (!arr) { arr = []; installmentsByEmp.set(key, arr); }
      arr.push(r);
    }

    const waivedArrangementIds = new Set<string>();
    {
      const { data: waivedType } = await supabase
        .from("ce_violation_resolution_types")
        .select("code")
        .eq("code", "WAIVED_RESOLVED_BY_AGREEMENT")
        .maybeSingle();
      if (waivedType) {
        const waivedViolations = await fetchAllRows(
          supabase,
          "ce_violations",
          undefined,
          undefined,
          "related_arrangement_id, resolution_type_code",
        );
        for (const v of waivedViolations) {
          if (v.resolution_type_code === "WAIVED_RESOLVED_BY_AGREEMENT" && v.related_arrangement_id) {
            waivedArrangementIds.add(String(v.related_arrangement_id));
          }
        }
      }
    }

    const exemptionsRowsAll = await fetchAllRows(
      supabase,
      "ce_contribution_exemptions",
      employerFilter ? "employer_id" : undefined,
      employerFilter || undefined,
    );
    const exemptionsByEmp = new Map<string, CeContributionExemption[]>();
    for (const r of exemptionsRowsAll) {
      const key = String(r.employer_id);
      const list = exemptionsByEmp.get(key) ?? [];
      list.push({
        personSsn: r.person_ssn,
        employerId: r.employer_id,
        fundCode: r.fund_code,
        effectiveFrom: String(r.effective_from).slice(0, 10),
        effectiveTo: r.effective_to ? String(r.effective_to).slice(0, 10) : null,
        status: r.status,
        authorityReference: r.authority_reference ?? undefined,
      });
      exemptionsByEmp.set(key, list);
    }

    const leadsByEmp = new Map<string, any[]>();
    {
      const leadRowsAll = await fetchAllRows(supabase, "ce_unregistered_employer_leads");
      for (const lead of leadRowsAll) {
        if (lead.status === "CLOSED" || lead.registered_employer_id) continue;
        const key = lead.matched_employer_id ? String(lead.matched_employer_id) : "__UNMATCHED__";
        const list = leadsByEmp.get(key) ?? [];
        list.push(lead);
        leadsByEmp.set(key, list);
      }
    }

    // Employer register used for DR-008 matching (trade name / legal name / address).
    const employerRegisterAll = await fetchAllRows(
      supabase,
      "au_er_master",
      employerFilter ? "regno" : undefined,
      employerFilter || undefined,
      "regno, name, trade_name, hq_addr1, hq_addr2, sector_code",
    );
    const employerRegister: CeEmployerRegisterEntry[] = employerRegisterAll.map((e: any) => ({
      employerId: e.regno,
      tradeName: e.trade_name || e.name || "",
      legalName: e.name ?? undefined,
      address: [e.hq_addr1, e.hq_addr2].filter(Boolean).join(", ") || undefined,
    }));
    const sectorCodeByEmp = new Map<string, string>();
    for (const e of employerRegisterAll) {
      if (e.sector_code) sectorCodeByEmp.set(String(e.regno), String(e.sector_code));
    }

    const { data: headcountTierRows } = await supabase
      .from("ce_headcount_tiers")
      .select("tier_code, tier_label, min_employer_size, max_employer_size, allowed_absolute_change, percentage_threshold, is_enabled, requires_client_confirmation")
      .order("sort_order");
    const headcountTiers: CeHeadcountTier[] = (headcountTierRows ?? []).map((t: any) => ({
      tierCode: t.tier_code,
      tierLabel: t.tier_label,
      minEmployerSize: Number(t.min_employer_size),
      maxEmployerSize: t.max_employer_size == null ? null : Number(t.max_employer_size),
      allowedAbsoluteChange: Number(t.allowed_absolute_change),
      percentageThreshold: t.percentage_threshold == null ? null : Number(t.percentage_threshold),
      isEnabled: t.is_enabled,
      requiresClientConfirmation: t.requires_client_confirmation,
    }));

    const { data: sectorBenchmarkRows } = await supabase
      .from("ce_sector_wage_benchmarks")
      .select(
        "id, sector_code, sector_label, calculated_minimum, calculated_average, sample_count, effective_from, effective_to, recalculated_at, override_minimum, override_average, override_reason, overridden_by, overridden_at, is_enabled",
      );
    const sectorBenchmarks: CeSectorBenchmark[] = (sectorBenchmarkRows ?? []).map((b: any) => ({
      id: b.id,
      sectorCode: b.sector_code,
      sectorLabel: b.sector_label ?? undefined,
      calculatedMinimum: b.calculated_minimum == null ? null : Number(b.calculated_minimum),
      calculatedAverage: b.calculated_average == null ? null : Number(b.calculated_average),
      sampleCount: Number(b.sample_count ?? 0),
      effectiveFrom: String(b.effective_from).slice(0, 10),
      effectiveTo: b.effective_to ? String(b.effective_to).slice(0, 10) : null,
      recalculatedAt: b.recalculated_at ?? null,
      overrideMinimum: b.override_minimum == null ? null : Number(b.override_minimum),
      overrideAverage: b.override_average == null ? null : Number(b.override_average),
      overrideReason: b.override_reason ?? null,
      overriddenBy: b.overridden_by ?? null,
      overriddenAt: b.overridden_at ?? null,
      isEnabled: b.is_enabled,
    }));

    // c3_submissions/line_items: used for DR-007 person/fund lines, DR-009 headcount
    // history and DR-010 wage observations. Employer id here is the internal uuid,
    // so it is joined back to the regno register via ce_v_employer_workforce-style
    // matching is not available; c3_submissions.employer_id is assumed to equal the
    // employer's regno-scoped identifier used elsewhere in ce_ tables.
    const c3SubmissionRows = await fetchAllRows(
      supabase,
      "c3_submissions",
      employerFilter ? "employer_id" : undefined,
      employerFilter || undefined,
      "id, employer_id, filing_period, total_employees, total_wages, submission_method",
    );
    const submissionById = new Map<string, any>();
    for (const sub of c3SubmissionRows) submissionById.set(String(sub.id), sub);

    const headcountHistoryByEmp = new Map<string, CeHeadcountObservation[]>();
    const wageObservationsByEmp = new Map<string, CeWageObservation>();
    const wageHistoryByEmp = new Map<string, CeWageObservation[]>();
    {
      const byEmpPeriod = new Map<string, any[]>();
      for (const sub of c3SubmissionRows) {
        const key = String(sub.employer_id);
        const list = byEmpPeriod.get(key) ?? [];
        list.push(sub);
        byEmpPeriod.set(key, list);
      }
      for (const [empId, subs] of byEmpPeriod) {
        const sorted = [...subs].sort((a, b) => (a.filing_period < b.filing_period ? -1 : 1));
        const hcObs: CeHeadcountObservation[] = sorted.map((sub) => ({
          employerId: empId,
          periodKey: String(sub.filing_period).slice(0, 7),
          reportedEmployees: Number(sub.total_employees ?? 0),
        }));
        headcountHistoryByEmp.set(empId, hcObs);

        const sectorCode = sectorCodeByEmp.get(empId);
        const wageObs: CeWageObservation[] = sorted
          .filter((sub) => Number(sub.total_employees) > 0)
          .map((sub) => ({
            employerId: empId,
            sectorCode,
            periodKey: String(sub.filing_period).slice(0, 7),
            averageWeeklyWage: Number(sub.total_wages ?? 0) / Number(sub.total_employees || 1),
            employeeCount: Number(sub.total_employees ?? 0),
          }));
        wageHistoryByEmp.set(empId, wageObs);
        if (wageObs.length > 0) wageObservationsByEmp.set(empId, wageObs[wageObs.length - 1]);
      }
    }

    const fundLinesByEmp = new Map<string, CeC3PersonFundLine[]>();
    {
      const c3LineRows = await fetchAllRows(
        supabase,
        "c3_line_items",
        undefined,
        undefined,
        "id, c3_id, employee_ssn, employee_name, wages_paid, ss_contribution, levy_contribution, under_age, over_age, invalid_ssn",
      );
      for (const line of c3LineRows) {
        const sub = submissionById.get(String(line.c3_id));
        if (!sub) continue;
        const empId = String(sub.employer_id);
        if (employerFilter && empId !== employerFilter) continue;
        const periodKey = String(sub.filing_period).slice(0, 7);
        const applicable =
          Number(line.wages_paid ?? 0) > 0 && !line.under_age && !line.over_age && !line.invalid_ssn;
        const ingestionSource =
          sub.submission_method === "online"
            ? "ONLINE"
            : sub.submission_method === "kiosk"
            ? "KIOSK"
            : sub.submission_method === "legacy_import"
            ? "LEGACY_IMPORT"
            : "PHYSICAL";
        const list = fundLinesByEmp.get(empId) ?? [];
        list.push({
          submissionId: String(sub.id),
          employerId: empId,
          personSsn: line.employee_ssn,
          personName: line.employee_name ?? undefined,
          periodKey,
          fundCode: "SS",
          applicable,
          contributionAmount: line.ss_contribution,
          wageAmount: Number(line.wages_paid ?? 0),
          ingestionSource,
        });
        list.push({
          submissionId: String(sub.id),
          employerId: empId,
          personSsn: line.employee_ssn,
          personName: line.employee_name ?? undefined,
          periodKey,
          fundCode: "LV",
          applicable,
          contributionAmount: line.levy_contribution,
          wageAmount: Number(line.wages_paid ?? 0),
          ingestionSource,
        });
        // No per-person severance column exists anywhere in the C3 line data —
        // the SV portion of DR-007 is reported via ruleDiagnostics and never
        // fabricated here (see markObligationConfigError below).
        fundLinesByEmp.set(empId, list);
      }
    }

    const statusStateByEmp = new Map<string, any>();
    {
      const statusRows = await fetchAllRows(
        supabase,
        "ce_employer_status_states",
        employerFilter ? "employer_id" : undefined,
        employerFilter || undefined,
      );
      for (const r of statusRows) statusStateByEmp.set(String(r.employer_id), r);
    }

    const obligationPeriodsByEmp = new Map<string, any[]>();
    {
      const obligationRows = await fetchAllRows(
        supabase,
        "ce_obligation_periods",
        employerFilter ? "employer_id" : undefined,
        employerFilter || undefined,
      );
      for (const r of obligationRows) {
        const key = String(r.employer_id);
        const list = obligationPeriodsByEmp.get(key) ?? [];
        list.push(r);
        obligationPeriodsByEmp.set(key, list);
      }
    }

    // Get all unique employer regnos from filing facts (primary list)
    let allEmployers = filings.map((f: any) => ({
      regno: f.regno,
      name: f.employer_name,
    }));

    // Apply limit/sample if specified
    if (employerLimit && employerLimit > 0 && allEmployers.length > employerLimit) {
      allEmployers = allEmployers.slice(0, employerLimit);
    }

    // ── Deterministic slice for this invocation ──
    // The full tenant (4k+ employers × 120 periods × rules) cannot be scanned
    // inside a single edge worker. Sort for a stable order, then process only
    // [employerOffset, employerOffset + batchSize) and chain the next slice.
    allEmployers.sort((a: any, b: any) => (String(a.regno) < String(b.regno) ? -1 : 1));
    const totalEmployers: number = allEmployers.length;
    const sliceStart = Math.max(0, employerOffset);
    const sliceEnd = Math.min(totalEmployers, sliceStart + batchSize);
    const batchEmployers = allEmployers.slice(sliceStart, sliceEnd);
    const hasMore = sliceEnd < totalEmployers;


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
     * DR-004 partial payment authorities are loaded for context and audit
     * reporting only. Neither a pending request nor an approved authority
     * suspends DR-003 or DR-004: the statutory deadline is immutable.
     */
    const authorityByEmp = new Map<string, Map<string, CePartialPaymentAuthority>>();
    {
      let q = supabase
        .from("ce_partial_payment_requests")
        .select(
          "employer_id, wage_period, status, approved_amount, settled_amount, authority_expires_on, requested_at",
        )
        .in("status", ["PENDING_APPROVAL", "APPROVED", "SETTLED", "EXPIRED"])
        .order("requested_at", { ascending: true });
      if (employerFilter) q = q.eq("employer_id", employerFilter);
      const { data, error } = await q;
      if (error) throw error;
      for (const row of data ?? []) {
        const regno = String(row.employer_id);
        const ym = String(row.wage_period).slice(0, 7);
        let m = authorityByEmp.get(regno);
        if (!m) {
          m = new Map();
          authorityByEmp.set(regno, m);
        }
        // Later rows win: the most recent governed decision is authoritative.
        m.set(ym, {
          status: row.status as CePartialPaymentAuthority["status"],
          approved_amount: row.approved_amount == null ? null : Number(row.approved_amount),
          settled_amount: row.settled_amount == null ? null : Number(row.settled_amount),
          authority_expires_on: row.authority_expires_on ?? null,
        });
      }
    }
    const authorityFor = (regno: string, ym: string): CePartialPaymentAuthority | null =>
      authorityByEmp.get(regno)?.get(ym) ?? null;



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
      // Fail-closed on configuration: a rule whose required parameters cannot
      // be resolved from configuration is NOT executed with a code default —
      // it is skipped and reported, so every produced violation is explainable.
      if (configErrorRuleIds.has(rule.id)) continue;
      const params = paramsByRuleId.get(rule.id) ?? {};
      const initialStatus = rule.auto_create_violation ? "OPEN" : "UNDER_REVIEW";
      const asOfPeriod = asOfDate.slice(0, 7);

      // ── DR-013 self-employed / voluntary non-compliance ──
      // Runs ONCE per rule over ce_self_employed_obligations, never per
      // employer: self-employed persons are not employer-scoped.
      if (rule.trigger_event === "self_employed_non_compliance") {
        if (obligationPolicyError) {
          markObligationConfigError(rule.rule_code, obligationPolicyError);
          continue;
        }
        const policy = timelinePolicyFor(0, null);
        const seConfig = {
          includeVoluntary: params.include_voluntary === true,
          consolidateReminders: params.consolidate_reminders === true,
          autoLegalEscalation: false, // St Kitts policy: never automatic.
          overContributionCreatesCredit: params.over_contribution_creates_credit === true,
          flagEmployerOverlap: params.flag_employer_overlap === true,
        };
        const { data: seRows } = await supabase
          .from("ce_self_employed_obligations")
          .select("*")
          .eq("suppressed", false);
        const obligations: CeSelfEmployedObligation[] = (seRows ?? []).map((o: any) => ({
          obligationId: o.id,
          personSsn: o.person_ssn,
          personName: o.person_name ?? undefined,
          contributorType: o.contributor_type,
          periodKey: String(o.wage_period).slice(0, 7),
          expectedAmount: Number(o.expected_amount ?? 0),
          declaredAmount: Number(o.declared_amount ?? 0),
          paidAmount: Number(o.paid_amount ?? 0),
          filingReceivedDate: o.filing_received_date ?? null,
          paymentReceivedDate: o.payment_received_date ?? null,
          suppressed: o.suppressed === true,
          employerReported: o.employer_reported === true,
          employerReportedBy: o.employer_reported_by ?? undefined,
        }));

        const evaluations = obligations.map((o) => evaluateSelfEmployedObligation(o, policy, seConfig, asOfDate));
        const reminders = consolidateSelfEmployedReminders(evaluations, obligations, seConfig);

        // One consolidated violation/reminder per person across all outstanding periods.
        for (const reminder of reminders) {
          const emp = { regno: reminder.personSsn, name: reminder.personSsn };
          const earliestPeriod = reminder.periods[0];
          const periodFromYm = earliestPeriod ? `${earliestPeriod}-01` : `${asOfPeriod}-01`;
          const dedupeKey = `${emp.regno}|${rule.violation_type_id}|${periodKey(periodFromYm)}`;
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
              summary: reminder.summary,
              period_from: periodFromYm,
              source_type: "DETECTION_RULE",
              source_rule_id: rule.id,
              skipped: true,
              skip_reason: "Unresolved violation already exists",
            });
            continue;
          }
          detected.push({
            rule_code: rule.rule_code,
            rule_name: rule.name,
            employer_id: emp.regno,
            employer_name: emp.name,
            violation_type_id: rule.violation_type_id,
            violation_type_code: rule.violation_type_code || "UNKNOWN",
            status: initialStatus,
            priority: rule.priority || "Medium",
            summary: reminder.summary,
            period_from: periodFromYm,
            source_type: "DETECTION_RULE",
            source_rule_id: rule.id,
          });
          existingSet.add(dedupeKey);
        }

        // Over-contribution -> credit drafts (CREDIT_OFFSET only, never auto-refund).
        if (!dryRun) {
          const credits = computeOverContributionCredits(obligations, seConfig);
          for (const c of credits) {
            const { data: existingCredit } = await supabase
              .from("ce_contribution_credits")
              .select("id")
              .eq("person_ssn", c.personSsn)
              .eq("wage_period", `${c.periodKey}-01`)
              .eq("source_type", c.sourceType)
              .eq("status", "OPEN")
              .maybeSingle();
            if (existingCredit) continue;
            await supabase.from("ce_contribution_credits").insert({
              person_ssn: c.personSsn,
              wage_period: `${c.periodKey}-01`,
              source_type: c.sourceType,
              amount: c.amount,
              status: "OPEN",
              notes: c.summary,
            });
          }
        }

        // Employer-overlap and multi-employer-reporting review flags.
        const employerReported: CeEmployerReportedPeriod[] = obligations
          .filter((o) => o.employerReported && o.employerReportedBy)
          .map((o) => ({ personSsn: o.personSsn, periodKey: o.periodKey, employerId: o.employerReportedBy! }));
        for (const overlap of detectEmployerOverlap(obligations, employerReported, seConfig)) {
          pushFlag(buildSelfEmployedOverlapFlag(overlap, rule.rule_code, rule.id));
        }
        for (const multi of detectMultiEmployerReporting(employerReported)) {
          pushFlag(buildMultiEmployerFlag(multi, rule.rule_code, rule.id));
        }

        continue;
      }


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

      for (const emp of batchEmployers) {
        const filing = filingMap.get(emp.regno) as any;
        const payment = paymentMap.get(emp.regno) as any;
        const arrear = arrearMap.get(emp.regno) as any;
        const wf = workforceMap.get(emp.regno) as any;


        let shouldFlag = false;
        let summary = "";
        let periodFrom: string | undefined;

        switch (rule.trigger_event) {
          case "c3_deadline_passed": {
            // DR-001 Late Filing. Requires an ACTUAL filing received after the
            // resolved deadline (+ grace). A missing filing is NEVER late here —
            // it is DR-002 Unreported. Deadline comes from the shared resolver.
            if (obligationPolicyError) {
              markObligationConfigError(rule.rule_code, obligationPolicyError);
              shouldFlag = false;
              break;
            }
            const cap = Math.min(ABSOLUTE_CAP_MONTHS, Number(params.lookback_months ?? ABSOLUTE_CAP_MONTHS));
            const policy = timelinePolicyFor(Number(params.grace_period_days), params.submission_due_day);
            const c3 = c3ByEmp.get(emp.regno);
            if (c3) {
              const win = windowFor(emp.regno, cap);
              for (const [ym, rec] of c3) {
                if (!rec.received || ym < win.from || ym > win.to) continue;
                const timeline = resolveObligationTimeline(ym, policy, "C3_FILING");
                const received = iso(rec.received)!;
                const outcome = evaluateFilingObligation({
                  timeline,
                  filingReceivedDate: received,
                  asOf: asOfDate,
                });
                if (outcome === "FILED_LATE") {
                  pushPeriod(
                    emp,
                    ym,
                    `Late filing: C3 for ${ym} received ${received}, after the permitted date ${timeline.grace_end_date} (due ${timeline.due_date}, ${timeline.grace_days}d grace, basis ${timeline.deadline_basis}).`,
                  );
                }
              }
            }

            shouldFlag = false;
            break;
          }


          case "c3_missing_30_days": {
            // DR-002 Unreported C3. Per-period emission so each missing month
            // gets its own row. The deadline comes from the shared resolver; the
            // rule parameter only adds days AFTER the resolved breach date.
            if (obligationPolicyError) {
              markObligationConfigError(rule.rule_code, obligationPolicyError);
              shouldFlag = false;
              break;
            }
            const cap = Math.min(ABSOLUTE_CAP_MONTHS, Number(params.lookback_months ?? ABSOLUTE_CAP_MONTHS));
            const minMissed = Number(params.min_missed_months);
            const extraDays = Number(params.days_past_deadline) || 0;
            const policy = timelinePolicyFor(
              Number(activePolicy?.c3_grace_period_days ?? 0),
              params.submission_due_day,
            );

            // Filed periods come from the bulk prefetch above — a NIL return is a
            // filed return, so it can never produce an unreported violation.
            const filedSet = filedPeriodsByEmp.get(emp.regno) ?? new Set<string>();

            const today = new Date(asOfDate);
            // Window starts at the employer's compliance start (registration /
            // first wages paid), bounded by the rule's safety cap.
            const startYm = complianceStartByEmp.get(emp.regno);
            const sinceStart = startYm ? monthsBetween(startYm, today) : cap;
            const lookback = Math.max(0, Math.min(cap, sinceStart));
            const missing: Array<{ ym: string; breachDate: string }> = [];
            for (let i = 1; i <= lookback; i++) {
              const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
              const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              if (startYm && ym < startYm) continue;
              if (filedSet.has(ym)) continue;
              const timeline = resolveObligationTimeline(ym, policy, "C3_FILING");
              const breachDate = extraDays > 0
                ? addDays(timeline.violation_effective_date, extraDays)
                : timeline.violation_effective_date;
              const outcome = evaluateFilingObligation({
                timeline,
                filingReceivedDate: null,
                asOf: asOfDate,
              });
              if (outcome === "UNREPORTED" && asOfDate >= breachDate) {
                missing.push({ ym, breachDate });
              }
            }


            if (missing.length >= minMissed) {
              for (const { ym, breachDate } of missing) {
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
                  summary: `Unreported C3: no return (including NIL) submitted for ${ym}; obligation in breach from ${breachDate}.`,
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
            // DR-003 Non-Payment: a declared C3 with no money received once the
            // resolved payment deadline (+ grace) has passed.
            if (obligationPolicyError) {
              markObligationConfigError(rule.rule_code, obligationPolicyError);
              shouldFlag = false;
              break;
            }
            const cap = Math.min(ABSOLUTE_CAP_MONTHS, Number(params.lookback_months ?? ABSOLUTE_CAP_MONTHS));
            const policy = timelinePolicyFor(Number(params.grace_period_days), params.payment_due_day);
            const c3 = c3ByEmp.get(emp.regno);
            const paid = payByEmp.get(emp.regno);
            if (c3) {
              const win = windowFor(emp.regno, cap);
              for (const [ym, rec] of c3) {
                if (rec.declared <= 0 || ym < win.from || ym > win.to) continue;
                const timeline = resolveObligationTimeline(ym, policy, "CONTRIBUTION_PAYMENT");
                const outcome = evaluatePaymentObligation({
                  timeline,
                  declaredAmount: rec.declared,
                  paidAmount: paid?.get(ym) || 0,
                  asOf: asOfDate,
                });
                if (outcome === "NOT_PAID") {
                  // A pending or approved partial payment request never
                  // suspends DR-003 — the statutory deadline still applies.
                  pushPeriod(
                    emp,
                    ym,
                    `Non-payment: contributions of $${rec.declared.toLocaleString()} declared for ${ym} but no payment received by ${timeline.grace_end_date} (due ${timeline.due_date}, basis ${timeline.deadline_basis}).`,
                  );
                }
              }
            }
            shouldFlag = false;
            break;
          }

          case "payment_partial": {
            // DR-004 Partial Payment: a shortfall against the declared
            // liability still outstanding after the resolved statutory
            // deadline. There is no percentage or amount threshold, and no
            // partial payment request or approval can postpone the deadline.
            if (obligationPolicyError) {
              markObligationConfigError(rule.rule_code, obligationPolicyError);
              shouldFlag = false;
              break;
            }
            const cap = Math.min(ABSOLUTE_CAP_MONTHS, Number(params.lookback_months ?? ABSOLUTE_CAP_MONTHS));
            const policy = timelinePolicyFor(Number(params.grace_period_days), params.payment_due_day);
            const c3 = c3ByEmp.get(emp.regno);
            const paid = payByEmp.get(emp.regno);
            if (c3 && paid) {
              const win = windowFor(emp.regno, cap);
              for (const [ym, rec] of c3) {
                if (rec.declared <= 0 || ym < win.from || ym > win.to) continue;
                const amountPaid = paid.get(ym) || 0;
                const timeline = resolveObligationTimeline(ym, policy, "CONTRIBUTION_PAYMENT");
                const authority = authorityFor(emp.regno, ym);
                const outcome = evaluatePartialPaymentObligation({
                  graceEndDate: timeline.grace_end_date,
                  declaredAmount: rec.declared,
                  paidAmount: amountPaid,
                  asOf: asOfDate,
                  authority,
                });
                if (!isPartialPaymentViolation(outcome)) continue;
                const shortfall = rec.declared - amountPaid;
                const reason = authority
                  ? `partial payment authority ${authority.status} — the statutory deadline is unchanged`
                  : "the shortfall remains unsettled";
                pushPeriod(
                  emp,
                  ym,
                  `Partial payment: ${ym} declared $${rec.declared.toLocaleString()}, paid $${amountPaid.toLocaleString()}, shortfall $${shortfall.toLocaleString()} unsettled after ${timeline.grace_end_date} — ${reason}.`,
                );
              }
            }

            shouldFlag = false;
            break;

          }


          case "repeat_violation_check": {
            // DR-005: pure repeatOffender module. Occurrences of the
            // repeat-offender rule's OWN violation type never feed the count.
            const occurrences: CeRepeatOccurrence[] = unresolvedViolations
              .concat(
                params.include_resolved_occurrences
                  ? existingViolations.filter((v: any) => v.is_deleted === false && !unresolvedViolations.includes(v))
                  : [],
              )
              .filter((v: any) => v.employer_id === emp.regno && v.violation_type_id !== rule.violation_type_id)
              .map((v: any) => ({
                violationId: v.id,
                employerId: v.employer_id,
                employerName: emp.name,
                violationTypeId: v.violation_type_id,
                violationTypeCode: v.violation_type_code ?? "UNKNOWN",
                occurredOn: (v.discovered_date ?? v.created_at ?? asOfDate).slice(0, 10),
                periodKey: v.period_from ? String(v.period_from).slice(0, 7) : undefined,
                resolved: !["OPEN", "IN_PROGRESS", "ESCALATED", "UNDER_REVIEW"].includes(v.status),
              }));
            const results = evaluateRepeatOffender(
              occurrences,
              {
                threshold: Number(params.violation_count_threshold),
                rollingMonths: Number(params.rolling_months),
                sameTypeOnly: params.same_type_only === true,
                requireConsecutive: params.require_consecutive === true,
                includeResolvedOccurrences: params.include_resolved_occurrences === true,
              },
              asOfDate,
            );
            for (const r of results) pushFlag(buildRepeatOffenderFlag(r, rule.rule_code, rule.id));
            shouldFlag = false;
            break;
          }

          case "installment_overdue": {
            // DR-006: pure arrangementBreach module over per-installment data.
            const config = {
              graceDaysAfterInstallment: Number(params.grace_days_after_installment),
              reminderLeadDays: Number(params.reminder_lead_days),
              partialInstallmentIsBreach: params.partial_installment_is_breach === true,
            };
            const installmentRows = installmentsByEmp.get(emp.regno) || [];
            const installments: CeInstallment[] = installmentRows
              .filter((i: any) => !waivedArrangementIds.has(String(i.arrangement_id)))
              .map((i: any) => ({
                installmentId: i.installment_id,
                arrangementId: i.arrangement_id,
                employerId: emp.regno,
                installmentNumber: Number(i.installment_number ?? 0),
                dueDate: String(i.due_date).slice(0, 10),
                amount: Number(i.scheduled_amount ?? 0),
                paidAmount: Number(i.paid_amount ?? 0),
                paidDate: i.paid_date ?? null,
              }));
            const evaluations = evaluateArrangementInstallments(installments, config, asOfDate);
            for (const e of evaluations) {
              if (!isBreach(e.outcome)) continue;
              const ym = e.breachDate ? e.breachDate.slice(0, 7) : asOfPeriod;
              pushPeriod(emp, ym, `Arrangement breach: ${e.summary}`);
            }
            const reminders = planInstallmentReminders(installments, config, asOfDate);
            if (!dryRun) {
              for (const r of reminders) {
                await supabase
                  .from("ce_arrangement_installment_reminders")
                  .upsert(
                    {
                      installment_id: r.installmentId,
                      arrangement_id: r.arrangementId,
                      employer_id: r.employerId,
                      installment_due_date: r.installmentDueDate,
                      reminder_date: r.reminderDate,
                      lead_days: r.leadDays,
                      status: "PENDING",
                    },
                    { onConflict: "installment_id,reminder_date", ignoreDuplicates: true },
                  );
              }
            }
            shouldFlag = false;
            break;
          }

          case "levy_omission_check":
          case "severance_omission_check": {
            // DR-007: pure fundOmission module over C3 person/fund lines.
            // The retired generic-arrears/min_outstanding_amount_xcd test
            // never reappears here.
            const checkFunds = (params.check_funds as CeFundCode[]) ?? [];
            const zeroThreshold = Number(params.zero_threshold ?? 0);
            // Severance has no per-person source column on the C3 line record.
            // Rather than fabricate an expected severance amount, the gap is
            // reported as a configuration/data-source issue and the SV portion
            // of the rule is skipped.
            if (checkFunds.includes("SV" as CeFundCode)) {
              markObligationConfigError(
                rule.rule_code,
                "Severance (SV) is configured in check_funds but C3 person lines carry no per-person severance contribution column; the SV portion of DR-007 is skipped until a severance line source exists.",
              );
            }
            const lines = fundLinesByEmp.get(emp.regno) || [];
            if (lines.length === 0) {
              markObligationConfigError(
                rule.rule_code,
                `No person-level C3 line data available for employer ${emp.regno}; period skipped rather than falling back to arrears.`,
              );
              shouldFlag = false;
              break;
            }
            const exemptions = exemptionsByEmp.get(emp.regno) || [];
            const omissions = evaluateFundOmissions(
              lines.filter((l) => checkFunds.includes(l.fundCode)),
              exemptions,
              { checkFunds, zeroThreshold },
            );
            for (const o of omissions) {
              pushPeriod(emp, o.periodKey, o.summary);
            }
            shouldFlag = false;
            break;
          }

          case "registration_not_found": {
            // DR-008: pure unregisteredEmployer module over scouting/inspection leads.
            const leadRows = leadsByEmp.get(emp.regno) || [];
            for (const lead of leadRows) {
              const scoutingLead: CeScoutingLead = {
                leadId: lead.id,
                tradeName: lead.trade_name,
                businessAddress: lead.business_address ?? undefined,
                discoveredDate: String(lead.discovered_date).slice(0, 10),
                sourceType: (lead.source_type as any) ?? "INSPECTION",
                sourceReference: lead.source_reference ?? undefined,
                status: lead.status,
                instructedAt: lead.instructed_at,
                registeredEmployerId: lead.registered_employer_id,
                legalRecommended: lead.legal_recommended,
                legalApprovedBy: lead.legal_approved_by,
              };
              const ev = evaluateLead(
                scoutingLead,
                employerRegister,
                { matchOnTradeName: params.match_on_trade_name === true, matchOnAddress: params.match_on_address === true },
                { registrationResponseDays: Number(params.registration_response_days), managementEscalationDays: Number(params.management_escalation_days) },
                asOfDate,
              );
              if (ev.action === "RAISE_REVIEW_FLAG") {
                pushFlag(buildUnregisteredLeadFlag(ev, scoutingLead, rule.rule_code, rule.id));
              }
              if (!dryRun && ev.action === "ESCALATE_TO_MANAGEMENT" && lead.status !== "ESCALATED") {
                await supabase.from("ce_unregistered_employer_leads").update({ status: "ESCALATED", escalated_at: asOfDate }).eq("id", lead.id);
              }
            }
            shouldFlag = false;
            break;
          }

          case "employee_underreporting": {
            // DR-009: pure headcountAnomaly module against configured tiers.
            if (wf) {
              const disc = evaluateHeadcountDiscrepancy(
                {
                  employerId: emp.regno,
                  employerName: emp.name,
                  periodKey: wf.last_reported_period ?? asOfPeriod,
                  registeredEmployees: Number(wf.registered_total ?? 0),
                  reportedEmployees: Number(wf.last_reported_employees ?? 0),
                },
                headcountTiers,
                {
                  useSizeTiers: params.use_size_tiers === true,
                  fallbackMinEmployeeDelta: params.min_employee_delta,
                  fallbackMinDiscrepancyPercent: params.min_discrepancy_percent,
                },
              );
              if (disc) pushFlag(buildHeadcountFlag(disc, rule.rule_code, rule.id));

              const history = headcountHistoryByEmp.get(emp.regno) || [];
              const anomaly = evaluateHistoricalHeadcountAnomaly(
                history,
                { employerId: emp.regno, employerName: emp.name, periodKey: wf.last_reported_period ?? asOfPeriod, reportedEmployees: Number(wf.last_reported_employees ?? 0) },
                {
                  historicalBaselinePeriods: Number(params.historical_baseline_periods),
                  minEmployerSizeForPercentage: Number(params.min_employer_size_for_percentage),
                  historicalChangePercent: Number(params.historical_change_percent),
                  historicalChangeAbsolute: Number(params.historical_change_absolute),
                },
              );
              if (anomaly) pushFlag(buildHeadcountFlag(anomaly, rule.rule_code, rule.id));
            }
            shouldFlag = false;
            break;
          }

          case "wage_underreporting": {
            // DR-010: pure wageAnomaly module against sector benchmarks and history.
            const obs = wageObservationsByEmp.get(emp.regno);
            if (obs) {
              const wageConfig = {
                enableSectorBenchmark: params.enable_sector_benchmark === true,
                enableHistoricalVariance: params.enable_historical_variance === true,
                benchmarkVariancePercent: Number(params.benchmark_variance_percent),
                historicalVariancePercent: Number(params.historical_variance_percent),
                lookbackPeriods: Number(params.lookback_periods),
                benchmarkRecalcMonths: Number(params.benchmark_recalc_months),
              };
              const bench = evaluateSectorBenchmark(obs, sectorBenchmarks, wageConfig);
              if (bench) pushFlag(buildWageFlag(bench, rule.rule_code, rule.id));
              const hist = wageHistoryByEmp.get(emp.regno) || [];
              const variance = evaluateHistoricalWageVariance(hist, obs, wageConfig);
              if (variance) pushFlag(buildWageFlag(variance, rule.rule_code, rule.id));
            }
            shouldFlag = false;
            break;
          }

          case "employer_cessation": {
            // DR-011: pure employerStatusRules module. Authoritative status
            // state is preferred; the legacy view status is only a fallback.
            const authoritative = statusStateByEmp.get(emp.regno);
            const status = (authoritative?.status ?? filing?.employer_status) as any;
            if (!authoritative) {
              markObligationConfigError(rule.rule_code, `No authoritative ce_employer_status_states row for ${emp.regno}; falling back to the legacy filing-status column.`);
            }
            const cessationInput: CeCessationInput = {
              employerId: emp.regno,
              employerName: emp.name,
              status,
              effectiveDate: authoritative?.effective_date ?? asOfDate,
              outstandingAmount: Number(arrear?.total_outstanding ?? 0),
              clearanceCertificateReference: authoritative?.clearance_certificate_reference ?? null,
              openObligationPeriods: (obligationPeriodsByEmp.get(emp.regno) || []).filter((o: any) => o.is_outstanding).map((o: any) => o.reporting_period),
              openViolationCount: unresolvedViolations.filter((v: any) => v.employer_id === emp.regno).length,
            };
            const finding = evaluateImproperCessation(cessationInput, {
              triggerOnStatus: params.trigger_on_status,
              requireClearanceCertificate: params.require_clearance_certificate === true,
              minOutstandingAmountXcd: Number(params.min_outstanding_amount_xcd),
            });
            if (finding) {
              shouldFlag = true;
              summary = finding.summary;
              periodFrom = asOfPeriod;
            }
            break;
          }

          case "contribution_gap_detected": {
            // DR-012: pure employerStatusRules.evaluateContributionGap module,
            // driven by the real obligation history (ce_obligation_periods),
            // never the "two missed months" heuristic. This is a VIOLATION,
            // not a review flag.
            const history: CeObligationHistoryEntry[] = (obligationPeriodsByEmp.get(emp.regno) || []).map(
              (o: any) => ({
                periodKey: String(o.wage_period).slice(0, 7),
                expected: true,
                filingReceived: o.filing_status === "FILED_ON_TIME" || o.filing_status === "FILED_LATE",
                contributionPaid: o.payment_status === "PAID_IN_FULL",
              }),
            );
            const gapFinding = evaluateContributionGap(emp.regno, history, {
              minMissedMonths: Number(params.min_missed_months),
              daysPastDeadline: Number(params.days_past_deadline) || 0,
            });
            if (gapFinding) {
              shouldFlag = true;
              summary = gapFinding.summary;
              periodFrom = gapFinding.gapPeriods[gapFinding.gapPeriods.length - 1]
                ? `${gapFinding.gapPeriods[gapFinding.gapPeriods.length - 1]}-01`
                : asOfPeriod;
            }
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
    let skippedCount = detected.filter((d) => d.skipped).length;

    // ── SSB penalty policy: enrich each detected row with principal/penalty/
    // interest/total using the active ce_compliance_policies row and each
    // employer's most recent C3 totals. The estimation basis (how many periods
    // and what multiplier) is owned by ce_calculation_rules CR-003 — nothing
    // about the estimate is hard-coded here.
    const { data: crRows } = await supabase
      .from("ce_calculation_rules")
      .select("id, rule_code, parameters, is_enabled, updated_at")
      .eq("rule_code", "CR-003")
      .limit(1);
    const cr003 = crRows?.[0] ?? null;
    const cr003Resolved = resolveRuleParameters(
      CALCULATION_PARAM_SPEC["CR-003"],
      cr003?.parameters,
      activePolicy,
    );
    if (!cr003 || cr003.is_enabled === false) {
      cr003Resolved.errors.push("Calculation rule CR-003 is missing or disabled — estimated assessments cannot be priced.");
    }
    const cr003Ok = cr003Resolved.errors.length === 0;
    if (!cr003Ok) {
      console.error(`[ce-violation-scan] CONFIGURATION ERROR CR-003: ${cr003Resolved.errors.join(" | ")}`);
    }
    ruleDiagnostics.push({
      rule_code: "CR-003",
      rule_id: cr003?.id ?? "",
      trigger_event: "calculation:estimated_assessment",
      config_updated_at: cr003?.updated_at ?? null,
      effective_parameters: cr003Resolved.values,
      parameter_sources: cr003Resolved.sources,
      status: cr003Ok ? "ok" : "configuration_error",
      ...(cr003Ok ? {} : { errors: cr003Resolved.errors }),
    });
    const historyPeriodCount = Number(cr003Resolved.values.history_period_count);
    const estimateMultiplier = Number(cr003Resolved.values.estimate_multiplier);

    const empIds = Array.from(new Set(newViolations.map((v) => v.employer_id).filter(Boolean)));
    const historyByEmp = new Map<string, number[]>();
    if (cr003Ok && empIds.length > 0) {
      // Pull the employer's most recent known C3 filings. Rows are aggregated
      // per (employer, period) first — a period can carry several C3 lines —
      // then the configured number of most recent periods forms the basis.

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
        const recent = Array.from(byPeriod.entries())
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .slice(0, historyPeriodCount)
          .map(([, v]) => v);
        if (recent.length > 0) historyByEmp.set(empId, recent);
      }
    }

    for (const v of newViolations) {
      const known = /arrears|outstanding|arrangement/i.test(v.summary)
        ? extractLeadingCurrency(v.summary)
        : undefined;
      const amounts = computeViolationAmounts({
        policy: activePolicy,
        history: historyByEmp.get(v.employer_id) || [],
        estimateMultiplier,
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

        let { data: inserted, error: insertError } = await supabase
          .from("ce_violations")
          .insert(rows)
          .select("id");

        if (insertError) {
          // A single conflicting row (active-violation dedupe index or a
          // violation-number collision) must not abort the whole scan.
          // Fall back to row-by-row inserts and skip only the conflicts.
          const isConflict =
            (insertError as any).code === "23505" ||
            /duplicate key/i.test(insertError.message || "");
          if (!isConflict) throw insertError;

          const salvaged: any[] = [];
          for (const row of rows) {
            const { data: one, error: oneErr } = await supabase
              .from("ce_violations")
              .insert({ ...row, violation_number: generateViolationNumber() })
              .select("id")
              .maybeSingle();
            if (oneErr) {
              const dup =
                (oneErr as any).code === "23505" ||
                /duplicate key/i.test(oneErr.message || "");
              if (dup) {
                skippedCount += 1;
                continue;
              }
              throw oneErr;
            }
            if (one) salvaged.push(one);
          }
          inserted = salvaged;
        }
        insertedCount += inserted?.length || 0;


        // Auto-route the whole batch in a single database round trip.
        // Routing each violation individually meant tens of thousands of
        // sequential RPC calls, which exhausted the edge worker wall-clock
        // and left the run stuck in "Running".
        const insertedIds = (inserted || []).map((ins: any) => ins.id);
        if (insertedIds.length > 0) {
          const { data: routed, error: routeErr } = await supabase.rpc(
            "fn_ce_route_violations_bulk",
            { p_violation_ids: insertedIds },
          );
          if (!routeErr) routedCount += Number(routed || 0);
        }
      }
    }

    // ── Review-flag persistence ────────────────────────────────────────────
    // Review flags are review items, NOT confirmed violations. They are
    // upserted on their deterministic dedupe key, so re-running detection over
    // unchanged data produces zero additional flags.
    let flagsCreated = 0;
    if (!dryRun && flags.length > 0) {
      for (let i = 0; i < flags.length; i += 200) {
        const slice = flags.slice(i, i + 200);
        const { data: upserted, error: flagErr } = await supabase
          .from("ce_compliance_review_flags")
          .upsert(slice, { onConflict: "dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (flagErr) {
          console.error("[ce-violation-scan] review flag upsert failed", flagErr.message);
        } else {
          flagsCreated += upserted?.length || 0;
        }
      }
    }


    // Build by-rule breakdown for this slice, merged with earlier slices
    const batchByRule = enrichedRules.map((r) => ({
      rule_code: r.rule_code,
      rule_name: r.name,
      detected: detected.filter((d) => d.rule_code === r.rule_code && !d.skipped).length,
      skipped: detected.filter((d) => d.rule_code === r.rule_code && d.skipped).length,
      total: detected.filter((d) => d.rule_code === r.rule_code).length,
    }));

    const cumulative: ScanCarry = {
      total_employers_scanned: carry.total_employers_scanned + batchEmployers.length,
      violations_detected: carry.violations_detected + detected.length,
      violations_created: carry.violations_created + (dryRun ? 0 : insertedCount),
      violations_routed: carry.violations_routed + (dryRun ? 0 : routedCount),
      violations_skipped_dedupe: carry.violations_skipped_dedupe + skippedCount,
      violations_would_create: carry.violations_would_create + newViolations.length,
      review_flags_created: carry.review_flags_created + flagsCreated,
      review_flags_would_create: (carry.review_flags_would_create ?? 0) + flags.length,
      by_rule: mergeByRule(carry.by_rule, batchByRule),
      sample_violations:
        carry.sample_violations.length >= 20
          ? carry.sample_violations
          : carry.sample_violations.concat(detected.slice(0, 20 - carry.sample_violations.length)),
    };

    const runResult = {
      ...cumulative,
      rules_evaluated: enrichedRules.length,
    };

  if (hasMore) {
    // Persist progress and hand the next slice to a fresh worker.
    await supabase
      .from("ce_automation_runs")
      .update({
        status: "Running",
        records_processed: cumulative.total_employers_scanned,
        records_affected: cumulative.violations_created,
        execution_log: {
          ...runResult,
          dry_run: dryRun,
          force,
          in_progress: true,
          heartbeat_at: new Date().toISOString(),

          employers_total: totalEmployers,
          employers_done: sliceEnd,
          progress_percent: Math.round((sliceEnd / Math.max(1, totalEmployers)) * 100),
          sample_violations: cumulative.sample_violations,
          rule_diagnostics: ruleDiagnostics,
          configuration_errors: ruleDiagnostics.filter((d) => d.status !== "ok"),
        },
      })
      .eq("id", runId);

    const nextUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ce-violation-scan`;
    const nextBody = JSON.stringify({
      continue_run_id: runId,
      employer_offset: sliceEnd,
      batch_size: batchSize,
      carry: cumulative,
      dry_run: dryRun,
      force,
      as_of_date: asOfDate,
      employer_id: employerFilter,
      limit: employerLimit,
      triggered_by: triggeredBy,
    });

    // The chain hop is the single point of failure for a long scan: a
    // transient 503 from the edge runtime used to abandon the run mid-way and
    // leave the UI waiting. Retry with bounded backoff before giving up.
    let lastStatus = 0;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt));
      try {
        const res = await fetch(nextUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: nextBody,
        });
        if (res.ok) return;
        lastStatus = res.status;
        // 4xx other than 429 will not succeed on retry.
        if (res.status < 500 && res.status !== 429) break;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(
      `Failed to chain next employer batch after retries (HTTP ${lastStatus || "network"}${
        lastErr ? `: ${(lastErr as Error).message}` : ""
      })`,
    );
  }


  // Update run record — final slice
  await supabase
    .from("ce_automation_runs")
    .update({
      completed_at: new Date().toISOString(),
      status: "Completed",
      records_processed: cumulative.total_employers_scanned,
      records_affected: dryRun ? 0 : cumulative.violations_created,
      execution_log: {
        ...runResult,
        dry_run: dryRun,
        force,
        in_progress: false,
        employers_total: totalEmployers,
        employers_done: sliceEnd,
        progress_percent: 100,
        sample_violations: cumulative.sample_violations,
        rule_diagnostics: ruleDiagnostics,
        configuration_errors: ruleDiagnostics.filter((d) => d.status !== "ok"),
        policy_snapshot: activePolicy,
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


