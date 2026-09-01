/**
 * Compliance — Payment allocation order and credit handling (Checkpoint C).
 *
 * Client direction:
 *   1. contributions, oldest outstanding period first;
 *   2. fines / penalties;
 *   3. interest is accounted SEPARATELY (its own component, never merged).
 * Over-payment becomes a governed CREDIT — never an automatic cash refund.
 *
 * The order is policy, not code: `CeAllocationPolicy.class_order` comes from
 * configuration and can be reordered without a deployment.
 *
 * Allocations already authorised through the B1 partial-payment workflow are
 * honoured first and can never be overridden by this generic engine.
 *
 * Mirrored byte-for-byte to
 * `supabase/functions/_shared/compliance/calculation/contributionAllocation.ts`.
 */

import {
  CeCalculationConfigError,
  CeCalculationTrace,
  round2,
} from "./calculationTrace";

export type CeLiabilityClass = "contribution" | "fine" | "penalty" | "interest";

export const CE_LIABILITY_CLASSES: readonly CeLiabilityClass[] = [
  "contribution",
  "fine",
  "penalty",
  "interest",
];

export type CeWithinClassOrder = "oldest_period_first" | "newest_period_first";

export interface CeAllocationPolicy {
  /** Configured settlement order across liability classes. */
  class_order: CeLiabilityClass[];
  within_class: CeWithinClassOrder;
  /**
   * "separate" keeps interest out of the automatic waterfall so it is settled
   * as its own component; "inline" lets it take its place in `class_order`.
   */
  interest_settlement: "separate" | "inline";
  /** B1 authority must always win — configurable only to make it explicit. */
  respect_partial_payment_authority: boolean;
  /** Over-payment becomes a credit rather than a refund in this checkpoint. */
  over_payment_creates_credit: boolean;
  policy_version: string;
}

export interface CeOutstandingItem {
  /** Ledger entry / bucket identifier. */
  id: string;
  /** "YYYY-MM". */
  wage_period: string;
  fund_code?: string | null;
  liability_class: CeLiabilityClass;
  outstanding_amount: number;
}

/** An allocation already approved through the B1 partial-payment workflow. */
export interface CeAuthorisedAllocation {
  item_id: string;
  amount: number;
  authority_reference: string;
}

export interface CeAllocationLine {
  item_id: string;
  wage_period: string;
  fund_code: string | null;
  liability_class: CeLiabilityClass;
  outstanding_before: number;
  amount: number;
  outstanding_after: number;
  sequence: number;
  source: "partial_payment_authority" | "allocation_policy";
  authority_reference?: string;
}

export interface CeCreditResult {
  amount: number;
  /** Source transaction the credit is traceable to. */
  source_reference: string;
  wage_period: string;
  fund_code: string | null;
  disposition: "offset_future_liability";
}

export interface CeAllocationResult {
  payment_amount: number;
  allocated_amount: number;
  lines: CeAllocationLine[];
  /** Interest settled separately from the contribution waterfall. */
  interest_settled: number;
  credit?: CeCreditResult;
  trace: CeCalculationTrace;
}

function assertPolicy(p: CeAllocationPolicy): void {
  if (!p) throw new CeCalculationConfigError("Allocation policy is not configured");
  if (!Array.isArray(p.class_order) || p.class_order.length === 0) {
    throw new CeCalculationConfigError("Allocation policy has no class_order configured");
  }
  for (const cls of p.class_order) {
    if (!CE_LIABILITY_CLASSES.includes(cls)) {
      throw new CeCalculationConfigError(`Allocation policy: unknown liability class "${cls}"`);
    }
  }
  if (p.within_class !== "oldest_period_first" && p.within_class !== "newest_period_first") {
    throw new CeCalculationConfigError(
      `Allocation policy: unsupported within_class "${p.within_class}"`,
    );
  }
  if (!p.policy_version) {
    throw new CeCalculationConfigError("Allocation policy: policy_version is required for audit");
  }
}

function orderItems(
  items: CeOutstandingItem[],
  policy: CeAllocationPolicy,
): CeOutstandingItem[] {
  const rank = new Map<string, number>();
  policy.class_order.forEach((cls, i) => rank.set(cls, i));
  return [...items]
    .filter((i) => rank.has(i.liability_class))
    .sort((a, b) => {
      const byClass = rank.get(a.liability_class)! - rank.get(b.liability_class)!;
      if (byClass !== 0) return byClass;
      const byPeriod = a.wage_period.localeCompare(b.wage_period);
      return policy.within_class === "oldest_period_first" ? byPeriod : -byPeriod;
    });
}

/**
 * Allocate a payment across outstanding items.
 *
 * Order of operations:
 *  1. honour B1-authorised allocations exactly;
 *  2. settle interest separately when the policy says so;
 *  3. run the configured class waterfall over what is left;
 *  4. turn any residue into a governed credit.
 */
