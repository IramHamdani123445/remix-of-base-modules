import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Inspection Register (`/compliance/field/inspections`).
 *
 * `ce_inspections` is the canonical inspection record. Lifecycle status is the
 * persisted `status` column normalised server-side by `ce_inspection_lifecycle`
 * (legacy rows carry mixed casing); timing state (overdue / due today / ...) is
 * DERIVED from `scheduled_date` and is deliberately kept separate from the
 * lifecycle so a row can read "Scheduled · Overdue" without contradiction.
 *
 * Search, filters, sorting, paging, KPIs and the attention counters are all
 * resolved by `ce_inspection_register_v1` against the full authorised
 * population, never the fetched page.
 */

export interface InspectionFilters {
  scope?: string;
  search?: string;
  quick?: string;
  statuses?: string[];
  types?: string[];
  territories?: string[];
  risk_bands?: string[];
  timing?: string;
  findings?: string;
  report?: string;
  evidence?: string;
  inspector?: string;
  employer?: string;
  plan?: string;
  case?: string;
  date_from?: string;
  date_to?: string;
}

export interface InspectionRow {
  id: string;
  inspection_number: string;
  employer_id: string | null;
  employer_name: string | null;
  territory: string | null;
  inspection_type: string | null;
  raw_status: string | null;
  lifecycle_status: string;
  inspector_id: string | null;
  inspector_name: string | null;
  inspector_code: string | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  visit_date: string | null;
  actual_start: string | null;
  actual_end: string | null;
  check_in_time: string | null;
  check_out_time: string | null;
  location_address: string | null;
  notes: string | null;
  case_id: string | null;
  case_number: string | null;
  plan_item_id: string | null;
  plan_id: string | null;
  plan_number: string | null;
  source_type: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string | null;
  risk_band: string | null;
  risk_score: number | null;
  findings_count: number;
  critical_high_findings: number;
  findings_pending_review: number;
  findings_converted: number;
  evidence_count: number;
  report_id: string | null;
  report_number: string | null;
  report_status: string;
  timing_status: string;
  is_overdue: boolean;
  age_days: number | null;
  is_mine: boolean;
}

export interface InspectionKpis {
  total: number;
  due_today: number;
  scheduled: number;
  in_progress: number;
  overdue: number;
  completed_30d: number;
  completed: number;
  cancelled: number;
  findings_total: number;
  findings_pending_review: number;
  report_pending: number;
  high_risk: number;
}

export interface InspectionAttention {
  overdue_not_started: number;
  stalled_in_progress: number;
  completed_no_report: number;
  completed_no_evidence: number;
  critical_findings_pending: number;
  unassigned: number;
}

export interface InspectionFacets {
  access: string;
  statuses: string[];
  types: string[];
  territories: string[];
  risk_bands: string[];
  report_statuses: string[];
  inspectors: { id: string; name: string; code: string | null }[];
  employers: { id: string; name: string }[];
}

interface RegisterResult {
  access: string;
  scope: string;
  user_id: string | null;
  page: number;
  page_size: number;
  today: string;
  total: number;
  kpis: InspectionKpis;
  attention: InspectionAttention;
  rows: InspectionRow[];
}

export const INSPECTION_QUICK_VIEWS = [
  { value: "ALL", label: "All" },
  { value: "MINE", label: "My inspections" },
  { value: "TODAY", label: "Today" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "HAS_FINDINGS", label: "Has findings" },
  { value: "REPORT_PENDING", label: "Report pending" },
  { value: "HIGH_RISK", label: "High risk" },
];

export const INSPECTION_SORTS = [
  { value: "urgency", label: "Urgency (overdue first)" },
  { value: "scheduled", label: "Scheduled date" },
  { value: "inspection", label: "Inspection number" },
  { value: "employer", label: "Employer" },
  { value: "inspector", label: "Inspector" },
  { value: "status", label: "Lifecycle status" },
  { value: "type", label: "Inspection type" },
  { value: "findings", label: "Findings count" },
  { value: "risk", label: "Employer risk" },
  { value: "created", label: "Created date" },
  { value: "completed", label: "Completion date" },
];

