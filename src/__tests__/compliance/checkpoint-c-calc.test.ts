import { describe, it, expect } from "vitest";
import {
  computeInterest,
  resolveAccrualStartDate,
  type CeInterestPolicy,
} from "@/lib/compliance/calculation/interestEngine";
import {
  computeEstimatedAssessment,
  reconcileEstimatedAssessment,
  selectEstimateBasis,
  type CeEstimateParameters,
  type CeHistoryPeriod,
} from "@/lib/compliance/calculation/estimatedAssessment";
import {
  allocateEstimateToEmployees,
  CE_SYSTEM_ESTIMATED_MARKER,
  type CeEmployeeHistory,
} from "@/lib/compliance/calculation/employeeAllocation";
import {
  allocatePayment,
  type CeAllocationPolicy,
  type CeOutstandingItem,
} from "@/lib/compliance/calculation/contributionAllocation";
import { calculationIdempotencyKey, round2 } from "@/lib/compliance/calculation/calculationTrace";
import {
  CALCULATION_PARAM_SPEC,
  isRetiredCalculationRule,
  resolveRuleParameters,
} from "@/lib/compliance/detectionRuleParameterSpec";
import { resolveObligationTimeline, normalizeObligationPolicy } from "@/lib/compliance/obligationDeadlineResolver";

const interestPolicy: CeInterestPolicy = {
  annual_rate_percent: 5,
  compounding_basis: "monthly_compound",
  minimum_interest_principal: 10,
  accrual_start: "grace_end",
  max_accrual_months: null,
  policy_version: "CR-002@test",
};

const estimateParams: CeEstimateParameters = {
  history_period_count: 3,
  estimate_multiplier: 1.5,
  minimum_history_periods: 2,
  exclude_zero_periods: true,
  exclude_amended_periods: true,
  exclude_statuses: ["DRAFT", "REJECTED"],
  outlier_deviation_multiple: null,
  policy_version: "CR-003@test",
};

const allocationPolicy: CeAllocationPolicy = {
  class_order: ["contribution", "fine", "penalty"],
  within_class: "oldest_period_first",
  interest_settlement: "separate",
  respect_partial_payment_authority: true,
  over_payment_creates_credit: true,
  policy_version: "CR-008@test",
};

/* ───────────────── 1. CR-001 retirement ───────────────── */

describe("CR-001 generic late-payment penalty is retired", () => {
  it("is flagged as retired and has no parameter contract", () => {
    expect(isRetiredCalculationRule("CR-001")).toBe(true);
    expect(CALCULATION_PARAM_SPEC["CR-001"]).toBeUndefined();
  });

  it("does not retire the fund-specific fine rules or interest", () => {
    for (const code of ["CR-002", "CR-003", "CR-005", "CR-006", "CR-007"]) {
      expect(isRetiredCalculationRule(code)).toBe(false);
    }
  });

  it("keeps CR-004 configurable but not activated", () => {
    expect(CALCULATION_PARAM_SPEC["CR-004"]).toBeDefined();
    expect(isRetiredCalculationRule("CR-004")).toBe(false);
  });
});

/* ───────────────── 2. Interest (CR-002) ───────────────── */

