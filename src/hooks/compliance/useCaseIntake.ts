import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for Compliance Case Intake (/compliance/cases/intake).
 *
 * Intake is the triage surface for cases that are still awaiting an officer:
 * `ce_case_intake_v1` resolves the caller's compliance scope, restricts to
 * unassigned, non-terminal cases, derives the fund from linked violations when
 * the case header has none, and then filters / sorts / pages / aggregates in
 * the database so counters describe the whole authorised intake population.
 *
 * All list state lives in the URL so filters, sort, page and page size survive
 * navigating into a case and back.
 */

export interface IntakeFilters {
  search?: string;
  employer?: string;
  families?: string[];
  funds?: string[];
  statuses?: string[];
  priorities?: string[];
  risk_bands?: string[];
  territory?: string;
  date_from?: string;
  date_to?: string;
  opened?: string;
  wait?: string;
  amount_min?: string;
  amount_max?: string;
  incomplete?: boolean;
}

export interface IntakeRow {
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
  created_at: string | null;
  case_family: string;
  fund_display: string;
  violation_count: number | null;
  linked_violations: number | null;
  summary: string | null;
  waiting_days: number;
  wait_bucket: string;
  data_incomplete: boolean;
}

export interface IntakeKpis {
  total: number;
  critical_high: number;
  high_risk: number;
  waiting_gt_3: number;
  opened_today: number;
  incomplete: number;
  oldest_waiting: number;
  exposure: number;
}

export interface IntakeOptions {
  families: string[];
  funds: string[];
  statuses: string[];
  priorities: string[];
  risk_bands: string[];
  territories: string[];
  employers: { id: string; name: string }[];
}

interface IntakeResult {
  scope: string;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  sla_configured: boolean;
  total: number;
  rows: IntakeRow[];
  kpis_all: IntakeKpis;
  kpis_filtered: IntakeKpis;
  options: Partial<IntakeOptions>;
}

export const INTAKE_SORTS = [
  { value: "recommended", label: "Recommended (triage)" },
  { value: "waiting", label: "Waiting time" },
  { value: "priority", label: "Priority" },
  { value: "risk", label: "Risk band" },
  { value: "amount", label: "Exposure amount" },
  { value: "opened_date", label: "Opened date" },
  { value: "employer", label: "Employer" },
  { value: "family", label: "Case family" },
  { value: "fund", label: "Fund" },
  { value: "case_number", label: "Case number" },
] as const;

export const RECOMMENDED_INTAKE_RULE =
  "Recommended triage order: (1) Critical → High → Medium → Low priority, (2) longest waiting " +
  "unassigned first, (3) highest employer risk band. No assignment SLA is configured for " +
  "compliance cases, so SLA is not part of the ordering.";

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const WAIT_BUCKETS = [
  { value: "LT_1", label: "Under 1 day" },
  { value: "1_3", label: "1–3 days" },
  { value: "4_7", label: "4–7 days" },
  { value: "8_14", label: "8–14 days" },
  { value: "15_PLUS", label: "15+ days" },
  { value: "GT_3", label: "Waiting more than 3 days" },
];

export const OPENED_OPTIONS = [
  { value: "TODAY", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

export const AMOUNT_RANGES = [
  { value: "0-1000", label: "Under $1,000" },
  { value: "1000-5000", label: "$1,000 – $5,000" },
  { value: "5000-10000", label: "$5,000 – $10,000" },
  { value: "10000-50000", label: "$10,000 – $50,000" },
  { value: "50000-", label: "$50,000+" },
];

const LIST_KEYS = ["families", "funds", "statuses", "priorities", "risk_bands"] as const;
const SCALAR_KEYS = [
  "search", "employer", "territory", "date_from", "date_to",
  "opened", "wait", "amount_min", "amount_max",
] as const;

const EMPTY_OPTIONS: IntakeOptions = {
  families: [], funds: [], statuses: [], priorities: [], risk_bands: [], territories: [], employers: [],
};

const EMPTY_KPIS: IntakeKpis = {
  total: 0, critical_high: 0, high_risk: 0, waiting_gt_3: 0,
  opened_today: 0, incomplete: 0, oldest_waiting: 0, exposure: 0,
};

export function useCaseIntake() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<IntakeFilters>(() => {
    const f: IntakeFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    if (params.get("incomplete") === "1") f.incomplete = true;
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
    (patch: Partial<IntakeFilters>) => {
      const flat: Record<string, string | undefined> = {};
      Object.entries(patch).forEach(([k, v]) => {
        if (k === "incomplete") flat.incomplete = v ? "1" : undefined;
        else if (Array.isArray(v)) flat[k] = v.length ? v.join(",") : undefined;
        else flat[k] = (v as string) || undefined;
      });
      update(flat, true);
    },
    [update],
  );

  const toggleInList = useCallback(
    (key: "families" | "funds" | "statuses" | "priorities" | "risk_bands", value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<IntakeFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { incomplete: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  /** Quick-filter preset: clears competing filters, then applies the preset. */
  const applyQuickFilter = useCallback(
    (patch: Partial<IntakeFilters>) => {
      const cleared: Record<string, string | undefined> = {
        priorities: undefined, risk_bands: undefined, wait: undefined,
        opened: undefined, amount_min: undefined, amount_max: undefined, incomplete: undefined,
      };
      Object.entries(patch).forEach(([k, v]) => {
        if (k === "incomplete") cleared.incomplete = v ? "1" : undefined;
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
    queryKey: ["ce-case-intake", rpcArgs, page, pageSize],
    queryFn: async (): Promise<IntakeResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_case_intake_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as IntakeResult;
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
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as IntakeOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    scope: result?.scope,
    slaConfigured: result?.sla_configured ?? false,
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
