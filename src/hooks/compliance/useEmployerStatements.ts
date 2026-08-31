import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Compliance Employer Statement Register
 * (/compliance/field/employer-statements).
 *
 * The financial position of every employer is computed in the database by
 * `ce_employer_statement_register_v1`, which reads the immutable
 * `ce_v_ledger_period_balances` view (posted, non-reversed ledger entries with
 * the statutory allocation waterfall applied). Nothing is aggregated in the
 * browser, so the register stays correct and fast as the ledger grows.
 *
 * "As of" is a statement date: periods after the month of that date are
 * excluded, which is how a back-dated statement must be produced.
 *
 * All list state lives in the URL so the as-of date, filters, sort, page and
 * page size survive drilling into a full statement and coming back.
 */

export interface StatementFilters {
  search?: string;
  territory?: string;
  positions?: string[];
  bands?: string[];
  funds?: string[];
  arrangement?: string;
  min_outstanding?: string;
  max_outstanding?: string;
  period_from?: string;
  period_to?: string;
}

export interface StatementRow {
  rn: number;
  employer_id: string;
  employer_name: string;
  territory: string;
  principal_outstanding: number;
  penalty_outstanding: number;
  interest_outstanding: number;
  total_outstanding: number;
  total_charged: number;
  payments_received: number;
  waivers_applied: number;
  write_offs: number;
  credit_available: number;
  payments_12m: number;
  entry_count: number;
  period_count: number;
  first_period: string | null;
  last_period: string | null;
  oldest_arrears_period: string | null;
  funds_in_arrears: string[];
  last_entry_at: string | null;
  last_payment_at: string | null;
  has_arrangement: boolean;
  arrangement_status: string | null;
  arrangement_next_due: string | null;
  open_violations: number;
  open_cases: number;
  position_status: "IN_ARREARS" | "UNDER_ARRANGEMENT" | "SETTLED" | "IN_CREDIT";
  ageing_band: string;
  arrears_age_months: number;
}

export interface StatementKpis {
  employers: number;
  outstanding: number;
  principal: number;
  penalty: number;
  interest: number;
  charged: number;
  paid: number;
  credits: number;
  in_arrears: number;
  settled: number;
  in_credit: number;
  under_arrangement: number;
  aged_over_12m: number;
  oldest_months: number;
}

export interface StatementOptions {
  territories: string[];
  funds: string[];
  positions: string[];
  bands: string[];
  period_min: string | null;
  period_max: string | null;
}

interface StatementResult {
  as_of: string;
  period_cutoff: string;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  can_export: boolean;
  total: number;
  rows: StatementRow[];
  kpis_all: StatementKpis;
  kpis_filtered: StatementKpis;
  options: Partial<StatementOptions>;
}

export const STATEMENT_SORTS = [
  { value: "outstanding", label: "Outstanding balance" },
  { value: "principal", label: "Principal outstanding" },
  { value: "penalty", label: "Penalty outstanding" },
  { value: "interest", label: "Interest outstanding" },
  { value: "charged", label: "Total charged" },
  { value: "paid", label: "Total paid" },
  { value: "age", label: "Arrears age" },
  { value: "periods", label: "Periods in statement" },
  { value: "last_payment", label: "Last payment" },
  { value: "employer", label: "Employer name" },
  { value: "employer_id", label: "Registration no." },
] as const;

export const POSITION_LABELS: Record<string, string> = {
  IN_ARREARS: "In arrears",
  UNDER_ARRANGEMENT: "Under arrangement",
  SETTLED: "Settled",
  IN_CREDIT: "In credit",
};

export const BAND_LABELS: Record<string, string> = {
  CURRENT: "No arrears",
  "0_3": "0–3 months",
  "4_12": "4–12 months",
  "13_36": "13–36 months",
  "36_PLUS": "Over 36 months",
};

export const FUND_LABELS: Record<string, string> = {
  SS: "Social Security",
  LEVY: "Housing & Social Development Levy",
  EI: "Employment Injury",
};

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const LIST_KEYS = ["positions", "bands", "funds"] as const;
const SCALAR_KEYS = [
  "search",
  "territory",
  "arrangement",
  "min_outstanding",
  "max_outstanding",
  "period_from",
  "period_to",
] as const;

