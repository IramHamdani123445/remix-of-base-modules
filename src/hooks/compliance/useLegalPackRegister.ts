import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * Enterprise reader/commands for Compliance → Legal Pack Preparation
 * (`/compliance/legal/pack-preparation`).
 *
 * OWNERSHIP BOUNDARY
 * ------------------
 * Readiness is NEVER computed in the browser. `ce_legal_pack_register_v1`
 * re-synchronises every pack from live records (cases, violations, notices,
 * delivery proof, responses, ledger, breaches, inspection evidence, documents)
 * and returns rows, KPIs, the "requires attention" set and facets.
 *
 * All writes go through governed commands which re-check authority,
 * pack state and completeness inside the database:
 *   - ce_legal_pack_confirm_item_v1
 *   - ce_legal_pack_detach_document_v1
 *   - ce_legal_pack_submit_v1  (idempotent, snapshots a pack version)
 */

const sb = supabase as any;

export const PACK_PAGE_SIZES = [25, 50, 100, 200] as const;

export type PackReadiness = 'NOT_STARTED' | 'IN_PROGRESS' | 'MISSING_MANDATORY' | 'READY';

export interface PackFilters {
  tab: string;
  search: string;
  readiness: string;
  reason_code: string;
  zone: string;
  missing_item: string;
  amount_band: string;
  age_min_days: string;
  sort: string;
  dir: 'asc' | 'desc';
  page: number;
  page_size: number;
}

export const DEFAULT_PACK_FILTERS: PackFilters = {
  tab: 'IN_PREPARATION',
  search: '',
  readiness: '',
  reason_code: '',
  zone: '',
  missing_item: '',
  amount_band: '',
  age_min_days: '',
  sort: 'age_days',
  dir: 'desc',
  page: 1,
  page_size: 25,
};

export interface PackRegisterRow {
  id: string;
  referral_number: string;
  employer_id: string | null;
  employer_name: string | null;
  employer_zone: string | null;
  status: string;
  reason_code: string | null;
  amount: number;
  created_at: string;
  returned_at: string | null;
  return_reason: string | null;
  case_number: string | null;
  case_id: string | null;
  documents: number;
  age_days: number;
  readiness: PackReadiness;
  missing_keys: string[];
  completion_pct: number;
  sla_breached: boolean;
  high_value: boolean;
}

export interface PackAttentionRow {
  id: string;
  referral_number: string;
  employer_name: string | null;
  amount: number;
  age_days: number;
  readiness: PackReadiness;
  status: string;
  completion_pct: number;
  missing_keys: string[];
  reason: string;
}

export interface PackKpis {
  in_preparation: number;
  ready: number;
  incomplete: number;
  pending_approval: number;
  returned: number;
  sla_breached: number;
  high_value: number;
  total_exposure: number;
  avg_completion: number;
}

export interface PackRegisterResult {
  items: PackRegisterRow[];
  total: number;
  page: number;
  page_size: number;
  kpis: PackKpis;
  attention: PackAttentionRow[];
  facets: {
    reason_codes: string[];
    zones: string[];
    items: Array<{ code: string; label: string }>;
    readiness: Array<{ code: string; label: string; tone: string | null }>;
  };
  thresholds: { sla_days: number; high_value: number };
  can_edit: boolean;
}

const TAB_STATES: Record<string, string[]> = {
  IN_PREPARATION: ['DRAFT', 'RETURNED'],
  RETURNED: ['RETURNED'],
  PENDING_APPROVAL: ['PENDING_APPROVAL'],
  ALL: ['DRAFT', 'RETURNED', 'PENDING_APPROVAL'],
};

const AMOUNT_BANDS: Record<string, { min?: number; max?: number }> = {
  '0-10k': { max: 10000 },
  '10k-50k': { min: 10000, max: 50000 },
  '50k-250k': { min: 50000, max: 250000 },
  '250k+': { min: 250000 },
};

