/**
 * BN Overpayments — Outstanding balance calculator.
 *
 * Pure function. Outstanding balance is DERIVED from approved financial
 * events; it is never manually typed. This is the single algorithm used by
 * the workspace summary, Award 360 alerts, reconciliation, and reporting.
 *
 * ── Accounting model (MODEL A — signed contra events) ───────────────────
 * The original transaction ALWAYS remains in its own financial category and
 * is immutable. A REVERSAL is an equal-and-opposite signed event applied to
 * the *category of the transaction it references*:
 *
 *   recovered  = Σ approved RECEIPT/DEDUCTION/ADJUSTMENT − Σ reversals of those
 *   waived     = Σ approved WAIVER                        − Σ reversals of those
 *   writtenOff = Σ approved WRITE_OFF                     − Σ reversals of those
 *
 *   outstanding = confirmedLiability − waived − writtenOff − recovered
 *
 * The reversal amount is NEVER added back a second time (that was the old
 * double-counting defect: exclude-original AND add-reversal). Model A is
 * used exclusively; Model B (exclude the reversed portion, add nothing) is
 * NOT mixed in.
 *
 * Golden invariant:
 *   confirmed 400, receipt 300, receipt fully reversed 300 → outstanding 400.
 *
 * Supports full reversal, partial reversal and multiple partial reversals of
 * the same original transaction. Over-reversal (cumulative reversal above the
 * unreversed amount) is rejected by `validateReversal` and reported by
 * `computeOverpaymentBalance` via `overReversedTxnIds`.
 */

export type BnRecoveryTransactionKind =
  | 'RECEIPT'         // Payment from claimant / third party
  | 'DEDUCTION'       // Withheld from a future benefit payment
  | 'WAIVER'          // Approved waiver amount
  | 'WRITE_OFF'       // Approved write-off amount
  | 'REVERSAL'        // Reverses a previously recorded transaction
  | 'ADJUSTMENT';     // Manual correction (rare, admin only)

export interface BnRecoveryTransactionSlice {
  readonly kind: BnRecoveryTransactionKind;
  /** Positive absolute magnitude, in `currency`. */
  readonly amount: number;
  /** Unapproved rows never affect the balance. */
  readonly approved: boolean;
  /** Stable identifier of this transaction. */
  readonly txnId?: string;
  /**
   * REVERSAL only — the immutable original transaction being reversed.
   * A REVERSAL without this reference is inert (it can never be attributed
   * to a category and is therefore ignored).
   */
  readonly reversesTxnId?: string | null;
  /** @deprecated legacy alias of `reversesTxnId`, retained for compatibility. */
  readonly reversedByTxnId?: string | null;
  /** ISO-4217. When present, all rows must agree with the case currency. */
  readonly currency?: string | null;
}

export interface BnOverpaymentBalanceInput {
  readonly confirmedLiability: number;
  readonly transactions: readonly BnRecoveryTransactionSlice[];
  /** Case currency. When set, mismatched rows are reported, never absorbed. */
  readonly currency?: string | null;
}

export interface BnOverpaymentBalance {
  readonly confirmed: number;
  /** Net of reversals. */
  readonly waived: number;
  /** Net of reversals. */
  readonly writtenOff: number;
  /** Receipts + deductions + adjustments, net of reversals. */
  readonly recovered: number;
  /** Gross magnitude of all approved, attributable reversals. */
  readonly reversed: number;
  /** Clamped to ≥ 0. */
  readonly outstanding: number;
  readonly hasOverAllocation: boolean;
  readonly isFullyRecovered: boolean;
  readonly isFullyWaived: boolean;
  readonly isFullyWrittenOff: boolean;
  /** Originals whose cumulative reversal exceeds their own amount. */
  readonly overReversedTxnIds: readonly string[];
  /** Rows whose currency disagrees with the case currency. */
  readonly currencyMismatchTxnIds: readonly string[];
}

/** Deterministic 2-decimal rounding (half-away-from-zero on the cent). */
export function round2(n: number): number {
  const s = n < 0 ? -1 : 1;
  return s * Math.round(Math.abs(n) * 100 + Number.EPSILON) / 100;
}

function reversalTarget(t: BnRecoveryTransactionSlice): string | null {
  return t.reversesTxnId ?? t.reversedByTxnId ?? null;
}

/** Cumulative approved reversal magnitude already applied to `txnId`. */
export function reversedAmountFor(
  transactions: readonly BnRecoveryTransactionSlice[],
  txnId: string,
): number {
  let total = 0;
  for (const t of transactions) {
    if (!t.approved || t.kind !== 'REVERSAL') continue;
    if (reversalTarget(t) === txnId) total += Math.abs(t.amount);
  }
  return round2(total);
}

