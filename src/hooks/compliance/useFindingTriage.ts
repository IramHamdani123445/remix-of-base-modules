import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader/writer for the Finding Triage & Promotion workspace
 * (`/compliance/inspections/convert-finding`).
 *
 * Search, filters, sorting, paging and KPIs are resolved by
 * `ce_finding_triage_register_v1` so they apply to the whole authorised
 * finding population. Conversion and disposition are performed by governed,
 * transactional RPCs — the browser never writes violations directly.
 */

export interface FindingTriageFilters {
  search?: string;
  queue?: string;
  severities?: string[];
  finding_types?: string[];
  categories?: string[];
  employer?: string;
  inspection_id?: string;
  inspector?: string;
  territory?: string;
  date_from?: string;
  date_to?: string;
  age?: string;
  evidence?: string;
  duplicates_only?: boolean;
  mine_only?: boolean;
}

export interface FindingTriageRow {
  id: string;
  title: string | null;
  description: string | null;
  finding_type: string | null;
  category: string | null;
  severity: string | null;
  recommended_action: string | null;
  created_at: string;
  created_by: string | null;
  disposition: string | null;
  violation_created: boolean | null;
  violation_id: string | null;
  converted_violation_number: string | null;
  inspection_id: string | null;
  inspection_number: string | null;
  candidate_violation_type_id: string | null;
  employer_id: string | null;
  employer_name: string | null;
  territory: string;
  inspector_id: string | null;
  inspector_name: string | null;
  evidence_count: number;
  age_days: number;
  possible_duplicate: boolean;
}

export interface FindingTriageKpis {
  awaiting: number;
  critical_high: number;
  duplicates: number;
  no_evidence: number;
  oldest_pending: string | null;
  max_age_days: number;
}

export interface FindingTriageFacets {
  finding_types: string[];
  categories: string[];
  territories: string[];
  inspectors: { id: string; name: string }[];
  employers: { id: string; name: string }[];
  inspections: { id: string; number: string; employer: string }[];
}

export interface ViolationTypeOption {
  id: string;
  code: string;
  name: string;
  category: string | null;
  fund_type: string | null;
  severity_default: string | null;
  requires_supervisor_review: boolean | null;
  conversion_policy: string | null;
}

interface RegisterResult {
  scope: string;
  page: number;
  page_size: number;
  total: number;
  kpis: FindingTriageKpis;
  rows: FindingTriageRow[];
}

export const TRIAGE_QUEUES = [
  { value: "PENDING", label: "Awaiting conversion" },
  { value: "CONVERTED", label: "Converted" },
  { value: "NO_VIOLATION", label: "No violation required" },
  { value: "ALL", label: "All findings" },
];

export const TRIAGE_SORTS = [
  { value: "priority", label: "Triage priority" },
  { value: "created_at", label: "Raised date" },
  { value: "age", label: "Waiting age" },
  { value: "severity", label: "Severity" },
  { value: "employer", label: "Employer" },
  { value: "inspection", label: "Inspection" },
  { value: "finding_type", label: "Finding type" },
  { value: "evidence", label: "Evidence" },
];

export const SEVERITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

export const TRIAGE_AGE_BUCKETS = [
  { value: "LT1", label: "Under 1 day" },
  { value: "D1_3", label: "1–3 days" },
  { value: "D4_7", label: "4–7 days" },
  { value: "D8_14", label: "8–14 days" },
  { value: "D15P", label: "15+ days" },
];

export const EVIDENCE_OPTIONS = [
  { value: "HAS", label: "Has evidence" },
  { value: "NONE", label: "No evidence" },
];

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const LIST_KEYS = ["severities", "finding_types", "categories"] as const;
const SCALAR_KEYS = [
  "search", "queue", "employer", "inspection_id", "inspector",
  "territory", "date_from", "date_to", "age", "evidence",
] as const;
const BOOL_KEYS = ["duplicates_only", "mine_only"] as const;

const EMPTY_KPIS: FindingTriageKpis = {
  awaiting: 0, critical_high: 0, duplicates: 0, no_evidence: 0, oldest_pending: null, max_age_days: 0,
};

const EMPTY_FACETS: FindingTriageFacets = {
  finding_types: [], categories: [], territories: [], inspectors: [], employers: [], inspections: [],
};