export function useLegalPackRegister() {
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const [filters, setFiltersState] = useState<PackFilters>(() => ({
    ...DEFAULT_PACK_FILTERS,
    search: searchParams.get('q') ?? '',
    tab: searchParams.get('tab') ?? DEFAULT_PACK_FILTERS.tab,
  }));

  const setFilters = useCallback((patch: Partial<PackFilters>) => {
    setFiltersState((prev) => ({
      ...prev,
      ...patch,
      page: patch.page ?? (patch.page_size ? 1 : 'page' in patch ? prev.page : 1),
    }));
  }, []);

  const resetFilters = useCallback(() => setFiltersState(DEFAULT_PACK_FILTERS), []);

  const params = useMemo(() => {
    const band = AMOUNT_BANDS[filters.amount_band] ?? {};
    return {
      states: TAB_STATES[filters.tab] ?? TAB_STATES.IN_PREPARATION,
      search: filters.search || null,
      readiness: filters.readiness || null,
      reason_code: filters.reason_code || null,
      zone: filters.zone || null,
      missing_item: filters.missing_item || null,
      min_amount: band.min ?? null,
      max_amount: band.max ?? null,
      age_min_days: filters.age_min_days || null,
      sort: filters.sort,
      dir: filters.dir,
      page: filters.page,
      page_size: filters.page_size,
    };
  }, [filters]);

  const query = useQuery<PackRegisterResult>({
    queryKey: ['ce-legal-pack-register', params],
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_pack_register_v1', { p_params: params });
      if (error) throw error;
      return data as PackRegisterResult;
    },
    staleTime: 15_000,
  });

  const selectedId = searchParams.get('referral');

  const setSelectedId = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (id) next.set('referral', id);
      else next.delete('referral');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['ce-legal-pack-register'] });
    qc.invalidateQueries({ queryKey: ['ce-legal-pack-detail'] });
    qc.invalidateQueries({ queryKey: ['legal-queue-referrals'] });
  }, [qc]);

  return {
    filters,
    setFilters,
    resetFilters,
    rows: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    kpis: query.data?.kpis,
    attention: query.data?.attention ?? [],
    facets: query.data?.facets,
    thresholds: query.data?.thresholds,
    canEdit: query.data?.can_edit ?? false,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error as Error | null,
    refetch: query.refetch,
    selectedId,
    setSelectedId,
    invalidate,
  };
}

// ── Detail + commands ───────────────────────────────────────────────────────

export interface PackChecklistItem {
  id: string;
  item_key: string;
  item_label: string;
  is_required: boolean;
  is_satisfied: boolean;
  item_status: string;
  completion_mode: 'MANUAL' | 'AUTO';
  group_code: string;
  display_order: number;
  auto_source: string | null;
  requires_document: boolean;
  auto_evidence: { ok?: boolean; count?: number; detail?: string };
  satisfied_by: string | null;
  satisfied_by_name: string | null;
  satisfied_at: string | null;
  notes: string | null;
}

export interface PackDetail {
  referral: Record<string, any>;
  rollup: {
    total_items: number;
    required_items: number;
    required_complete: number;
    missing_required: number;
    missing_keys: string[];
    completion_pct: number;
  };
  readiness: PackReadiness;
  checklist: PackChecklistItem[];
  groups: Array<{ code: string; label: string }>;
  documents: Array<Record<string, any>>;
  violations: Array<Record<string, any>>;
  versions: Array<Record<string, any>>;
  timeline: Array<Record<string, any>>;
  workflow: {
    enabled: boolean;
    workflow_name: string | null;
    levels: number;
    next_approver_role: string | null;
    context: Record<string, any>;
  };
  can_edit: boolean;
}

export function useLegalPackDetail(referralId: string | null) {
  return useQuery<PackDetail>({
    queryKey: ['ce-legal-pack-detail', referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const { data, error } = await sb.rpc('ce_legal_pack_detail_v1', { p_referral_id: referralId });
      if (error) throw error;
      return data as PackDetail;
    },
  });
}

export function usePackCommands(referralId: string | null, onDone?: () => void) {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ['ce-legal-pack-detail', referralId] });
    qc.invalidateQueries({ queryKey: ['ce-legal-pack-register'] });
    onDone?.();
  };

  const confirmItem = useMutation({
    mutationFn: async (v: { itemKey: string; satisfied: boolean; notes?: string }) => {
      const { data, error } = await sb.rpc('ce_legal_pack_confirm_item_v1', {
        p_referral_id: referralId,
        p_item_key: v.itemKey,
        p_satisfied: v.satisfied,
        p_notes: v.notes ?? null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: done,
  });

  const detachDocument = useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await sb.rpc('ce_legal_pack_detach_document_v1', {
        p_referral_id: referralId,
        p_document_id: documentId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: done,
  });

  const submitPack = useMutation({
    mutationFn: async (v: { notes?: string; idempotencyKey: string }) => {
      const { data, error } = await sb.rpc('ce_legal_pack_submit_v1', {
        p_referral_id: referralId,
        p_idempotency_key: v.idempotencyKey,
        p_notes: v.notes ?? null,
      });
      if (error) throw error;
      return data as { status: string; version_no: number; workflow: any };
    },
    onSuccess: done,
  });

  return { confirmItem, detachDocument, submitPack };
}

export const READINESS_TONE: Record<string, string> = {
  READY: 'bg-success/10 text-success border-success/30',
  IN_PROGRESS: 'bg-primary/10 text-primary border-primary/30',
  MISSING_MANDATORY: 'bg-destructive/10 text-destructive border-destructive/30',
  NOT_STARTED: 'bg-muted text-muted-foreground border-border',
};

export const READINESS_LABEL: Record<string, string> = {
  READY: 'Ready for approval',
  IN_PROGRESS: 'In progress',
  MISSING_MANDATORY: 'Missing mandatory items',
  NOT_STARTED: 'Not started',
};

export const ATTENTION_LABEL: Record<string, string> = {
  RETURNED_BY_LEGAL: 'Returned by Legal',
  SLA_BREACHED: 'Preparation SLA breached',
  HIGH_VALUE_INCOMPLETE: 'High value pack incomplete',
  READY_NOT_SUBMITTED: 'Ready but not submitted',
};
