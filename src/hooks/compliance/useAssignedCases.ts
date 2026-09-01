import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Compliance Assigned Cases workspace
 * (/compliance/cases/assigned).
 *
 * Ownership is resolved in the database by `ce_assigned_cases_v1`, which uses
 * `ce_officer_identities()` so that "My Cases" matches every identifier
 * `ce_cases.assigned_officer_id` may hold for the signed-in user
 * (ce_inspectors.id, inspector_code, legacy_inspector_code and the auth uid).
 * Team scope adds the officers a supervisor owns; enterprise scope removes the
 * ownership predicate entirely. Scope is authorised server-side, so requesting
 * a wider scope than the caller holds silently falls back to "mine".
 *
 * All list state lives in the URL so scope, filters, sort, page and page size
 * survive navigating into a case and back.
 */

export type AssignedScope = "mine" | "team" | "all";

export interface AssignedFilters {
  search?: string;
  employer?: string;
  officer?: string;
  families?: string[];
  statuses?: string[];
  priorities?: string[];
  risk_bands?: string[];
  territory?: string;
  due?: string;
  age?: string;
  opened?: string;
  assigned?: string;
  date_from?: string;
  date_to?: string;
  include_closed?: boolean;
}

export interface AssignedRow {
  rn: number;
  id: string;
  case_number: string;
  employer_id: string | null;
  employer_name: string | null;
  territory: string;
  status: string;
  priority: string;
  risk_band: string;
  risk_score: number | null;
  total_amount: number;
  opened_date: string | null;
  target_resolution_date: string | null;
  case_family: string;
  assigned_officer_id: string | null;
  assigned_officer_name: string | null;
  is_mine: boolean;
  days_open: number;
  days_assigned: number | null;
  assigned_at: string | null;
  reassigned: boolean;
  due_bucket: string;
  age_bucket: string;
}

export interface AssignedKpis {
  total: number;
  overdue: number;
  due_today: number;
  due_week: number;
  critical_high: number;
  high_risk: number;
  exposure: number;
  oldest: number;
}

export interface AssignedOptions {
  statuses: string[];
  priorities: string[];
  risk_bands: string[];
  families: string[];
  territories: string[];
  employers: { id: string; name: string }[];
  officers: { id: string; name: string }[];
}

interface AssignedResult {
  scope: AssignedScope;
  requested_scope: string;
  can_team: boolean;
  can_all: boolean;
  can_assign: boolean;
  identity_resolved: boolean;
  officer_identities: string[];
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  total: number;
  rows: AssignedRow[];
  kpis_all: AssignedKpis;
  kpis_filtered: AssignedKpis;
  options: Partial<AssignedOptions>;
}

export const ASSIGNED_SORTS = [
  { value: "recommended", label: "Recommended (worklist)" },
  { value: "due", label: "Target / due date" },
  { value: "priority", label: "Priority" },
  { value: "risk", label: "Risk band" },
  { value: "age", label: "Case age" },
  { value: "assigned", label: "Recently assigned" },
  { value: "opened_date", label: "Opened date" },
  { value: "amount", label: "Exposure amount" },
  { value: "employer", label: "Employer" },
  { value: "officer", label: "Assigned officer" },
  { value: "case_number", label: "Case number" },
] as const;

export const RECOMMENDED_ASSIGNED_RULE =
  "Recommended worklist order: (1) overdue against the target resolution date, " +
  "(2) Critical → High → Medium → Low priority, (3) earliest target resolution date, " +
  "(4) oldest case first. Target resolution date is the case's own target, not a workflow SLA.";

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const DUE_OPTIONS = [
  { value: "OVERDUE", label: "Overdue" },
  { value: "TODAY", label: "Due today" },
  { value: "1_3", label: "Due in 1–3 days" },
  { value: "WEEK", label: "Due this week" },
  { value: "LATER", label: "Due later" },
  { value: "NONE", label: "No target date" },
  { value: "DUE_WEEK", label: "Overdue or due within 7 days" },
];

export const AGE_OPTIONS = [
  { value: "0_7", label: "0–7 days" },
  { value: "8_30", label: "8–30 days" },
  { value: "31_60", label: "31–60 days" },
  { value: "61_90", label: "61–90 days" },
  { value: "91_180", label: "91–180 days" },
  { value: "180_PLUS", label: "180+ days" },
];

export const OPENED_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export const ASSIGNED_SINCE_OPTIONS = [
  { value: "7", label: "Assigned in last 7 days" },
  { value: "30", label: "Assigned in last 30 days" },
];

const LIST_KEYS = ["families", "statuses", "priorities", "risk_bands"] as const;
const SCALAR_KEYS = [
  "search", "employer", "officer", "territory",
  "due", "age", "opened", "assigned", "date_from", "date_to",
] as const;

const EMPTY_OPTIONS: AssignedOptions = {
  statuses: [], priorities: [], risk_bands: [], families: [],
  territories: [], employers: [], officers: [],
};

const EMPTY_KPIS: AssignedKpis = {
  total: 0, overdue: 0, due_today: 0, due_week: 0,
  critical_high: 0, high_risk: 0, exposure: 0, oldest: 0,
};

export function useAssignedCases() {
  const [params, setParams] = useSearchParams();

  const requestedScope = (["mine", "team", "all"].includes(params.get("scope") || "")
    ? params.get("scope")
    : "mine") as AssignedScope;

  const filters = useMemo<AssignedFilters>(() => {
    const f: AssignedFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    if (params.get("closed") === "1") f.include_closed = true;
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

  const flatten = (patch: Partial<AssignedFilters>) => {
    const flat: Record<string, string | undefined> = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (k === "include_closed") flat.closed = v ? "1" : undefined;
      else if (Array.isArray(v)) flat[k] = v.length ? v.join(",") : undefined;
      else flat[k] = (v as string) || undefined;
    });
    return flat;
  };

  const patchFilters = useCallback(
    (patch: Partial<AssignedFilters>) => update(flatten(patch), true),
    [update],
  );

  const toggleInList = useCallback(
    (key: (typeof LIST_KEYS)[number], value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<AssignedFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { closed: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  /** Quick-filter preset: clears competing filters, then applies the preset. */
  const applyQuickFilter = useCallback(
    (patch: Partial<AssignedFilters>) => {
      const cleared: Record<string, string | undefined> = {
        priorities: undefined, risk_bands: undefined, statuses: undefined,
        due: undefined, age: undefined, opened: undefined, assigned: undefined,
      };
      Object.assign(cleared, flatten(patch));
      update(cleared, true);
    },
    [update],
  );

  const setScope = useCallback(
    (next: AssignedScope) => update({ scope: next, officer: undefined }, true),
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

  const rpcArgs = useMemo(
    () => ({ p_scope: requestedScope, p_filters: { ...filters }, p_sort: sort, p_dir: dir }),
    [requestedScope, filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-assigned-cases", rpcArgs, page, pageSize],
    queryFn: async (): Promise<AssignedResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_assigned_cases_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as AssignedResult;
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
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as AssignedOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    scope: (result?.scope ?? requestedScope) as AssignedScope,
    requestedScope,
    canTeam: result?.can_team ?? false,
    canAll: result?.can_all ?? false,
    canAssign: result?.can_assign ?? false,
    /** False when the signed-in user has no compliance officer profile at all. */
    identityResolved: result?.identity_resolved ?? true,
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
    setScope,
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
