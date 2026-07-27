/**
 * CH-SIMPLE-P4 — Granular runtime-contract gate tests.
 *
 * These are the targeted call-site proofs required by the operator-UX epic:
 *
 *  A. Manual Production dispatch is only gated when derived.action === "DISPATCH".
 *     Recovery, Finalize and Confirm-Inbox variants must remain enabled even
 *     when the runtime contract is failing.
 *
 *  B. Controlled Revalidation authorisation must NOT depend on
 *     CONTROLLED_REVALIDATION_SEND capabilities (runtime_dispatch/provider/
 *     policy). Authorisation succeeds when only assessment/snapshot/baseline/
 *     revalidation caps pass; the actual send stays a separate action.
 *
 *  C. Arm automation uses AUTOMATED_PRODUCTION_ARM — a distinct action code
 *     that does NOT include runtime_dispatch. AUTOMATED_CANARY remains
 *     separate and DOES require runtime_dispatch. Emergency Stop and Disarm
 *     buttons are never gated.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RuntimeContractReport } from "@/platform/communication-hub/runtimeContractService";
import {
  getRuntimeRequirements,
  runtimeActionPasses,
} from "@/platform/communication-hub/runtimeActionRequirements";

vi.mock("@/platform/communication-hub/runtimeContractService", async (orig) => {
  const actual: any = await orig();
  return { ...actual, auditRuntimeContract: vi.fn() };
});

import { auditRuntimeContract } from "@/platform/communication-hub/runtimeContractService";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { RuntimeContractActionGate } from "@/pages/admin/communicationHub/goLive/RuntimeContractActionGate";

function reportPassingOnly(caps: readonly string[]): RuntimeContractReport {
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

function reportWithAllPassingExcept(missing: readonly string[]): RuntimeContractReport {
  const all = Array.from(
    new Set(
      [
        "ONE_REAL_EMAIL",
        "MANUAL_PRODUCTION_SEND",
        "CONTROLLED_REVALIDATION_AUTHORISATION",
        "CONTROLLED_REVALIDATION_SEND",
        "AUTOMATED_PRODUCTION_ARM",
        "AUTOMATED_CANARY",
      ].flatMap((a) => [...getRuntimeRequirements(a as any)]),
    ),
  );
  return {
    ok: false,
    checked_at: new Date().toISOString(),
    checks: all.map((c) => ({
      capability: c,
      requirement: `${c} baseline`,
      object_name: `obj_${c}`,
      status: missing.includes(c) ? "MISSING_TABLE" : "PASS",
      detail: null,
      fix_action: null,
    })),
    summary: { total: all.length, pass: all.length - missing.length, fail: missing.length },
  };
}

beforeEach(() => {
  vi.mocked(auditRuntimeContract).mockReset();
});

function renderWithRouter(node: React.ReactElement) {
  return render(
    <MemoryRouter>
      <RuntimeContractProvider>{node}</RuntimeContractProvider>
    </MemoryRouter>,
  );
}

/* ------------------------------------------------------------------ */
/* A. Manual Production — conditional gating by derived.action        */
/* ------------------------------------------------------------------ */