describe("CR-002 interest engine", () => {
  const anchor = { due_date: "2026-08-31", grace_end_date: "2026-09-14", wage_period: "2026-07" };

  it("starts accruing only after the configured grace anchor", () => {
    expect(resolveAccrualStartDate(anchor, interestPolicy)).toBe("2026-09-14");
    const before = computeInterest({
      principal: 5000,
      anchor,
      as_of_date: "2026-09-30",
      policy: interestPolicy,
    });
    expect(before.elapsed_months).toBe(0);
    expect(before.amount).toBe(0);
  });

  it("compounds monthly at the configured annual rate", () => {
    const result = computeInterest({
      principal: 10000,
      anchor,
      as_of_date: "2027-09-14",
      policy: interestPolicy,
    });
    expect(result.elapsed_months).toBe(12);
    const expected = round2(10000 * (Math.pow(1 + 0.05 / 12, 12) - 1));
    expect(result.cumulative_amount).toBeCloseTo(expected, 2);
    // compounding must exceed the simple-interest equivalent
    expect(result.cumulative_amount).toBeGreaterThan(500);
  });

  it("honours simple monthly interest when configured", () => {
    const simple = computeInterest({
      principal: 10000,
      anchor,
      as_of_date: "2027-09-14",
      policy: { ...interestPolicy, compounding_basis: "monthly_simple" },
    });
    expect(simple.cumulative_amount).toBeCloseTo(500, 2);
  });

  it("suppresses interest below the configured minimum principal", () => {
    const result = computeInterest({
      principal: 9.99,
      anchor,
      as_of_date: "2027-09-14",
      policy: interestPolicy,
    });
    expect(result.amount).toBe(0);
    expect(result.trace.suppressed_reason).toBeTruthy();
  });

  it("never double-charges: only the incremental amount is posted", () => {
    const first = computeInterest({
      principal: 10000, anchor, as_of_date: "2027-03-14", policy: interestPolicy,
    });
    const second = computeInterest({
      principal: 10000,
      anchor,
      as_of_date: "2027-09-14",
      policy: interestPolicy,
      already_accrued: first.cumulative_amount,
    });
    expect(round2(first.cumulative_amount + second.amount)).toBeCloseTo(second.cumulative_amount, 2);
    const repeat = computeInterest({
      principal: 10000,
      anchor,
      as_of_date: "2027-03-14",
      policy: interestPolicy,
      already_accrued: first.cumulative_amount,
    });
    expect(repeat.amount).toBe(0);
  });

  it("produces a reproducible trace and stable idempotency key", () => {
    const result = computeInterest({
      employer_id: "000005", principal: 10000, anchor, as_of_date: "2027-09-14", policy: interestPolicy,
    });
    expect(result.trace.rule_code).toBe("CR-002");
    expect(result.trace.policy_version).toBe("CR-002@test");
    expect(result.trace.steps.length).toBeGreaterThan(2);
    const key = { component: "INTEREST" as const, rule_code: "CR-002", employer_id: "000005", period: "2026-07", fund_code: "SS", as_of: "2027-09-14" };
    expect(calculationIdempotencyKey(key)).toBe(calculationIdempotencyKey(key));
  });

  it("uses the authoritative obligation timeline as its anchor", () => {
    const timeline = resolveObligationTimeline({
      obligation_type: "CONTRIBUTION_PAYMENT",
      wage_period: "2026-07",
      policy: normalizeObligationPolicy({
        deadline_basis: "calendar_month_end",
        reporting_offset_months: 1,
        grace_days: 0,
      }),
    });
    expect(timeline.due_date).toBe("2026-08-31");
    const result = computeInterest({
      principal: 1000,
      anchor: { due_date: timeline.due_date, grace_end_date: timeline.grace_end_date, wage_period: "2026-07" },
      as_of_date: "2026-10-31",
      policy: interestPolicy,
    });
    expect(result.accrual_start_date).toBe(timeline.grace_end_date);
  });

  it("rejects an unconfigured policy rather than defaulting", () => {
    expect(() =>
      computeInterest({
        principal: 100,
        anchor,
        as_of_date: "2027-01-01",
        policy: { ...interestPolicy, policy_version: "" },
      }),
    ).toThrow();
  });
});

/* ───────────────── 3. Estimated assessment (CR-003) ───────────────── */

const history: CeHistoryPeriod[] = [
  { wage_period: "2026-06", total_liability: 1000 },
  { wage_period: "2026-05", total_liability: 1200 },
  { wage_period: "2026-04", total_liability: 800 },
  { wage_period: "2026-03", total_liability: 5000 },
];

