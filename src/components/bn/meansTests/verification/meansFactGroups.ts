/**
 * BN Means-Test — frozen-version fact grouping helpers (Epic 14).
 *
 * Presentation-only shaping of the governed verification workspace payload.
 * No business decision is taken here: outcomes, availability and readiness
 * all remain backend-owned. Extracted when the legacy MT6 verification and
 * calculation panels were retired in favour of the Epic 8/9 sections.
import { formatWithCurrency } from '@/utils/formatCurrency';
 */

export type BnMeansVerificationOutcome =
  | 'VERIFIED'
  | 'REJECTED'
  | 'CLARIFICATION_REQUIRED'
  | 'NOT_APPLICABLE';

export interface BnMeansVerificationRow {
  readonly factKind: 'HOUSEHOLD' | 'INCOME' | 'ASSET' | 'DEDUCTION' | 'EVIDENCE';
  readonly factId: string;
  readonly label: string;
  readonly declaredValue: string;
  readonly source: string;
  readonly effectivePeriod: string;
  readonly evidenceStatus: string;
}

export interface BnMeansVerificationRecord {
  readonly fact_kind?: unknown;
  readonly fact_id?: unknown;
  readonly outcome?: unknown;
  readonly reason_code?: unknown;
  readonly notes?: unknown;
  readonly verified_by?: unknown;
  readonly verified_at?: unknown;
}


export function buildFactGroups(
  data: Record<string, unknown>,
  currency: string,
): readonly { title: string; rows: BnMeansVerificationRow[] }[] {
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const money = (v: unknown) => (v === null || v === undefined ? '—' : formatWithCurrency(Number(v), currency));
  const period = (from: unknown, to: unknown) =>
    `${from ? String(from) : '—'} → ${to ? String(to) : 'open'}`;

  return [
    {
      title: 'Household',
      rows: rows(data.household).map((r) => ({
        factKind: 'HOUSEHOLD' as const,
        factId: String(r.member_id),
        label: String(r.relationship_code ?? 'Member'),
        declaredValue: r.is_dependant ? 'Dependant' : 'Non-dependant',
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: period(r.member_from, r.member_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Income',
      rows: rows(data.income).map((r) => ({
        factKind: 'INCOME' as const,
        factId: String(r.income_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.declared_amount)} ${String(r.declared_frequency ?? '')} · annualised ${money(r.normalised_annual_amount)}`,
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: period(r.effective_from, r.effective_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Assets',
      rows: rows(data.assets).map((r) => ({
        factKind: 'ASSET' as const,
        factId: String(r.asset_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.valuation_amount)} · share ${String(r.ownership_share ?? 1)}`,
        source: String(r.fact_source ?? 'DECLARED'),
        effectivePeriod: String(r.valuation_date ?? '—'),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Deductions',
      rows: rows(data.deductions).map((r) => ({
        factKind: 'DEDUCTION' as const,
        factId: String(r.deduction_fact_id),
        label: String(r.category_code ?? ''),
        declaredValue: `${money(r.claimed_amount)} · annualised ${money(r.normalised_annual_amount)} · ${String(r.approval_status ?? 'CLAIMED')}`,
        source: String(r.claim_basis ?? 'CLAIMED'),
        effectivePeriod: period(r.effective_from, r.effective_to),
        evidenceStatus: String(r.evidence_status ?? 'NONE'),
      })),
    },
    {
      title: 'Evidence',
      rows: rows(data.evidence).map((r) => ({
        factKind: 'EVIDENCE' as const,
        factId: String(r.evidence_id),
        label: String(r.evidence_type ?? ''),
        declaredValue: String(r.dms_document_id ?? r.dms_reference ?? '—'),
        source: String(r.fact_kind ?? 'ASSESSMENT'),
        effectivePeriod: String(r.received_at ?? '—'),
        evidenceStatus: String(r.status ?? '—'),
      })),
    },
  ];
}

