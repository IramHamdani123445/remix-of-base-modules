import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Compliance Case Queue (/compliance/cases/queue).
 *
 * The queue is an ACTIVE-work surface: `ce_case_queue_v1` excludes closed /
 * resolved cases, resolves the caller's compliance data scope BEFORE filtering,
 * and then applies search, filters, ordering, queue ranking, paging and queue
 * KPI aggregation in the database — so ranking and counts describe the entire
 * authorised queue rather than a truncated first page.
 *
 * All list state lives in the URL query string so filters, sort, page and page
 * size survive drilling into a case and navigating back.
 */

export interface QueueFilters {
  search?: string;
  employer?: string;
  statuses?: string[];
  priorities?: string[];
  risk_bands?: string[];
  assigned?: string;
  territory?: string;
  case_type?: string;
  date_from?: string;
  date_to?: string;
  age?: string;
  due?: string;
  amount_min?: string;
  amount_max?: string;
  arrangement?: string;
  legal_only?: boolean;
}

export type DueStatus = "OVERDUE" | "DUE_TODAY" | "DUE_1_3" | "DUE_4_7" | "DUE_LATER" | "NO_TARGET";

export interface QueueRow {
  rn: number;
  id: string;
  case_number: string;
  employer_id: string | null;
  employer_name: string | null;
  territory: string;
  status: string;
  status_group: "ACTIVE" | "LEGAL";
  priority: string;
  risk_band: string;
  risk_score: number | null;
  total_amount: number;
  assigned_officer_id: string | null;
  assigned_officer_name: string | null;
  opened_date: string | null;
  target_resolution_date: string | null;
  case_type: string;
  case_family: string | null;
  legal_case_id: string | null;
  violation_count: number | null;
  summary: string | null;
  age_days: number;
  due_status: DueStatus;
  arrangement_state: string;
}

export interface QueueKpis {
  total: number;
  critical: number;
  high: number;
  overdue: number;
  due_week: number;
  unassigned: number;
  mine: number;
  exposure: number;
}

export interface QueueOptions {
  statuses: string[];
  priorities: string[];
  risk_bands: string[];
  territories: string[];
  case_types: string[];
  officers: { id: string; name: string }[];
  employers: { id: string; name: string }[];
}

interface QueueResult {
  scope: string;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  total: number;
  rows: QueueRow[];
  kpis_all: QueueKpis;
  kpis_filtered: QueueKpis;
  options: Partial<QueueOptions>;
}

/** Sort options. `recommended` is the documented composite queue order. */
export const QUEUE_SORTS = [
  { value: "recommended", label: "Recommended (urgency)" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "Target resolution date" },
  { value: "age", label: "Case age" },
  { value: "risk", label: "Risk band" },
  { value: "amount", label: "Amount / arrears" },
  { value: "opened_date", label: "Opened date" },
  { value: "employer", label: "Employer" },
  { value: "assigned", label: "Assigned officer" },
  { value: "case_number", label: "Case number" },
] as const;

export const RECOMMENDED_SORT_RULE =
  "Recommended order: (1) overdue cases first, (2) Critical → High → Medium → Low priority, " +
  "(3) earliest target-resolution date, (4) oldest active case. Risk band is shown but is not " +
  "part of the ordering — it is not an approved prioritisation input.";

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const AGE_BUCKETS = [
  { value: "0_7", label: "0–7 days" },
  { value: "8_30", label: "8–30 days" },
  { value: "31_60", label: "31–60 days" },
  { value: "61_90", label: "61–90 days" },
  { value: "91_180", label: "91–180 days" },
  { value: "180_PLUS", label: "180+ days" },
];

export const DUE_OPTIONS = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "DUE_TODAY", label: "Due today" },
  { value: "DUE_1_3", label: "Due in 1–3 days" },
  { value: "DUE_4_7", label: "Due in 4–7 days" },
  { value: "DUE_7", label: "Due within 7 days" },
  { value: "DUE_LATER", label: "Due later" },
  { value: "NO_TARGET", label: "No target date" },
];

export const AMOUNT_RANGES = [
  { value: "0-1000", label: "Under $1,000" },
  { value: "1000-5000", label: "$1,000 – $5,000" },
  { value: "5000-10000", label: "$5,000 – $10,000" },
  { value: "10000-50000", label: "$10,000 – $50,000" },
  { value: "50000-", label: "$50,000+" },
];

export const ARRANGEMENT_OPTIONS = [
  { value: "NONE", label: "No arrangement" },
  { value: "ACTIVE", label: "Active arrangement" },
  { value: "COMPLETED", label: "Completed arrangement" },
  { value: "BREACHED", label: "Breached / defaulted" },
];

const LIST_KEYS = ["statuses", "priorities", "risk_bands"] as const;
const SCALAR_KEYS = [
  "search", "assigned", "territory", "case_type",
  "date_from", "date_to", "age", "due", "amount_min", "amount_max", "arrangement",
] as const;

const EMPTY_OPTIONS: QueueOptions = {
  statuses: [], priorities: [], risk_bands: [], territories: [],
  case_types: [], officers: [], employers: [],
};

const EMPTY_KPIS: QueueKpis = {
  total: 0, critical: 0, high: 0, overdue: 0, due_week: 0, unassigned: 0, mine: 0, exposure: 0,
};

export function useCaseQueue() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<QueueFilters>(() => {
    const f: QueueFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    const employer = params.get("regno") || params.get("employer");
    if (employer) f.employer = employer;
    if (params.get("legal_only") === "1") f.legal_only = true;
    return f;
  }, [params]);

  const sort = params.get("sort") || "recommended";
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
    (patch: Partial<QueueFilters>) => {
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
      patchFilters({ [key]: next } as Partial<QueueFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = {
      regno: undefined, employer: undefined, legal_only: undefined,
    };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  /** Applies a quick-filter preset: clears competing filters, then sets the preset. */
  const applyQuickFilter = useCallback(
    (patch: Partial<QueueFilters>) => {
      const cleared: Record<string, string | undefined> = {
        assigned: undefined, due: undefined, priorities: undefined,
        risk_bands: undefined, legal_only: undefined,
      };
      Object.entries(patch).forEach(([k, v]) => {
        if (k === "legal_only") cleared.legal_only = v ? "1" : undefined;
        else if (Array.isArray(v)) cleared[k] = v.length ? v.join(",") : undefined;
        else cleared[k] = (v as string) || undefined;
      });
      update(cleared, true);
    },
    [update],
  );

  const changeSort = useCallback(
    (nextSort: string, nextDir?: "asc" | "desc") => update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );

  const toggleDir = useCallback(
    () => update({ dir: dir === "asc" ? "desc" : "asc" }, true),
    [update, dir],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(() => ({ p_filters: { ...filters }, p_sort: sort, p_dir: dir }), [filters, sort, dir]);

  const query = useQuery({
    queryKey: ["ce-case-queue", rpcArgs, page, pageSize],
    queryFn: async (): Promise<QueueResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_case_queue_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as QueueResult;
    },
    staleTime: 30_000,
    retry: 1,
  });

  const result = query.data;
  const total = result?.total ?? 0;

  const activeFilterCount = Object.entries(filters).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  ).length;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as QueueOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    scope: result?.scope,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    filters,
    activeFilterCount,
    patchFilters,
    applyQuickFilter,
    toggleInList,
    resetFilters,
    sort,
    dir,
    changeSort,
    toggleDir,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
