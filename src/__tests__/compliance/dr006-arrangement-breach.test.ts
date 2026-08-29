import { describe, expect, it } from "vitest";
import {
  evaluateInstallment,
  evaluateArrangementInstallments,
  planInstallmentReminders,
  isBreach,
  type CeArrangementBreachConfig,
  type CeInstallment,
} from "@/lib/compliance/detection/arrangementBreach";

const baseConfig: CeArrangementBreachConfig = {
  graceDaysAfterInstallment: 0,
  reminderLeadDays: 15,
  partialInstallmentIsBreach: true,
};

function inst(overrides: Partial<CeInstallment>): CeInstallment {
  return {
    installmentId: "I-1",
    arrangementId: "ARR-1",
    employerId: "EMP-1",
    installmentNumber: 1,
    dueDate: "2026-03-15",
    amount: 1000,
    paidAmount: 0,
    paidDate: null,
    ...overrides,
  };
}

describe("DR-006 arrangement breach", () => {
  it("full installment paid on time is not a breach", () => {
    const i = inst({ paidAmount: 1000, paidDate: "2026-03-15" });
    const result = evaluateInstallment(i, baseConfig, "2026-03-20");
    expect(result.outcome).toBe("PAID_IN_FULL");
    expect(isBreach(result.outcome)).toBe(false);
  });

  it("one day late with zero grace is BREACH_MISSED", () => {
    const i = inst({ paidAmount: 0 });
    const result = evaluateInstallment(i, baseConfig, "2026-03-16");
    expect(result.outcome).toBe("BREACH_MISSED");
    expect(isBreach(result.outcome)).toBe(true);
  });

  it("partial installment on the due date is BREACH_PARTIAL", () => {
    const i = inst({ paidAmount: 400 });
    const result = evaluateInstallment(i, baseConfig, "2026-03-15");
    expect(result.outcome).toBe("BREACH_PARTIAL");
    expect(result.shortfall).toBe(600);
  });

  it("reminder is generated 15 days ahead by config, and changing to 7 moves the date", () => {
    const i = inst({ dueDate: "2026-04-01", paidAmount: 0 });
    const reminders15 = planInstallmentReminders([i], baseConfig, "2026-03-01");
    expect(reminders15).toHaveLength(1);
    expect(reminders15[0].reminderDate).toBe("2026-03-17");

    const config7: CeArrangementBreachConfig = { ...baseConfig, reminderLeadDays: 7 };
    const reminders7 = planInstallmentReminders([i], config7, "2026-03-01");
    expect(reminders7[0].reminderDate).toBe("2026-03-25");
  });

  it("a pending reminder does not delay the breach", () => {
    const i = inst({ dueDate: "2026-04-01", paidAmount: 0 });
    // Reminder still pending (not yet sent) at asOf, but the installment is already past due.
    const evaluation = evaluateInstallment(i, baseConfig, "2026-04-02");
    expect(evaluation.outcome).toBe("BREACH_MISSED");
  });

  it("grace of 3 days: WITHIN_GRACE on day 1, breach on day 4", () => {
    const config: CeArrangementBreachConfig = { ...baseConfig, graceDaysAfterInstallment: 3 };
    const i = inst({ paidAmount: 0 });
    const day1 = evaluateInstallment(i, config, "2026-03-16");
    expect(day1.outcome).toBe("WITHIN_GRACE");
    const day4 = evaluateInstallment(i, config, "2026-03-19");
    expect(day4.outcome).toBe("BREACH_MISSED");
  });

  it("is deterministic across two identical runs", () => {
    const items = [
      inst({ installmentId: "I-1", paidAmount: 0 }),
      inst({ installmentId: "I-2", dueDate: "2026-04-15", paidAmount: 500 }),
    ];
    const run1 = evaluateArrangementInstallments(items, baseConfig, "2026-04-20");
    const run2 = evaluateArrangementInstallments(items, baseConfig, "2026-04-20");
    expect(run1).toEqual(run2);
  });
});
