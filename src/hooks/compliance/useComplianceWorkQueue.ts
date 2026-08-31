import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise work-queue reader for the Compliance workbench.
 *
 * Searching, filtering, sorting and paging are all performed by
 * `ce_work_queue_v1` so that they apply to the whole authorised result set,
 * never to a truncated browser page. The database resolves the caller's data
 * scope BEFORE any filter is applied, so a filter can only narrow what a user
 * may see.
 */

export type WorkQueueMode = "review" | "assignment";

export interface WorkQueueFilters {
  search?: string;
  work_type?: string;
  item_type?: string;
  status?: string;
  priority?: string;
  owner?: string;
  zone?: string;
  queue?: string;
  employer?: string;
  risk_band?: string;
  unassigned_only?: boolean;
  mine_only?: boolean;
  overdue_only?: boolean;
  due_today?: boolean;
  due_from?: string;
  due_to?: string;
  created_from?: string;
  created_to?: string;
  assigned_from?: string;
  assigned_to?: string;
  min_age_days?: number;
}

export interface WorkQueueRow {
  work_type: string;
  item_type: string | null;
  record_ref: string | null;
  record_id: string;
  route: string;
  employer_id: string | null;
  employer_name: string | null;
  status: string | null;
  priority: string | null;
  priority_rank: number | null;
  risk_band: string | null;
  owner_id: string | null;
  owner_name: string | null;
  queue_name: string | null;
  zone_code: string | null;
  due_date: string | null;
  created_at: string | null;
  assigned_at: string | null;
  reassignable: boolean;
  unassigned: boolean;
  is_mine: boolean;
  overdue: boolean;
  days_to_due: number | null;
  age_hours: number | null;
  waiting_hours: number | null;
  waiting_breach: boolean;
}

export interface WorkQueueOptions {
  work_types: string[];
  item_types: string[];
  statuses: string[];
  priorities: string[];
  risk_bands: string[];
  owners: { id: string; name: string }[];
  zones: { id: string; code: string; name: string }[];
  queues: { id: string; name: string; type: string }[];
}

export interface WorkloadRow {
  owner_id: string;
  officer_name: string;
  active_work: number;
  overdue: number;
  critical_high: number;
  due_this_week: number;
  oldest_assignment: string | null;
}

export interface WorkQueueResult {
  generated_at: string;
  mode: WorkQueueMode;
  scope: "enterprise" | "team" | "own";
  page: number;
  page_size: number;
  total: number;
  grand_total: number;
  sla_hours: number;
  sort: string;
  dir: "asc" | "desc";
  rows: WorkQueueRow[];
  options: WorkQueueOptions;
  workload: WorkloadRow[];
}

export const WORK_QUEUE_SORTS = [
  { value: "default", label: "Smart urgency (recommended)" },
  { value: "due_date", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "waiting", label: "Waiting time" },
  { value: "age", label: "Age in queue" },
  { value: "created", label: "Created date" },
  { value: "assigned", label: "Assigned date" },
  { value: "employer", label: "Employer" },
  { value: "work_type", label: "Work type" },
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "risk", label: "Risk band" },
] as const;

const EMPTY_OPTIONS: WorkQueueOptions = {
  work_types: [],
  item_types: [],
  statuses: [],
  priorities: [],
  risk_bands: [],
  owners: [],
  zones: [],
  queues: [],
};

export function useComplianceWorkQueue(mode: WorkQueueMode, initialPageSize = 25) {
  const [filters, setFilters] = useState<WorkQueueFilters>({});
  const [sort, setSort] = useState<string>("default");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const patchFilters = useCallback((patch: Partial<WorkQueueFilters>) => {
    setPage(1);
    setFilters((prev) => {
      const next: WorkQueueFilters = { ...prev, ...patch };
      (Object.keys(next) as (keyof WorkQueueFilters)[]).forEach((k) => {
        const v = next[k];
        if (v === undefined || v === "" || v === false || v === null) delete next[k];
      });
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setFilters({});
    setPage(1);
  }, []);

  const changeSort = useCallback((nextSort: string, nextDir?: "asc" | "desc") => {
    setPage(1);
    setSort(nextSort);
    if (nextDir) setDir(nextDir);
  }, []);

  const toggleDir = useCallback(() => {
    setPage(1);
    setDir((d) => (d === "asc" ? "desc" : "asc"));
  }, []);

  const query = useQuery({
    queryKey: ["ce-work-queue", mode, filters, sort, dir, page, pageSize],
    queryFn: async (): Promise<WorkQueueResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_work_queue_v1", {
        p_mode: mode,
        p_filters: filters,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as WorkQueueResult;
    },
    staleTime: 30_000,
  });

  const result = query.data;

  const activeFilterCount = useMemo(
    () => Object.keys(filters).length,
    [filters],
  );

  const totalPages = useMemo(() => {
    const total = result?.total ?? 0;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [result?.total, pageSize]);

  return {
    rows: result?.rows ?? [],
    options: result?.options ?? EMPTY_OPTIONS,
    workload: result?.workload ?? [],
    total: result?.total ?? 0,
    grandTotal: result?.grand_total ?? 0,
    scope: result?.scope,
    slaHours: result?.sla_hours ?? 48,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    filters,
    patchFilters,
    resetFilters,
    activeFilterCount,
    sort,
    dir,
    changeSort,
    toggleDir,
    page,
    setPage,
    pageSize,
    setPageSize,
    totalPages,
  };
}
