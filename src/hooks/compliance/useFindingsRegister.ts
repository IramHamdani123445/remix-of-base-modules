import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Inspection Findings Register
 * (`/compliance/field/findings`).
 *
 * This is the MASTER lifecycle register: every finding in the authorised
 * scope regardless of disposition. The Conversion Queue
 * (`/compliance/inspections/convert-finding`) remains the narrower work queue
 * of findings still eligible for promotion to a violation.
 *
 * Search, filters, sorting, paging, KPIs and the disposition summary are all
 * resolved server-side by `ce_findings_register_v1`, so they apply to the full
 * authorised population rather than a fetched page. Writes go exclusively
 * through the same governed RPCs used by the Conversion Queue.
 */

export interface FindingsRegisterFilters {
  search?: string;
  quick?: string;
  severities?: string[];
  finding_types?: string[];
  categories?: string[];
  dispositions?: string[];
  employer?: string;
  inspection_id?: string;
  inspector?: string;
  territory?: string;
  date_from?: string;
  date_to?: string;
  age?: string;
  evidence?: string;
  violation_outcome?: string;
  mine_only?: boolean;
}

export interface FindingsRegisterRow {
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
  disposition_code: string;
  review_notes: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  converted_by: string | null;
  converted_at: string | null;
  violation_created: boolean | null;
  violation_id: string | null;
  violation_number: string | null;
  violation_status: string | null;
  violation_outcome: string;
  inspection_id: string | null;
  inspection_number: string | null;
  inspection_status: string | null;
  visit_date: string | null;
  candidate_violation_type_id: string | null;
  employer_id: string | null;
  employer_name: string | null;
  territory: string;
  inspector_id: string | null;
  inspector_name: string | null;
  evidence_count: number;
  age_days: number;
  follow_up_required: boolean | null;
}

export interface FindingsRegisterKpis {
  total: number;
  pending_review: number;
  critical_high: number;
  converted: number;
  no_violation: number;
  no_evidence: number;
  oldest_pending: string | null;
}

export interface FindingsRegisterFacets {
  finding_types: string[];
  categories: string[];
  territories: string[];
  inspectors: { id: string; name: string }[];
  employers: { id: string; name: string }[];
  inspections: { id: string; number: string; employer: string }[];
}

interface RegisterResult {
  scope: string;
  actor_code: string | null;
  page: number;
  page_size: number;
  total: number;
  kpis: FindingsRegisterKpis;
  disposition_summary: Record<string, number>;
  conversion_queue_count: number;
  rows: FindingsRegisterRow[];
}

export const QUICK_FILTERS = [
  { value: "ALL", label: "All findings" },
  { value: "PENDING", label: "Pending review" },
  { value: "CRITICAL_HIGH", label: "Critical / High" },
  { value: "CONVERTED", label: "Converted" },
  { value: "NOT_CONVERTED", label: "Not converted" },
  { value: "NO_VIOLATION", label: "No violation required" },
  { value: "NO_EVIDENCE", label: "No evidence" },
  { value: "MINE", label: "My inspections" },
];

export const DISPOSITION_OPTIONS = [
  { value: "PENDING_REVIEW", label: "Pending review" },
  { value: "FLAG_FOR_REVIEW", label: "Flagged for supervisor review" },
  { value: "VIOLATION_CANDIDATE", label: "Violation candidate" },
  { value: "INFORMATIONAL", label: "No violation required (informational)" },
  { value: "CONVERTED", label: "Converted to violation" },
];

export const VIOLATION_OUTCOME_OPTIONS = [
  { value: "NOT_CONVERTED", label: "Not converted" },
  { value: "CONVERSION_PENDING", label: "Conversion pending" },
  { value: "VERIFICATION_PENDING", label: "Verification pending" },
  { value: "OPEN_VIOLATION", label: "Open violation" },
  { value: "RESOLVED_VIOLATION", label: "Resolved violation" },
  { value: "VIOLATION_CREATED", label: "Violation created" },
];

