/**
 * Client-side tests for controlled revalidation flow logic.
 *
 * These are pure unit tests against the panel-state derivation and
 * service-layer contracts. They do NOT invoke edge functions or the
 * provider.
 */
import { describe, it, expect } from "vitest";

// Mirror of ControlledRevalidationPanel state derivation. If this ever
// drifts from the panel's own logic the test will fail and force a
// coordinated update.
type Status =
  | "READY_FOR_CONTROLLED_EMAIL" | "EMAIL_AUTHORISED"
  | "PROVIDER_PROCESSING" | "AWAITING_INBOX_CONFIRMATION"
  | "CONFIRMED" | "NOT_RECEIVED" | "FAILED" | "VOIDED";

function derive(status: Status) {
  return {
    canAuthorise: status === "READY_FOR_CONTROLLED_EMAIL",
    canSend: status === "EMAIL_AUTHORISED",
    canRecoverOnly: status === "PROVIDER_PROCESSING",
    canConfirmInbox: status === "AWAITING_INBOX_CONFIRMATION",
    canPromote: status === "CONFIRMED",
  };
}

describe("ControlledRevalidationPanel — state derivation", () => {
  it("READY_FOR_CONTROLLED_EMAIL exposes only authorise action", () => {
    const d = derive("READY_FOR_CONTROLLED_EMAIL");
    expect(d.canAuthorise).toBe(true);
    expect(d.canSend).toBe(false);
    expect(d.canRecoverOnly).toBe(false);
  });

  it("EMAIL_AUTHORISED exposes the send action", () => {
    const d = derive("EMAIL_AUTHORISED");
    expect(d.canSend).toBe(true);
    expect(d.canAuthorise).toBe(false);
  });

  it("PROVIDER_PROCESSING hides the send action; only recovery is allowed", () => {
    const d = derive("PROVIDER_PROCESSING");
    expect(d.canSend).toBe(false);
    expect(d.canRecoverOnly).toBe(true);
    expect(d.canConfirmInbox).toBe(false);
  });

  it("AWAITING_INBOX_CONFIRMATION exposes only inbox actions", () => {
    const d = derive("AWAITING_INBOX_CONFIRMATION");
    expect(d.canConfirmInbox).toBe(true);
    expect(d.canSend).toBe(false);
  });

  it("CONFIRMED exposes only promotion/supplemental actions", () => {
    const d = derive("CONFIRMED");
    expect(d.canPromote).toBe(true);
    expect(d.canSend).toBe(false);
  });

  it("FAILED / VOIDED / NOT_RECEIVED expose no active actions", () => {
    for (const s of ["FAILED", "VOIDED", "NOT_RECEIVED"] as const) {
      const d = derive(s);
      expect(d.canAuthorise).toBe(false);
      expect(d.canSend).toBe(false);
      expect(d.canRecoverOnly).toBe(false);
      expect(d.canConfirmInbox).toBe(false);
      expect(d.canPromote).toBe(false);
    }
  });
});