describe("CR-003 estimated assessment", () => {
  it("uses the configured number of recent periods and multiplier", () => {
    const result = computeEstimatedAssessment({
      employer_id: "000005", wage_period: "2026-07", candidates: history, params: estimateParams,
    });
    expect(result.outcome).toBe("estimated");
    expect(result.basis.selected.map((p) => p.wage_period)).toEqual(["2026-06", "2026-05", "2026-04"]);
    expect(result.average_liability).toBe(1000);
    expect(result.amount).toBe(1500);
  });

  it("changes with configuration, never with code", () => {
    const result = computeEstimatedAssessment({
      wage_period: "2026-07",
      candidates: history,
      params: { ...estimateParams, history_period_count: 4, estimate_multiplier: 2 },
    });
    expect(result.basis.selected).toHaveLength(4);
    expect(result.amount).toBe(round2(((1000 + 1200 + 800 + 5000) / 4) * 2));
  });

  it("excludes nil, amended and disqualified-status periods", () => {
    const basis = selectEstimateBasis(
      [
        { wage_period: "2026-06", total_liability: 0 },
        { wage_period: "2026-05", total_liability: 900, is_amended: true },
        { wage_period: "2026-04", total_liability: 900, status: "REJECTED" },
        { wage_period: "2026-03", total_liability: 900 },
        { wage_period: "2026-02", total_liability: 900 },
      ],
      estimateParams,
    );
    expect(basis.selected.map((p) => p.wage_period)).toEqual(["2026-03", "2026-02"]);
    const reasons = basis.excluded.map((e) => e.reason);
    expect(reasons).toContain("zero_or_negative");
    expect(reasons).toContain("amended_period");
    expect(reasons).toContain("excluded_status");
  });

  it("raises an exception instead of guessing when history is insufficient", () => {
    const result = computeEstimatedAssessment({
      wage_period: "2026-07",
      candidates: [{ wage_period: "2026-06", total_liability: 1000 }],
      params: estimateParams,
    });
    expect(result.outcome).toBe("exception");
    expect(result.amount).toBe(0);
    expect(result.exception?.reason).toBe("insufficient_history");
  });

  it("reconciles a filed C3 that is lower than the estimate into a credit", () => {
    const recon = reconcileEstimatedAssessment({
      wage_period: "2026-07",
      estimated_amount: 1500,
      actual_amount: 900,
      policy_version: "CR-003@test",
    });
    expect(recon.outcome).toBe("credit_due");
    expect(recon.credit_amount).toBe(600);
    expect(recon.additional_liability).toBe(0);
    expect(recon.estimated_amount).toBe(1500);
    expect(recon.actual_amount).toBe(900);
  });

  it("reconciles a filed C3 that is higher into an additional liability", () => {
    const recon = reconcileEstimatedAssessment({
      wage_period: "2026-07", estimated_amount: 1500, actual_amount: 2100, policy_version: "CR-003@test",
    });
    expect(recon.outcome).toBe("additional_liability");
    expect(recon.additional_liability).toBe(600);
    expect(recon.credit_amount).toBe(0);
  });

  it("is idempotent — reconciling the same figures twice yields the same result", () => {
    const args = { wage_period: "2026-07", estimated_amount: 1500, actual_amount: 900, policy_version: "CR-003@test" };
    expect(reconcileEstimatedAssessment(args)).toEqual(reconcileEstimatedAssessment(args));
  });
});

/* ───────────────── 4. System-estimated employee allocation ───────────────── */

const employees: CeEmployeeHistory[] = [
  { person_ssn: "A1", wage_total: 6000, periods_present: 3, employment_status: "active" },
  { person_ssn: "A2", wage_total: 3000, periods_present: 3, employment_status: "active" },
  { person_ssn: "A3", wage_total: 1000, periods_present: 3, employment_status: "active" },
];

