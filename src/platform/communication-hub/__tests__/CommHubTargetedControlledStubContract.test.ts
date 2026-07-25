/**
 * PHASE_4B3 — Targeted Controlled Stub dispatcher contract repair.
 *
 * Static, source-level assertions verifying the invariants required after
 * the revalidation/grant-lifecycle repair. No runtime rows are created.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dispatcher = readFileSync(
  "supabase/functions/comm-hub-dispatch/index.ts",
  "utf8",
);

// Isolate the targeted-controlled-live handler so unrelated code paths
// (e.g. Dry Run) cannot satisfy these assertions accidentally.
const targetedStart = dispatcher.indexOf(
  "async function processTargetedControlledLive",
);
expect(targetedStart, "processTargetedControlledLive must exist").toBeGreaterThan(0);
const targeted = dispatcher.slice(targetedStart);

describe("targeted controlled stub — canonical revalidation contract", () => {
  it("does NOT call the deprecated 1-arg revalidate signature", () => {
    // The legacy `{ p_message_id: messageId }` call was the root cause of
    // execution 8's revalidation_exception; it must not exist anywhere in
    // the targeted handler.
    expect(targeted).not.toMatch(/p_message_id:\s*messageId[\s\S]{0,80}revalidate_comm_hub_send_decision/);
    expect(targeted).not.toMatch(/revalidate_comm_hub_send_decision[\s\S]{0,80}p_message_id/);
  });

  it("loads prior decision payload and calls the canonical 2-arg signature", () => {
    expect(targeted).toMatch(/from\("communication_hub_send_decision_log"\)/);
    expect(targeted).toMatch(
      /revalidate_comm_hub_send_decision[\s\S]{0,200}p_prior_decision_id[\s\S]{0,80}p_payload/,
    );
  });

  it("parses fresh_decision/fresh_decision_id and requires fresh_allowed && !stale", () => {
    expect(targeted).toContain("fresh_decision");
    expect(targeted).toContain("fresh_decision_id");
    expect(targeted).toMatch(/fresh_allowed\s*===\s*true[\s\S]{0,40}stale\s*!==\s*true/);
  });
});

describe("targeted controlled stub — grant lifecycle contracts", () => {
  it("reserve uses hardened service-bound signature bound to DISPATCH_CONTROLLED_STUB", () => {
    expect(targeted).toMatch(
      /reserve_comm_hub_controlled_live_grant[\s\S]{0,400}p_expected_action:\s*action[\s\S]{0,200}p_service_operation:\s*"DISPATCH_CONTROLLED_STUB"/,
    );
    expect(targeted).toMatch(/reserveRaw as any\)\?\.allowed/);
    // No hash-based reserve arguments — they were dropped by the hardened contract.
    expect(targeted).not.toMatch(/reserve_comm_hub_controlled_live_grant[\s\S]{0,400}p_recipient_set_hash/);
  });

  it("consume uses hardened service-bound signature and asserts allowed=true", () => {
    // Both consume call sites (exception + success) must use the hardened
    // 5-arg signature.
    const consumeCalls = targeted.match(/consume_comm_hub_controlled_live_grant/g) ?? [];
    expect(consumeCalls.length).toBeGreaterThanOrEqual(2);
    expect(targeted).toMatch(
      /consume_comm_hub_controlled_live_grant[\s\S]{0,400}p_message_id:\s*messageId[\s\S]{0,200}p_service_operation:\s*"DISPATCH_CONTROLLED_STUB"/,
    );
    // The legacy provider_invocation_key parameter is gone.
    expect(targeted).not.toMatch(/consume_comm_hub_controlled_live_grant[\s\S]{0,400}p_provider_invocation_key/);
  });
});

describe("targeted controlled stub — pre-provider reconciliation", () => {
  it("defines a single preProviderReconcile helper", () => {
    expect(targeted).toMatch(/const preProviderReconcile\s*=\s*async/);
    expect(targeted).toContain("reconcile_comm_hub_controlled_live_pre_provider");
  });

  it("routes every post-claim, pre-provider failure through the reconciliation helper", () => {
    // Any residual raw revoke_comm_hub_controlled_live_grant call inside
    // the targeted handler would bypass message-lock cleanup.
    expect(targeted).not.toMatch(/admin\.rpc\("revoke_comm_hub_controlled_live_grant"/);
  });

  it("exposes retry-safety metadata on the envelope after reconciliation", () => {
    expect(targeted).toMatch(/requires_new_execution:\s*true/);
    expect(targeted).toMatch(/requires_new_grant:\s*true/);
    expect(targeted).toMatch(/retry_safe:\s*true/);
  });
});

describe("targeted controlled stub — attempt numbering", () => {
  it("uses claim.attempt_count directly (no +1)", () => {
    // The claim RPC already increments and returns attempt_count.
    expect(targeted).toMatch(/\(claim\.attempt_count as number\)/);
    expect(targeted).not.toMatch(/\(\(msg as any\)\.attempt_count \?\? 0\)\s*\+\s*1/);
  });
});

describe("targeted controlled stub — success-path ordering", () => {
  it("updates the attempt row with provider evidence BEFORE calling consume", () => {
    // consume's evidence check requires a durable provider_call_attempted
    // attempt on the message. The success path must set that first.
    const attemptUpdateIdx = targeted.indexOf('provider_call_attempted: true,');
    const consumeIdx = targeted.indexOf('consume_comm_hub_controlled_live_grant');
    expect(attemptUpdateIdx).toBeGreaterThan(0);
    expect(consumeIdx).toBeGreaterThan(attemptUpdateIdx);
  });
});
