import { describe, expect, it } from "vitest";
import {
  buildHeadcountFlag,
  evaluateHeadcountDiscrepancy,
  evaluateHistoricalHeadcountAnomaly,
  type CeHeadcountObservation,
  type CeHeadcountTier,
} from "@/lib/compliance/detection/headcountAnomaly";

const tiers: CeHeadcountTier[] = [
  {
    tierCode: "SMALL",
    tierLabel: "Small employer",
    minEmployerSize: 0,
    maxEmployerSize: 10,
    allowedAbsoluteChange: 1,
    percentageThreshold: null,
    isEnabled: true,
    requiresClientConfirmation: true,
  },
  {
    tierCode: "LARGE",
    tierLabel: "Large employer",
    minEmployerSize: 11,
    maxEmployerSize: null,
    allowedAbsoluteChange: 5,
    percentageThreshold: 10,
    isEnabled: true,
    requiresClientConfirmation: true,
  },
];

describe("DR-009 headcount discrepancy tiers", () => {
  it("applies the small-employer tier's own allowance", () => {
    const finding = evaluateHeadcountDiscrepancy(
      { employerId: "E1", periodKey: "2024-01", registeredEmployees: 8, reportedEmployees: 6 },
      tiers,
      { useSizeTiers: true },
    );
    expect(finding).toBeDefined();
    expect(finding?.tierCode).toBe("SMALL");
    expect(finding?.delta).toBe(2);
  });

  it("applies a different allowance for the large tier with the same absolute delta", () => {
    // delta of 2 is within LARGE's allowance of 5, so no finding
    const finding = evaluateHeadcountDiscrepancy(
      { employerId: "E2", periodKey: "2024-01", registeredEmployees: 50, reportedEmployees: 48 },
      tiers,
      { useSizeTiers: true },
    );
    expect(finding).toBeUndefined();
  });

  it("changing a tier threshold in the table changes the result without code changes", () => {
    const tighterTiers: CeHeadcountTier[] = tiers.map((t) =>
      t.tierCode === "LARGE" ? { ...t, allowedAbsoluteChange: 1 } : t,
    );
    const finding = evaluateHeadcountDiscrepancy(
      { employerId: "E2", periodKey: "2024-01", registeredEmployees: 50, reportedEmployees: 48 },
      tighterTiers,
      { useSizeTiers: true },
    );
    expect(finding).toBeDefined();
    expect(finding?.tierCode).toBe("LARGE");
  });

  it("surfaces requiresClientConfirmation on a review flag", () => {
    const finding = evaluateHeadcountDiscrepancy(
      { employerId: "E1", periodKey: "2024-01", registeredEmployees: 8, reportedEmployees: 6 },
      tiers,
      { useSizeTiers: true },
    );
    expect(finding).toBeDefined();
    const flag = buildHeadcountFlag(finding!, "DR-009");
    expect(flag.status).toBe("OPEN");
    expect(flag.flag_type).toBe("HEADCOUNT_DISCREPANCY");
    expect(flag.evidence.requires_client_confirmation).toBe(true);
  });
});

describe("DR-009 historical headcount anomaly", () => {
  const history: CeHeadcountObservation[] = [
    { employerId: "E3", periodKey: "2024-01", reportedEmployees: 100 },
    { employerId: "E3", periodKey: "2024-02", reportedEmployees: 102 },
    { employerId: "E3", periodKey: "2024-03", reportedEmployees: 98 },
  ];

  it("flags a substantial increase anomaly", () => {
    const current: CeHeadcountObservation = { employerId: "E3", periodKey: "2024-04", reportedEmployees: 160 };
    const finding = evaluateHistoricalHeadcountAnomaly(history, current, {
      historicalBaselinePeriods: 3,
      minEmployerSizeForPercentage: 10,
      historicalChangePercent: 20,
      historicalChangeAbsolute: 10,
    });
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("INCREASE");
  });

  it("flags a substantial decrease anomaly", () => {
    const current: CeHeadcountObservation = { employerId: "E3", periodKey: "2024-04", reportedEmployees: 40 };
    const finding = evaluateHistoricalHeadcountAnomaly(history, current, {
      historicalBaselinePeriods: 3,
      minEmployerSizeForPercentage: 10,
      historicalChangePercent: 20,
      historicalChangeAbsolute: 10,
    });
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("DECREASE");
  });

  it("suppresses percentage logic below minEmployerSizeForPercentage, using absolute only", () => {
    const smallHistory: CeHeadcountObservation[] = [
      { employerId: "E4", periodKey: "2024-01", reportedEmployees: 3 },
      { employerId: "E4", periodKey: "2024-02", reportedEmployees: 3 },
    ];
    // baseline = 3, minEmployerSizeForPercentage = 10 -> percentage logic disabled
    // current = 5 -> delta 2, well within historicalChangeAbsolute of 10, so no flag
    // even though percent change (66%) would blow past historicalChangePercent if applied
    const current: CeHeadcountObservation = { employerId: "E4", periodKey: "2024-03", reportedEmployees: 5 };
    const finding = evaluateHistoricalHeadcountAnomaly(smallHistory, current, {
      historicalBaselinePeriods: 2,
      minEmployerSizeForPercentage: 10,
      historicalChangePercent: 20,
      historicalChangeAbsolute: 10,
    });
    expect(finding).toBeUndefined();
  });

  it("is deterministic across two runs with identical dedupe keys", () => {
    const current: CeHeadcountObservation = { employerId: "E3", periodKey: "2024-04", reportedEmployees: 160 };
    const config = {
      historicalBaselinePeriods: 3,
      minEmployerSizeForPercentage: 10,
      historicalChangePercent: 20,
      historicalChangeAbsolute: 10,
    };
    const findingA = evaluateHistoricalHeadcountAnomaly(history, current, config);
    const findingB = evaluateHistoricalHeadcountAnomaly(history, current, config);
    const flagA = buildHeadcountFlag(findingA!, "DR-009");
    const flagB = buildHeadcountFlag(findingB!, "DR-009");
    expect(flagA.dedupe_key).toBe(flagB.dedupe_key);
    expect(flagA.flag_number).toBe(flagB.flag_number);
  });
});
