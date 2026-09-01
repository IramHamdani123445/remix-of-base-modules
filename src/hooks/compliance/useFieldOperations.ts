import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader/writer for the Field Execution Workspace
 * (`/compliance/field/operations`).
 *
 * The canonical field activity record is the weekly plan item
 * (`ce_weekly_plan_items`) joined to its owning plan and, where executed, its
 * inspection. Search, filters, sorting, paging and KPIs are resolved
 * server-side by `ce_field_operations_register_v1` so they cover the whole
 * authorised population, not the fetched page. Check-in, check-out and
 * evidence registration go exclusively through governed RPCs, which is why an
 * active visit now survives a page reload.
 */

export const FIELD_EVIDENCE_BUCKET = "ce-field-evidence";

export interface FieldOpsFilters {
  search?: string;
  quick?: string;
  statuses?: string[];
  visit_types?: string[];
  territories?: string[];
  inspector?: string;
  employer?: string;
  plan_id?: string;
  date_from?: string;
  date_to?: string;
  mine_only?: boolean;
}

export interface FieldVisitRow {
  id: string;
  plan_id: string;
  plan_number: string | null;
  plan_status: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  inspector_code: string | null;
  employer_id: string | null;
  employer_name: string | null;
  territory: string | null;
  visit_type: string | null;
  purpose: string | null;
  priority: string | null;
  source_type: string | null;
  source_ref: string | null;
  is_mandatory: boolean | null;
  scheduled_date: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  execution_status: string;
  check_in_time: string | null;
  check_in_gps_lat: number | null;
  check_in_gps_lng: number | null;
  check_out_time: string | null;
  check_out_gps_lat: number | null;
  check_out_gps_lng: number | null;
  outcome_notes: string | null;
  findings_note: string | null;
  not_done_reason: string | null;
  rescheduled_to: string | null;
  created_at: string;
  updated_at: string | null;
  inspection_id: string | null;
  inspection_number: string | null;
  inspection_status: string | null;
  evidence_count: number;
  findings_count: number;
  working_papers_count: number;
  duration_minutes: number | null;
  is_overdue: boolean;
  age_days: number | null;
}

export interface FieldOpsKpis {
  total: number;
  active_visits: number;
  scheduled_today: number;
  planned: number;
  in_progress: number;
  completed: number;
  overdue: number;
  evidence_total: number;
  no_evidence: number;
  findings_total: number;
  avg_visit_minutes: number | null;
}

export interface FieldOpsFacets {
  statuses: string[];
  visit_types: string[];
  territories: string[];
  inspectors: { id: string | null; name: string }[];
  employers: { id: string; name: string }[];
}

interface RegisterResult {
  scope: string;
  user_id: string | null;
  page: number;
  page_size: number;
  total: number;
  kpis: FieldOpsKpis;
  rows: FieldVisitRow[];
}

export interface FieldVisitDetail {
  item: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  inspection: Record<string, unknown> | null;
  evidence: {
    id: string;
    evidence_type: string | null;
    file_name: string | null;
    file_url: string | null;
    description: string | null;
    captured_at: string | null;
    captured_by: string | null;
  }[];
  findings: { id: string; title: string | null; severity: string | null; created_at: string }[];
  audit: {
    action: string;
    performed_by: string | null;
    performed_at: string;
    snapshot: Record<string, unknown> | null;
  }[];
}

export const QUICK_VIEWS = [
  { value: "ALL", label: "All visits" },
  { value: "ACTIVE", label: "Active check-ins" },
  { value: "TODAY", label: "Scheduled today" },
  { value: "PLANNED", label: "Planned" },
  { value: "COMPLETED", label: "Completed" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "NO_EVIDENCE", label: "Executed without evidence" },
  { value: "MINE", label: "My visits" },
];

export const EXECUTION_STATUS_OPTIONS = [
  { value: "PLANNED", label: "Planned" },
  { value: "PENDING", label: "Pending" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "NOT_DONE", label: "Not done" },
  { value: "RESCHEDULED", label: "Rescheduled" },
];

export const FIELD_SORTS = [
  { value: "schedule", label: "Scheduled date" },
  { value: "employer", label: "Employer" },
  { value: "inspector", label: "Inspector" },
  { value: "status", label: "Execution status" },
  { value: "evidence", label: "Evidence count" },
  { value: "checkin", label: "Check-in time" },
  { value: "territory", label: "Territory" },
];

export const DATE_PRESETS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "ALL", label: "All time" },
];

export const EVIDENCE_TYPES = [
  { value: "PHOTO", label: "Photo" },
  { value: "DOCUMENT", label: "Document" },
  { value: "SIGNED_FORM", label: "Signed form" },
  { value: "AUDIO", label: "Audio recording" },
];

export const PAGE_SIZE_OPTIONS = [25, 50, 100];

const LIST_KEYS = ["statuses", "visit_types", "territories"] as const;
const SCALAR_KEYS = ["search", "quick", "inspector", "employer", "plan_id", "date_from", "date_to"] as const;

const EMPTY_KPIS: FieldOpsKpis = {
  total: 0, active_visits: 0, scheduled_today: 0, planned: 0, in_progress: 0,
  completed: 0, overdue: 0, evidence_total: 0, no_evidence: 0, findings_total: 0,
  avg_visit_minutes: null,
};

const EMPTY_FACETS: FieldOpsFacets = {
  statuses: [], visit_types: [], territories: [], inspectors: [], employers: [],
};

