import { describe, expect, it } from "vitest";
import {
  evaluateFundOmissions,
  isExemptionApplicable,
  findApplicableExemption,
  type CeC3PersonFundLine,
  type CeContributionExemption,
  type CeFundOmissionConfig,
} from "@/lib/compliance/detection/fundOmission";

const config: CeFundOmissionConfig = { checkFunds: ["LV", "SV", "SS"], zeroThreshold: 0 };

function line(overrides: Partial<CeC3PersonFundLine>): CeC3PersonFundLine {
  return {
    submissionId: "SUB-1",
    employerId: "EMP-A",
    personSsn: "SSN-1",
    periodKey: "2024-03",
    fundCode: "LV",
    applicable: true,
    contributionAmount: 0,
    ingestionSource: "ONLINE",
    ...overrides,
  };
}

function exemption(overrides: Partial<CeContributionExemption>): CeContributionExemption {
  return {
    personSsn: "SSN-1",
    employerId: "EMP-A",
    fundCode: "LV",
    effectiveFrom: "2024-01-01",
    status: "ACTIVE",
    ...overrides,
  };
}

describe("DR-007 fund omission", () => {
  it("flags an applicable person with zero Levy contribution", () => {
    const result = evaluateFundOmissions([line({ fundCode: "LV", contributionAmount: 0 })], [], config);
    expect(result).toHaveLength(1);
    expect(result[0].fundCode).toBe("LV");
  });

  it("flags an applicable person with zero Severance contribution", () => {
    const result = evaluateFundOmissions([line({ fundCode: "SV", contributionAmount: null })], [], config);
    expect(result).toHaveLength(1);
    expect(result[0].fundCode).toBe("SV");
  });

  it("suppresses the flag when a valid employer-specific ACTIVE exemption applies", () => {
    const result = evaluateFundOmissions(
      [line({ fundCode: "LV", contributionAmount: 0 })],
      [exemption({})],
      config,
    );
    expect(result).toHaveLength(0);
  });

  it("does not let an exemption at Employer A suppress the same person's flag at Employer B", () => {
    const result = evaluateFundOmissions(
      [line({ employerId: "EMP-B", fundCode: "LV", contributionAmount: 0 })],
      [exemption({ employerId: "EMP-A" })],
      config,
    );
    expect(result).toHaveLength(1);
    expect(result[0].employerId).toBe("EMP-B");
  });

  it("flags when the exemption's effective period does not cover the period", () => {
    const result = evaluateFundOmissions(
      [line({ periodKey: "2025-06", fundCode: "LV", contributionAmount: 0 })],
      [exemption({ effectiveFrom: "2024-01-01", effectiveTo: "2024-12-31" })],
      config,
    );
    expect(result).toHaveLength(1);
  });

  it("flags when the exemption is REVOKED", () => {
    const result = evaluateFundOmissions(
      [line({ fundCode: "LV", contributionAmount: 0 })],
      [exemption({ status: "REVOKED" })],
      config,
    );
    expect(result).toHaveLength(1);
  });

  it("flags when the exemption is PENDING_VERIFICATION", () => {
    const result = evaluateFundOmissions(
      [line({ fundCode: "LV", contributionAmount: 0 })],
      [exemption({ status: "PENDING_VERIFICATION" })],
      config,
    );
    expect(result).toHaveLength(1);
    expect(isExemptionApplicable(exemption({ status: "PENDING_VERIFICATION" }), {
      personSsn: "SSN-1",
      employerId: "EMP-A",
      fundCode: "LV",
      periodKey: "2024-03",
    })).toBe(false);
  });

  it("does not flag a non-applicable line", () => {
    const result = evaluateFundOmissions([line({ applicable: false, contributionAmount: 0 })], [], config);
    expect(result).toHaveLength(0);
    expect(findApplicableExemption([], { personSsn: "x", employerId: "y", fundCode: "SS", periodKey: "2024-01" })).toBeUndefined();
  });

  it("detects omissions from both PHYSICAL and LEGACY_IMPORT ingestion", () => {
    const result = evaluateFundOmissions(
      [
        line({ personSsn: "SSN-2", ingestionSource: "PHYSICAL", contributionAmount: 0 }),
        line({ personSsn: "SSN-3", ingestionSource: "LEGACY_IMPORT", contributionAmount: undefined }),
      ],
      [],
      config,
    );
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.ingestionSource).sort()).toEqual(["LEGACY_IMPORT", "PHYSICAL"]);
  });

  it("is deterministic across two runs", () => {
    const lines = [
      line({ personSsn: "SSN-9", fundCode: "SS", contributionAmount: 0 }),
      line({ personSsn: "SSN-2", fundCode: "LV", contributionAmount: null }),
    ];
    const r1 = evaluateFundOmissions(lines, [], config);
    const r2 = evaluateFundOmissions(lines, [], config);
    expect(r1).toEqual(r2);
  });
});
