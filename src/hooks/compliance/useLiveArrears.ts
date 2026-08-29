import { supabase } from '@/integrations/supabase/client';

/**
 * Live arrears loader — reads the governed reporting view
 * `ce_v_employer_arrears_report`, which is derived from the canonical
 * `ce_v_employer_arrears_summary` (C-L1 ledger truth) and resolves zone
 * (`ce_violations.zone_id` → `ce_zones.zone_name`) and last-payment date
 * (`cn_payment` / `cn_payment_header`) server-side.
 *
 * Financial values are NOT recomputed here — they are passed through
 * unchanged from the canonical view.
 */
export interface LiveArrearsRow {
  id: string;
  employer_id: string;
  regno: string;
  employer_name: string;
  zone: string;
  total_arrears: number;
  current_penalty: number;
  total_outstanding: number;
  last_payment_date: string | null;
  aging_category: string;
  trend: string;
}

async function loadAllPaged<T = any>(
  table: string,
  select = '*',
  filters?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 200000; from += pageSize) {
    let q: any = (supabase as any).from(table).select(select).range(from, from + pageSize - 1);
    if (filters) q = filters(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data as T[]) || []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

function bucketAging(lastPayment: string | null): string {
  if (!lastPayment) return '90+ days';
  const days = Math.floor((Date.now() - new Date(lastPayment).getTime()) / (1000 * 60 * 60 * 24));
  if (days <= 30) return '0-30 days';
  if (days <= 60) return '30-60 days';
  if (days <= 90) return '60-90 days';
  return '90+ days';
}

export async function loadLiveArrears(): Promise<LiveArrearsRow[]> {
  const rows = await loadAllPaged<any>(
    'ce_v_employer_arrears_report',
    'regno,employer_name,current_arrears,current_penalty,total_outstanding,has_arrears,zone,last_payment_date',
    (q) => q.eq('has_arrears', true).order('total_outstanding', { ascending: false }),
  );

  return rows.map((r: any) => {
    const last = r.last_payment_date || null;
    return {
      id: String(r.regno),
      employer_id: String(r.regno),
      regno: String(r.regno),
      employer_name: r.employer_name || String(r.regno),
      zone: r.zone || 'Unassigned',
      total_arrears: Number(r.current_arrears || 0),
      current_penalty: Number(r.current_penalty || 0),
      total_outstanding: Number(r.total_outstanding || 0),
      last_payment_date: last,
      aging_category: bucketAging(last),
      trend: '—',
    };
  });
}
