import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Compliance Case Register (/compliance/cases).
 *
 * Search, filters, sorting, paging and KPI aggregation are all resolved by
 * `ce_case_register_v1`, so they apply to the entire authorised case
 * population rather than a truncated browser page. The database resolves the
 * caller's compliance data scope BEFORE any filter is applied, so selecting
 * "Assigned To = Any" can never widen access beyond the caller's permissions.
 *
 * All list state lives in the URL query string, so a filtered register is
 * bookmarkable and survives drilling into a case and navigating back.
 * The legacy `?regno=` employer deep-link contract is honoured as the
 * employer filter itself rather than as a competing filter.
 */

export interface CaseFilters {
  search?: string;
  employer?: string;
  statuses?: string[];
  status_group?: string;
  priorities?: string[];
  risk_bands?: string[];
  assigned?: string;
  territory?: string;
  case_type?: string;
  date_from?: string;
  date_to?: string;
  age?: string;
  sla?: string;
  amount_min?: string;
  amount_max?: string;
  arrangement?: string;
  legal_only?: boolean;
}

export interface CaseRow {
  id: string;
  case_number: string;
  employer_id: string | null;
  employer_name: string | null;
  territory: string;
  status: string;
  status_group: "ACTIVE" | "LEGAL" | "RESOLVED" | "CLOSED";
  priority: string;
  risk_band: string;
  risk_score: number | null;
  total_amount: number;
  assigned_officer_id: string | null;
  assigned_officer_name: string | null;
  opened_date: string | null;
  target_resolution_date: string | null;
  closed_date: string | null;
  case_type: string;
  case_family: string | null;
  legal_case_id: string | null;
  violation_count: number | null;
  age_days: number;
  sla_status: "OVERDUE" | "DUE_TODAY" | "DUE_1_3" | "DUE_4_7" | "WITHIN_SLA" | "NO_SLA" | "NOT_APPLICABLE";
  arrangement_state: string;
}

export interface CaseKpis {
  total: number;
  open: number;
  legal: number;
  overdue: number;
  unassigned: number;
  arrears: number;
}

export interface CaseOptions {
  statuses: string[];
  priorities: string[];
  risk_bands: string[];
  territories: string[];
  case_types: string[];
  officers: { id: string; name: string }[];
  employers: { id: string; name: string }[];
}

interface CaseRegisterResult {
  scope: string;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  total: number;
  rows: CaseRow[];
  kpis_all: CaseKpis;
  kpis_filtered: CaseKpis;
  options: Partial<CaseOptions>;
}

export const CASE_SORTS = [
  { value: "urgency", label: "Priority / Urgency" },
  { value: "opened_date", label: "Opened date" },
  { value: "case_number", label: "Case number" },
  { value: "employer", label: "Employer" },
  { value: "status", label: "Status" },
  { value: "priority", label: "Priority" },
  { value: "risk", label: "Risk band" },
  { value: "amount", label: "Arrears / exposure" },
  { value: "assigned", label: "Assigned officer" },
  { value: "age", label: "Case age" },
  { value: "sla", label: "SLA urgency" },
] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const AGE_BUCKETS = [
  { value: "0_7", label: "0–7 days" },
  { value: "8_30", label: "8–30 days" },
  { value: "31_60", label: "31–60 days" },
  { value: "61_90", label: "61–90 days" },
  { value: "91_180", label: "91–180 days" },
  { value: "180_PLUS", label: "180+ days" },
];

export const SLA_OPTIONS = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "DUE_TODAY", label: "Due today" },
  { value: "DUE_1_3", label: "Due in 1–3 days" },
  { value: "DUE_4_7", label: "Due in 4–7 days" },
  { value: "WITHIN_SLA", label: "Within SLA" },
  { value: "NO_SLA", label: "No target date set" },
];

export const AMOUNT_RANGES = [
  { value: "0-0", label: "$0" },
  { value: "1-1000", label: "$1 – $1,000" },
  { value: "1001-5000", label: "$1,001 – $5,000" },
  { value: "5001-10000", label: "$5,001 – $10,000" },
  { value: "10001-50000", label: "$10,001 – $50,000" },
  { value: "50001-", label: "$50,000+" },
];