export function useFindingTriage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const filters = useMemo<FindingTriageFilters>(() => {
    const f: FindingTriageFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    BOOL_KEYS.forEach((k) => {
      if (params.get(k) === "1") f[k] = true;
    });
    if (!f.queue) f.queue = "PENDING";
    return f;
  }, [params]);

  const sort = params.get("sort") || "priority";
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
    (patch: Partial<FindingTriageFilters>) => {
      const flat: Record<string, string | undefined> = {};
      Object.entries(patch).forEach(([k, v]) => {
        if (Array.isArray(v)) flat[k] = v.length ? v.join(",") : undefined;
        else if (typeof v === "boolean") flat[k] = v ? "1" : undefined;
        else flat[k] = (v as string) || undefined;
      });
      update(flat, true);
    },
    [update],
  );

  const toggleInList = useCallback(
    (key: (typeof LIST_KEYS)[number], value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<FindingTriageFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = {};
    [...SCALAR_KEYS, ...LIST_KEYS, ...BOOL_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: ["employer", "inspection", "finding_type"].includes(key) ? "asc" : "desc" }, true);
    },
    [sort, dir, update],
  );

  const changeSort = useCallback(
    (nextSort: string) => update({ sort: nextSort }, true),
    [update],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(
    () => ({ p_filters: filters, p_sort: sort, p_dir: dir }),
    [filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-finding-triage", rpcArgs, page, pageSize],
    queryFn: async (): Promise<RegisterResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_finding_triage_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as RegisterResult;
    },
    staleTime: 20_000,
  });

  const facetsQuery = useQuery({
    queryKey: ["ce-finding-triage-facets"],
    queryFn: async (): Promise<FindingTriageFacets> => {
      const { data, error } = await (supabase.rpc as any)("ce_finding_triage_facets_v1");
      if (error) throw error;
      return { ...EMPTY_FACETS, ...((data as Partial<FindingTriageFacets>) ?? {}) };
    },
    staleTime: 5 * 60_000,
  });

  const violationTypesQuery = useQuery({
    queryKey: ["ce-violation-types-active"],
    queryFn: async (): Promise<ViolationTypeOption[]> => {
      const { data, error } = await supabase
        .from("ce_violation_types")
        .select("id, code, name, category, fund_type, severity_default, requires_supervisor_review, conversion_policy")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ViolationTypeOption[];
    },
    staleTime: 5 * 60_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ce-finding-triage"] });
    queryClient.invalidateQueries({ queryKey: ["ce-finding-triage-facets"] });
  }, [queryClient]);

  const convert = useMutation({
    mutationFn: async (input: {
      findingId: string;
      violationTypeId: string;
      summary: string;
      severity: string;
      principalAmount?: number;
      duplicateOfId?: string | null;
      duplicateJustification?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("ce_convert_finding_to_violation_v1", {
        p_finding_id: input.findingId,
        p_violation_type_id: input.violationTypeId,
        p_summary: input.summary,
        p_severity: input.severity,
        p_principal_amount: input.principalAmount ?? 0,
        p_duplicate_of_id: input.duplicateOfId ?? null,
        p_duplicate_justification: input.duplicateJustification ?? null,
      });
      if (error) throw error;
      return data as { violation_id: string; violation_number: string; status: string; evidence_count: number };
    },
    onSuccess: invalidate,
  });

  const dispose = useMutation({
    mutationFn: async (input: { findingId: string; disposition: string; reason: string }) => {
      const { data, error } = await (supabase.rpc as any)("ce_dispose_finding_v1", {
        p_finding_id: input.findingId,
        p_disposition: input.disposition,
        p_reason: input.reason,
      });
      if (error) throw error;
      return data as { finding_id: string; disposition: string };
    },
    onSuccess: invalidate,
  });

  const fetchAllForExport = useCallback(async (): Promise<FindingTriageRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_finding_triage_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 200,
      p_export: true,
    });
    if (error) throw error;
    return ((data as RegisterResult)?.rows ?? []) as FindingTriageRow[];
  }, [rpcArgs]);

  const total = query.data?.total ?? 0;
  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => k !== "queue" && (Array.isArray(v) ? v.length > 0 : Boolean(v)),
  ).length;

  return {
    rows: query.data?.rows ?? [],
    kpis: query.data?.kpis ?? EMPTY_KPIS,
    scope: query.data?.scope,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    facets: facetsQuery.data ?? EMPTY_FACETS,
    violationTypes: violationTypesQuery.data ?? [],
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
    convert,
    dispose,
    fetchAllForExport,
  };
}
