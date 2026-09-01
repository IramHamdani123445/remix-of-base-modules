import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Enterprise reader for the Field Audit Reports Register
 * (`/compliance/field/all-reports`).
 *
 * Search, filters, sorting, paging, KPIs and filter options are resolved by
 * `ce_audit_report_register_v1`, so they apply to the whole authorised report
 * population rather than a truncated browser page. The database resolves the
 * caller's compliance data scope BEFORE any filter is applied — an officer can
 * never widen access by clearing filters.
 *
 * All list state lives in the URL query string so a filtered register is
 * bookmarkable and survives drilling into a report and navigating back.
 */

export interface AuditReportFilters {
  search?: string;
  statuses?: string[];
  acknowledgments?: string[];
  employer?: string;
  inspector?: string;
  territory?: string;
  date_from?: string;
  date_to?: string;
  findings?: string;
  violations?: string;
  pdf?: string;
  attention?: string;
  age?: string;
}

export interface AuditReportRow {
  id: string;
  report_number: string;
  inspection_id: string | null;
  inspection_number: string | null;
  territory: string;
  employer_id: string | null;
  employer_name: string;
  employer_reg_number: string | null;
  inspector_id: string | null;
  inspector_name: string | null;
  report_date: string | null;
  audit_date: string | null;
  status: string;
  lifecycle_stage: "DRAFT" | "FINAL" | "AWAITING_ACK" | "ACKNOWLEDGED" | "SUPERSEDED";
  acknowledgment_status: string;
  total_findings: number;
  total_violations: number;
  total_evidence: number;
  checklist_completion_pct: number;
  current_version: number;
  version_count: number;
  risk_rating: string | null;
  has_pdf: boolean;
  pdf_url: string | null;
  signed_pdf_url: string | null;
  internal_pdf_url: string | null;
  employer_pdf_url: string | null;
  generated_at: string | null;
  finalized_at: string | null;
  acknowledgment_sent_at: string | null;
  acknowledgment_completed_at: string | null;
  ack_days_outstanding: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  age_days: number;
  draft_ageing: boolean;
  ack_overdue: boolean;
  missing_pdf: boolean;
}

export interface AuditReportKpis {
  total: number;
  draft: number;
  final: number;
  awaiting_ack: number;
  acknowledged: number;
  attention: number;
  findings: number;
  violations: number;
}

export interface AuditReportOptions {
  statuses: string[];
  acknowledgments: string[];
  territories: string[];
  inspectors: { id: string; name: string }[];
  employers: { id: string; name: string }[];
}

interface RegisterResult {
  scope: string;
  actor_code: string | null;
  page: number;
  page_size: number;
  sort: string;
  dir: "asc" | "desc";
  total: number;
  rows: AuditReportRow[];
  kpis_all: AuditReportKpis;
  kpis_filtered: AuditReportKpis;
  options: Partial<AuditReportOptions>;
}

export const AUDIT_REPORT_SORTS = [
  { value: "report_date", label: "Report date" },
  { value: "attention", label: "Needs attention first" },
  { value: "report_number", label: "Report number" },
  { value: "employer", label: "Employer" },
  { value: "inspector", label: "Inspector" },
  { value: "status", label: "Status" },
  { value: "acknowledgment", label: "Acknowledgement" },
  { value: "findings", label: "Findings" },
  { value: "violations", label: "Violations" },
  { value: "age", label: "Report age" },
] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const AGE_BUCKETS = [
  { value: "0_7", label: "0–7 days" },
  { value: "8_30", label: "8–30 days" },
  { value: "31_90", label: "31–90 days" },
  { value: "90_PLUS", label: "90+ days" },
];

export const ATTENTION_OPTIONS = [
  { value: "ANY", label: "Any attention flag" },
  { value: "DRAFT_AGEING", label: "Draft ageing (7+ days)" },
  { value: "AWAITING_ACK", label: "Awaiting employer acknowledgement" },
  { value: "ACK_OVERDUE", label: "Acknowledgement overdue (14+ days)" },
  { value: "MISSING_PDF", label: "Final without PDF" },
];

