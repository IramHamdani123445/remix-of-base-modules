import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader/writer for the Inspection Evidence Register
 * (`/compliance/inspections/evidence`).
 *
 * Search, filters, sorting, paging, KPIs, traceability joins (inspection →
 * employer → finding → violation) and capability resolution are all handled
 * server-side by `ce_evidence_register_v1`, so they apply to the whole
 * authorised population rather than a fetched page. Every write goes through a
 * governed RPC that records an audit entry.
 */

export interface EvidenceFilters {
  search?: string;
  quick?: string;
  types?: string[];
  statuses?: string[];
  file_states?: string[];
  employer?: string;
  inspection_id?: string;
  finding_id?: string;
  finding?: string;
  captured_by?: string;
  date_from?: string;
  date_to?: string;
  mine_only?: boolean;
}

export interface EvidenceRow {
  id: string;
  evidence_type: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  file_ext: string | null;
  description: string | null;
  captured_at: string;
  captured_by: string | null;
  status: string;
  file_state: string;
  version_no: number;
  storage_bucket: string | null;
  storage_path: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  inspection_id: string | null;
  inspection_number: string | null;
  inspection_status: string | null;
  employer_id: string | null;
  employer_name: string | null;
  inspector_name: string | null;
  finding_id: string | null;
  finding_title: string | null;
  finding_severity: string | null;
  finding_type: string | null;
  violation_id: string | null;
  violation_number: string | null;
  violation_status: string | null;
  downstream_locked: boolean;
}

export interface EvidenceCapabilities {
  can_view: boolean;
  can_attach: boolean;
  can_edit: boolean;
  can_replace: boolean;
  can_withdraw: boolean;
  is_oversight: boolean;
  scope: string;
}

export interface EvidenceKpis {
  total: number;
  this_month: number;
  linked_findings: number;
  missing_files: number;
  superseded: number;
}

const ARRAY_KEYS = ['types', 'statuses', 'file_states'] as const;

export function useEvidenceRegister() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  const filters: EvidenceFilters = useMemo(() => {
    const get = (k: string) => params.get(k) ?? undefined;
    const getArr = (k: string) => {
      const raw = params.get(k);
      return raw ? raw.split(',').filter(Boolean) : undefined;
    };
    return {
      search: get('q'),
      quick: get('quick') ?? 'ALL',
      types: getArr('types'),
      statuses: getArr('statuses'),
      file_states: getArr('file_states'),
      employer: get('employer'),
      inspection_id: get('inspection'),
      finding_id: get('finding_id'),
      finding: get('finding'),
      captured_by: get('by'),
      date_from: get('from'),
      date_to: get('to'),
      mine_only: params.get('mine') === '1',
    };
  }, [params]);

  const sort = params.get('sort') ?? 'captured_at';
  const dir = (params.get('dir') ?? 'desc') as 'asc' | 'desc';
  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('size') ?? '25');

  const patch = useCallback(
    (next: Record<string, string | string[] | boolean | undefined | null>, resetPage = true) => {
      const sp = new URLSearchParams(params);
      Object.entries(next).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0)) {
          sp.delete(k);
        } else if (Array.isArray(v)) {
          sp.set(k, v.join(','));
        } else if (typeof v === 'boolean') {
          sp.set(k, '1');
        } else {
          sp.set(k, v);
        }
      });
      if (resetPage) sp.delete('page');
      setParams(sp, { replace: true });
    },
    [params, setParams],
  );

  const clearFilters = useCallback(() => {
    const sp = new URLSearchParams();
    setParams(sp, { replace: true });
  }, [setParams]);

  const hasActiveFilters = useMemo(() => {
    const keys = ['q', 'types', 'statuses', 'file_states', 'employer', 'inspection', 'finding', 'finding_id', 'by', 'from', 'to', 'mine'];
    return keys.some((k) => params.get(k)) || (params.get('quick') ?? 'ALL') !== 'ALL';
  }, [params]);

  const query = useQuery({
    queryKey: ['ce-evidence-register', filters, sort, dir, page, pageSize],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ce_evidence_register_v1', {
        p_filters: filters as any,
        p_sort: sort,
        p_dir: dir,
        p_page: page,
        p_page_size: pageSize,
        p_export: false,
      });
      if (error) throw error;
      return data as {
        rows: EvidenceRow[];
        total: number;
        page: number;
        page_size: number;
        kpis: EvidenceKpis;
        capabilities: EvidenceCapabilities;
      };
    },
  });

  const facets = useQuery({
    queryKey: ['ce-evidence-facets'],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ce_evidence_register_facets_v1');
      if (error) throw error;
      return data as {
        types: string[];
        employers: Array<{ id: string; name: string }>;
        inspections: Array<{ id: string; number: string; employer: string }>;
        captured_by: string[];
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ce-evidence-register'] });
    qc.invalidateQueries({ queryKey: ['ce-evidence-facets'] });
    qc.invalidateQueries({ queryKey: ['inspection-evidence'] });
  }, [qc]);

  const updateMetadata = useMutation({
    mutationFn: async (input: { id: string; evidence_type: string; description: string | null; finding_id: string | null }) => {
      const { error } = await (supabase.rpc as any)('ce_evidence_update_metadata_v1', {
        p_id: input.id,
        p_evidence_type: input.evidence_type,
        p_description: input.description,
        p_finding_id: input.finding_id,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const withdraw = useMutation({
    mutationFn: async (input: { id: string; reason: string }) => {
      const { error } = await (supabase.rpc as any)('ce_evidence_withdraw_v1', {
        p_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    filters,
    sort,
    dir,
    page,
    pageSize,
    patch,
    clearFilters,
    hasActiveFilters,
    rows: query.data?.rows ?? [],
    total: query.data?.total ?? 0,
    kpis: query.data?.kpis,
    capabilities: query.data?.capabilities,
    facets: facets.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    invalidate,
    updateMetadata,
    withdraw,
    ARRAY_KEYS,
  };
}

/** Evidence audit trail + version chain for the detail drawer. */
export function useEvidenceDetail(id: string | null) {
  return useQuery({
    queryKey: ['ce-evidence-detail', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)('ce_evidence_detail_v1', { p_id: id });
      if (error) throw error;
      return data as {
        audit: Array<{ action: string; reason: string | null; details: any; actor_code: string | null; created_at: string }>;
        versions: Array<{ id: string; version_no: number; file_name: string; status: string; captured_at: string; captured_by: string | null; replacement_reason: string | null }>;
      };
    },
  });
}
