/**
 * Compliance waiver amount resolution.
 *
 * Approved waivers never mutate the original case/violation totals — the
 * outstanding balance is derived at read time so the Admin Panel always shows
 * the recalculated (post-waiver) figure while the gross amount stays auditable.
 *
 * A waiver counts towards the balance once it reaches APPROVED (and stays
 * counted when it is subsequently APPLIED).
 */
import { supabase } from '@/integrations/supabase/client';

const WAIVERS = 'ce_waivers' as never;

/** Statuses whose approved amount reduces the outstanding balance. */
export const EFFECTIVE_WAIVER_STATUSES = ['APPROVED', 'APPLIED'] as const;

export interface WaivedAmounts {
  /** Total approved waiver value attached to the case (all sources). */
  caseTotal: number;
  /** Approved waiver value keyed by the violation it was raised against. */
  byViolation: Record<string, number>;
  /** Approved waiver value not attributed to a specific violation. */
  caseLevel: number;
}

const EMPTY: WaivedAmounts = { caseTotal: 0, byViolation: {}, caseLevel: 0 };

function sumRows(rows: any[]): WaivedAmounts {
  const byViolation: Record<string, number> = {};
  let caseTotal = 0;
  let caseLevel = 0;
  for (const r of rows) {
    const amt = Number(r?.amount_approved ?? 0);
    if (!Number.isFinite(amt) || amt <= 0) continue;
    caseTotal += amt;
    if (r.violation_id) {
      byViolation[r.violation_id] = (byViolation[r.violation_id] ?? 0) + amt;
    } else {
      caseLevel += amt;
    }
  }
  return { caseTotal, byViolation, caseLevel };
}

/** Approved waiver amounts for a case, split by linked violation. */
export async function fetchCaseWaivedAmounts(caseId?: string | null): Promise<WaivedAmounts> {
  if (!caseId) return EMPTY;
  const { data, error } = await (supabase.from(WAIVERS) as any)
    .select('id, violation_id, amount_approved, status')
    .eq('case_id', caseId)
    .in('status', EFFECTIVE_WAIVER_STATUSES as unknown as string[]);
  if (error) throw error;
  return sumRows(data || []);
}

/** Approved waiver amount raised directly against a single violation. */
export async function fetchViolationWaivedAmount(violationId?: string | null): Promise<number> {
  if (!violationId) return 0;
  const { data, error } = await (supabase.from(WAIVERS) as any)
    .select('amount_approved, status')
    .eq('violation_id', violationId)
    .in('status', EFFECTIVE_WAIVER_STATUSES as unknown as string[]);
  if (error) throw error;
  return sumRows((data || []).map((r: any) => ({ ...r, violation_id: violationId }))).caseTotal;
}

/** Outstanding balance = gross total − collected − waived (never negative). */
export function computeOutstanding(
  total: number | null | undefined,
  collected: number | null | undefined,
  waived: number | null | undefined,
): number {
  const value = (Number(total) || 0) - (Number(collected) || 0) - (Number(waived) || 0);
  return Math.max(0, Number(value.toFixed(2)));
}
