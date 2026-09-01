import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  CaseRequestQueueRow,
  CaseRequestStatus,
  CaseRequestType,
} from "@/services/caseRequestsService";

/**
 * Enterprise reader for the Compliance case governance queues
 * (Case Closure, Reopen Requests, Case Merge Review).
 *
 * `ce_case_requests_v1` resolves the caller's compliance data scope BEFORE
 * filtering, then applies search, filters, ordering, paging, status counts and
 * KPI aggregation in the database — so the tab counts and KPIs describe the
 * whole authorised population, not a truncated first page.
 *
 * All list state lives in the URL query string so filters, sort, status tab,
 * page and page size survive drilling into a case and navigating back.
 */

export interface RequestFilters {
  search?: string;
  employer?: string;
  case?: string;
  requested_by?: string;
  reviewed_by?: string;
  date_from?: string;
  date_to?: string;
  reviewed_from?: string;
  reviewed_to?: string;
  waiting?: string;
  priorities?: string[];
  risk_bands?: string[];
  case_statuses?: string[];
  amount_min?: string;
  same_employer?: string;
}

export interface RequestKpis {
  pending: number;
  sla_breached: number;
  waiting_gt_3d: number;
  critical_high: number;
  exposure: number;
  oldest_pending_days: number;
  approved: number;
  rejected: number;
  cancelled: number;
}

export interface RequestOptions {
  employers: { id: string; name: string }[];
  cases: { id: string; name: string }[];
  requesters: { id: string; name: string }[];
  reviewers: { id: string; name: string }[];
  case_statuses: string[];
  priorities: string[];
  risk_bands: string[];
}

interface RequestResult {
  scope: string;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  total: number;
  rows: CaseRequestQueueRow[];
  status_counts: Record<string, number>;
  kpis: RequestKpis;
  options: Partial<RequestOptions>;
}

export const REQUEST_SORTS = [
  { value: "recommended", label: "Recommended (urgency)" },
  { value: "waiting", label: "Waiting time" },
  { value: "requested_at", label: "Requested date" },
  { value: "reviewed_at", label: "Decision date" },
  { value: "priority", label: "Case priority" },
  { value: "risk", label: "Risk band" },
  { value: "amount", label: "Case exposure" },
  { value: "employer", label: "Employer" },
  { value: "case_number", label: "Case number" },
  { value: "requester", label: "Requested by" },
] as const;

export const RECOMMENDED_REQUEST_RULE =
  "Recommended order: (1) requests past the approval SLA first, (2) longest waiting, " +
  "(3) Critical → High → Medium → Low case priority, (4) largest case exposure.";

export const WAITING_BUCKETS = [
  { value: "TODAY", label: "Waiting under 24h" },
  { value: "1_3", label: "Waiting 1–3 days" },
  { value: "4_7", label: "Waiting 4–7 days" },
  { value: "8_14", label: "Waiting 8–14 days" },
  { value: "15_PLUS", label: "Waiting 15+ days" },
];

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const REQUEST_STATUSES: CaseRequestStatus[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
];

const LIST_KEYS = ["priorities", "risk_bands", "case_statuses"] as const;
const SCALAR_KEYS = [
  "search", "case", "requested_by", "reviewed_by", "date_from", "date_to",
  "reviewed_from", "reviewed_to", "waiting", "amount_min", "same_employer",
] as const;

const EMPTY_OPTIONS: RequestOptions = {
  employers: [], cases: [], requesters: [], reviewers: [],
  case_statuses: [], priorities: [], risk_bands: [],
};

const EMPTY_KPIS: RequestKpis = {
  pending: 0, sla_breached: 0, waiting_gt_3d: 0, critical_high: 0,
  exposure: 0, oldest_pending_days: 0, approved: 0, rejected: 0, cancelled: 0,
};

export function useCaseRequests(type: CaseRequestType) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<RequestFilters>(() => {
    const f: RequestFilters = {};
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
    return f;
  }, [params]);

  const status = (params.get("status") || "PENDING").toUpperCase() as CaseRequestStatus;
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
    (patch: Partial<RequestFilters>) => {
      const flat: Record<string, string | undefined> = {};
      Object.entries(patch).forEach(([k, v]) => {
        if (k === "employer") {
          flat.regno = (v as string) || undefined;
          flat.employer = undefined;
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
    (key: "priorities" | "risk_bands" | "case_statuses", value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      patchFilters({ [key]: next } as Partial<RequestFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { regno: undefined, employer: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  /** Quick filters clear competing selections so presets never stack silently. */
  const applyQuickFilter = useCallback(
    (patch: Partial<RequestFilters>) => {
      const cleared: Record<string, string | undefined> = {
        waiting: undefined, priorities: undefined, risk_bands: undefined, same_employer: undefined,
      };
      Object.entries(patch).forEach(([k, v]) => {
        if (Array.isArray(v)) cleared[k] = v.length ? v.join(",") : undefined;
        else cleared[k] = (v as string) || undefined;
      });
      update(cleared, true);
    },
    [update],
  );

  const setStatus = useCallback((s: CaseRequestStatus) => update({ status: s }, true), [update]);
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
    () => ({ p_type: type, p_status: status, p_filters: { ...filters }, p_sort: sort, p_dir: dir }),
    [type, status, filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-case-requests", rpcArgs, page, pageSize],
    queryFn: async (): Promise<RequestResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_case_requests_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as RequestResult;
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
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as RequestOptions,
    kpis: result?.kpis ?? EMPTY_KPIS,
    statusCounts: result?.status_counts ?? {},
    scope: result?.scope,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    status,
    setStatus,
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
