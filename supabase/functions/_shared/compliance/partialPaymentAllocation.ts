/**
 * Compliance — Partial Payment (DR-004) shared logic.
 *
 * ONE implementation of:
 *   - the allocation waterfall (which bucket money is applied to first)
 *   - allocation validation (buckets exist, nothing negative, total matches)
 *   - the DR-004 obligation outcome (authorised vs unauthorised shortfall)
 *   - the DR-003 / DR-004 mutual-exclusivity rule
 *
 * This module is mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/partialPaymentAllocation.ts`
 * so the scanner and the application agree. It contains NO regulatory
 * constants: every threshold arrives from configuration.
 */

export interface CePartialPaymentBucket {
  payment_code: string;
  fund_code?: string | null;
  bucket_label?: string | null;
  outstanding_amount: number;
}

export interface CePartialPaymentAllocationLine {
  payment_code: string;
  fund_code?: string | null;
  bucket_label?: string | null;
  outstanding_amount: number;
  amount: number;
}

export interface CePartialPaymentLiability {
  employer_id?: string;
  wage_period?: string;
  total_outstanding: number;
  buckets: CePartialPaymentBucket[];
}

export class CePartialPaymentConfigError extends Error {}

export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Apply `amount` across the outstanding buckets following the configured
 * allocation order. Buckets that are not listed in the order are never
 * funded automatically — the order is the authoritative policy.
 */
export function buildDefaultAllocation(
  liability: CePartialPaymentLiability,
  amount: number,
  allocationOrder: string[],
): CePartialPaymentAllocationLine[] {
  if (!Array.isArray(allocationOrder) || allocationOrder.length === 0) {
    throw new CePartialPaymentConfigError(
      "Partial payment policy has no allocation order configured",
    );
  }
  let remaining = round2(Math.max(Number(amount) || 0, 0));
  const out: CePartialPaymentAllocationLine[] = [];
  for (const code of allocationOrder) {
    if (remaining <= 0) break;
    const bucket = (liability.buckets ?? []).find((b) => b.payment_code === code);
    if (!bucket) continue;
    const outstanding = round2(Math.max(Number(bucket.outstanding_amount) || 0, 0));
    if (outstanding <= 0) continue;
    const take = round2(Math.min(remaining, outstanding));
    if (take <= 0) continue;
    out.push({
      payment_code: bucket.payment_code,
      fund_code: bucket.fund_code ?? null,
      bucket_label: bucket.bucket_label ?? null,
      outstanding_amount: outstanding,
      amount: take,
    });
    remaining = round2(remaining - take);
  }
  return out;
}

export interface AllocationValidationResult {
  ok: boolean;
  total: number;
  errors: string[];
}

export function validateAllocation(
  lines: CePartialPaymentAllocationLine[],
  expectedTotal: number,
  liability?: CePartialPaymentLiability,
): AllocationValidationResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  let total = 0;

  for (const line of lines ?? []) {
    const code = (line?.payment_code ?? "").trim();
    if (!code) {
      errors.push("Every allocation line needs a payment category");
      continue;
    }
    if (seen.has(code)) errors.push(`Payment category ${code} appears more than once`);
    seen.add(code);

    const amount = Number(line.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      errors.push(`Allocation for ${code} must be zero or greater`);
      continue;
    }
    if (liability) {
      const bucket = (liability.buckets ?? []).find((b) => b.payment_code === code);
      if (!bucket) {
        errors.push(`${code} has no outstanding balance for this period`);
      } else if (round2(amount) > round2(Number(bucket.outstanding_amount) || 0)) {
        errors.push(`Allocation for ${code} exceeds its outstanding balance`);
      }
    }
    total = round2(total + amount);
  }

  if (round2(total) !== round2(Number(expectedTotal) || 0)) {
    errors.push(
      `Allocation total ${round2(total)} does not equal the payment amount ${round2(Number(expectedTotal) || 0)}`,
    );
  }

  return { ok: errors.length === 0, total: round2(total), errors };
}

/* ------------------------------------------------------------------ */
/* DR-004 obligation outcome                                           */
/* ------------------------------------------------------------------ */

export type CePartialPaymentAuthorityStatus =
  | "DRAFT"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED"
  | "SETTLED"
  | "EXPIRED";

export interface CePartialPaymentAuthority {
  status: CePartialPaymentAuthorityStatus;
  approved_amount: number | null;
  settled_amount: number | null;
  /**
   * ISO date the payment authority stops being valid. This governs how long
   * the counter may accept the approved money — it NEVER changes the statutory
   * payment deadline.
   */
  authority_expires_on: string | null;
}

export type CePartialPaymentOutcome =
  | "NOT_APPLICABLE"
  | "WITHIN_DEADLINE"
  | "PARTIAL_OUTSTANDING";

export function authorityIsLive(
  authority: CePartialPaymentAuthority | null | undefined,
  asOf: string,
): boolean {
  if (!authority) return false;
  if (authority.status !== "APPROVED" && authority.status !== "SETTLED") return false;
  if (authority.authority_expires_on && authority.authority_expires_on < asOf) return false;
  return true;
}

/**
 * DR-004 — Partial Payment.
 *
 * The statutory deadline is immutable: it comes from the obligation deadline
 * resolver and nothing in the partial-payment workflow can move it. A shortfall
 * against the declared liability that is still outstanding after the resolved
 * deadline is a DR-004 violation, whether or not a partial payment request is
 * pending, approved or settled. A payment authority only permits SSB to accept
 * money short of the full liability; it is not a licence to pay late.
 */
export function evaluatePartialPaymentObligation(input: {
  /** Effective enforcement date from the shared deadline resolver. */
  graceEndDate: string;
  declaredAmount: number;
  paidAmount: number;
  asOf: string;
  /** Retained for reporting/context only — it cannot change the outcome. */
  authority?: CePartialPaymentAuthority | null;
}): CePartialPaymentOutcome {
  const declared = round2(Number(input.declaredAmount) || 0);
  const paid = round2(Number(input.paidAmount) || 0);
  if (declared <= 0) return "NOT_APPLICABLE";
  // No money at all is DR-003 (non-payment), never DR-004.
  if (paid <= 0) return "NOT_APPLICABLE";
  if (paid >= declared) return "NOT_APPLICABLE";

  if (input.asOf <= input.graceEndDate) return "WITHIN_DEADLINE";
  return "PARTIAL_OUTSTANDING";
}

export function isPartialPaymentViolation(outcome: CePartialPaymentOutcome): boolean {
  return outcome === "PARTIAL_OUTSTANDING";
}