export const REGISTER_SORTS = [
  { value: "register", label: "Register priority (pending first)" },
  { value: "created_at", label: "Finding date" },
  { value: "age", label: "Pending age" },
  { value: "severity", label: "Severity" },
  { value: "employer", label: "Employer" },
  { value: "inspection", label: "Inspection number" },
  { value: "finding_type", label: "Finding type" },
  { value: "disposition", label: "Disposition" },
  { value: "evidence", label: "Evidence count" },
  { value: "violation", label: "Violation outcome" },
];

export const SEVERITY_OPTIONS = ["Critical", "High", "Medium", "Low"];

export const AGE_BUCKETS = [
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

export const DATE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
  { value: "ALL", label: "All time" },
];

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

const LIST_KEYS = ["severities", "finding_types", "categories", "dispositions"] as const;
const SCALAR_KEYS = [
  "search", "quick", "employer", "inspection_id", "inspector",
  "territory", "date_from", "date_to", "age", "evidence", "violation_outcome",
] as const;
const BOOL_KEYS = ["mine_only"] as const;

const EMPTY_KPIS: FindingsRegisterKpis = {
  total: 0, pending_review: 0, critical_high: 0, converted: 0,
  no_violation: 0, no_evidence: 0, oldest_pending: null,
};

const EMPTY_FACETS: FindingsRegisterFacets = {
  finding_types: [], categories: [], territories: [], inspectors: [], employers: [], inspections: [],
};

export interface FindingDetail {
  finding: Record<string, unknown> | null;
  inspection: Record<string, unknown> | null;
  violation: { id: string; violation_number: string; status: string; severity: string | null; created_at: string } | null;
  candidate_violation_type: {
    id: string; code: string; name: string;
    conversion_policy: string | null;
    requires_supervisor_review: boolean | null;
    maker_checker_required: boolean | null;
  } | null;
  evidence: {
    id: string; evidence_type: string | null; file_name: string | null;
    file_url: string | null; description: string | null;
    captured_at: string | null; captured_by: string | null;
  }[];
  timeline: {
    action: string; entity_type: string; performed_by: string | null; performed_at: string;
    description: string | null; reason: string | null;
    old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null;
  }[];
}

export interface ViolationTypeOption {
  id: string;
  code: string;
  name: string;
  severity_default?: string | null;
  conversion_policy?: string | null;
}

/** Active violation types used for candidate classification and conversion. */
export function useActiveViolationTypes() {
  return useQuery({
    queryKey: ["ce-violation-types-active"],
    queryFn: async (): Promise<ViolationTypeOption[]> => {
      const { data, error } = await supabase
        .from("ce_violation_types")
        .select("id, code, name, severity_default, conversion_policy")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ViolationTypeOption[];
    },
    staleTime: 5 * 60_000,
  });
}

export function useFindingDetail(findingId: string | null) {
  return useQuery({
    queryKey: ["ce-finding-detail", findingId],
    enabled: !!findingId,
    queryFn: async (): Promise<FindingDetail> => {
      const { data, error } = await (supabase.rpc as any)("ce_finding_detail_v1", {
        p_finding_id: findingId,
      });
      if (error) throw error;
      return data as FindingDetail;
    },
  });
}

