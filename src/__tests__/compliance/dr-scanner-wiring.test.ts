/**
 * Checkpoint B2 — proof that the detection rules DR-005 … DR-013 are actually
 * WIRED into the single existing scanner (`ce-violation-scan`), that each one
 * delegates to its pure logic module rather than re-implementing semantics
 * inline, and that the review-flag path is deduplicated.
 *
 * These assertions are deliberately source-level: the scanner is a Deno edge
 * function that cannot be imported into the vitest (browser/node) environment,
 * so the contract is enforced by inspecting the shipped source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const SCANNER = resolve(process.cwd(), "supabase/functions/ce-violation-scan/index.ts");
const SRC_DIR = resolve(process.cwd(), "src/lib/compliance/detection");
const EDGE_DIR = resolve(process.cwd(), "supabase/functions/_shared/compliance/detection");

const MODULES = [
  "reviewFlag.ts",
  "repeatOffender.ts",
  "arrangementBreach.ts",
  "fundOmission.ts",
  "unregisteredEmployer.ts",
  "headcountAnomaly.ts",
  "wageAnomaly.ts",
  "employerStatusRules.ts",
  "selfEmployedCompliance.ts",
];

/** trigger_event → a call that only the corresponding pure module provides. */
const BRANCH_CONTRACT: Array<{ rule: string; triggerEvent: string; call: string }> = [
  { rule: "DR-005", triggerEvent: "repeat_violation_check", call: "evaluateRepeatOffender" },
  { rule: "DR-006", triggerEvent: "installment_overdue", call: "evaluateArrangementInstallments" },
  { rule: "DR-007", triggerEvent: "levy_omission_check", call: "evaluateFundOmissions" },
  { rule: "DR-007", triggerEvent: "severance_omission_check", call: "evaluateFundOmissions" },
  { rule: "DR-008", triggerEvent: "registration_not_found", call: "evaluateLead" },
  { rule: "DR-009", triggerEvent: "employee_underreporting", call: "evaluateHeadcountDiscrepancy" },
  { rule: "DR-010", triggerEvent: "wage_underreporting", call: "evaluateSectorBenchmark" },
  { rule: "DR-011", triggerEvent: "employer_cessation", call: "evaluateImproperCessation" },
  { rule: "DR-012", triggerEvent: "contribution_gap_detected", call: "evaluateContributionGap" },
  { rule: "DR-013", triggerEvent: "self_employed_non_compliance", call: "evaluateSelfEmployedPortfolio" },
];

const scanner = readFileSync(SCANNER, "utf8");

describe("Checkpoint B2 scanner wiring", () => {
  it.each(BRANCH_CONTRACT)(
    "$rule ($triggerEvent) is handled by the scanner",
    ({ triggerEvent }) => {
      expect(scanner).toContain(`"${triggerEvent}"`);
    },
  );

  it.each(BRANCH_CONTRACT)("$rule delegates to its pure module ($call)", ({ call }) => {
    expect(scanner).toContain(`${call}(`);
    // The helper must be imported, not defined locally in the scanner.
    expect(scanner).not.toMatch(new RegExp(`function\\s+${call}\\s*\\(`));
  });

  it("leaves no empty stub branch for any B2 rule", () => {
    for (const { triggerEvent } of BRANCH_CONTRACT) {
      const stub = new RegExp(`case "${triggerEvent}":\\s*\\{\\s*break;`);
      expect(scanner, `${triggerEvent} is still an empty stub`).not.toMatch(stub);
    }
  });

  it("persists review flags idempotently on the deterministic dedupe key", () => {
    expect(scanner).toContain("ce_compliance_review_flags");
    expect(scanner).toContain('onConflict: "dedupe_key"');
    expect(scanner).toContain("ignoreDuplicates: true");
    expect(scanner).toContain("review_flags_created");
  });

  it("retires the DR-007 generic-arrears semantics", () => {
    expect(scanner).not.toContain("min_outstanding_amount_xcd\n");
    expect(scanner).not.toMatch(/total_outstanding\s*>\s*minOutstanding/);
    expect(scanner).not.toMatch(/total_outstanding > 500/);
  });

  it("never auto-escalates self-employed cases to Legal", () => {
    expect(scanner).not.toMatch(/auto_legal_escalation\s*:\s*true/);
  });

  it.each(MODULES)("edge mirror of %s exists and matches the app copy", (file) => {
    const src = resolve(SRC_DIR, file);
    const edge = resolve(EDGE_DIR, file);
    expect(existsSync(edge), `${file} is not mirrored into the edge runtime`).toBe(true);
    const normalise = (v: string) => v.replace(/from "@\/[^"]+"/g, 'from "<alias>"').replace(/from "\.\/[^"]+"/g, 'from "<alias>"');
    expect(normalise(readFileSync(edge, "utf8"))).toBe(normalise(readFileSync(src, "utf8")));
  });
});
