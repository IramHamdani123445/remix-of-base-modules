import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeInterest, type CeInterestPolicy } from "@/lib/compliance/calculation/interestEngine";
import {
  CALCULATION_PARAM_SPEC,
  resolveRuleParameters,
} from "@/lib/compliance/detectionRuleParameterSpec";

/** Client-confirmed basis only. Nothing here invents a cap or a start date. */
const CONFIRMED: CeInterestPolicy = {
  annual_rate_percent: 5,
  compounding_basis: "monthly_compound",
  minimum_interest_principal: 10,
  accrual_start: "grace_end",
  policy_version: "CR-002@test",
};

const anchor = { due_date: "1987-02-28", grace_end_date: "1987-02-28", wage_period: "1987-01" };
const recent = { due_date: "2026-06-30", grace_end_date: "2026-06-30", wage_period: "2026-05" };

describe("CR-002 retroactivity governance (open decision CR-002-RETROACTIVITY)", () => {
  it("keeps the confirmed basis untouched: 5%, monthly compounding, EC$10 minimum, grace anchor", () => {
    const spec = CALCULATION_PARAM_SPEC["CR-002"];
    const byKey = Object.fromEntries(spec.map((s) => [s.key, s]));
    expect(byKey.annual_rate_percent.suggested).toBe(5);
    expect(byKey.compounding_basis.suggested).toEqual(["monthly_compound"]);
    expect(byKey.minimum_interest_principal.suggested).toBe(10);
    expect(byKey.accrual_start.suggested).toEqual(["grace_end"]);
  });

  it("exposes retroactivity governance as configuration, with no seeded cap or start date", () => {
    const spec = CALCULATION_PARAM_SPEC["CR-002"];
    const byKey = Object.fromEntries(spec.map((s) => [s.key, s]));
    for (const key of [
      "interest_effective_from",
      "max_accrual_months",
      "max_interest_amount",
      "apply_to_pre_existing_liabilities",
    ]) {
      expect(byKey[key]).toBeTruthy();
      expect(byKey[key].required).toBe(false);
      expect(byKey[key].suggested).toBeUndefined();
    }
    expect(byKey.interest_effective_from.type).toBe("date");
  });

  it("resolves the governance parameters without substituting defaults", () => {
    const r = resolveRuleParameters(CALCULATION_PARAM_SPEC["CR-002"], {
      annual_rate_percent: 5,
      compounding_basis: ["monthly_compound"],
      minimum_interest_principal: 10,
      accrual_start: ["grace_end"],
    });
    expect(r.errors).toEqual([]);
    expect(r.values.max_accrual_months).toBeUndefined();
    expect(r.values.interest_effective_from).toBeUndefined();
    expect(r.values.max_interest_amount).toBeUndefined();
    expect(r.values.apply_to_pre_existing_liabilities).toBeUndefined();
  });

  it("rejects a malformed effective date instead of guessing one", () => {
    const r = resolveRuleParameters(CALCULATION_PARAM_SPEC["CR-002"], {
      annual_rate_percent: 5,
      compounding_basis: ["monthly_compound"],
      minimum_interest_principal: 10,
      accrual_start: ["grace_end"],
      interest_effective_from: "01/01/2026",
    });
    expect(r.errors.join(" ")).toContain("interest_effective_from");
  });

  it("classifies unapproved retroactive interest for review in production, charging nothing", () => {
    const r = computeInterest({
      employer_id: "000005",
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: { ...CONFIRMED, interest_effective_from: "2026-01-01" },
      is_production: true,
    });
    expect(r.classification).toBe("INTEREST_POLICY_REVIEW_REQUIRED");
    expect(r.amount).toBe(0);
    expect(r.cumulative_amount).toBe(0);
    expect(r.review_reason).toContain("CR-002-RETROACTIVITY");
  });

  it("also holds production accrual when no effective date has been approved at all", () => {
    const r = computeInterest({
      principal: 1000,
      anchor: recent,
      as_of_date: "2026-08-29",
      policy: CONFIRMED,
      is_production: true,
    });
    expect(r.classification).toBe("INTEREST_POLICY_REVIEW_REQUIRED");
    expect(r.amount).toBe(0);
  });

  it("accrues normally in production once the balance post-dates the approved effective date", () => {
    const r = computeInterest({
      principal: 1000,
      anchor: recent,
      as_of_date: "2026-08-29",
      policy: { ...CONFIRMED, interest_effective_from: "2026-01-01" },
      is_production: true,
    });
    expect(r.classification).toBe("ACCRUED");
    expect(r.amount).toBeGreaterThan(0);
    expect(r.elapsed_months).toBe(1);
  });

  it("accrues from the effective date only, under exclude_pre_effective", () => {
    const r = computeInterest({
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: {
        ...CONFIRMED,
        interest_effective_from: "2026-01-01",
        apply_to_pre_existing_liabilities: "exclude_pre_effective",
      },
      is_production: true,
    });
    expect(r.classification).toBe("ACCRUED");
    expect(r.accrual_start_date).toBe("2026-01-01");
    expect(r.elapsed_months).toBe(7);
  });

  it("accrues from the statutory anchor when retrospective application is approved", () => {
    const r = computeInterest({
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: {
        ...CONFIRMED,
        interest_effective_from: "2026-01-01",
        apply_to_pre_existing_liabilities: "apply_retrospectively",
      },
      is_production: true,
    });
    expect(r.classification).toBe("ACCRUED");
    expect(r.accrual_start_date).toBe("1987-02-28");
    expect(r.elapsed_months).toBe(474);
    expect(r.cumulative_amount).toBeCloseTo(15560.76, 2);
  });

  it("computes but never posts the unapproved figure when running as a simulation", () => {
    const r = computeInterest({
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: { ...CONFIRMED, interest_effective_from: "2026-01-01" },
      is_production: true,
      simulation: true,
    });
    expect(r.classification).toBe("SIMULATED");
    expect(r.is_simulation).toBe(true);
    expect(r.cumulative_amount).toBeCloseTo(15560.76, 2);
    expect(r.trace.steps.join(" ")).toContain("SIMULATION");
  });

  it("honours an approved month cap and an approved amount ceiling when configured", () => {
    const capped = computeInterest({
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: {
        ...CONFIRMED,
        apply_to_pre_existing_liabilities: "apply_retrospectively",
        interest_effective_from: "2026-01-01",
        max_accrual_months: 120,
      },
      is_production: true,
    });
    expect(capped.elapsed_months).toBe(120);
    expect(capped.cumulative_amount).toBeLessThan(15560.76);

    const ceilinged = computeInterest({
      principal: 2519.1,
      anchor,
      as_of_date: "2026-08-29",
      policy: {
        ...CONFIRMED,
        apply_to_pre_existing_liabilities: "apply_retrospectively",
        interest_effective_from: "2026-01-01",
        max_interest_amount: 500,
      },
      is_production: true,
    });
    expect(ceilinged.cumulative_amount).toBe(500);
  });

  it("guards the accrual worker: production review classification is never posted", () => {
    const worker = readFileSync(
      resolve(process.cwd(), "supabase/functions/ce-ledger-penalty-accrual/index.ts"),
      "utf8",
    );
    expect(worker).toContain("INTEREST_POLICY_REVIEW_REQUIRED");
    expect(worker).toContain("platform_environment_marker");
    expect(worker).toContain("is_simulation");
    // No invented cap may be baked into the worker.
    expect(worker).not.toMatch(/max_accrual_months:\s*(60|120|240)\b/);
  });
});
