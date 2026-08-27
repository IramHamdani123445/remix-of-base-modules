/**
 * Contribution Snapshot Service
 *
 * Builds/refreshes `bn_claim_contribution_snapshot` from `ip_wages` so that
 * contribution-based eligibility facts can resolve deterministically.
 *
 * Call `ensureContributionSnapshot(claimId, opts)` BEFORE evaluating any rule
 * whose fact has `requires_snapshot = true`.
 */
import { supabase } from '@/integrations/supabase/client';

const db = supabase as any;

export interface SnapshotResult {
  claim_id: string;
  ssn: string;
  total_weeks: number;
  paid_weeks: number;
  credited_weeks: number;
  average_weekly_wage: number;
  window_13: number;
  window_26: number;
  window_39: number;
  window_52: number;
  window_12m: number;
  period_from: string | null;
  period_to: string | null;
  captured_at: string;
  refreshed: boolean;
}

function isoMinusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function loadClaim(claimId: string) {
  const { data } = await db.from('bn_claim').select('id, ssn, claim_date').eq('id', claimId).maybeSingle();
  return data ?? null;
}

async function loadWages(ssn: string) {
  // Pull up to 2000 most-recent weeks. ip_wages is week-grained ("period").
  const { data, error } = await db
    .from('ip_wages')
    .select('period, wages_paid1, wages_paid2, wages_paid3, wages_paid4, wages_paid5, wages_paid6, wages_paid7, paid_code1, paid_code2, paid_code3, paid_code4, paid_code5, paid_code6, paid_code7')
    .eq('ssn', ssn)
    .order('period', { ascending: false })
    .limit(2000);
  // BUG-48 — the error was discarded and an empty array returned, so a failed
  // read counted as "this claimant has no contributions" and failed every
  // minimum-weeks rule against her.
  if (error) throw new Error(`ip_wages could not be read: ${error.message}`);
  return (data as any[]) ?? [];
}

function weekIsPaid(row: any): boolean {
  for (let i = 1; i <= 7; i++) {
    const w = Number(row[`wages_paid${i}`] ?? 0);
    if (w > 0) return true;
  }
  return false;
}

function weekIsCredited(row: any): boolean {
  // Credit codes (C/Y/etc.) — treat any non-empty paid_code with zero wages as credited.
  for (let i = 1; i <= 7; i++) {
    const c = String(row[`paid_code${i}`] ?? '').trim();
    const w = Number(row[`wages_paid${i}`] ?? 0);
    if (c && w === 0) return true;
  }
  return false;
}

function weekWage(row: any): number {
  let t = 0;
  for (let i = 1; i <= 7; i++) t += Number(row[`wages_paid${i}`] ?? 0);
  return t;
}

/**
 * The windows the snapshot records, and the keys `contribution_json` carries.
 *
 * These are a storage contract, not a policy choice: `window_26` must remain
 * the 26-week count because rules and snapshots already in the database read it
 * by that name. A product wanting a different window states it on its own rule;
 * it does not rename these.
 */
export const SNAPSHOT_WINDOW_DAYS: Record<string, number> = {
  window_13: 13 * 7,
  window_26: 26 * 7,
  window_39: 39 * 7,
  window_52: 52 * 7,
  window_12m: 365,
};

export interface ContributionTotals {
  total: number;
  paid: number;
  credited: number;
  wageSum: number;
  avg: number;
  windowCounts: Record<string, number>;
  minP: string | null;
  maxP: string | null;
}

/**
 * The claimant's contribution record, computed from ip_wages by SSN (BUG-48).
 *
 * Extracted from `ensureContributionSnapshot` so intake can use it. A claim is
 * not needed to count a person's contribution weeks — contributions belong to
 * the person — and at registration there is no claim yet. Every contribution
 * fact used to give up at that point and report UNEVALUATED, which made any
 * product carrying a contribution rule impossible to register.
 *
 * Deliberately the only implementation. ip_wages is week-grained with seven
 * wage columns per row (`wages_paid1..7`) and seven codes (`paid_code1..7`);
 * `wages`, `weeks`, `contributions` and `employer_reg_no` do not exist on it,
 * and every reader that named them failed with 42703 and silently reported
 * zero. Duplicating this arithmetic is how that happened.
 */
