import { describe, expect, it } from "vitest";
import {
  buildWageFlag,
  evaluateHistoricalWageVariance,
  evaluateSectorBenchmark,
  isBenchmarkStale,
  resolveEffectiveBenchmark,
  type CeSectorBenchmark,
  type CeWageObservation,
} from "@/lib/compliance/detection/wageAnomaly";

const config = {
  enableSectorBenchmark: true,
  enableHistoricalVariance: true,
  benchmarkVariancePercent: 10,
  historicalVariancePercent: 50,
  lookbackPeriods: 3,
  benchmarkRecalcMonths: 1,
};

function makeBenchmark(overrides: Partial<CeSectorBenchmark> = {}): CeSectorBenchmark {
  return {
    id: "B1",
    sectorCode: "RETAIL",
    calculatedMinimum: 200,
    calculatedAverage: 300,
    sampleCount: 50,
    effectiveFrom: "2024-01",
    effectiveTo: null,
    recalculatedAt: "2024-01-01T00:00:00Z",
    overrideMinimum: null,
    overrideAverage: null,
    overrideReason: null,
    overriddenBy: null,
    overriddenAt: null,
    isEnabled: true,
    ...overrides,
  };
}

describe("DR-010 sector benchmark", () => {
  it("flags a wage below the sector threshold as a review flag, not a violation", () => {
    const benchmarks = [makeBenchmark()];
    const observation: CeWageObservation = {
      employerId: "E1",
      sectorCode: "RETAIL",
      periodKey: "2024-02",
      averageWeeklyWage: 150,
    };
    const finding = evaluateSectorBenchmark(observation, benchmarks, config);
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("BELOW_BENCHMARK");
    const flag = buildWageFlag(finding!, "DR-010");
    expect(flag.flag_type).toBe("WAGE_BELOW_BENCHMARK");
    expect(flag.status).toBe("OPEN");
  });

  it("keeps a legitimately low wage as a reviewable flag, not an automatic violation", () => {
    const benchmarks = [makeBenchmark()];
    const observation: CeWageObservation = {
      employerId: "E2",
      sectorCode: "RETAIL",
      periodKey: "2024-02",
      averageWeeklyWage: 170, // below min but within acceptable range still triggers review, not violation
    };
    const finding = evaluateSectorBenchmark(observation, benchmarks, config);
    expect(finding).toBeDefined();
    const flag = buildWageFlag(finding!, "DR-010");
    expect(flag.status).toBe("OPEN");
    expect(flag).not.toHaveProperty("violation_id");
  });

  it("an authorised override changes the detection result and records source OVERRIDE", () => {
    const overriddenBenchmarks = [
      makeBenchmark({
        overrideMinimum: 100,
        overrideReason: "Seasonal sector adjustment",
        overriddenBy: "admin-1",
        overriddenAt: "2024-02-01T00:00:00Z",
      }),
    ];
    const observation: CeWageObservation = {
      employerId: "E3",
      sectorCode: "RETAIL",
      periodKey: "2024-02",
      averageWeeklyWage: 150, // was flagged against min=200, now not flagged against override min=100
    };
    const finding = evaluateSectorBenchmark(observation, overriddenBenchmarks, config);
    expect(finding).toBeUndefined();

    const effective = resolveEffectiveBenchmark(overriddenBenchmarks, "RETAIL", "2024-02");
    expect(effective?.source).toBe("OVERRIDE");
    expect(effective?.minimum).toBe(100);
  });
});

describe("DR-010 historical wage variance", () => {
  const history: CeWageObservation[] = [
    { employerId: "E4", periodKey: "2024-01", averageWeeklyWage: 300 },
    { employerId: "E4", periodKey: "2024-02", averageWeeklyWage: 310 },
    { employerId: "E4", periodKey: "2024-03", averageWeeklyWage: 290 },
  ];

  it("flags sudden wage inflation (e.g. an extra zero)", () => {
    const current: CeWageObservation = { employerId: "E4", periodKey: "2024-04", averageWeeklyWage: 3000 };
    const finding = evaluateHistoricalWageVariance(history, current, config);
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("SUDDEN_INFLATION");
  });

  it("flags sudden wage deflation", () => {
    const current: CeWageObservation = { employerId: "E4", periodKey: "2024-04", averageWeeklyWage: 30 };
    const finding = evaluateHistoricalWageVariance(history, current, config);
    expect(finding).toBeDefined();
    expect(finding?.kind).toBe("SUDDEN_DEFLATION");
  });
});

describe("DR-010 monthly benchmark refresh", () => {
  it("isBenchmarkStale is true for a benchmark older than the cadence and false after refresh", () => {
    const stale = makeBenchmark({ recalculatedAt: "2024-01-01T00:00:00Z" });
    expect(isBenchmarkStale(stale, 1, "2024-03-01")).toBe(true);

    const refreshed = makeBenchmark({ recalculatedAt: "2024-02-15T00:00:00Z" });
    expect(isBenchmarkStale(refreshed, 1, "2024-03-01")).toBe(false);
  });
});

describe("DR-010 determinism", () => {
  it("produces identical dedupe keys across two runs", () => {
    const benchmarks = [makeBenchmark()];
    const observation: CeWageObservation = {
      employerId: "E5",
      sectorCode: "RETAIL",
      periodKey: "2024-02",
      averageWeeklyWage: 150,
    };
    const findingA = evaluateSectorBenchmark(observation, benchmarks, config);
    const findingB = evaluateSectorBenchmark(observation, benchmarks, config);
    const flagA = buildWageFlag(findingA!, "DR-010");
    const flagB = buildWageFlag(findingB!, "DR-010");
    expect(flagA.dedupe_key).toBe(flagB.dedupe_key);
    expect(flagA.flag_number).toBe(flagB.flag_number);
  });
});
