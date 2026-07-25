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
    // Locate the pre-provider insert block and assert both fields present.
    const insertIdx = targeted.indexOf('.from("communication_delivery_attempt")\n    .insert');
    expect(insertIdx).toBeGreaterThan(0);
    const insertBlock = targeted.slice(insertIdx, insertIdx + 1200);
    expect(insertBlock).toMatch(/status:\s*"pending"/);
    expect(insertBlock).toMatch(/finished_at:\s*null/);
  });

  it("never writes the legacy 'sent' or 'failed' vocabulary on attempt rows", () => {
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
    const guardIdx = targeted.indexOf("if (evidenceErr)");
    expect(guardIdx).toBeGreaterThan(0);
    const guardBlock = targeted.slice(guardIdx, guardIdx + 1600);
    expect(guardBlock).toContain("provider_evidence_persist_failed");
    expect(guardBlock).toMatch(/retry_safe:\s*false/);
    expect(guardBlock).toMatch(/reconciliation_required:\s*true/);
    expect(guardBlock).toMatch(/return\s+json\(env,\s*200\)/);
  });

  it("gates the success-path consume behind a successful evidence write", () => {
    const evidenceIdx = targeted.indexOf("const { error: evidenceErr }");
    const guardIdx = targeted.indexOf("if (evidenceErr)", evidenceIdx);
    const consumeIdx = targeted.indexOf('consume_comm_hub_controlled_live_grant', guardIdx);
    expect(evidenceIdx).toBeGreaterThan(0);
    expect(guardIdx).toBeGreaterThan(evidenceIdx);
    expect(consumeIdx).toBeGreaterThan(guardIdx);
  });

  it("marks provider-exception evidence-write failures as ambiguous (retry_safe=false)", () => {
    const guardIdx = targeted.indexOf("if (ambEvidenceErr)");
    expect(guardIdx).toBeGreaterThan(0);
    const guardBlock = targeted.slice(guardIdx, guardIdx + 1600);
    expect(guardBlock).toContain("provider_evidence_persist_failed");
    expect(guardBlock).toMatch(/retry_safe:\s*false/);
    expect(guardBlock).toMatch(/reconciliation_required:\s*true/);
  });
});
