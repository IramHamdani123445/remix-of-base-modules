import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CeObligationPolicyError,
  type CeReminderRule,
  evaluateFilingObligation,
  evaluatePaymentObligation,
  normalizeObligationPolicy,
  remindersDueOn,
  resolveObligationTimeline,
  resolveReminderDate,
  resolveReminderSchedule,
} from "@/lib/compliance/obligationDeadlineResolver";
import {
  buildObligationRows,
  describeOutstandingPeriods,
  enumerateWagePeriods,
  planReminderNotices,
} from "@/lib/compliance/obligationLifecycle";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const monthEndPolicy = normalizeObligationPolicy({
  deadline_basis: "calendar_month_end",
  reporting_offset_months: 1,
  deadline_fixed_day: null,
});

const fixedDayPolicy = normalizeObligationPolicy({
  deadline_basis: "fixed_day_of_month",
  reporting_offset_months: 1,
  deadline_fixed_day: 28,
});

describe("obligation deadline resolver — month-end truth", () => {
  it("resolves the real calendar month end of the month following the wage month", () => {
    // 30-day, 31-day and February variants must all come from the calendar.
    expect(resolveObligationTimeline("2026-03", monthEndPolicy).due_date).toBe("2026-04-30");
    expect(resolveObligationTimeline("2026-04", monthEndPolicy).due_date).toBe("2026-05-31");
    expect(resolveObligationTimeline("2026-01", monthEndPolicy).due_date).toBe("2026-02-28");
  });

  it("honours February in a leap year", () => {
    expect(resolveObligationTimeline("2028-01", monthEndPolicy).due_date).toBe("2028-02-29");
  });

  it("crosses the year boundary correctly", () => {
    const t = resolveObligationTimeline("2026-12", monthEndPolicy);
    expect(t.reporting_period).toBe("2027-01");
    expect(t.due_date).toBe("2027-01-31");
  });

  it("supports the possible future fixed-day basis without code change", () => {
    expect(resolveObligationTimeline("2026-03", fixedDayPolicy).due_date).toBe("2026-04-28");
    // A fixed day beyond the real month length clamps to the calendar.
    const day31 = normalizeObligationPolicy({
      deadline_basis: "fixed_day_of_month",
      reporting_offset_months: 1,
      deadline_fixed_day: 31,
    });
    expect(resolveObligationTimeline("2026-01", day31).due_date).toBe("2026-02-28");
  });

  it("derives grace end and violation-effective date from the due date", () => {
    const graced = normalizeObligationPolicy(
      { deadline_basis: "calendar_month_end", reporting_offset_months: 1 },
      { grace_days: 5 },
    );
    const t = resolveObligationTimeline("2026-01", graced);
    expect(t.due_date).toBe("2026-02-28");
    expect(t.grace_end_date).toBe("2026-03-05");
    expect(t.violation_effective_date).toBe("2026-03-06");
  });

  it("fails visibly when the policy has no owner or an unsupported basis", () => {
    expect(() => normalizeObligationPolicy(null)).toThrow(CeObligationPolicyError);
    expect(() =>
      normalizeObligationPolicy({ deadline_basis: "28th_always", reporting_offset_months: 1 }),
    ).toThrow(CeObligationPolicyError);
    expect(() =>
      normalizeObligationPolicy({ deadline_basis: "fixed_day_of_month", reporting_offset_months: 1 }),
    ).toThrow(CeObligationPolicyError);
  });
});

describe("DR-001 / DR-002 filing semantics", () => {
  const timeline = resolveObligationTimeline("2026-01", monthEndPolicy); // due 2026-02-28

  it("treats a filing on the due date as on time", () => {
    expect(
      evaluateFilingObligation({ timeline, filingReceivedDate: "2026-02-28", asOf: "2026-03-10" }),
    ).toBe("FILED_ON_TIME");
  });

  it("raises Late Filing only for an ACTUAL filing after the deadline", () => {
    expect(
      evaluateFilingObligation({ timeline, filingReceivedDate: "2026-03-01", asOf: "2026-03-10" }),
    ).toBe("FILED_LATE");
  });

  it("never calls a missing filing 'late' — absence is Unreported", () => {
    expect(evaluateFilingObligation({ timeline, filingReceivedDate: null, asOf: "2026-03-10" })).toBe(
      "UNREPORTED",
    );
  });

  it("keeps a not-yet-due period pending rather than in breach", () => {
    expect(evaluateFilingObligation({ timeline, filingReceivedDate: null, asOf: "2026-02-10" })).toBe(
      "PENDING",
    );
  });

  it("treats a valid NIL return as a submitted report, not unreported", () => {
    const rows = buildObligationRows({
      employerId: "E1",
      employerName: "Nil Filer Ltd",
      wagePeriod: "2026-01",
      facts: { filing_received_date: "2026-02-20", filing_is_nil: true, declared_amount: 0, paid_amount: 0 },
      filingPolicy: monthEndPolicy,
      paymentPolicy: monthEndPolicy,
      reminderRules: [],
      asOf: "2026-03-15",
    });
    const filing = rows.find((r) => r.obligation_type === "C3_FILING")!;
    expect(filing.filing_status).toBe("FILED_ON_TIME");
    expect(filing.is_outstanding).toBe(false);
    const payment = rows.find((r) => r.obligation_type === "CONTRIBUTION_PAYMENT")!;
    expect(payment.is_outstanding).toBe(false);
  });
});

