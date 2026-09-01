import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CALCULATION_PARAM_SPEC,
  DETECTION_PARAM_SPEC,
  resolveRuleParameters,
  validateRuleParameterDraft,
} from "@/lib/compliance/detectionRuleParameterSpec";

const SRC = resolve(process.cwd(), "src/lib/compliance/detectionRuleParameterSpec.ts");
const EDGE = resolve(process.cwd(), "supabase/functions/_shared/compliance/detectionRuleParameterSpec.ts");
const SCANNER = resolve(process.cwd(), "supabase/functions/ce-violation-scan/index.ts");

describe("compliance rule parameter contract", () => {
  it("keeps the edge-runtime mirror byte-identical to the app copy", () => {
    expect(readFileSync(EDGE, "utf8")).toBe(readFileSync(SRC, "utf8"));
  });

  it("resolves rule parameters, aliases and policy-owned values", () => {
    const specs = DETECTION_PARAM_SPEC.c3_deadline_passed;
    const r = resolveRuleParameters(specs, { grace_period_days: 14 }, { c3_submission_deadline_day: 28 });
    expect(r.errors).toEqual([]);
    expect(r.values.grace_period_days).toBe(14);
    expect(r.values.submission_due_day).toBe(28);
    expect(r.sources.submission_due_day).toBe("policy:c3_submission_deadline_day");
  });

  it("accepts legacy alias keys for already-configured rules", () => {
    const r = resolveRuleParameters(DETECTION_PARAM_SPEC.repeat_violation_check, {
      repeat_threshold: 3,
      rolling_months: 12,
      same_type_only: true,
      require_consecutive: false,
      include_resolved_occurrences: true,
    });
    expect(r.errors).toEqual([]);
    expect(r.values.violation_count_threshold).toBe(3);
    expect(r.sources.violation_count_threshold).toBe("alias:repeat_threshold");
  });

  it("retires the DR-007 generic-arrears threshold in favour of fund scoping", () => {
    const keys = DETECTION_PARAM_SPEC.levy_omission_check.map((f) => f.key);
    expect(keys).not.toContain("min_outstanding_amount_xcd");
    expect(keys).toContain("check_funds");
  });

  it("reports a configuration error instead of substituting a business default", () => {
    const r = resolveRuleParameters(DETECTION_PARAM_SPEC.levy_omission_check, {}, null);
    expect(r.values.check_funds).toBeUndefined();
    expect(r.errors.join(" ")).toContain("check_funds");
  });

  it("rejects out-of-range and non-integer values", () => {
    const r = resolveRuleParameters(DETECTION_PARAM_SPEC.c3_deadline_passed, {
      grace_period_days: 400,
      submission_due_day: 12.5,
    });
    expect(r.errors).toHaveLength(2);
  });

  it("flags required fields in the admin draft validator", () => {
    const errs = validateRuleParameterDraft(DETECTION_PARAM_SPEC.levy_omission_check, {}, null);
    expect(errs.check_funds).toBeTruthy();
  });


  it("DR-004 no longer exposes any shortfall threshold to configure", () => {
    const keys = DETECTION_PARAM_SPEC.payment_partial.map((f) => f.key);
    expect(keys).not.toContain("min_shortfall_amount_xcd");
    expect(keys).not.toContain("min_shortfall_percent");
  });


  it("treats policy-owned fields as satisfied when the policy supplies them", () => {
    const errs = validateRuleParameterDraft(
      DETECTION_PARAM_SPEC.payment_not_received,
      { grace_period_days: 0 },
      { payment_due_date_day: 28 },
    );
    expect(errs.payment_due_day).toBeUndefined();
  });

  it("defines the CR-003 estimation basis as configuration", () => {
    const keys = CALCULATION_PARAM_SPEC["CR-003"].map((s) => s.key);
    // Checkpoint C widened the contract: history depth, multiplier and the
    // exclusion rules are all configuration, never code.
    expect(keys).toEqual([
      "history_period_count",
      "estimate_multiplier",
      "minimum_history_periods",
      "exclude_zero_periods",
      "exclude_amended_periods",
      "exclude_statuses",
      "outlier_deviation_multiple",
    ]);
  });


  it("leaves no business-policy fallback literals in the scanner", () => {
    const src = readFileSync(SCANNER, "utf8");
    // Old hard-coded fallbacks that must no longer exist.
    expect(src).not.toMatch(/rule\.parameters\?\.[a-z_]+ \?\? \d/);
    expect(src).not.toMatch(/total_outstanding > 500/);
    expect(src).not.toMatch(/avg \* 1\.5/);
    expect(src).not.toMatch(/\.slice\(0, 3\)/);
    expect(src).not.toMatch(/total_outstanding > minOutstanding/);
  });
});