export const TIMING_OPTIONS = [
  { value: "ANY", label: "Any timing" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "DUE_TODAY", label: "Due today" },
  { value: "DUE_WEEK", label: "Due this week" },
  { value: "FUTURE", label: "Future" },
  { value: "NO_DATE", label: "No scheduled date" },
  { value: "CLOSED", label: "Closed (completed/cancelled)" },
];

export const FINDINGS_OPTIONS = [
  { value: "ANY", label: "Any findings state" },
  { value: "NONE", label: "No findings" },
  { value: "HAS", label: "Has findings" },
  { value: "CRITICAL_HIGH", label: "Critical / high findings" },
  { value: "PENDING_REVIEW", label: "Findings awaiting review" },
  { value: "CONVERTED", label: "Finding converted to violation" },
];

export const EVIDENCE_OPTIONS = [
  { value: "ANY", label: "Any evidence state" },
  { value: "HAS", label: "Has evidence" },
  { value: "NONE", label: "No evidence" },
  { value: "MISSING_ON_COMPLETED", label: "Completed without evidence" },
];

export const REPORT_OPTIONS = [
  { value: "ANY", label: "Any report status" },
  { value: "NOT_STARTED", label: "Not started" },
  { value: "DRAFT", label: "Draft" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "FINAL", label: "Final" },
];

export const PAGE_SIZES = [25, 50, 100, 200];

const ARRAY_KEYS = new Set(["statuses", "types", "territories", "risk_bands"]);

