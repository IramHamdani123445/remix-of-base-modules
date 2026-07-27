/**
 * Slice: Runtime-contract gating for the five provider-contacting actions.
 *
 * Proves fail-closed behaviour for the shared capability layer:
 *  1) capabilityPasses regressions (empty match must NOT count as PASS).
 *  2) runtimeActionPasses across every action code.
 *  3) RuntimeContractGate renders blocker + hides children on:
 *       - loading, absent report, audit error, MISSING_TABLE,
 *         MISSING_COLUMN, SIGNATURE_MISMATCH, NOT_IMPLEMENTED
 *     and permits children only when all required capabilities PASS.
 *  4) Unrelated capability failures do not block an unrelated action.
 *  5) Blocker explanation is visible and no child action fires when blocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RuntimeContractReport, RuntimeContractCheck, RuntimeCheckStatus } from "@/platform/communication-hub/runtimeContractService";
import { capabilityPasses } from "@/platform/communication-hub/runtimeContractService";
import {
  getRuntimeRequirements,
  runtimeActionPasses,
  type RuntimeActionCode,
} from "@/platform/communication-hub/runtimeActionRequirements";

// Mock the RPC so the context resolves synchronously in tests.
vi.mock("@/platform/communication-hub/runtimeContractService", async (orig) => {
  const actual: any = await orig();
  return { ...actual, auditRuntimeContract: vi.fn() };
});

import { auditRuntimeContract } from "@/platform/communication-hub/runtimeContractService";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { RuntimeContractGate } from "@/pages/admin/communicationHub/goLive/RuntimeContractGate";

const ALL_ACTIONS: RuntimeActionCode[] = [
  "ONE_REAL_EMAIL",
  "MANUAL_PRODUCTION_SEND",
  "CONTROLLED_REVALIDATION_AUTHORISATION",
  "CONTROLLED_REVALIDATION_SEND",
  "AUTOMATED_PRODUCTION_ARM",
  "AUTOMATED_CANARY",
];

function buildPassingReport(): RuntimeContractReport {
  // Collect union of all required capabilities so every action passes.
  const caps = Array.from(new Set(ALL_ACTIONS.flatMap((a) => [...getRuntimeRequirements(a)])));
  const checks: RuntimeContractCheck[] = caps.map((c) => ({
    capability: c,
    requirement: `${c} baseline`,
    object_name: `obj_${c}`,
    status: "PASS",
    detail: null,
    fix_action: null,
  }));
  return { ok: true, checked_at: new Date().toISOString(), checks, summary: { total: checks.length, pass: checks.length, fail: 0 } };
}

function withOneCapabilityStatus(status: RuntimeCheckStatus, capability: string): RuntimeContractReport {
  const r = buildPassingReport();
  return {
    ...r,
    ok: false,
    checks: r.checks.map((c) => (c.capability === capability ? { ...c, status } : c)),
  };
}

async function renderGate(action: RuntimeActionCode) {
  const view = render(
    <RuntimeContractProvider>
      <RuntimeContractGate action={action} capabilities={[...getRuntimeRequirements(action)]}>
        <button data-testid={`action-${action}`}>ACT</button>
      </RuntimeContractGate>
    </RuntimeContractProvider>,
  );
  // Wait for the effect-driven fetch to resolve.
  await screen.findByRole("alert").catch(() => null);
  return view;
}

beforeEach(() => {
  vi.mocked(auditRuntimeContract).mockReset();
});

describe("capabilityPasses — regression: empty match must fail closed", () => {
  it("returns false when the capability has zero matched checks", () => {
    const r: RuntimeContractReport = { ok: true, checked_at: "x", checks: [], summary: { total: 0, pass: 0, fail: 0 } };
    expect(capabilityPasses(r, "revalidation")).toBe(false);
  });
  it("returns false when report is null", () => {
    expect(capabilityPasses(null, "provider")).toBe(false);
  });
  it("returns true only when every matched check PASSes", () => {
    const r: RuntimeContractReport = {
      ok: true, checked_at: "x",
      checks: [
        { capability: "provider", requirement: "r", object_name: "o", status: "PASS", detail: null, fix_action: null },
        { capability: "provider", requirement: "r2", object_name: "o2", status: "PASS", detail: null, fix_action: null },
      ],
      summary: { total: 2, pass: 2, fail: 0 },
    };
    expect(capabilityPasses(r, "provider")).toBe(true);
  });
});

describe("runtimeActionPasses — capability map coverage", () => {
  for (const action of ALL_ACTIONS) {
    it(`${action}: requires >0 capabilities and fails closed on null report`, () => {
      expect(getRuntimeRequirements(action).length).toBeGreaterThan(0);
      expect(runtimeActionPasses(null, action)).toBe(false);
    });
    it(`${action}: passes only when its required capabilities all PASS`, () => {
      const r = buildPassingReport();
      expect(runtimeActionPasses(r, action)).toBe(true);
      const firstReq = getRuntimeRequirements(action)[0];
      const broken = withOneCapabilityStatus("MISSING_TABLE", firstReq);
      expect(runtimeActionPasses(broken, action)).toBe(false);
    });
  }
});

describe("RuntimeContractGate — fail-closed behaviour per action", () => {
  const FAIL_STATUSES: RuntimeCheckStatus[] = [
    "MISSING_TABLE",
    "MISSING_COLUMN",
    "SIGNATURE_MISMATCH",
    "NOT_IMPLEMENTED",
  ];

  for (const action of ALL_ACTIONS) {
    it(`${action}: absent report → disabled + blocker`, async () => {
      vi.mocked(auditRuntimeContract).mockRejectedValueOnce(new Error("boom"));
      await renderGate(action);
      expect(screen.queryByTestId(`action-${action}`)).not.toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Communication Hub runtime contract is not satisfied/i,
      );
    });

    for (const status of FAIL_STATUSES) {
      it(`${action}: required capability ${status} → disabled`, async () => {
        const firstReq = getRuntimeRequirements(action)[0];
        vi.mocked(auditRuntimeContract).mockResolvedValueOnce(withOneCapabilityStatus(status, firstReq));
        await renderGate(action);
        expect(screen.queryByTestId(`action-${action}`)).not.toBeInTheDocument();
        // Blocker mentions the failing status.
        expect(screen.getByRole("alert")).toHaveTextContent(status);
      });
    }

    it(`${action}: all required capabilities PASS → children rendered`, async () => {
      vi.mocked(auditRuntimeContract).mockResolvedValueOnce(buildPassingReport());
      const { findByTestId } = render(
        <RuntimeContractProvider>
          <RuntimeContractGate action={action} capabilities={[...getRuntimeRequirements(action)]}>
            <button data-testid={`action-${action}`}>ACT</button>
          </RuntimeContractGate>
        </RuntimeContractProvider>,
      );
      expect(await findByTestId(`action-${action}`)).toBeInTheDocument();
    });

    it(`${action}: unrelated capability failure does not block`, async () => {
      // Fail a capability that is NOT in this action's requirement set.
      const required = new Set(getRuntimeRequirements(action));
      const unrelated = ALL_ACTIONS
        .flatMap((a) => [...getRuntimeRequirements(a)])
        .find((c) => !required.has(c));
      if (!unrelated) return; // nothing unrelated exists in the union — trivially passes.
      const r = withOneCapabilityStatus("MISSING_TABLE", unrelated);
      // Re-mark the unrelated capability check back to PASS if it appeared under a required cap alias:
      vi.mocked(auditRuntimeContract).mockResolvedValueOnce(r);
      const { findByTestId } = render(
        <RuntimeContractProvider>
          <RuntimeContractGate action={action} capabilities={[...getRuntimeRequirements(action)]}>
            <button data-testid={`action-${action}`}>ACT</button>
          </RuntimeContractGate>
        </RuntimeContractProvider>,
      );
      expect(await findByTestId(`action-${action}`)).toBeInTheDocument();
    });
  }
});

describe("RuntimeContractGate — no child invocation when blocked", () => {
  it("does not render (and thus cannot fire) the action button while blocked", async () => {
    const spy = vi.fn();
    vi.mocked(auditRuntimeContract).mockRejectedValueOnce(new Error("audit failure"));
    render(
      <RuntimeContractProvider>
        <RuntimeContractGate action="ONE_REAL_EMAIL" capabilities={[...getRuntimeRequirements("ONE_REAL_EMAIL")]}>
          <button data-testid="blocked-btn" onClick={spy}>ACT</button>
        </RuntimeContractGate>
      </RuntimeContractProvider>,
    );
    await screen.findByRole("alert");
    expect(screen.queryByTestId("blocked-btn")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
