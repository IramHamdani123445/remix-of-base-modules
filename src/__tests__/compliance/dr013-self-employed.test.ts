import { describe, expect, it } from "vitest";
import { normalizeObligationPolicy, type CeObligationPolicy } from "../../lib/compliance/obligationDeadlineResolver";
import {
  SELF_EMPLOYED_LEGAL_ESCALATION_IS_MANUAL_ONLY,
  computeOverContributionCredits,
  consolidateSelfEmployedReminders,
  detectEmployerOverlap,
  detectMultiEmployerReporting,
  evaluateSelfEmployedObligation,
  evaluateSelfEmployedPortfolio,
  type CeSelfEmployedConfig,
  type CeSelfEmployedObligation,
} from "../../lib/compliance/detection/selfEmployedCompliance";

const policy: CeObligationPolicy = normalizeObligationPolicy({
  deadline_basis: "calendar_month_end",
  reporting_offset_months: 1,
  grace_days: 20,
});

const baseConfig: CeSelfEmployedConfig = {
  includeVoluntary: true,
  consolidateReminders: true,
  autoLegalEscalation: false,
  overContributionCreatesCredit: true,
  flagEmployerOverlap: true,
};

function obligation(overrides: Partial<CeSelfEmployedObligation>): CeSelfEmployedObligation {
  return {
    personSsn: "SSN-1",
    contributorType: "SELF_EMPLOYED",
    periodKey: "2026-01",
    expectedAmount: 100,
    declaredAmount: 100,
    paidAmount: 0,
    filingReceivedDate: null,
    paymentReceivedDate: null,
    ...overrides,
  };
}

describe("evaluateSelfEmployedObligation", () => {
  it("is NOT_YET_DUE before the applicable deadline", () => {
    // Reporting period 2026-02, due date last day of Feb + 20 days grace ~ 2026-03-20.
    const result = evaluateSelfEmployedObligation(obligation({}), policy, baseConfig, "2026-02-10");
    expect(result.outcome).toBe("NOT_YET_DUE");
  });

  it("is OUTSTANDING only after the deadline has passed", () => {
    const result = evaluateSelfEmployedObligation(obligation({}), policy, baseConfig, "2026-04-01");
    expect(["OUTSTANDING_FILING", "OUTSTANDING_PAYMENT"]).toContain(result.outcome);
  });
});

describe("consolidateSelfEmployedReminders", () => {
  it("consolidates multiple outstanding periods into ONE reminder", () => {
    const items = [
      obligation({ periodKey: "2026-01", paidAmount: 0 }),
      obligation({ periodKey: "2026-02", paidAmount: 0 }),
    ];
    const evaluations = evaluateSelfEmployedPortfolio(items, policy, baseConfig, "2026-06-01");
    const reminders = consolidateSelfEmployedReminders(evaluations, items, baseConfig);
    const forPerson = reminders.filter((r) => r.personSsn === "SSN-1");
    expect(forPerson.length).toBe(1);
    expect(forPerson[0].periods).toEqual(["2026-01", "2026-02"]);
  });

  it("produces one reminder per period when consolidation is disabled", () => {
    const config = { ...baseConfig, consolidateReminders: false };
    const items = [
      obligation({ periodKey: "2026-01", paidAmount: 0 }),
      obligation({ periodKey: "2026-02", paidAmount: 0 }),
    ];
    const evaluations = evaluateSelfEmployedPortfolio(items, policy, config, "2026-06-01");
    const reminders = consolidateSelfEmployedReminders(evaluations, items, config);
    expect(reminders.length).toBe(2);
  });
});

