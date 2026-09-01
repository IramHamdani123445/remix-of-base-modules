import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader for the Compliance Employer 360 lookup
 * (/compliance/field/employer-360).
 *
 * `ce_employer_lookup_v1` resolves the caller's compliance authority BEFORE
 * searching, then applies relevance ranking, filtering, sorting, paging and
 * compact compliance context (risk band, open violations, active cases,
 * outstanding balance) in a single aggregated statement — no per-row N+1.
 *
 * All list state lives in the URL query string so search, filters, sort, page
 * and page size survive opening an Employer 360 profile and navigating back.
 */

export interface EmployerLookupFilters {
  search?: string;
  statuses?: string[];
  offices?: string[];
  risk_bands?: string[];
  sector?: string;
  ownership?: string;
  registered?: string;
  date_from?: string;
  date_to?: string;
  has_violations?: boolean;
  has_cases?: boolean;
  has_outstanding?: boolean;
  high_risk?: boolean;
}

export interface EmployerLookupRow {
  regno: string;
  name: string;
  trade_name: string | null;
  status_code: string | null;
  status: string;
  office_code: string | null;
  village_code: string | null;
  registration_date: string | null;
  phone: string | null;
  email: string | null;
  sector_code: string | null;
  ownership_code: string | null;
  employees: number;
  risk_band: string;
  risk_score: number | null;
  open_violations: number;
  active_cases: number;
  outstanding: number;
  match_rank: number;
}

export interface EmployerLookupOptions {
  statuses: string[];
  offices: string[];
  risk_bands: string[];
  sectors: string[];
  ownerships: string[];
}

interface LookupResult {
  page: number;
  page_size: number;
  sort: string;
  dir: 'asc' | 'desc';
  total: number;
  exact_regno: string | null;
  rows: EmployerLookupRow[];
  options: Partial<EmployerLookupOptions>;
}

export const EMPLOYER_SORTS = [
  { value: 'relevance', label: 'Best match' },
  { value: 'name', label: 'Employer name' },
  { value: 'regno', label: 'Registration number' },
  { value: 'status', label: 'Status' },
  { value: 'registered', label: 'Registered date' },
  { value: 'risk', label: 'Risk' },
  { value: 'violations', label: 'Open violations' },
  { value: 'outstanding', label: 'Outstanding' },
] as const;

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

export const REGISTERED_OPTIONS = [
  { value: 'THIS_YEAR', label: 'This year' },
  { value: 'LAST_12M', label: 'Last 12 months' },
  { value: 'OLDER_1Y', label: 'Older than 1 year' },
  { value: 'CUSTOM', label: 'Custom range' },
];

export const MIN_SEARCH_LENGTH = 2;

const LIST_KEYS = ['statuses', 'offices', 'risk_bands'] as const;
const SCALAR_KEYS = ['search', 'sector', 'ownership', 'registered', 'date_from', 'date_to'] as const;
const BOOL_KEYS = ['has_violations', 'has_cases', 'has_outstanding', 'high_risk'] as const;

const EMPTY_OPTIONS: EmployerLookupOptions = {
  statuses: [], offices: [], risk_bands: [], sectors: [], ownerships: [],
};

export function useEmployerLookup() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo<EmployerLookupFilters>(() => {
    const f: EmployerLookupFilters = {};
    SCALAR_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) (f as Record<string, unknown>)[k] = v;
    });
    LIST_KEYS.forEach((k) => {
      const v = params.get(k);
      if (v) f[k] = v.split(',').filter(Boolean);
    });
    BOOL_KEYS.forEach((k) => {
      if (params.get(k) === '1') f[k] = true;
    });
    return f;
  }, [params]);

  const search = filters.search ?? '';
  const hasSearch = search.trim().length >= MIN_SEARCH_LENGTH;

  const sort = params.get('sort') || (hasSearch ? 'relevance' : 'name');
  const dir = (params.get('dir') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';
  const page = Math.max(1, Number(params.get('page') || 1));
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get('size')))
    ? Number(params.get('size'))
    : 25;

  const update = useCallback(
    (patch: Record<string, string | undefined>, resetPage = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([k, v]) => {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, v);
          });
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const patchFilters = useCallback(
    (patch: Partial<EmployerLookupFilters>) => {
      const flat: Record<string, string | undefined> = {};
      Object.entries(patch).forEach(([k, v]) => {
        if (typeof v === 'boolean') flat[k] = v ? '1' : undefined;
        else if (Array.isArray(v)) flat[k] = v.length ? v.join(',') : undefined;
        else flat[k] = (v as string) || undefined;
      });
      update(flat, true);
    },
    [update],
  );

  const toggleInList = useCallback(
    (key: 'statuses' | 'offices' | 'risk_bands', value: string) => {
      const current = filters[key] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      patchFilters({ [key]: next } as Partial<EmployerLookupFilters>);
    },
    [filters, patchFilters],
  );

  const resetFilters = useCallback(() => {
    const cleared: Record<string, string | undefined> = {};
    [...SCALAR_KEYS, ...LIST_KEYS, ...BOOL_KEYS].forEach((k) => { cleared[k] = undefined; });
    update(cleared, true);
  }, [update]);

  const changeSort = useCallback(
    (nextSort: string, nextDir?: 'asc' | 'desc') => update({ sort: nextSort, dir: nextDir ?? dir }, true),
    [update, dir],
  );
  const toggleDir = useCallback(
    () => update({ dir: dir === 'asc' ? 'desc' : 'asc' }, true),
    [update, dir],
  );
  const setPage = useCallback((p: number) => update({ page: String(Math.max(1, p)) }), [update]);
  const setPageSize = useCallback((n: number) => update({ size: String(n) }, true), [update]);

  const hasFilters = Object.entries(filters).some(([k, v]) =>
    k === 'search' ? false : Array.isArray(v) ? v.length > 0 : Boolean(v),
  );

  /** The RPC is only meaningful once a search term or an explicit filter exists. */
  const enabled = hasSearch || hasFilters;

  const rpcArgs = useMemo(
    () => ({ p_filters: { ...filters, search: hasSearch ? search.trim() : undefined }, p_sort: sort, p_dir: dir }),
    [filters, search, hasSearch, sort, dir],
  );

  const query = useQuery({
    queryKey: ['ce-employer-lookup', rpcArgs, page, pageSize],
    queryFn: async (): Promise<LookupResult> => {
      const { data, error } = await (supabase.rpc as any)('ce_employer_lookup_v1', {
        ...rpcArgs,
        p_page: page,
        p_page_size: pageSize,
      });
      if (error) throw error;
      return data as LookupResult;
    },
    enabled,
    staleTime: 30_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });

  const result = query.data;
  const total = result?.total ?? 0;
  const activeFilterCount = Object.entries(filters).filter(([k, v]) =>
    k === 'search' ? false : Array.isArray(v) ? v.length > 0 : Boolean(v),
  ).length;

  return {
    rows: result?.rows ?? [],
    options: { ...EMPTY_OPTIONS, ...(result?.options ?? {}) } as EmployerLookupOptions,
    total,
    exactRegno: result?.exact_regno ?? null,
    isLoading: query.isLoading && enabled,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: query.refetch,
    enabled,
    hasSearch,
    filters,
    search,
    sort,
    dir,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    activeFilterCount,
    patchFilters,
    toggleInList,
    resetFilters,
    changeSort,
    toggleDir,
    setPage,
    setPageSize,
  };
}
