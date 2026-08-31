import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Compliance Violation History audit trail.
 *
 * Search, filters, sorting and paging are all resolved by `ce_violation_history_v1`
 * so they apply to the whole authorised dataset, never to a truncated browser page.
 * The database resolves the caller's compliance data scope BEFORE any filter runs,
 * so a filter can only ever narrow what a user is already permitted to see.
 *
 * All list state lives in the URL query string so filtered views are shareable and
 * survive navigating into a violation and back.
 */

export interface HistoryFilters {
  search?: string;
  employer?: string;
  violation_id?: string;
  violation_type?: string;
  action?: string;
  performed_by?: string;
  from_value?: string;
  to_value?: string;
  date_from?: string;
  date_to?: string;
}

export interface HistoryRow {
  id: string;
  violation_id: string;
  action: string;
  from_value: string | null;
  to_value: string | null;
  notes: string | null;
  performed_by: string | null;
  performed_at: string;
  violation_number: string;
  employer_id: string | null;
  employer_name: string | null;
  violation_status: string | null;
  violation_type: string | null;
}

export interface HistoryOptions {
  actions: string[];
  performers: string[];
  from_values: string[];
  to_values: string[];
  employers: { id: string; name: string }[];
  violation_types: { id: string; name: string }[];
  violations: { id: string; number: string; employer_id: string | null; employer_name: string | null }[];
}

export interface HistorySummary {
  violation_id: string;
  violation_number: string;
  employer_id: string | null;
  employer_name: string | null;
  violation_type: string | null;
  status: string | null;
  created_at: string | null;
  assignee: string | null;
  event_count: number;
}

interface HistoryResult {
  scope: string;
  page: number;
  page_size: number;
  total: number;
  grand_total: number;
  sort: string;
  dir: "asc" | "desc";
  rows: HistoryRow[];
  options: Partial<HistoryOptions>;
  summary: HistorySummary | null;
}

export const HISTORY_SORTS = [
  { value: "performed_at", label: "Date / performed at" },
  { value: "employer", label: "Employer" },
  { value: "violation", label: "Violation number" },
  { value: "action", label: "Action" },
  { value: "performed_by", label: "Performed by" },
  { value: "from_value", label: "From status" },
  { value: "to_value", label: "To status" },
] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const FILTER_KEYS: (keyof HistoryFilters)[] = [
  "search", "employer", "violation_id", "violation_type", "action",
  "performed_by", "from_value", "to_value", "date_from", "date_to",
];

const EMPTY_OPTIONS: HistoryOptions = {
  actions: [], performers: [], from_values: [], to_values: [],
  employers: [], violation_types: [], violations: [],
};

export function useViolationHistory() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<HistoryFilters>(() => {
    const f: HistoryFilters = {};
    FILTER_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v;
    });
    return f;
  }, [params]);

  const sort = params.get("sort") || "performed_at";
  const dir = (params.get("dir") === "asc" ? "asc" : "desc") as "asc" | "desc";
  const page = Math.max(1, Number(params.get("page") || 1));
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get("size")))
    ? Number(params.get("size"))
    : 25;
  const view = params.get("view") === "timeline" ? "timeline" : "table";

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
    (patch: Partial<HistoryFilters>) => update(patch as Record<string, string | undefined>, true),
    [update],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = {};
    FILTER_KEYS.forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const changeSort = useCallback(
    (nextSort: string, nextDir?: "asc" | "desc") =>
      update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: key === "performed_at" ? "desc" : "asc" }, true);
    },
    [sort, dir, update],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);
  const setView = useCallback((v: "table" | "timeline") => update({ view: v }), [update]);

  const query = useQuery({
    queryKey: ["ce-violation-history", filters, sort, dir, page, pageSize],
    queryFn: async (): Promise<HistoryResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_violation_history_v1", {
        p_filters: filters,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as HistoryResult;
    },
    staleTime: 30_000,
  });

  const fetchAllForExport = useCallback(async (): Promise<HistoryRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_violation_history_v1", {
      p_filters: filters,
      p_sort: sort,
      p_dir: dir,
      p_page: 1,
      p_page_size: 200,
      p_export: true,
    });
    if (error) throw error;
    return ((data as HistoryResult)?.rows ?? []) as HistoryRow[];
  }, [filters, sort, dir]);

  const result = query.data;
  const total = result?.total ?? 0;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as HistoryOptions,
    summary: result?.summary ?? null,
    scope: result?.scope,
    total,
    grandTotal: result?.grand_total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    filters,
    activeFilterCount: Object.keys(filters).length,
    patchFilters,
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
    view,
    setView,
    fetchAllForExport,
  };
}