describe("DR-003 payment semantics", () => {
  const timeline = resolveObligationTimeline("2026-01", monthEndPolicy);

  it("distinguishes unpaid, partial and full against the same deadline", () => {
    const base = { timeline, declaredAmount: 1000, asOf: "2026-03-10" };
    expect(evaluatePaymentObligation({ ...base, paidAmount: 0 })).toBe("NOT_PAID");
    expect(evaluatePaymentObligation({ ...base, paidAmount: 400 })).toBe("PARTIALLY_PAID");
    expect(evaluatePaymentObligation({ ...base, paidAmount: 1000 })).toBe("PAID_IN_FULL");
  });

  it("does not flag before the deadline has passed", () => {
    expect(
      evaluatePaymentObligation({ timeline, declaredAmount: 1000, paidAmount: 0, asOf: "2026-02-01" }),
    ).toBe("PENDING");
  });
});

describe("reminder timing is configuration, not code", () => {
  const day3: CeReminderRule = {
    rule_code: "REM-C3-D03",
    is_enabled: true,
    obligation_type: "ALL",
    offset_type: "reporting_day_of_month",
    offset_value: 3,
    audience: "EMPLOYER",
    template_code: "TPL-REM-C3-EARLY",
    channels: ["EMAIL"],
    consolidate_periods: true,
    sequence: 1,
  };
  const day20: CeReminderRule = { ...day3, rule_code: "REM-C3-D20", offset_value: 20, sequence: 2 };

  it("resolves the configured day-of-month reminders inside the reporting period", () => {
    const t = resolveObligationTimeline("2026-01", monthEndPolicy); // reporting 2026-02
    expect(resolveReminderDate(t, day3)).toBe("2026-02-03");
    expect(resolveReminderDate(t, day20)).toBe("2026-02-20");
  });

  it("changing the configured day changes the schedule with no code change", () => {
    const t = resolveObligationTimeline("2026-01", monthEndPolicy);
    expect(resolveReminderDate(t, { ...day3, offset_value: 11 })).toBe("2026-02-11");
  });

  it("skips disabled rules and returns an ordered schedule", () => {
    const t = resolveObligationTimeline("2026-01", monthEndPolicy);
    const schedule = resolveReminderSchedule(t, [day20, day3, { ...day3, rule_code: "OFF", is_enabled: false }]);
    expect(schedule.map((s) => s.rule_code)).toEqual(["REM-C3-D03", "REM-C3-D20"]);
  });

  it("fires only on the exact configured cycle date", () => {
    const t = resolveObligationTimeline("2026-01", monthEndPolicy);
    expect(remindersDueOn(t, [day3, day20], "2026-02-20").map((r) => r.rule_code)).toEqual(["REM-C3-D20"]);
    expect(remindersDueOn(t, [day3, day20], "2026-02-19")).toHaveLength(0);
  });

  it("issues ONE consolidated notice listing every outstanding period", () => {
    const rules = [day3, day20];
    const obligations = ["2025-10", "2025-11", "2025-12"].flatMap((ym) =>
      buildObligationRows({
        employerId: "E9",
        employerName: "Arrears Ltd",
        wagePeriod: ym,
        facts: { filing_received_date: null, filing_is_nil: false, declared_amount: 0, paid_amount: 0 },
        filingPolicy: monthEndPolicy,
        paymentPolicy: monthEndPolicy,
        reminderRules: rules,
        asOf: "2026-02-20",
      }),
    );
    const plans = planReminderNotices({
      asOf: "2026-02-20",
      rules,
      obligations,
      filingPolicy: monthEndPolicy,
      paymentPolicy: monthEndPolicy,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].employer_id).toBe("E9");
    expect(plans[0].rule_code).toBe("REM-C3-D20");
    expect(plans[0].periods.map((p) => p.wage_period)).toEqual(["2025-10", "2025-11", "2025-12"]);
    expect(describeOutstandingPeriods(plans[0].periods)).toContain("2025-10");
  });
});

describe("wage period enumeration", () => {
  it("enumerates inclusive periods from compliance start to the last complete period", () => {
    expect(enumerateWagePeriods("2025-11", "2026-01", 120)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("respects the technical safety cap and never runs backwards", () => {
    expect(enumerateWagePeriods("2020-01", "2026-01", 3)).toHaveLength(3);
    expect(enumerateWagePeriods("2026-05", "2026-01", 120)).toEqual([]);
  });
});

describe("no hard-coded regulatory timing remains in the obligation path", () => {
  const forbidden = [
    { file: "supabase/functions/ce-violation-scan/index.ts", pattern: /new Date\(\s*y\s*,\s*m\s*,\s*dueDay/ },
    { file: "supabase/functions/run-notice-generation/index.ts", pattern: /days_open:\s*(7|21|45)\b/ },
  ];

  it.each(forbidden)("$file has no embedded deadline arithmetic", ({ file, pattern }) => {
    expect(read(file)).not.toMatch(pattern);
  });

  it("the deadline resolver is shared by detection, lifecycle and notices", () => {
    const scan = read("supabase/functions/ce-violation-scan/index.ts");
    const lifecycle = read("supabase/functions/ce-obligation-lifecycle/index.ts");
    expect(scan).toContain("_shared/compliance/obligationDeadlineResolver.ts");
    expect(scan).toContain("resolveObligationTimeline");
    expect(lifecycle).toContain("_shared/compliance/obligationDeadlineResolver.ts");
  });

  it("keeps the edge mirrors byte-identical to the app modules", () => {
    for (const name of ["obligationDeadlineResolver", "obligationLifecycle"]) {
      expect(read(`supabase/functions/_shared/compliance/${name}.ts`)).toBe(
        read(`src/lib/compliance/${name}.ts`),
      );
    }
  });
});