const EMPTY_KPIS: StatementKpis = {
  employers: 0, outstanding: 0, principal: 0, penalty: 0, interest: 0,
  charged: 0, paid: 0, credits: 0, in_arrears: 0, settled: 0,
  in_credit: 0, under_arrangement: 0, aged_over_12m: 0, oldest_months: 0,
};

const EMPTY_OPTIONS: StatementOptions = {
  territories: [], funds: ["SS", "LEVY", "EI"],
  positions: ["IN_ARREARS", "UNDER_ARRANGEMENT", "SETTLED", "IN_CREDIT"],
  bands: ["CURRENT", "0_3", "4_12", "13_36", "36_PLUS"],
  period_min: null, period_max: null,
};

const isoToday = () => new Date().toISOString().slice(0, 10);

export function useEmployerStatements() {
  const [params, setParams] = useSearchParams();

  const asOf = params.get("as_of") || isoToday();

  const filters = useMemo<StatementFilters>(() => {
    const f: StatementFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    return f;
  }, [params]);

  const sort = params.get("sort") || "outstanding";
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

  const flatten = (patch: Partial<StatementFilters>) => {
    const flat: Record<string, string | undefined> = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (Array.isArray(v)) flat[k] = v.length ? v.join(",") : undefined;
      else flat[k] = (v as string) || undefined;
    });
    return flat;
  };

  const patchFilters = useCallback(
    (patch: Partial<StatementFilters>) => update(flatten(patch), true),
    [update],
  );

  const toggleInList = useCallback(
    (key: (typeof LIST_KEYS)[number], value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      patchFilters({ [key]: next } as Partial<StatementFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = {};
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const applyQuickFilter = useCallback(
    (patch: Partial<StatementFilters>) => {
      const cleared: Record<string, string | undefined> = {
        positions: undefined, bands: undefined, arrangement: undefined,
        min_outstanding: undefined, max_outstanding: undefined,
      };
      Object.assign(cleared, flatten(patch));
      update(cleared, true);
    },
    [update],
  );

  const setAsOf = useCallback(
    (date: string) => update({ as_of: date === isoToday() ? undefined : date }, true),
    [update],
  );
  const changeSort = useCallback(
    (nextSort: string, nextDir?: "asc" | "desc") =>
      update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );
  const toggleDir = useCallback(
    () => update({ dir: dir === "asc" ? "desc" : "asc" }, true),
    [update, dir],
  );
  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(
    () => ({ p_as_of: asOf, p_filters: { ...filters }, p_sort: sort, p_dir: dir }),
    [asOf, filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-employer-statements", rpcArgs, page, pageSize],
    queryFn: async (): Promise<StatementResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_employer_statement_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as StatementResult;
    },
    staleTime: 30_000,
    retry: 1,
  });

  /** Full filtered result set (all pages) for export — same governed reader. */
  const fetchAllForExport = useCallback(async (): Promise<StatementRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_employer_statement_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 200,
    });
    if (error) throw error;
    const first = data as StatementResult;
    const rows = [...(first.rows ?? [])];
    const pages = Math.ceil((first.total ?? 0) / 200);
    for (let p = 2; p <= pages; p++) {
      const { data: more, error: err } = await (supabase.rpc as any)(
        "ce_employer_statement_register_v1",
        { ...rpcArgs, p_page: p, p_page_size: 200 },
      );
      if (err) throw err;
      rows.push(...(((more as StatementResult).rows) ?? []));
    }
    return rows;
  }, [rpcArgs]);

  const result = query.data;
  const total = result?.total ?? 0;
  const activeFilterCount = Object.entries(filters).filter(([, v]) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  ).length;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as StatementOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    canExport: result?.can_export ?? false,
    periodCutoff: result?.period_cutoff ?? "",
    asOf,
    setAsOf,
    filters,
    patchFilters,
    toggleInList,
    resetFilters,
    applyQuickFilter,
    activeFilterCount,
    sort,
    dir,
    changeSort,
    toggleDir,
    page,
    pageSize,
    setPage,
    setPageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    fetchAllForExport,
  };
}