export function useInspectionRegister() {
  const [params, setParams] = useSearchParams();

  const scope = params.get("scope") ?? "AUTO";
  const search = params.get("q") ?? "";
  const quick = params.get("quick") ?? "ALL";
  const sort = params.get("sort") ?? "urgency";
  const dir = params.get("dir") ?? "asc";
  const page = Number(params.get("page") ?? 1);
  const pageSize = Number(params.get("size") ?? 25);

  const filters: InspectionFilters = useMemo(() => {
    const get = (k: string) => params.get(k) ?? undefined;
    const getArr = (k: string) => {
      const raw = params.get(k);
      return raw ? raw.split(",").filter(Boolean) : undefined;
    };
    return {
      scope,
      search: search || undefined,
      quick,
      statuses: getArr("statuses"),
      types: getArr("types"),
      territories: getArr("territories"),
      risk_bands: getArr("risk_bands"),
      timing: get("timing"),
      findings: get("findings"),
      report: get("report"),
      evidence: get("evidence"),
      inspector: get("inspector"),
      employer: get("employer"),
      plan: get("plan"),
      case: get("case"),
      date_from: get("from"),
      date_to: get("to"),
    };
  }, [params, scope, search, quick]);

  const patch = useCallback(
    (next: Record<string, string | string[] | number | undefined | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          Object.entries(next).forEach(([k, v]) => {
            const value = ARRAY_KEYS.has(k) && Array.isArray(v) ? v.join(",") : v;
            if (value === undefined || value === null || value === "" || (Array.isArray(v) && v.length === 0)) {
              sp.delete(k);
            } else {
              sp.set(k, String(value));
            }
          });
          if (resetPage) sp.delete("page");
          return sp;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const resetFilters = useCallback(() => {
    setParams(new URLSearchParams(), { replace: true });
  }, [setParams]);

  const registerQuery = useQuery({
    queryKey: ["ce_inspection_register_v1", filters, sort, dir, page, pageSize],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<RegisterResult> => {
      const { data, error } = await supabase.rpc("ce_inspection_register_v1" as never, {
        p_filters: filters as never,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      } as never);
      if (error) throw error;
      return data as unknown as RegisterResult;
    },
  });

  const facetsQuery = useQuery({
    queryKey: ["ce_inspection_register_facets_v1"],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<InspectionFacets> => {
      const { data, error } = await supabase.rpc("ce_inspection_register_facets_v1" as never);
      if (error) throw error;
      return data as unknown as InspectionFacets;
    },
  });

  const exportRows = useCallback(async (): Promise<InspectionRow[]> => {
    const { data, error } = await supabase.rpc("ce_inspection_register_v1" as never, {
      p_filters: filters as never,
      p_sort: sort,
      p_dir: dir,
      p_page: 1,
      p_page_size: 5000,
      p_export: true,
    } as never);
    if (error) throw error;
    return ((data as unknown as RegisterResult)?.rows ?? []) as InspectionRow[];
  }, [filters, sort, dir]);

  const changeSort = useCallback(
    (key: string) => {
      if (sort === key) patch({ dir: dir === "asc" ? "desc" : "asc" }, false);
      else patch({ sort: key, dir: key === "urgency" ? "asc" : "desc" }, false);
    },
    [sort, dir, patch],
  );

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string }[] = [];
    const push = (key: string, label: string) => chips.push({ key, label });
    if (search) push("q", `Search: ${search}`);
    if (quick !== "ALL") push("quick", `View: ${INSPECTION_QUICK_VIEWS.find((v) => v.value === quick)?.label ?? quick}`);
    if (scope !== "AUTO") push("scope", `Scope: ${scope === "MINE" ? "My inspections" : scope === "TEAM" ? "My team" : "All"}`);
    filters.statuses?.forEach(() => undefined);
    if (filters.statuses?.length) push("statuses", `Status: ${filters.statuses.join(", ")}`);
    if (filters.types?.length) push("types", `Type: ${filters.types.join(", ")}`);
    if (filters.territories?.length) push("territories", `Zone: ${filters.territories.join(", ")}`);
    if (filters.risk_bands?.length) push("risk_bands", `Risk: ${filters.risk_bands.join(", ")}`);
    if (filters.timing && filters.timing !== "ANY") push("timing", `Timing: ${filters.timing.replace(/_/g, " ").toLowerCase()}`);
    if (filters.findings && filters.findings !== "ANY") push("findings", `Findings: ${filters.findings.replace(/_/g, " ").toLowerCase()}`);
    if (filters.report && filters.report !== "ANY") push("report", `Report: ${filters.report.replace(/_/g, " ").toLowerCase()}`);
    if (filters.evidence && filters.evidence !== "ANY") push("evidence", `Evidence: ${filters.evidence.replace(/_/g, " ").toLowerCase()}`);
    if (filters.inspector) push("inspector", `Inspector: ${filters.inspector}`);
    if (filters.employer) push("employer", `Employer: ${filters.employer}`);
    if (filters.plan) push("plan", `Plan: ${filters.plan}`);
    if (filters.case) push("case", `Case: ${filters.case}`);
    if (filters.date_from) push("from", `From: ${filters.date_from}`);
    if (filters.date_to) push("to", `To: ${filters.date_to}`);
    return chips;
  }, [filters, search, quick, scope]);

  const result = registerQuery.data;

  return {
    params,
    patch,
    resetFilters,
    changeSort,
    exportRows,
    scope,
    search,
    quick,
    sort,
    dir,
    page,
    pageSize,
    filters,
    activeFilterChips,
    rows: result?.rows ?? [],
    total: result?.total ?? 0,
    kpis: result?.kpis,
    attention: result?.attention,
    access: result?.access ?? facetsQuery.data?.access ?? "NONE",
    effectiveScope: result?.scope ?? "ALL",
    today: result?.today,
    facets: facetsQuery.data,
    isLoading: registerQuery.isLoading,
    isFetching: registerQuery.isFetching,
    error: registerQuery.error as Error | null,
    refetch: registerQuery.refetch,
  };
}
