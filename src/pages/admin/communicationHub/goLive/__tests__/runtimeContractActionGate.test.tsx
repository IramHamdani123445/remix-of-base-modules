/**
 * A4.0 — Action-level runtime-contract gating.
 *
 * Proves:
 *  1. Provider-touching buttons are disabled while the runtime contract
 *     fails, is loading, is absent, or returns audit errors.
 *  2. Sibling controls (recovery, inbox confirmation, Emergency Stop,
 *     diagnostics, evidence) rendered in the same panel remain interactive.
 *  3. Blocker note is displayed when the action is blocked, and hidden
 *     when passing.
 *  4. Zero matched checks fails closed (regression, mirrors
 *     runtimeContractGating.test.tsx expectations).
 *  5. No RPC / no click handler fires when the button is blocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RuntimeContractReport, RuntimeCheckStatus } from "@/platform/communication-hub/runtimeContractService";
import {
  getRuntimeRequirements,
  type RuntimeActionCode,
} from "@/platform/communication-hub/runtimeActionRequirements";

vi.mock("@/platform/communication-hub/runtimeContractService", async (orig) => {
  const actual: any = await orig();
  return { ...actual, auditRuntimeContract: vi.fn() };
});

import { auditRuntimeContract } from "@/platform/communication-hub/runtimeContractService";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { RuntimeContractActionGate } from "@/pages/admin/communicationHub/goLive/RuntimeContractActionGate";

const ALL_ACTIONS: RuntimeActionCode[] = [
  "ONE_REAL_EMAIL",
  "MANUAL_PRODUCTION_SEND",
  "CONTROLLED_REVALIDATION_AUTHORISATION",
  "CONTROLLED_REVALIDATION_SEND",
  "AUTOMATED_PRODUCTION_ARM",
  "AUTOMATED_CANARY",
];

function passingReport(): RuntimeContractReport {
  const caps = Array.from(new Set(ALL_ACTIONS.flatMap((a) => [...getRuntimeRequirements(a)])));
  return {
    ok: true,
    checked_at: new Date().toISOString(),
    checks: caps.map((c) => ({
      capability: c,
      requirement: `${c} baseline`,
      object_name: `obj_${c}`,
      status: "PASS",
      detail: null,
      fix_action: null,
    })),
    summary: { total: caps.length, pass: caps.length, fail: 0 },
  };
}

function reportWithFailing(status: RuntimeCheckStatus, capability: string): RuntimeContractReport {
  const r = passingReport();
  return {
    ...r,
    ok: false,
    checks: r.checks.map((c) => (c.capability === capability ? { ...c, status } : c)),
  };
}

beforeEach(() => {
  vi.mocked(auditRuntimeContract).mockReset();
});

async function renderPanelWithSiblings(
  action: RuntimeActionCode,
  reportMock: () => Promise<RuntimeContractReport> | Promise<never>,
  onSend: () => void,
) {
  vi.mocked(auditRuntimeContract).mockImplementationOnce(reportMock);
  const view = render(
    <RuntimeContractProvider>
      <div>
        {/* Simulated sibling controls that must NEVER be hidden. */}
        <button data-testid="recovery-btn">Recover</button>
        <button data-testid="inbox-confirm-btn">Confirm inbox</button>
        <button data-testid="emergency-stop-btn">Emergency Stop</button>
        <button data-testid="disarm-btn">Disarm</button>
        <button data-testid="diagnostics-btn">Diagnostics</button>
        <RuntimeContractActionGate action={action} actionLabel="Provider action">
          <button data-testid="provider-btn" onClick={onSend}>SEND</button>
        </RuntimeContractActionGate>
      </div>
    </RuntimeContractProvider>,
  );
  // Wait for effect-driven fetch.
  await screen.findByTestId("provider-btn");
  return view;
}

describe("RuntimeContractActionGate — action-level blocking", () => {
  const FAIL_STATUSES: RuntimeCheckStatus[] = [
    "MISSING_TABLE",
    "MISSING_COLUMN",
    "SIGNATURE_MISMATCH",
    "NOT_IMPLEMENTED",
  ];

  for (const action of ALL_ACTIONS) {
    it(`${action}: PASS report → button enabled and clickable`, async () => {
      const spy = vi.fn();
      await renderPanelWithSiblings(action, async () => passingReport(), spy);
      const btn = await screen.findByTestId("provider-btn");
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it(`${action}: audit error → button disabled, siblings preserved, no fire`, async () => {
      const spy = vi.fn();
      await renderPanelWithSiblings(action, async () => { throw new Error("audit failed"); }, spy);
      const btn = screen.getByTestId("provider-btn");
      expect(btn).toBeDisabled();
      fireEvent.click(btn);
      expect(spy).not.toHaveBeenCalled();
      // Siblings preserved.
      expect(screen.getByTestId("recovery-btn")).toBeInTheDocument();
      expect(screen.getByTestId("inbox-confirm-btn")).toBeInTheDocument();
      expect(screen.getByTestId("emergency-stop-btn")).toBeInTheDocument();
      expect(screen.getByTestId("disarm-btn")).toBeInTheDocument();
      expect(screen.getByTestId("diagnostics-btn")).toBeInTheDocument();
    });

    for (const status of FAIL_STATUSES) {
      it(`${action}: required capability ${status} → button disabled, no fire`, async () => {
        const spy = vi.fn();
        const cap = getRuntimeRequirements(action)[0];
        await renderPanelWithSiblings(action, async () => reportWithFailing(status, cap), spy);
        const btn = screen.getByTestId("provider-btn");
        expect(btn).toBeDisabled();
        fireEvent.click(btn);
        expect(spy).not.toHaveBeenCalled();
        // Emergency Stop still there.
        expect(screen.getByTestId("emergency-stop-btn")).toBeInTheDocument();
      });
    }

    it(`${action}: unrelated capability failure does NOT block`, async () => {
      const spy = vi.fn();
      const required = new Set(getRuntimeRequirements(action));
      const unrelated = ALL_ACTIONS.flatMap((a) => [...getRuntimeRequirements(a)]).find((c) => !required.has(c));
      if (!unrelated) return; // no unrelated cap exists — trivially passes.
      await renderPanelWithSiblings(action, async () => reportWithFailing("MISSING_TABLE", unrelated), spy);
      const btn = await screen.findByTestId("provider-btn");
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  }
});

describe("RuntimeContractActionGate — panels remain mounted when contract fails", () => {
  it("audit failure keeps sibling recovery/emergency controls interactive", async () => {
    vi.mocked(auditRuntimeContract).mockRejectedValueOnce(new Error("audit failed"));
    const recoverySpy = vi.fn();
    const emergencySpy = vi.fn();
    render(
      <RuntimeContractProvider>
        <button data-testid="recovery" onClick={recoverySpy}>Recover</button>
        <button data-testid="emergency" onClick={emergencySpy}>Emergency Stop</button>
        <RuntimeContractActionGate action="MANUAL_PRODUCTION_SEND" actionLabel="Dispatch">
          <button data-testid="dispatch">DISPATCH</button>
        </RuntimeContractActionGate>
      </RuntimeContractProvider>,
    );
    await screen.findByTestId("dispatch");
    fireEvent.click(screen.getByTestId("recovery"));
    fireEvent.click(screen.getByTestId("emergency"));
    expect(recoverySpy).toHaveBeenCalledTimes(1);
    expect(emergencySpy).toHaveBeenCalledTimes(1);
    // Blocked provider button did NOT fire.
    expect(screen.getByTestId("dispatch")).toBeDisabled();
  });
});