export function useFindingsRegister() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const filters = useMemo<FindingsRegisterFilters>(() => {
    const f: FindingsRegisterFilters = {};
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
    if (!f.quick) f.quick = "ALL";
    return f;
  }, [params]);

  /** Date preset: default is the last 90 days, but every older finding stays reachable. */
  const datePreset = params.get("range") || (filters.date_from || filters.date_to ? "CUSTOM" : "90");

  const effectiveFilters = useMemo<FindingsRegisterFilters>(() => {
    const f = { ...filters };
    if (datePreset !== "CUSTOM" && datePreset !== "ALL") {
      const days = Number(datePreset);
      if (Number.isFinite(days) && days > 0) {
        const from = new Date();
        from.setDate(from.getDate() - days);
        f.date_from = from.toISOString().slice(0, 10);
        f.date_to = undefined;
      }
    }
    return f;
  }, [filters, datePreset]);

  const sort = params.get("sort") || "register";
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
    (patch: Partial<FindingsRegisterFilters>) => {
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

  const setDatePreset = useCallback(
    (value: string) => {
      if (value === "CUSTOM") update({ range: "CUSTOM" }, true);
      else update({ range: value, date_from: undefined, date_to: undefined }, true);
    },
    [update],
  );

  const toggleInList = useCallback(
    (key: (typeof LIST_KEYS)[number], value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<FindingsRegisterFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { range: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS, ...BOOL_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: ["employer", "inspection", "finding_type", "disposition"].includes(key) ? "asc" : "desc" }, true);
    },
    [sort, dir, update],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(
    () => ({ p_filters: effectiveFilters, p_sort: sort, p_dir: dir }),
    [effectiveFilters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-findings-register", rpcArgs, page, pageSize],
    queryFn: async (): Promise<RegisterResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_findings_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as RegisterResult;
    },
    staleTime: 20_000,
    retry: false,
  });

  const facetsQuery = useQuery({
    queryKey: ["ce-findings-register-facets"],
    queryFn: async (): Promise<FindingsRegisterFacets> => {
      const { data, error } = await (supabase.rpc as any)("ce_findings_register_facets_v1");
      if (error) throw error;
      return { ...EMPTY_FACETS, ...((data as Partial<FindingsRegisterFacets>) ?? {}) };
    },
    staleTime: 5 * 60_000,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ce-findings-register"] });
    queryClient.invalidateQueries({ queryKey: ["ce-finding-detail"] });
    queryClient.invalidateQueries({ queryKey: ["ce-finding-triage"] });
  }, [queryClient]);

  /** Governed classification — identical service used by the Conversion Queue. */
  const classify = useMutation({
    mutationFn: async (input: {
      findingId: string;
      disposition: string;
      reason: string;
      candidateViolationTypeId?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("ce_classify_finding_v1", {
        p_finding_id: input.findingId,
        p_disposition: input.disposition,
        p_reason: input.reason,
        p_candidate_violation_type_id: input.candidateViolationTypeId ?? null,
      });
      if (error) throw error;
      return data as { finding_id: string; disposition: string };
    },
    onSuccess: invalidate,
  });

  /** Canonical Finding -> Violation conversion (same transactional RPC as the queue). */
  const convert = useMutation({
    mutationFn: async (input: {
      findingId: string;
      violationTypeId: string;
      summary: string;
      severity: string;
      principalAmount?: number;
    }) => {
      const { data, error } = await (supabase.rpc as any)("ce_convert_finding_to_violation_v1", {
        p_finding_id: input.findingId,
        p_violation_type_id: input.violationTypeId,
        p_summary: input.summary,
        p_severity: input.severity,
        p_principal_amount: input.principalAmount ?? 0,
        p_duplicate_of_id: null,
        p_duplicate_justification: null,
      });
      if (error) throw error;
      return data as { violation_id: string; violation_number: string; status: string; evidence_count: number };
    },
    onSuccess: invalidate,
  });

  const fetchAllForExport = useCallback(async (): Promise<FindingsRegisterRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_findings_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 200,
      p_export: true,
    });
    if (error) throw error;
    return ((data as RegisterResult)?.rows ?? []) as FindingsRegisterRow[];
  }, [rpcArgs]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    SCALAR_KEYS.forEach((k) => { if (k !== "quick" && filters[k]) n += 1; });
    LIST_KEYS.forEach((k) => { n += (filters[k]?.length ?? 0); });
    if (filters.mine_only) n += 1;
    if (datePreset !== "90") n += 1;
    return n;
  }, [filters, datePreset]);

  return {
    filters,
    datePreset,
    setDatePreset,
    patchFilters,
    toggleInList,
    resetFilters,
    activeFilterCount,
    sort,
    dir,
    toggleSort,
    changeSort: (s: string) => update({ sort: s }, true),
    page,
    pageSize,
    setPage,
    setPageSize,
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    kpis: query.data?.kpis ?? EMPTY_KPIS,
    dispositionSummary: query.data?.disposition_summary ?? {},
    conversionQueueCount: query.data?.conversion_queue_count ?? 0,
    scope: query.data?.scope ?? null,
    actorCode: query.data?.actor_code ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    facets: facetsQuery.data ?? EMPTY_FACETS,
    classify,
    convert,
    fetchAllForExport,
    invalidate,
  };
}