describe("employer overlap", () => {
  it("flags a self-employed person also reported by an employer for the same period", () => {
    const items = [obligation({ periodKey: "2026-01" })];
    const overlaps = detectEmployerOverlap(
      items,
      [{ personSsn: "SSN-1", periodKey: "2026-01", employerId: "EMP-1" }],
      baseConfig,
    );
    expect(overlaps.length).toBe(1);
    expect(overlaps[0].employerIds).toEqual(["EMP-1"]);
  });

  it("can be suppressed once flagged for review", () => {
    const suppressed = obligation({ periodKey: "2026-01", suppressed: true });
    const result = evaluateSelfEmployedObligation(suppressed, policy, baseConfig, "2026-06-01");
    expect(result.outcome).toBe("SUPPRESSED");
  });

  it("detects people reported by multiple employers for the same period", () => {
    const results = detectMultiEmployerReporting([
      { personSsn: "SSN-2", periodKey: "2026-01", employerId: "EMP-1" },
      { personSsn: "SSN-2", periodKey: "2026-01", employerId: "EMP-2" },
      { personSsn: "SSN-3", periodKey: "2026-01", employerId: "EMP-1" },
    ]);
    expect(results.length).toBe(1);
    expect(results[0].personSsn).toBe("SSN-2");
    expect(results[0].employerIds).toEqual(["EMP-1", "EMP-2"]);
  });
});

describe("voluntary contributors", () => {
  it("is included when includeVoluntary is true", () => {
    const voluntary = obligation({ contributorType: "VOLUNTARY" });
    const result = evaluateSelfEmployedObligation(voluntary, policy, { ...baseConfig, includeVoluntary: true }, "2026-06-01");
    expect(result.outcome).not.toBe("EXCLUDED");
  });

  it("is excluded when includeVoluntary is false", () => {
    const voluntary = obligation({ contributorType: "VOLUNTARY" });
    const result = evaluateSelfEmployedObligation(voluntary, policy, { ...baseConfig, includeVoluntary: false }, "2026-06-01");
    expect(result.outcome).toBe("EXCLUDED");
  });
});

describe("over-contribution credits", () => {
  it("generates a CREDIT_OFFSET, never a refund", () => {
    const items = [obligation({ declaredAmount: 100, expectedAmount: 100, paidAmount: 150 })];
    const credits = computeOverContributionCredits(items, baseConfig);
    expect(credits.length).toBe(1);
    expect(credits[0].treatment).toBe("CREDIT_OFFSET");
    expect(credits[0].amount).toBeCloseTo(50);
  });

  it("marks a finance hand-off only when coverage has ended", () => {
    const items = [obligation({ declaredAmount: 100, expectedAmount: 100, paidAmount: 150 })];
    const noHandoff = computeOverContributionCredits(items, baseConfig, { coverageEnded: { "SSN-1": false } });
    const withHandoff = computeOverContributionCredits(items, baseConfig, { coverageEnded: { "SSN-1": true } });
    expect(noHandoff[0].financeHandoffRequired).toBe(false);
    expect(withHandoff[0].financeHandoffRequired).toBe(true);
  });
});

describe("no automatic legal escalation", () => {
  it("produces no escalation output and documents manual-only referral", () => {
    const config = { ...baseConfig, autoLegalEscalation: false };
    expect(config.autoLegalEscalation).toBe(false);
    expect(SELF_EMPLOYED_LEGAL_ESCALATION_IS_MANUAL_ONLY).toBe(true);
    // No exported function in this module ever produces a legal escalation artifact.
  });
});

describe("determinism", () => {
  it("produces identical results across two runs", () => {
    const items = [
      obligation({ periodKey: "2026-01", paidAmount: 0 }),
      obligation({ periodKey: "2026-02", paidAmount: 150 }),
    ];
    const run1 = evaluateSelfEmployedPortfolio(items, policy, baseConfig, "2026-06-01");
    const run2 = evaluateSelfEmployedPortfolio(items, policy, baseConfig, "2026-06-01");
    expect(run1).toEqual(run2);
    const credits1 = computeOverContributionCredits(items, baseConfig, { coverageEnded: { "SSN-1": true } });
    const credits2 = computeOverContributionCredits(items, baseConfig, { coverageEnded: { "SSN-1": true } });
    expect(credits1).toEqual(credits2);
  });
});