export type BnReversalValidationCode =
  | 'ORIGINAL_NOT_FOUND'
  | 'ORIGINAL_NOT_APPROVED'
  | 'ORIGINAL_IS_REVERSAL'
  | 'AMOUNT_NOT_POSITIVE'
  | 'CURRENCY_MISMATCH'
  | 'EXCEEDS_UNREVERSED_AMOUNT';

export interface BnReversalValidation {
  readonly ok: boolean;
  readonly code?: BnReversalValidationCode;
  readonly unreversedAmount: number;
}

/**
 * Guard for BN_OVP_REVERSE_TRANSACTION. Prevents reversing more than the
 * unreversed remainder (so a second full reversal, or an over-reversal, is
 * rejected rather than silently creating negative recovery).
 */
export function validateReversal(
  transactions: readonly BnRecoveryTransactionSlice[],
  originalTxnId: string,
  reversalAmount: number,
  currency?: string | null,
): BnReversalValidation {
  const original = transactions.find((t) => t.txnId === originalTxnId);
  if (!original) return { ok: false, code: 'ORIGINAL_NOT_FOUND', unreversedAmount: 0 };
  if (original.kind === 'REVERSAL') {
    return { ok: false, code: 'ORIGINAL_IS_REVERSAL', unreversedAmount: 0 };
  }
  if (!original.approved) {
    return { ok: false, code: 'ORIGINAL_NOT_APPROVED', unreversedAmount: 0 };
  }

  const unreversed = round2(Math.abs(original.amount) - reversedAmountFor(transactions, originalTxnId));

  if (!(reversalAmount > 0)) {
    return { ok: false, code: 'AMOUNT_NOT_POSITIVE', unreversedAmount: unreversed };
  }
  if (currency && original.currency && original.currency !== currency) {
    return { ok: false, code: 'CURRENCY_MISMATCH', unreversedAmount: unreversed };
  }
  if (round2(reversalAmount) > unreversed + 0.0001) {
    return { ok: false, code: 'EXCEEDS_UNREVERSED_AMOUNT', unreversedAmount: unreversed };
  }
  return { ok: true, unreversedAmount: unreversed };
}

/**
 * Compute the outstanding balance for an overpayment.
 *
 * Transactions with `approved === false` are ignored — pending approvals
 * must never move the balance until an authorised command approves them.
 */
export function computeOverpaymentBalance(
  input: BnOverpaymentBalanceInput,
): BnOverpaymentBalance {
  const byId = new Map<string, BnRecoveryTransactionSlice>();
  for (const t of input.transactions) {
    if (t.txnId) byId.set(t.txnId, t);
  }

  // Attribute each approved reversal to the category of its original.
  const reversalByOriginal = new Map<string, number>();
  let reversedGross = 0;
  for (const t of input.transactions) {
    if (!t.approved || t.kind !== 'REVERSAL') continue;
    const target = reversalTarget(t);
    if (!target || !byId.has(target)) continue; // inert, unattributable
    const amt = Math.abs(t.amount);
    reversalByOriginal.set(target, (reversalByOriginal.get(target) ?? 0) + amt);
    reversedGross += amt;
  }

  const overReversedTxnIds: string[] = [];
  const currencyMismatchTxnIds: string[] = [];

  let waived = 0;
  let writtenOff = 0;
  let recovered = 0;

  for (const t of input.transactions) {
    if (!t.approved) continue;
    if (t.kind === 'REVERSAL') continue; // applied as a contra below

    if (input.currency && t.currency && t.currency !== input.currency && t.txnId) {
      currencyMismatchTxnIds.push(t.txnId);
    }

    const gross = Math.abs(t.amount);
    const reversedHere = t.txnId ? (reversalByOriginal.get(t.txnId) ?? 0) : 0;
    if (t.txnId && reversedHere > gross + 0.0001) overReversedTxnIds.push(t.txnId);

    // MODEL A: original stays in its category, reversal is the contra event.
    const net = gross - Math.min(reversedHere, gross);

    switch (t.kind) {
      case 'WAIVER':      waived += net; break;
      case 'WRITE_OFF':   writtenOff += net; break;
      case 'RECEIPT':
      case 'DEDUCTION':
      case 'ADJUSTMENT':  recovered += net; break;
    }
  }

  waived = round2(waived);
  writtenOff = round2(writtenOff);
  recovered = round2(recovered);

  const confirmed = round2(input.confirmedLiability);
  const raw = round2(confirmed - waived - writtenOff - recovered);
  const outstanding = Math.max(0, raw);

  return {
    confirmed,
    waived,
    writtenOff,
    recovered,
    reversed: round2(reversedGross),
    outstanding,
    hasOverAllocation: raw < -0.005,
    isFullyRecovered: outstanding === 0 && recovered > 0,
    isFullyWaived: confirmed > 0 && waived >= confirmed,
    isFullyWrittenOff: confirmed > 0 && writtenOff >= confirmed,
    overReversedTxnIds,
    currencyMismatchTxnIds,
  };
}
