/**
 * Shared reference-data hook for the Risk signal surfaces. Every controlled
 * value shown to an officer comes from the governed reference query — the UI
 * never hard-codes categories, priorities or reasons.
 */
import { useQuery } from '@tanstack/react-query';
import { riskQueryService } from '@/services/bn/risk/riskQueryService';
import type { BnRiskReferenceData, BnRiskReferenceItem } from '@/types/bn/risk/riskSignals';

export function useRiskReferenceData() {
  return useQuery({
    queryKey: ['bn-risk-reference-data'],
    queryFn: async () => {
      const result = await riskQueryService.referenceData();
      if (result.status !== 'OK' || !result.data) {
        throw new Error(result.code ?? 'REFERENCE_DATA_UNAVAILABLE');
      }
      return result.data;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function referenceItems(
  reference: BnRiskReferenceData | undefined,
  domain: keyof BnRiskReferenceData,
): readonly BnRiskReferenceItem[] {
  return reference?.[domain] ?? [];
}

export function referenceLabel(
  reference: BnRiskReferenceData | undefined,
  domain: keyof BnRiskReferenceData,
  code: string | null | undefined,
): string {
  if (!code) return '—';
  return referenceItems(reference, domain).find((i) => i.code === code)?.label ?? code;
}
