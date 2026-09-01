import { describe, expect, it } from "vitest";
import {
  evaluateLead,
  matchLeadToRegister,
  buildUnregisteredLeadFlag,
  type CeEmployerRegisterEntry,
  type CeLeadLifecycleConfig,
  type CeLeadMatchConfig,
  type CeScoutingLead,
} from "@/lib/compliance/detection/unregisteredEmployer";

const register: CeEmployerRegisterEntry[] = [
  { employerId: "EMP-1", tradeName: "Island Fresh Grocers Ltd", address: "12 Main St" },
];

const fullMatch: CeLeadMatchConfig = { matchOnTradeName: true, matchOnAddress: true };
const nameOnly: CeLeadMatchConfig = { matchOnTradeName: true, matchOnAddress: false };
const addressOnly: CeLeadMatchConfig = { matchOnTradeName: false, matchOnAddress: true };

const lifecycle: CeLeadLifecycleConfig = { registrationResponseDays: 14, managementEscalationDays: 21 };

function lead(overrides: Partial<CeScoutingLead>): CeScoutingLead {
  return {
    leadId: "LEAD-1",
    tradeName: "Sunny Corner Bakery",
    businessAddress: "5 Bay Rd",
    discoveredDate: "2024-01-01",
    sourceType: "SCOUTING",
    status: "NEW",
    ...overrides,
  };
}

describe("DR-008 unregistered employer", () => {
  it("raises a review flag (not a violation) for an unmatched inspection/scouting lead", () => {
    const ev = evaluateLead(lead({}), [], fullMatch, lifecycle, "2024-01-05");
    expect(ev.action).toBe("RAISE_REVIEW_FLAG");
    const flag = buildUnregisteredLeadFlag(ev, lead({}), "DR-008");
    expect(flag.flag_type).toBe("UNREGISTERED_EMPLOYER_LEAD");
    expect(flag.subject_type).toBe("LEAD");
    expect(flag.subject_id).toBe("LEAD-1");
    expect(flag.status).toBe("OPEN");
  });

  it("resolves when registration occurs inside the configured response period", () => {
    const l = lead({ status: "INSTRUCTED", instructedAt: "2024-01-01" });
    const ev = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-10");
    expect(ev.action).toBe("AWAIT_REGISTRATION");
    expect(ev.registerByDate).toBe("2024-01-15");
  });

  it("escalates to management when unresolved past the management threshold", () => {
    const l = lead({ status: "INSTRUCTED", instructedAt: "2024-01-01" });
    const ev = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-25");
    expect(ev.action).toBe("ESCALATE_TO_MANAGEMENT");
    expect(ev.managementEscalationDue).toBe("2024-01-22");
  });

  it("requires management approval even for an immediate legal recommendation", () => {
    const l = lead({ legalRecommended: true, legalApprovedBy: null });
    const ev = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-05");
    expect(ev.action).toBe("AWAIT_LEGAL_APPROVAL");
  });

  it("produces no flag when a lead matches an existing registration", () => {
    const l = lead({ tradeName: "Island Fresh Grocers Ltd", businessAddress: "12 Main St" });
    const ev = evaluateLead(l, register, fullMatch, lifecycle, "2024-01-05");
    expect(ev.action).toBe("MARK_MATCHED");
    expect(ev.matched?.employerId).toBe("EMP-1");
  });

  it("switches behaviour between trade-name-only and address-only matching config", () => {
    const l = lead({ tradeName: "Island Fresh Grocers", businessAddress: "different address" });
    const nameMatch = matchLeadToRegister(l, register, nameOnly);
    expect(nameMatch?.method).toBe("TRADE_NAME");

    const addrLead = lead({ tradeName: "totally unrelated", businessAddress: "12 Main St" });
    const addrMatch = matchLeadToRegister(addrLead, register, addressOnly);
    expect(addrMatch?.method).toBe("ADDRESS");

    expect(matchLeadToRegister(addrLead, register, nameOnly)).toBeUndefined();
  });

  it("changes outcome when registrationResponseDays changes from 14 to 7, with no code change", () => {
    const l = lead({ status: "INSTRUCTED", instructedAt: "2024-01-01" });
    const evWith14 = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-10");
    expect(evWith14.action).toBe("AWAIT_REGISTRATION");

    const shorter: CeLeadLifecycleConfig = { registrationResponseDays: 7, managementEscalationDays: 21 };
    const evWith7 = evaluateLead(l, [], fullMatch, shorter, "2024-01-10");
    expect(evWith7.registerByDate).toBe("2024-01-08");
    // registerByDate has already passed by asOf, though escalation threshold is unchanged
    expect(evWith7.action).toBe("AWAIT_REGISTRATION");
    expect(evWith7.registerByDate).not.toBe(evWith14.registerByDate);
  });

  it("is deterministic and produces a stable dedupe key across two runs", () => {
    const l = lead({});
    const ev1 = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-05");
    const ev2 = evaluateLead(l, [], fullMatch, lifecycle, "2024-01-05");
    const flag1 = buildUnregisteredLeadFlag(ev1, l, "DR-008");
    const flag2 = buildUnregisteredLeadFlag(ev2, l, "DR-008");
    expect(flag1).toEqual(flag2);
    expect(flag1.dedupe_key).toBe(flag2.dedupe_key);
  });
});
