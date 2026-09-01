import { describe, expect, it } from "vitest";
import {
  evaluateRepeatOffender,
  buildRepeatOffenderFlag,
  type CeRepeatOccurrence,
  type CeRepeatOffenderConfig,
} from "@/lib/compliance/detection/repeatOffender";

const baseConfig: CeRepeatOffenderConfig = {
  threshold: 3,
  rollingMonths: 12,
  sameTypeOnly: true,
  requireConsecutive: false,
  includeResolvedOccurrences: true,
};

function occ(overrides: Partial<CeRepeatOccurrence>): CeRepeatOccurrence {
  return {
    violationId: "V-1",
    employerId: "EMP-1",
    employerName: "Acme Ltd",
    violationTypeId: "TYPE-LATE",
    violationTypeCode: "LATE_FILING",
    occurredOn: "2026-01-01",
    resolved: false,
    ...overrides,
  };
}

describe("DR-005 repeat offender", () => {
  it("three same-type non-consecutive occurrences in the trailing 12 months trigger one flag", () => {
    const occurrences = [
      occ({ violationId: "V-1", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", occurredOn: "2026-01-10" }),
      occ({ violationId: "V-3", occurredOn: "2026-04-01" }),
    ];
    const results = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(results).toHaveLength(1);
    expect(results[0].qualifyingCount).toBe(3);
    expect(results[0].triggeringViolationIds.sort()).toEqual(["V-1", "V-2", "V-3"]);
  });

  it("three occurrences of mixed types under sameTypeOnly do not trigger a flag", () => {
    const occurrences = [
      occ({ violationId: "V-1", violationTypeCode: "LATE_FILING", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", violationTypeCode: "LATE_PAYMENT", occurredOn: "2026-01-10" }),
      occ({ violationId: "V-3", violationTypeCode: "UNDERPAYMENT", occurredOn: "2026-04-01" }),
    ];
    const results = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(results).toHaveLength(0);
  });

  it("excludes an occurrence outside the rolling window", () => {
    const occurrences = [
      occ({ violationId: "V-0", occurredOn: "2024-01-01" }), // outside window
      occ({ violationId: "V-1", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", occurredOn: "2026-01-10" }),
    ];
    const results = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(results).toHaveLength(0);
  });

  it("produces two separate flags when two violation types each reach the threshold", () => {
    const occurrences = [
      occ({ violationId: "A1", violationTypeCode: "LATE_FILING", occurredOn: "2025-11-01" }),
      occ({ violationId: "A2", violationTypeCode: "LATE_FILING", occurredOn: "2026-01-01" }),
      occ({ violationId: "A3", violationTypeCode: "LATE_FILING", occurredOn: "2026-03-01" }),
      occ({ violationId: "B1", violationTypeCode: "LATE_PAYMENT", occurredOn: "2025-12-01" }),
      occ({ violationId: "B2", violationTypeCode: "LATE_PAYMENT", occurredOn: "2026-02-01" }),
      occ({ violationId: "B3", violationTypeCode: "LATE_PAYMENT", occurredOn: "2026-04-01" }),
    ];
    const results = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(results).toHaveLength(2);
    const codes = results.map((r) => r.violationTypeCode).sort();
    expect(codes).toEqual(["LATE_FILING", "LATE_PAYMENT"]);
    const flags = results.map((r) => buildRepeatOffenderFlag(r, "DR-005"));
    expect(new Set(flags.map((f) => f.dedupe_key)).size).toBe(2);
  });

  it("excludes repeat-flag artifacts from the occurrence count", () => {
    const occurrences = [
      occ({ violationId: "V-1", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", occurredOn: "2026-01-01" }),
      occ({ violationId: "V-3", occurredOn: "2026-03-01", isRepeatFlagArtifact: true }),
      occ({ violationId: "V-4", violationTypeCode: "REPEAT_OFFENDER_ARTIFACT", occurredOn: "2026-04-01" }),
    ];
    const results = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(results).toHaveLength(0);
  });

  it("ignores resolved violations when includeResolvedOccurrences is false", () => {
    const occurrences = [
      occ({ violationId: "V-1", occurredOn: "2025-11-01", resolved: true }),
      occ({ violationId: "V-2", occurredOn: "2026-01-01", resolved: false }),
      occ({ violationId: "V-3", occurredOn: "2026-03-01", resolved: false }),
    ];
    const config: CeRepeatOffenderConfig = { ...baseConfig, includeResolvedOccurrences: false };
    const results = evaluateRepeatOffender(occurrences, config, "2026-06-01");
    expect(results).toHaveLength(0);

    const withResolved = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(withResolved).toHaveLength(1);
  });

  it("changing threshold/rollingMonths changes the outcome with no code change", () => {
    const occurrences = [
      occ({ violationId: "V-1", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", occurredOn: "2026-01-01" }),
    ];
    const withDefault = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    expect(withDefault).toHaveLength(0);

    const lowerThreshold = evaluateRepeatOffender(
      occurrences,
      { ...baseConfig, threshold: 2 },
      "2026-06-01",
    );
    expect(lowerThreshold).toHaveLength(1);

    const shorterWindow = evaluateRepeatOffender(
      occurrences,
      { ...baseConfig, threshold: 2, rollingMonths: 1 },
      "2026-06-01",
    );
    expect(shorterWindow).toHaveLength(0);
  });

  it("re-running the same evaluation twice yields identical dedupe keys", () => {
    const occurrences = [
      occ({ violationId: "V-1", occurredOn: "2025-11-01" }),
      occ({ violationId: "V-2", occurredOn: "2026-01-01" }),
      occ({ violationId: "V-3", occurredOn: "2026-03-01" }),
    ];
    const run1 = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    const run2 = evaluateRepeatOffender(occurrences, baseConfig, "2026-06-01");
    const flag1 = buildRepeatOffenderFlag(run1[0], "DR-005");
    const flag2 = buildRepeatOffenderFlag(run2[0], "DR-005");
    expect(flag1.dedupe_key).toBe(flag2.dedupe_key);
    expect(flag1.flag_number).toBe(flag2.flag_number);
  });
});