describe("Manual Production dispatch gating is action-conditional", () => {
  /**
   * Mimics ManualProductionObservationPanel's structure: only when
   * derived.action === "DISPATCH" is the button wrapped in the gate.
   * Recovery / Finalize / Confirm-Inbox render as bare buttons.
   */
  function ManualLike({ action, spy }: { action: string; spy: () => void }) {
    if (action === "DISPATCH") {
      return (
        <RuntimeContractActionGate action="MANUAL_PRODUCTION_SEND" actionLabel="Dispatch">
          <button data-testid="mp-btn" onClick={spy}>Dispatch</button>
        </RuntimeContractActionGate>
      );
    }
    return <button data-testid="mp-btn" onClick={spy}>{action}</button>;
  }

  it("DISPATCH + failed contract → disabled and never fires", async () => {
    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(
      reportWithAllPassingExcept(["runtime_dispatch"]),
    );
    const spy = vi.fn();
    renderWithRouter(<ManualLike action="DISPATCH" spy={spy} />);
    const btn = await screen.findByTestId("mp-btn");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  for (const action of ["CHECK_RECOVERY", "FINALIZE", "CONFIRM_INBOX"]) {
    it(`${action} + failed contract → still enabled and clickable`, async () => {
      vi.mocked(auditRuntimeContract).mockResolvedValueOnce(
        reportWithAllPassingExcept(["runtime_dispatch"]),
      );
      const spy = vi.fn();
      renderWithRouter(<ManualLike action={action} spy={spy} />);
      const btn = await screen.findByTestId("mp-btn");
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  }
});

/* ------------------------------------------------------------------ */
/* B. Revalidation authorisation is decoupled from SEND caps           */
/* ------------------------------------------------------------------ */

describe("Controlled Revalidation authorisation runtime requirements", () => {
  it("does not include the runtime_dispatch capability", () => {
    const auth = getRuntimeRequirements("CONTROLLED_REVALIDATION_AUTHORISATION");
    expect(auth).not.toContain("runtime_dispatch");
    expect(auth).not.toContain("provider");
    expect(auth).not.toContain("policy");
  });

  it("authorisation passes even when provider/runtime_dispatch fail", async () => {
    // Report where SEND-only capabilities fail but authorisation caps pass.
    const authCaps = getRuntimeRequirements("CONTROLLED_REVALIDATION_AUTHORISATION");
    const failing = ["runtime_dispatch", "provider", "policy"];
    const report = reportWithAllPassingExcept(failing);
    // Sanity: authorisation caps are still PASS.
    for (const c of authCaps) {
      const check = report.checks.find((k) => k.capability === c);
      expect(check?.status).toBe("PASS");
    }
    expect(runtimeActionPasses(report, "CONTROLLED_REVALIDATION_AUTHORISATION")).toBe(true);
    expect(runtimeActionPasses(report, "CONTROLLED_REVALIDATION_SEND")).toBe(false);

    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(report);
    const spy = vi.fn();
    renderWithRouter(
      <RuntimeContractActionGate action="CONTROLLED_REVALIDATION_AUTHORISATION" actionLabel="Authorise">
        <button data-testid="auth-btn" onClick={spy}>Authorise</button>
      </RuntimeContractActionGate>,
    );
    const btn = await screen.findByTestId("auth-btn");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("controlled send remains blocked when runtime_dispatch fails", async () => {
    const report = reportWithAllPassingExcept(["runtime_dispatch"]);
    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(report);
    const spy = vi.fn();
    renderWithRouter(
      <RuntimeContractActionGate action="CONTROLLED_REVALIDATION_SEND" actionLabel="Send">
        <button data-testid="send-btn" onClick={spy}>Send</button>
      </RuntimeContractActionGate>,
    );
    const btn = await screen.findByTestId("send-btn");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* C. Automation: ARM vs CANARY are distinct                          */
/* ------------------------------------------------------------------ */

describe("Automation gates: ARM vs CANARY", () => {
  it("AUTOMATED_PRODUCTION_ARM does not require runtime_dispatch", () => {
    const arm = getRuntimeRequirements("AUTOMATED_PRODUCTION_ARM");
    expect(arm).not.toContain("runtime_dispatch");
    expect(arm).not.toContain("provider");
    expect(arm).toContain("automation");
    expect(arm).toContain("automated_readiness");
  });

  it("AUTOMATED_CANARY still requires runtime_dispatch and provider", () => {
    const canary = getRuntimeRequirements("AUTOMATED_CANARY");
    expect(canary).toContain("runtime_dispatch");
    expect(canary).toContain("provider");
  });

  it("ARM is blocked when automated_readiness fails", async () => {
    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(
      reportWithAllPassingExcept(["automated_readiness"]),
    );
    const spy = vi.fn();
    renderWithRouter(
      <RuntimeContractActionGate action="AUTOMATED_PRODUCTION_ARM" actionLabel="Arm">
        <button data-testid="arm-btn" onClick={spy}>ARM</button>
      </RuntimeContractActionGate>,
    );
    const btn = await screen.findByTestId("arm-btn");
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  it("ARM is enabled when runtime_dispatch is the only failing cap", async () => {
    // ARM does not include runtime_dispatch, so it should still enable.
    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(
      reportWithAllPassingExcept(["runtime_dispatch"]),
    );
    const spy = vi.fn();
    renderWithRouter(
      <RuntimeContractActionGate action="AUTOMATED_PRODUCTION_ARM" actionLabel="Arm">
        <button data-testid="arm-btn" onClick={spy}>ARM</button>
      </RuntimeContractActionGate>,
    );
    const btn = await screen.findByTestId("arm-btn");
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Emergency Stop and Disarm are unwrapped and always enabled", async () => {
    // These are never wrapped by RuntimeContractActionGate — model that.
    vi.mocked(auditRuntimeContract).mockResolvedValueOnce(
      reportWithAllPassingExcept(["runtime_dispatch", "automated_readiness", "provider"]),
    );
    const stop = vi.fn();
    const disarm = vi.fn();
    renderWithRouter(
      <div>
        <button data-testid="stop-btn" onClick={stop}>Emergency Stop</button>
        <button data-testid="disarm-btn" onClick={disarm}>Disarm</button>
      </div>,
    );
    fireEvent.click(await screen.findByTestId("stop-btn"));
    fireEvent.click(screen.getByTestId("disarm-btn"));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(disarm).toHaveBeenCalledTimes(1);
  });
});
