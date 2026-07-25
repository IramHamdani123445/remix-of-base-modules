/**
 * Regression: Controlled Stub attempt-status vocabulary and evidence-gated
 * grant consumption. Static source-level assertions on the dispatcher.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const dispatcher = readFileSync(
  "supabase/functions/comm-hub-dispatch/index.ts",
  "utf8",
);
const targetedStart = dispatcher.indexOf(
  "async function processTargetedControlledLive",
);
const targeted = dispatcher.slice(targetedStart);

describe("controlled stub — attempt-status vocabulary", () => {
  it("inserts the pre-provider attempt as status='pending' with finished_at=null", () => {
    expect(targeted).toMatch(/status:\s*"pending",[\s\S]{0,400}finished_at:\s*null,/);
  });

  it("never writes the legacy 'sent' or 'failed' vocabulary on attempt rows", () => {
    // The success/failure mapping now uses success/failure; 'sent' & 'failed'
    // violate communication_delivery_attempt_status_chk.
    expect(targeted).not.toMatch(/status:\s*"sent"/);
    expect(targeted).not.toMatch(/status:\s*"failed"/);
  });

  it("maps provider outcomes to the constraint vocabulary", () => {
    expect(targeted).toMatch(/PROVIDER_ACCEPTED"\s*\?\s*"success"/);
    expect(targeted).toMatch(/PROVIDER_REJECTED"\s*\?\s*"failure"/);
    expect(targeted).toMatch(/DELIVERY_PENDING"\s*\?\s*"pending"/);
  });
});

describe("controlled stub — evidence-gated grant consumption", () => {
  it("captures the provider-evidence UPDATE error and blocks consume when it fails", () => {
    expect(targeted).toMatch(/const\s*\{\s*error:\s*evidenceErr\s*\}\s*=\s*await admin\.from\("communication_delivery_attempt"\)\.update/);
    expect(targeted).toMatch(/if\s*\(evidenceErr\)\s*\{[\s\S]{0,600}provider_evidence_persist_failed[\s\S]{0,300}retry_safe:\s*false[\s\S]{0,200}reconciliation_required:\s*true[\s\S]{0,200}return\s+json\(env,\s*200\);/);
  });

  it("gates the success-path consume behind a successful evidence write", () => {
    const evidenceIdx = targeted.indexOf("const { error: evidenceErr }");
    const consumeIdx = targeted.indexOf('consume_comm_hub_controlled_live_grant', evidenceIdx);
    const guardIdx = targeted.indexOf("if (evidenceErr)", evidenceIdx);
    expect(evidenceIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(evidenceIdx);
    expect(consumeIdx).toBeGreaterThan(guardIdx);
  });

  it("marks provider-exception evidence-write failures as ambiguous (retry_safe=false)", () => {
    // Ambiguous ambEvidenceErr branch.
    expect(targeted).toMatch(/ambEvidenceErr[\s\S]{0,600}provider_evidence_persist_failed[\s\S]{0,300}retry_safe:\s*false/);
  });
});
