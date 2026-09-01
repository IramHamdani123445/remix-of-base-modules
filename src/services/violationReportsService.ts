import { supabase } from '@/integrations/supabase/client';

/**
 * Server-side aggregated violation reporting.
 *
 * NOTE: ce_violations holds hundreds of thousands of rows. Reports MUST aggregate
 * in the database — never download raw rows into the browser.
 */

export type ViolationReportDimension = 'status' | 'type' | 'zone';

export interface ViolationReportFilters {
  from?: string | null;
  to?: string | null;
  status?: string | null;
  type?: string | null;
  fund?: string | null;
  zone?: string | null;
  severity?: string | null;
}

export interface ViolationReportGroupRow {
  bucket: string;
  violation_count: number;
  employer_count: number;
  total_amount: number;
  resolved_count: number;
  unresolved_count: number;
  avg_resolution_days: number | null;
  median_resolution_days: number | null;
  min_resolution_days: number | null;
  max_resolution_days: number | null;
}

export interface ViolationReportFilterOptions {
  statuses: string[];
  types: string[];
  zones: string[];
  funds: string[];
  severities: string[];
}

function clean(value?: string | null): string | null {
  if (!value || value === 'all') return null;
  return value;
}

export async function fetchViolationReportGroups(
  dimension: ViolationReportDimension,
  filters: ViolationReportFilters = {},
): Promise<ViolationReportGroupRow[]> {
  const { data, error } = await (supabase as any).rpc('ce_violation_report_group_v1', {
    p_dimension: dimension,
    p_from: clean(filters.from),
    p_to: clean(filters.to),
    p_status: clean(filters.status),
    p_type: clean(filters.type),
    p_fund: clean(filters.fund),
    p_zone: clean(filters.zone),
    p_severity: clean(filters.severity),
  });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    bucket: r.bucket ?? 'Unknown',
    violation_count: Number(r.violation_count ?? 0),
    employer_count: Number(r.employer_count ?? 0),
    total_amount: Number(r.total_amount ?? 0),
    resolved_count: Number(r.resolved_count ?? 0),
    unresolved_count: Number(r.unresolved_count ?? 0),
    avg_resolution_days: r.avg_resolution_days != null ? Number(r.avg_resolution_days) : null,
    median_resolution_days: r.median_resolution_days != null ? Number(r.median_resolution_days) : null,
    min_resolution_days: r.min_resolution_days != null ? Number(r.min_resolution_days) : null,
    max_resolution_days: r.max_resolution_days != null ? Number(r.max_resolution_days) : null,
  }));
}

export async function fetchViolationReportFilterOptions(): Promise<ViolationReportFilterOptions> {
  const { data, error } = await (supabase as any).rpc('ce_violation_report_filter_options_v1');
  if (error) throw error;
  const raw = (data || {}) as Record<string, unknown>;
  const list = (key: string): string[] =>
    Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter(Boolean).map(String).sort() : [];
  return {
    statuses: list('statuses'),
    types: list('types'),
    zones: list('zones'),
    funds: list('funds'),
    severities: list('severities'),
  };
}