export async function computeContributionTotals(
  ssn: string,
  asOfDate: string,
): Promise<ContributionTotals> {
  const rows = await loadWages(ssn);
  let paid = 0;
  let credited = 0;
  let total = 0;
  let wageSum = 0;
  let wageWeeks = 0;

  const windowCutoffs: Record<string, string> = {};
  const windowCounts: Record<string, number> = {};
  for (const [key, days] of Object.entries(SNAPSHOT_WINDOW_DAYS)) {
    windowCutoffs[key] = isoMinusDays(asOfDate, days);
    windowCounts[key] = 0;
  }

  let minP: string | null = null;
  let maxP: string | null = null;

  for (const r of rows) {
    const period: string = r.period;
    if (!period) continue;
    total += 1;
    const isPaid = weekIsPaid(r);
    if (isPaid) paid += 1;
    else if (weekIsCredited(r)) credited += 1;
    const w = weekWage(r);
    if (w > 0) {
      wageSum += w;
      wageWeeks += 1;
    }
    if (!minP || period < minP) minP = period;
    if (!maxP || period > maxP) maxP = period;
    if (isPaid) {
      for (const k of Object.keys(windowCutoffs)) {
        if (period >= windowCutoffs[k] && period <= asOfDate) windowCounts[k] += 1;
      }
    }
  }

  return {
    total,
    paid,
    credited,
    wageSum,
    avg: wageWeeks > 0 ? wageSum / wageWeeks : 0,
    windowCounts,
    minP,
    maxP,
  };
}

export async function ensureContributionSnapshot(
  claimId: string,
  opts: { force?: boolean; maxAgeMinutes?: number } = {},
): Promise<SnapshotResult | null> {
  const claim = await loadClaim(claimId);
  if (!claim?.ssn) return null;
  const maxAge = opts.maxAgeMinutes ?? 60 * 24; // 24h

  if (!opts.force) {
    const { data: existing } = await db
      .from('bn_claim_contribution_snapshot')
      .select('*')
      .eq('claim_id', claimId)
      .order('captured_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) {
      const ageMs = Date.now() - new Date(existing.captured_at).getTime();
      if (ageMs < maxAge * 60_000) {
        const j = (existing.contribution_json ?? {}) as Record<string, number>;
        return {
          claim_id: claimId,
          ssn: claim.ssn,
          total_weeks: existing.total_weeks ?? 0,
          paid_weeks: existing.paid_weeks ?? 0,
          credited_weeks: existing.credited_weeks ?? 0,
          average_weekly_wage: Number(existing.average_weekly_wage ?? 0),
          window_13: Number(j.window_13 ?? 0),
          window_26: Number(j.window_26 ?? 0),
          window_39: Number(j.window_39 ?? 0),
          window_52: Number(j.window_52 ?? 0),
          window_12m: Number(j.window_12m ?? 0),
          period_from: existing.period_from,
          period_to: existing.period_to,
          captured_at: existing.captured_at,
          refreshed: false,
        };
      }
    }
  }

  const claimDate = claim.claim_date ?? new Date().toISOString().slice(0, 10);
  const totals = await computeContributionTotals(claim.ssn, claimDate);
  const { paid, credited, total, wageSum, avg, windowCounts, minP, maxP } = totals;
  const contribJson = {
    ...windowCounts,
    recent_weeks: windowCounts.window_13,
    source: 'ip_wages',
    computed_at: new Date().toISOString(),
  };

  const { data: inserted } = await db
    .from('bn_claim_contribution_snapshot')
    .insert({
      claim_id: claimId,
      period_from: minP,
      period_to: maxP,
      total_weeks: total,
      paid_weeks: paid,
      credited_weeks: credited,
      total_wages: wageSum,
      average_weekly_wage: avg,
      contribution_json: contribJson,
    })
    .select('*')
    .single();

  return {
    claim_id: claimId,
    ssn: claim.ssn,
    total_weeks: total,
    paid_weeks: paid,
    credited_weeks: credited,
    average_weekly_wage: avg,
    window_13: windowCounts.window_13,
    window_26: windowCounts.window_26,
    window_39: windowCounts.window_39,
    window_52: windowCounts.window_52,
    window_12m: windowCounts.window_12m,
    period_from: minP,
    period_to: maxP,
    captured_at: inserted?.captured_at ?? new Date().toISOString(),
    refreshed: true,
  };
}

export async function hasFreshContributionSnapshot(claimId: string, maxAgeMinutes = 24 * 60): Promise<boolean> {
  const { data } = await db
    .from('bn_claim_contribution_snapshot')
    .select('captured_at')
    .eq('claim_id', claimId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.captured_at) return false;
  return Date.now() - new Date(data.captured_at).getTime() < maxAgeMinutes * 60_000;
}
