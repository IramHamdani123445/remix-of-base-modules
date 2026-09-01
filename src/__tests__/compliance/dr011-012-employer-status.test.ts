import { describe, expect, it } from "vitest";
import {
  CE_EMPLOYER_STATUSES,
  EMPLOYER_STATUS_CHANGE_CAPABILITY,
  evaluateContributionGap,
  evaluateImproperCessation,
  preservesHistoryOnStatusChange,
  validateStatusChange,
  type CeCessationConfig,
  type CeContributionGapConfig,
  type CeObligationHistoryEntry,
  type CeStatusChangeRequest,
} from "../../lib/compliance/detection/employerStatusRules";

function baseReq(overrides: Partial<CeStatusChangeRequest> = {}): CeStatusChangeRequest {
  return {
    employerId: "EMP-1",
    toStatus: "INACTIVE",
    evidenceType: "INSPECTOR_VISIT",
    evidenceReference: "VISIT-2026-001",
    actorCapabilities: [EMPLOYER_STATUS_CHANGE_CAPABILITY],
    ...overrides,
  };
}

describe("validateStatusChange", () => {
  it.each(CE_EMPLOYER_STATUSES)("accepts a valid change to %s", (status) => {
    const result = validateStatusChange(baseReq({ toStatus: status }));
    expect(result.ok).toBe(true);
  });

  it("rejects an unauthorised actor with CE-EST-403", () => {
    const result = validateStatusChange(baseReq({ actorCapabilities: [] }));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("CE-EST-403");
  });

  it("rejects a status change without evidence with CE-EST-422", () => {
    const result = validateStatusChange(baseReq({ evidenceType: undefined, evidenceReference: undefined }));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("CE-EST-422");
  });

  it("rejects an unknown status with CE-EST-422", () => {
    const result = validateStatusChange(baseReq({ toStatus: "DORMANT" }));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("CE-EST-422");
  });

  it("rejects a blank evidence reference with CE-EST-422", () => {
    const result = validateStatusChange(baseReq({ evidenceReference: "   " }));
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("CE-EST-422");
  });
});

describe("preservesHistoryOnStatusChange", () => {
  it("keeps historical obligations and violations across a status change", () => {
    expect(preservesHistoryOnStatusChange({ obligations: 12, violations: 3 }, { obligations: 12, violations: 3 })).toBe(true);
  });

  it("fails when history appears to have been erased", () => {
    expect(preservesHistoryOnStatusChange({ obligations: 12, violations: 3 }, { obligations: 0, violations: 0 })).toBe(false);
  });
});

describe("evaluateContributionGap (DR-012)", () => {
  const history: CeObligationHistoryEntry[] = [
    { periodKey: "2026-01", expected: true, filingReceived: true, contributionPaid: true },
    { periodKey: "2026-02", expected: true, filingReceived: false, contributionPaid: false },
    { periodKey: "2026-03", expected: true, filingReceived: true, contributionPaid: false },
    { periodKey: "2026-04", expected: false, filingReceived: false, contributionPaid: false },
    { periodKey: "2026-05", expected: true, filingReceived: false, contributionPaid: true },
  ];
  const config: CeContributionGapConfig = { minMissedMonths: 2, daysPastDeadline: 0 };

  it("flags an actual contribution gap from obligation history", () => {
    const finding = evaluateContributionGap("EMP-1", history, config);
    expect(finding).toBeDefined();
    expect(finding?.gapPeriods).toEqual(["2026-02", "2026-03", "2026-05"]);
    expect(finding?.longestConsecutiveRun).toBe(2);
  });

  it("does not count a period that was not expected", () => {
    const finding = evaluateContributionGap("EMP-1", history, config);
    expect(finding?.gapPeriods).not.toContain("2026-04");
  });

  it("is configurable via minMissedMonths", () => {
    const strict = evaluateContributionGap("EMP-1", history, { minMissedMonths: 5, daysPastDeadline: 0 });
    expect(strict).toBeUndefined();
    const lenient = evaluateContributionGap("EMP-1", history, { minMissedMonths: 1, daysPastDeadline: 0 });
    expect(lenient).toBeDefined();
  });
});

describe("evaluateImproperCessation (DR-011)", () => {
  const config: CeCessationConfig = {
    triggerOnStatus: ["CLOSED", "CEASED"],
    requireClearanceCertificate: true,
    minOutstandingAmountXcd: 0,
  };

  it("flags an outstanding balance at cessation", () => {
    const finding = evaluateImproperCessation(
      {
        employerId: "EMP-1",
        status: "CLOSED",
        effectiveDate: "2026-06-01",
        outstandingAmount: 500,
        clearanceCertificateReference: "CERT-1",
      },
      config,
    );
    expect(finding).toBeDefined();
    expect(finding?.reasons).toContain("OUTSTANDING_BALANCE");
  });

  it("flags a missing clearance certificate at cessation", () => {
    const finding = evaluateImproperCessation(
      {
        employerId: "EMP-1",
        status: "CEASED",
        effectiveDate: "2026-06-01",
        outstandingAmount: 0,
        clearanceCertificateReference: null,
      },
      config,
    );
    expect(finding).toBeDefined();
    expect(finding?.reasons).toContain("NO_CLEARANCE_CERTIFICATE");
  });

  it("does not flag a clean cessation with clearance and nothing outstanding", () => {
    const finding = evaluateImproperCessation(
      {
        employerId: "EMP-1",
        status: "CLOSED",
        effectiveDate: "2026-06-01",
        outstandingAmount: 0,
        clearanceCertificateReference: "CERT-2",
        openObligationPeriods: [],
        openViolationCount: 0,
      },
      config,
    );
    expect(finding).toBeUndefined();
  });

  it("only evaluates statuses configured in triggerOnStatus", () => {
    const finding = evaluateImproperCessation(
      {
        employerId: "EMP-1",
        status: "INACTIVE",
        effectiveDate: "2026-06-01",
        outstandingAmount: 5000,
        clearanceCertificateReference: null,
      },
      config,
    );
    expect(finding).toBeUndefined();
  });
});
