import { useQuery } from '@tanstack/react-query';
import {
  fetchEmployerLedgerPage,
  fetchEmployerLedgerSummary,
  fetchLedgerEntryDetail,
  fetchLedgerReconciliation,
  type LedgerPageFilters,
} from '@/services/compliance/employerLedgerService';

export function useEmployerLedgerPage(filters: LedgerPageFilters, enabled = true) {
  return useQuery({
    queryKey: ['employer-ledger-page', filters],
    queryFn: () => fetchEmployerLedgerPage(filters),
    enabled: enabled && !!filters.employerId,
    staleTime: 30_000,
  });
}

export function useEmployerLedgerSummary(
  args: { employerId: string; fromDate?: string | null; toDate?: string | null; fundType?: string | null },
  enabled = true,
) {
  return useQuery({
    queryKey: ['employer-ledger-summary', args],
    queryFn: () => fetchEmployerLedgerSummary(args),
    enabled: enabled && !!args.employerId,
    staleTime: 30_000,
  });
}

export function useLedgerEntryDetail(entryId?: string | null) {
  return useQuery({
    queryKey: ['employer-ledger-entry', entryId],
    queryFn: () => fetchLedgerEntryDetail(entryId as string),
    enabled: !!entryId,
  });
}

export function useEmployerLedgerReconciliation(employerId?: string) {
  return useQuery({
    queryKey: ['employer-ledger-reconcile', employerId],
    queryFn: () => fetchLedgerReconciliation(employerId as string),
    enabled: !!employerId,
    staleTime: 60_000,
  });
}