describe("historical employee allocation of a system estimate", () => {
  const params = {
    basis_periods: ["2026-04", "2026-05", "2026-06"],
    minimum_periods_present: 1,
    contribution_ceiling: null,
    allocate_ceased_employees: false,
    allocate_benefit_overlap: false,
    policy_version: "CR-003@test",
  };

  it("distributes strictly by historical wage ratio and marks records SYSTEM_ESTIMATED", () => {
    const result = allocateEstimateToEmployees({
      employer_id: "000005", target_period: "2026-07", target_amount: 1000, employees, params,
    });
    const byPerson = Object.fromEntries(result.allocations.map((l) => [l.person_ssn, l.amount]));
    expect(byPerson.A1).toBeCloseTo(600, 2);
    expect(byPerson.A2).toBeCloseTo(300, 2);
    expect(byPerson.A3).toBeCloseTo(100, 2);
    expect(result.allocations.every((l) => l.record_marker === CE_SYSTEM_ESTIMATED_MARKER)).toBe(true);
    expect(round2(result.allocated_amount)).toBe(1000);
    expect(result.unallocated_amount).toBe(0);
  });

  it("sends ceased employees to the review queue instead of allocating silently", () => {
    const result = allocateEstimateToEmployees({
      target_period: "2026-07",
      target_amount: 1000,
      employees: [...employees, { person_ssn: "A4", wage_total: 2000, periods_present: 3, employment_status: "ceased" }],
      params,
    });
    expect(result.exceptions.some((e) => e.person_ssn === "A4" && e.reason === "employment_ceased")).toBe(true);
    expect(result.allocations.some((l) => l.person_ssn === "A4")).toBe(false);
  });

  it("flags people who joined after the basis window", () => {
    const result = allocateEstimateToEmployees({
      target_period: "2026-07",
      target_amount: 1000,
      employees: [...employees, { person_ssn: "A5", wage_total: 0, periods_present: 0, employment_start_date: "2026-07-01" }],
      params,
    });
    expect(result.exceptions.some((e) => e.person_ssn === "A5")).toBe(true);
  });

  it("respects the insurable ceiling and leaves the residue unallocated", () => {
    const result = allocateEstimateToEmployees({
      target_period: "2026-07",
      target_amount: 1000,
      employees,
      params: { ...params, contribution_ceiling: 200 },
    });
    expect(result.allocations.every((l) => l.amount <= 200)).toBe(true);
    expect(result.unallocated_amount).toBeGreaterThan(0);
    expect(result.exceptions.some((e) => e.reason === "contribution_ceiling_reached")).toBe(true);
  });

  it("never invents an allocation when no usable basis exists", () => {
    const result = allocateEstimateToEmployees({
      target_period: "2026-07", target_amount: 1000, employees: [], params,
    });
    expect(result.allocations).toHaveLength(0);
    expect(result.unallocated_amount).toBe(1000);
    expect(result.exceptions.some((e) => e.reason === "no_allocable_basis")).toBe(true);
  });
});

/* ───────────────── 5. Payment allocation and credits ───────────────── */

const items: CeOutstandingItem[] = [
  { id: "c-old", wage_period: "2026-03", liability_class: "contribution", outstanding_amount: 500 },
  { id: "c-new", wage_period: "2026-06", liability_class: "contribution", outstanding_amount: 500 },
  { id: "f-1", wage_period: "2026-03", liability_class: "fine", outstanding_amount: 200 },
  { id: "i-1", wage_period: "2026-03", liability_class: "interest", outstanding_amount: 300 },
];