/** Best-effort browser geolocation; never blocks the governed action. */
export async function captureGps(): Promise<{ lat: number | null; lng: number | null }> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { lat: null, lng: null };
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ lat: null, lng: null }), 6000);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
      () => { clearTimeout(timer); resolve({ lat: null, lng: null }); },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 30_000 },
    );
  });
}

export function useFieldVisitDetail(itemId: string | null) {
  return useQuery({
    queryKey: ["ce-field-visit-detail", itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<FieldVisitDetail> => {
      const { data, error } = await (supabase.rpc as any)("ce_field_visit_detail_v1", {
        p_item_id: itemId,
      });
      if (error) throw error;
      return data as FieldVisitDetail;
    },
  });
}

export function useFieldOperations() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();

  const filters = useMemo<FieldOpsFilters>(() => {
    const f: FieldOpsFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    if (params.get("mine_only") === "1") f.mine_only = true;
    if (!f.quick) f.quick = "ALL";
    return f;
  }, [params]);

  const datePreset = params.get("range") || (filters.date_from || filters.date_to ? "CUSTOM" : "ALL");

  const effectiveFilters = useMemo<FieldOpsFilters>(() => {
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

  const sort = params.get("sort") || "schedule";
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
    (patch: Partial<FieldOpsFilters>) => {
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
      patchFilters({ [key]: next } as Partial<FieldOpsFilters>);
    },
    [filters, patchFilters],
  );

  const setDatePreset = useCallback(
    (value: string) => {
      if (value === "CUSTOM") update({ range: "CUSTOM" }, true);
      else update({ range: value, date_from: undefined, date_to: undefined }, true);
    },
    [update],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { range: undefined, mine_only: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: ["employer", "inspector", "territory", "status"].includes(key) ? "asc" : "desc" }, true);
    },
    [sort, dir, update],
  );

  const rpcArgs = useMemo(
    () => ({ p_filters: effectiveFilters, p_sort: sort, p_dir: dir }),
    [effectiveFilters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-field-operations", rpcArgs, page, pageSize],
    queryFn: async (): Promise<RegisterResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_field_operations_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as RegisterResult;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: false,
  });

  const facetsQuery = useQuery({
    queryKey: ["ce-field-operations-facets"],
    queryFn: async (): Promise<FieldOpsFacets> => {
      const { data, error } = await (supabase.rpc as any)("ce_field_operations_facets_v1");
      if (error) throw error;
      return { ...EMPTY_FACETS, ...((data as Partial<FieldOpsFacets>) ?? {}) };
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["ce-field-operations"] });
    queryClient.invalidateQueries({ queryKey: ["ce-field-visit-detail"] });
  }, [queryClient]);

  const checkIn = useMutation({
    mutationFn: async (input: { itemId: string; notes?: string; gpsUnavailableReason?: string }) => {
      const gps = await captureGps();
      const { data, error } = await (supabase.rpc as any)("ce_field_visit_check_in_v1", {
        p_item_id: input.itemId,
        p_notes: input.notes ?? null,
        p_lat: gps.lat,
        p_lng: gps.lng,
        p_gps_unavailable_reason:
          gps.lat === null ? (input.gpsUnavailableReason || "GPS unavailable on device") : null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const checkOut = useMutation({
    mutationFn: async (input: { itemId: string; outcomeNotes: string; findings?: string }) => {
      const gps = await captureGps();
      const { data, error } = await (supabase.rpc as any)("ce_field_visit_check_out_v1", {
        p_item_id: input.itemId,
        p_outcome_notes: input.outcomeNotes,
        p_findings: input.findings ?? null,
        p_lat: gps.lat,
        p_lng: gps.lng,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: invalidate,
  });

  const addEvidence = useMutation({
    mutationFn: async (input: {
      itemId: string;
      files: File[];
      evidenceType: string;
      description?: string;
    }) => {
      const gps = await captureGps();
      let stored = 0;
      for (const file of input.files) {
        const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
        const path = `${input.itemId}/${Date.now()}-${safeName}`;
        const { error: upErr } = await supabase.storage
          .from(FIELD_EVIDENCE_BUCKET)
          .upload(path, file, { upsert: false });
        if (upErr) throw upErr;
        const { error } = await (supabase.rpc as any)("ce_field_visit_add_evidence_v1", {
          p_item_id: input.itemId,
          p_evidence_type: input.evidenceType,
          p_file_name: file.name,
          p_file_url: path,
          p_file_size: file.size,
          p_description: input.description ?? null,
          p_lat: gps.lat,
          p_lng: gps.lng,
        });
        if (error) throw error;
        stored += 1;
      }
      return { stored };
    },
    onSuccess: invalidate,
  });

  const fetchAllForExport = useCallback(async (): Promise<FieldVisitRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_field_operations_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 2000,
      p_export: true,
    });
    if (error) throw error;
    return ((data as RegisterResult)?.rows ?? []) as FieldVisitRow[];
  }, [rpcArgs]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    SCALAR_KEYS.forEach((k) => { if (k !== "quick" && filters[k]) n += 1; });
    LIST_KEYS.forEach((k) => { n += (filters[k]?.length ?? 0); });
    if (filters.mine_only) n += 1;
    if (datePreset !== "ALL") n += 1;
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
    page,
    pageSize,
    setPage: (p: number) => update({ page: String(Math.max(1, p)) }),
    setPageSize: (n: number) => update({ size: String(n) }, true),
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    kpis: query.data?.kpis ?? EMPTY_KPIS,
    scope: query.data?.scope ?? null,
    userId: query.data?.user_id ?? null,
    facets: facetsQuery.data ?? EMPTY_FACETS,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    checkIn,
    checkOut,
    addEvidence,
    fetchAllForExport,
    invalidate,
  };
}