export const ARRANGEMENT_OPTIONS = [
  { value: "NONE", label: "No arrangement" },
  { value: "ACTIVE", label: "Active arrangement" },
  { value: "COMPLETED", label: "Completed arrangement" },
  { value: "BREACHED", label: "Breached / defaulted" },
];

export const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "year", label: "This year" },
];

const ISO = (d: Date) => d.toISOString().slice(0, 10);

export function datePresetRange(preset: string): { from?: string; to?: string } {
  const today = new Date();
  switch (preset) {
    case "today":
      return { from: ISO(today), to: ISO(today) };
    case "7":
    case "30":
    case "90": {
      const from = new Date(today);
      from.setDate(from.getDate() - (Number(preset) - 1));
      return { from: ISO(from), to: ISO(today) };
    }
    case "year":
      return { from: `${today.getFullYear()}-01-01`, to: ISO(today) };
    default:
      return {};
  }
}

const LIST_KEYS = ["statuses", "priorities", "risk_bands"] as const;
const SCALAR_KEYS = [
  "search", "status_group", "assigned", "territory", "case_type",
  "date_from", "date_to", "age", "sla", "amount_min", "amount_max", "arrangement",
] as const;

const EMPTY_OPTIONS: CaseOptions = {
  statuses: [], priorities: [], risk_bands: [], territories: [],
  case_types: [], officers: [], employers: [],
};

const EMPTY_KPIS: CaseKpis = { total: 0, open: 0, legal: 0, overdue: 0, unassigned: 0, arrears: 0 };

export function useCaseRegister() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<CaseFilters>(() => {
    const f: CaseFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    // `?regno=` remains the canonical employer deep-link contract.
    const employer = params.get("regno") || params.get("employer");
    if (employer) f.employer = employer;
    if (params.get("legal_only") === "1") f.legal_only = true;
    return f;
  }, [params]);

  const sort = params.get("sort") || "urgency";
  const dir = (params.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc";
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 25;

  const update = useCallback(
    (patch: Record<string, string | undefined>, resetPage = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            if (v === undefined || v === "") next.delete(k);
            else next.set(k, v);
          });
          if (resetPage) next.delete("page");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const patchFilters = useCallback(
    (patch: Partial<CaseFilters>) => {
      const flat: Record<string, string | undefined> = {};
      Object.entries(patch).forEach(([k, v]) => {
        if (k === "employer") {
          flat.regno = (v as string) || undefined;
          flat.employer = undefined;
        } else if (k === "legal_only") {
          flat.legal_only = v ? "1" : undefined;
        } else if (Array.isArray(v)) {
          flat[k] = v.length ? v.join(",") : undefined;
        } else {
          flat[k] = (v as string) || undefined;
        }
      });
      update(flat, true);
    },
    [update],
  );

  const toggleInList = useCallback(
    (key: "statuses" | "priorities" | "risk_bands", value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<CaseFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { regno: undefined, employer: undefined, legal_only: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const changeSort = useCallback(
    (nextSort: string, nextDir?: "asc" | "desc") => update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: key === "case_number" || key === "employer" || key === "assigned" ? "asc" : "desc" }, true);
    },
    [sort, dir, update],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(
    () => ({
      p_filters: {
        ...filters,
        amount_min: filters.amount_min,
        amount_max: filters.amount_max,
      },
      p_sort: sort,
      p_dir: dir,
    }),
    [filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-case-register", rpcArgs, page, pageSize],
    queryFn: async (): Promise<CaseRegisterResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_case_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as CaseRegisterResult;
    },
    staleTime: 30_000,
  });

  const fetchAllForExport = useCallback(async (): Promise<CaseRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_case_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 200,
      p_export: true,
    });
    if (error) throw error;
    return ((data as CaseRegisterResult)?.rows ?? []) as CaseRow[];
  }, [rpcArgs]);

  const result = query.data;
  const total = result?.total ?? 0;

  const activeFilterCount =
    Object.entries(filters).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v))).length;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as CaseOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    scope: result?.scope,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    filters,
    activeFilterCount,
    patchFilters,
    toggleInList,
    resetFilters,
    sort,
    dir,
    changeSort,
    toggleSort,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    fetchAllForExport,
  };
}