describe("payment allocation order and credits", () => {
  it("settles contributions oldest-first before fines, and interest separately", () => {
    const result = allocatePayment({
      payment_reference: "RCT-1", payment_amount: 1100, items, policy: allocationPolicy,
    });
    const order = result.lines.map((l) => l.item_id);
    expect(order.slice(0, 3)).toEqual(["c-old", "c-new", "f-1"]);
    expect(result.interest_settled).toBe(0);
    expect(result.credit).toBeUndefined();
  });

  it("settles interest only after contributions and fines are cleared", () => {
    const result = allocatePayment({
      payment_reference: "RCT-2", payment_amount: 1500, items, policy: allocationPolicy,
    });
    expect(result.interest_settled).toBe(300);
    expect(result.lines.at(-1)?.liability_class).toBe("interest");
  });

  it("follows a reconfigured class order without code change", () => {
    const result = allocatePayment({
      payment_reference: "RCT-3",
      payment_amount: 200,
      items,
      policy: { ...allocationPolicy, class_order: ["fine", "contribution", "penalty"] },
    });
    expect(result.lines[0].item_id).toBe("f-1");
  });

  it("never overrides an approved B1 partial-payment allocation", () => {
    const result = allocatePayment({
      payment_reference: "RCT-4",
      payment_amount: 500,
      items,
      policy: allocationPolicy,
      authorised_allocations: [{ item_id: "c-new", amount: 500, authority_reference: "PPR-1" }],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].item_id).toBe("c-new");
    expect(result.lines[0].source).toBe("partial_payment_authority");
    expect(result.lines[0].authority_reference).toBe("PPR-1");
  });

  it("turns an over-payment into a governed credit, never an automatic refund", () => {
    const result = allocatePayment({
      payment_reference: "RCT-5", payment_amount: 2000, items, policy: allocationPolicy,
    });
    expect(result.credit?.amount).toBe(500);
    expect(result.credit?.disposition).toBe("offset_future_liability");
    expect(result.credit?.source_reference).toBe("RCT-5");
    expect(JSON.stringify(result)).not.toMatch(/refund/i);
  });

  it("is idempotent and fully traced", () => {
    const args = { payment_reference: "RCT-6", payment_amount: 900, items, policy: allocationPolicy };
    const a = allocatePayment(args);
    const b = allocatePayment(args);
    expect(a.lines).toEqual(b.lines);
    expect(a.trace.steps.length).toBeGreaterThan(2);
    expect(round2(a.allocated_amount)).toBe(900);
  });

  it("rejects an approved allocation pointing at an unknown liability", () => {
    expect(() =>
      allocatePayment({
        payment_reference: "RCT-7",
        payment_amount: 100,
        items,
        policy: allocationPolicy,
        authorised_allocations: [{ item_id: "ghost", amount: 100, authority_reference: "PPR-X" }],
      }),
    ).toThrow();
  });
});

/* ───────────────── 6. Configuration contracts ───────────────── */

describe("Checkpoint C parameter contracts", () => {
  it("resolves the St Kitts interest defaults from configuration", () => {
    const resolved = resolveRuleParameters(
      CALCULATION_PARAM_SPEC["CR-002"],
      {
        annual_rate_percent: 5,
        compounding_basis: ["monthly_compound"],
        minimum_interest_principal: 10,
        accrual_start: ["grace_end"],
      },
      null,
    );
    expect(resolved.errors).toEqual([]);
    expect(resolved.values.annual_rate_percent).toBe(5);
  });

  it("reports a configuration error rather than substituting a default rate", () => {
    const resolved = resolveRuleParameters(CALCULATION_PARAM_SPEC["CR-002"], {}, null);
    expect(resolved.errors.length).toBeGreaterThan(0);
  });

  it("defines the estimated-assessment and allocation contracts", () => {
    const estimateKeys = CALCULATION_PARAM_SPEC["CR-003"].map((p) => p.key);
    expect(estimateKeys).toContain("history_period_count");
    expect(estimateKeys).toContain("estimate_multiplier");
    const allocKeys = CALCULATION_PARAM_SPEC["CR-008"].map((p) => p.key);
    expect(allocKeys).toContain("class_order");
    expect(allocKeys).toContain("interest_settlement");
  });
});
