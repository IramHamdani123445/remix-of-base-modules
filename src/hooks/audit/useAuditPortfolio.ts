import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Server-owned Annual Plan portfolio intelligence.
 *
 * All three read models come from a single governed RPC each, so the browser
 * never recomputes portfolio truth. `ia_annual_plan_readiness` remains the
 * authoritative submission gate — the portfolio only displays it.
 */

async function callRpc<T = any>(fn: any, args: any): Promise<T> {
  const { data, error } = await (supabase as any).rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export interface PortfolioSummary {
  success: boolean;
  code?: string;
  error?: string;
  plan_id?: string;
  plan_status?: string;
  fiscal_year?: string | number;
  totals?: {
    engagements: number;
    planned_hours: number;
    planned_days: number;
    available_capacity_hours: number;
    buffer_hours: number;
    net_capacity_hours: number;
    utilisation_pct: number | null;
    remaining_capacity_hours: number;
  };
  by_risk?: Record<string, number>;
  by_quarter?: Record<string, number>;
  by_department?: Array<{ department_id: string | null; department: string; engagements: number; hours: number }>;
  by_function?: Array<{ function_id: string | null; function: string; engagements: number }>;
  gaps?: {
    unscheduled: number;
    missing_lead: number;
    missing_reviewer: number;
    lead_reviewer_conflict: number;
  };
  conflict_engagements?: Array<{
    id: string;
    name: string;
    missing_lead: boolean;
    missing_reviewer: boolean;
    lead_reviewer_conflict: boolean;
    unscheduled: boolean;
  }>;
  readiness?: any;
  version?: {
    current_version_number: number;
    previous_submitted_version: { version_number: number; status_at_snapshot: string; created_at: string } | null;
  };
}

export interface PlanCoverage {
  success: boolean;
  code?: string;
  rows?: Array<{
    department_id: string;
    department: string;
    department_risk: string | null;
    function_id: string | null;
    function: string | null;
    risk_rating: string | null;
    last_audit_date: string | null;
    covered: boolean;
    engagement_id: string | null;
    engagement: string | null;
    quarter: string | null;
    effort_hours: number | null;
  }>;
  uncovered_high_risk?: any[];
  departments_without_audit?: string[];
}

export interface PlanVersionDiff {
  success: boolean;
  code?: string;
  has_baseline?: boolean;
  message?: string;
  baseline?: { version_number: number; status_at_snapshot: string; created_at: string };
  added?: Array<{ engagement_id: string; name: string; quarter: string; risk: string; hours: string }>;
  removed?: Array<{ engagement_id: string; name: string; quarter: string; risk: string; hours: string }>;
  modified?: Array<{
    engagement_id: string;
    name: string;
    changes: Array<{ field: string; from: string | null; to: string | null }> | null;
  }>;
  effort?: { baseline_hours: number; current_hours: number; delta_hours: number };
}

export function usePlanPortfolioSummary(planId?: string) {
  return useQuery({
    queryKey: ['ia-plan-portfolio-summary', planId],
    queryFn: () => callRpc<PortfolioSummary>('ia_annual_plan_portfolio_summary', { p_plan_id: planId }),
    enabled: !!planId,
    staleTime: 30_000,
  });
}

export function usePlanCoverage(planId?: string) {
  return useQuery({
    queryKey: ['ia-plan-coverage', planId],
    queryFn: () => callRpc<PlanCoverage>('ia_annual_plan_coverage', { p_plan_id: planId }),
    enabled: !!planId,
    staleTime: 60_000,
  });
}

export function usePlanVersionDiff(planId?: string) {
  return useQuery({
    queryKey: ['ia-plan-version-diff', planId],
    queryFn: () => callRpc<PlanVersionDiff>('ia_annual_plan_version_diff', { p_plan_id: planId }),
    enabled: !!planId,
    staleTime: 30_000,
  });
}
