/**
 * BN Contribution Adapter — Reads from ip_wages and bn_get_contribution_summary RPC
 */
import { supabase } from '@/integrations/supabase/client';
import type { IBnContributionAdapter, ContributionSummary, WageRecord } from './contracts';

const db = supabase as any;

export const bnContributionAdapter: IBnContributionAdapter = {
  async getContributionSummary(ssn, windowStart, windowEnd): Promise<ContributionSummary> {
    const { data, error } = await db.rpc('bn_get_contribution_summary', {
      p_ssn: ssn.trim(),
      p_from_date: windowStart,
      p_to_date: windowEnd,
    });

    if (error) throw error;

    // RPC returns a single summary row
    const row = Array.isArray(data) ? data[0] : data;
    return {
      ssn,
      totalWeeks: Number(row?.total_weeks ?? 0),
      totalAmount: Number(row?.total_wages ?? 0),
      averageWeeklyWage: Number(row?.avg_weekly_wages ?? 0),
      windowStart,
      windowEnd,
    };
  },

  /**
   * BUG-48 — this selected `employer_reg_no`, `wages`, `weeks` and
   * `contributions`. None of the four exists on ip_wages, so PostgREST
   * rejected the whole query with 42703 on every call. Every caller caught the
   * throw and carried on with zeros: the intake wizard's Contribution Window
   * showed Paid 0 / Credited 0 / Avg 0.00 for claimants who had contributions,
   * and the paid-versus-credited split never worked for anybody.
   *
   * ip_wages is week-grained with seven wage columns per row and seven codes.
   * A week is paid when it carries wages, and credited when it carries a code
   * with no wages -- the same reading `contributionSnapshotService` uses.
   */
  async getWeeklyWages(ssn, periodStart, periodEnd): Promise<WageRecord[]> {
    const wageCols = [1, 2, 3, 4, 5, 6, 7].map((i) => `wages_paid${i}`);
    const codeCols = [1, 2, 3, 4, 5, 6, 7].map((i) => `paid_code${i}`);
    const { data, error } = await db
      .from('ip_wages')
      .select(['period', 'payer_id', 'ip_ss_amt', ...wageCols, ...codeCols].join(', '))
      .eq('ssn', ssn.trim())
      .gte('period', periodStart)
      .lte('period', periodEnd)
      .order('period', { ascending: false });

    if (error) throw error;
    return (data ?? []).map((w: any) => {
      const wages = wageCols.reduce((sum, c) => sum + Number(w[c] ?? 0), 0);
      const hasCode = codeCols.some((c) => String(w[c] ?? '').trim() !== '');
      return {
        period: w.period,
        // ip_wages links the employer through payer_id, not employer_reg_no --
        // as employerAdapter.verifyEmployment already notes.
        employerRegNo: String(w.payer_id ?? ''),
        wages,
        // One ip_wages row is one week. It counts whenever it carries either
        // wages or a contribution code; a row with neither is not a week of
        // cover, and counting it would overstate the claimant's record.
        weeks: wages > 0 || hasCode ? 1 : 0,
        contributions: Number(w.ip_ss_amt ?? 0),
      };
    });
  },

  /** BUG-48 — `weeks` and `contributions` do not exist on ip_wages either. */
  async getTotalContributions(ssn): Promise<{ weeks: number; amount: number }> {
    const wageCols = [1, 2, 3, 4, 5, 6, 7].map((i) => `wages_paid${i}`);
    const codeCols = [1, 2, 3, 4, 5, 6, 7].map((i) => `paid_code${i}`);
    const { data, error } = await db
      .from('ip_wages')
      .select(['ip_ss_amt', ...wageCols, ...codeCols].join(', '))
      .eq('ssn', ssn.trim());

    if (error) throw error;
    const rows = data ?? [];
    return {
      weeks: rows.reduce((sum: number, r: any) => {
        const wages = wageCols.reduce((t, c) => t + Number(r[c] ?? 0), 0);
        const hasCode = codeCols.some((c) => String(r[c] ?? '').trim() !== '');
        return sum + (wages > 0 || hasCode ? 1 : 0);
      }, 0),
      amount: rows.reduce((sum: number, r: any) => sum + Number(r.ip_ss_amt ?? 0), 0),
    };
  },

  async hasMinimumContributions(ssn, requiredWeeks, windowWeeks, referenceDate): Promise<boolean> {
    const refDate = new Date(referenceDate);
    const windowStart = new Date(refDate);
    windowStart.setDate(windowStart.getDate() - windowWeeks * 7);

    const summary = await this.getContributionSummary(
      ssn,
      windowStart.toISOString().split('T')[0],
      referenceDate
    );
    return summary.totalWeeks >= requiredWeeks;
  },
};