export function allocatePayment(input: {
  employer_id?: string;
  payment_reference: string;
  payment_amount: number;
  payment_period?: string;
  items: CeOutstandingItem[];
  policy: CeAllocationPolicy;
  authorised_allocations?: CeAuthorisedAllocation[];
}): CeAllocationResult {
  const { policy } = input;
  assertPolicy(policy);

  const payment = round2(Math.max(Number(input.payment_amount) || 0, 0));
  let remaining = payment;
  const lines: CeAllocationLine[] = [];
  const steps: string[] = [
    `Payment ${input.payment_reference}: ${payment.toFixed(2)}`,
    `Configured class order: ${policy.class_order.join(" → ")} (within class: ${policy.within_class})`,
    `Interest settlement: ${policy.interest_settlement}`,
  ];

  const outstanding = new Map<string, number>();
  for (const item of input.items ?? []) {
    outstanding.set(item.id, round2(Math.max(Number(item.outstanding_amount) || 0, 0)));
  }
  const byId = new Map((input.items ?? []).map((i) => [i.id, i]));
  let sequence = 0;

  const take = (
    item: CeOutstandingItem,
    requested: number,
    source: CeAllocationLine["source"],
    authorityReference?: string,
  ) => {
    const before = outstanding.get(item.id) ?? 0;
    const amount = round2(Math.min(requested, before, remaining));
    if (amount <= 0) return;
    outstanding.set(item.id, round2(before - amount));
    remaining = round2(remaining - amount);
    sequence += 1;
    lines.push({
      item_id: item.id,
      wage_period: item.wage_period,
      fund_code: item.fund_code ?? null,
      liability_class: item.liability_class,
      outstanding_before: before,
      amount,
      outstanding_after: round2(before - amount),
      sequence,
      source,
      ...(authorityReference ? { authority_reference: authorityReference } : {}),
    });
    steps.push(
      `#${sequence} ${source === "partial_payment_authority" ? "[B1 authority] " : ""}${item.liability_class} ${item.wage_period}${
        item.fund_code ? `/${item.fund_code}` : ""
      }: ${amount.toFixed(2)} of ${before.toFixed(2)}`,
    );
  };

  // 1 — B1 partial-payment authority is never overridden.
  const authorised = input.authorised_allocations ?? [];
  if (policy.respect_partial_payment_authority && authorised.length > 0) {
    steps.push(`Honouring ${authorised.length} approved partial-payment allocation line(s) first`);
    for (const auth of authorised) {
      const item = byId.get(auth.item_id);
      if (!item) {
        throw new CeCalculationConfigError(
          `Approved partial-payment allocation references unknown liability "${auth.item_id}"`,
        );
      }
      take(item, round2(Number(auth.amount) || 0), "partial_payment_authority", auth.authority_reference);
    }
  }

  // 2 — interest settled as its own component.
  let interestSettled = 0;
  const ordered = orderItems(
    (input.items ?? []).filter((i) => (outstanding.get(i.id) ?? 0) > 0),
    policy.interest_settlement === "separate"
      ? { ...policy, class_order: policy.class_order.filter((c) => c !== "interest") }
      : policy,
  );

  // 3 — configured waterfall.
  for (const item of ordered) {
    if (remaining <= 0) break;
    take(item, remaining, "allocation_policy");
  }

  if (policy.interest_settlement === "separate" && remaining > 0) {
    const interestItems = orderItems(
      (input.items ?? []).filter(
        (i) => i.liability_class === "interest" && (outstanding.get(i.id) ?? 0) > 0,
      ),
      { ...policy, class_order: ["interest"] },
    );
    if (interestItems.length > 0) {
      steps.push("Contributions and fines/penalties settled — applying the remainder to interest separately");
    }
    for (const item of interestItems) {
      if (remaining <= 0) break;
      const before = outstanding.get(item.id) ?? 0;
      take(item, remaining, "allocation_policy");
      interestSettled = round2(interestSettled + Math.min(before, round2(before - (outstanding.get(item.id) ?? 0))));
    }
  }
  interestSettled = round2(
    lines.filter((l) => l.liability_class === "interest").reduce((s, l) => s + l.amount, 0),
  );

  const allocated = round2(lines.reduce((s, l) => s + l.amount, 0));

  let credit: CeCreditResult | undefined;
  if (remaining > 0) {
    if (!policy.over_payment_creates_credit) {
      throw new CeCalculationConfigError(
        "Payment exceeds outstanding liability but over_payment_creates_credit is disabled — no disposition is configured",
      );
    }
    credit = {
      amount: remaining,
      source_reference: input.payment_reference,
      wage_period: input.payment_period ?? (input.items ?? [])[0]?.wage_period ?? "",
      fund_code: (input.items ?? [])[0]?.fund_code ?? null,
      disposition: "offset_future_liability",
    };
    steps.push(
      `Over-contribution ${remaining.toFixed(2)} recorded as a credit against future liabilities (no cash refund — Finance process)`,
    );
  }

  return {
    payment_amount: payment,
    allocated_amount: allocated,
    lines,
    interest_settled: interestSettled,
    credit,
    trace: {
      rule_code: "CR-008",
      policy_version: policy.policy_version,
      component: "CONTRIBUTION",
      principal: payment,
      rate: null,
      rate_basis: null,
      period_count: lines.length,
      multiplier: null,
      compounding_basis: null,
      source_periods: Array.from(new Set(lines.map((l) => l.wage_period))),
      allocation_basis: `${policy.class_order.join(">")} / ${policy.within_class}`,
      rounding: "half_up_2",
      raw_amount: payment,
      amount: allocated,
      steps,
      inputs: {
        employer_id: input.employer_id ?? null,
        payment_reference: input.payment_reference,
        payment_amount: payment,
        class_order: policy.class_order,
        within_class: policy.within_class,
        interest_settlement: policy.interest_settlement,
        respect_partial_payment_authority: policy.respect_partial_payment_authority,
        authorised_allocations: authorised,
        items: (input.items ?? []).map((i) => ({
          id: i.id,
          wage_period: i.wage_period,
          liability_class: i.liability_class,
          outstanding_amount: i.outstanding_amount,
        })),
        credit_amount: credit?.amount ?? 0,
      },
    },
  };
}