export const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "year", label: "This year" },
];

const ISO = (d: Date) => d.toISOString().slice(0, 10);

export function datePresetRange(preset: string): { from?: string; to?: string } {
  const today = new Date();
  switch (preset) {
    case "today":
      return { from: ISO(today), to: ISO(today) };
    case "7":
    case "30":
    case "90": {
      const from = new Date(today);
      from.setDate(from.getDate() - (Number(preset) - 1));
      return { from: ISO(from), to: ISO(today) };
    }
    case "year":
      return { from: `${today.getFullYear()}-01-01`, to: ISO(today) };
    default:
      return {};
  }
}

const LIST_KEYS = ["statuses", "acknowledgments"] as const;
const SCALAR_KEYS = [
  "search", "employer", "inspector", "territory",
  "date_from", "date_to", "findings", "violations", "pdf", "attention", "age",
] as const;

const EMPTY_OPTIONS: AuditReportOptions = {
  statuses: [], acknowledgments: [], territories: [], inspectors: [], employers: [],
};

const EMPTY_KPIS: AuditReportKpis = {
  total: 0, draft: 0, final: 0, awaiting_ack: 0, acknowledged: 0, attention: 0, findings: 0, violations: 0,
};

export function useAuditReportRegister() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<AuditReportFilters>(() => {
    const f: AuditReportFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(",").filter(Boolean);
    });
    // `?regno=` remains the canonical employer deep-link contract.
    const employer = params.get("regno");
    if (employer) f.employer = employer;
    return f;
  }, [params]);

  const sort = params.get("sort") || "report_date";
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
    (patch: Partial<AuditReportFilters>) => {
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
    (key: "statuses" | "acknowledgments", value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      patchFilters({ [key]: next } as Partial<AuditReportFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = { regno: undefined };
    [...SCALAR_KEYS, ...LIST_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const changeSort = useCallback(
    (nextSort: string, nextDir?: "asc" | "desc") => update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );

  const toggleSort = useCallback(
    (key: string) => {
      if (sort === key) update({ dir: dir === "asc" ? "desc" : "asc" }, true);
      else update({ sort: key, dir: ["report_number", "employer", "inspector", "status"].includes(key) ? "asc" : "desc" }, true);
    },
    [sort, dir, update],
  );

  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const rpcArgs = useMemo(
    () => ({ p_filters: filters, p_sort: sort, p_dir: dir }),
    [filters, sort, dir],
  );

  const query = useQuery({
    queryKey: ["ce-audit-report-register", rpcArgs, page, pageSize],
    queryFn: async (): Promise<RegisterResult> => {
      const { data, error } = await (supabase.rpc as any)("ce_audit_report_register_v1", {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as RegisterResult;
    },
    staleTime: 30_000,
  });

  const fetchAllForExport = useCallback(async (): Promise<AuditReportRow[]> => {
    const { data, error } = await (supabase.rpc as any)("ce_audit_report_register_v1", {
      ...rpcArgs,
      p_page: 1,
      p_page_size: 200,
      p_export: true,
    });
    if (error) throw error;
    return ((data as RegisterResult)?.rows ?? []) as AuditReportRow[];
  }, [rpcArgs]);

  const result = query.data;
  const total = result?.total ?? 0;
  const activeFilterCount =
    Object.entries(filters).filter(([, v]) => (Array.isArray(v) ? v.length > 0 : Boolean(v))).length;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as AuditReportOptions,
    kpisAll: result?.kpis_all ?? EMPTY_KPIS,
    kpisFiltered: result?.kpis_filtered ?? EMPTY_KPIS,
    scope: result?.scope,
    total,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
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
    fetchAllForExport,
  };
}
