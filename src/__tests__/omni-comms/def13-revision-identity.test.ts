/**
 * DEF-13 — deployment revision truth.
 *
 * Proves, against the real committed sources:
 *   1. the revision resolution rule (build artifact authoritative, stale
 *      override detected, malformed override ignored);
 *   2. that neither the runtime nor the dispatcher consumes the legacy
 *      `OMNI_COMMS_EDGE_REVISION` variable as deployment truth;
 *   3. that the committed build artifact is not stale relative to the
 *      Omni-Comms runtime / dispatcher / shared source tree.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

// Imported at runtime only: the adapter registry is Deno source and must not
// be pulled into the browser typecheck graph.
const REGISTRY_MODULE =
  "../../../supabase/functions/_shared/omni-comms/adapterRegistry.ts";

let OMNI_COMMS_REVISION_PATTERN: RegExp;
let resolveRevisionReport: (
  env: string | undefined,
  build: string | undefined,
) => {
  revision: string | null;
  revisionSource: string;
  revisionVerified: boolean;
  buildRevision: string | null;
  environmentRevision: string | null;
  revisionStale: boolean;
};

beforeAll(async () => {
  const mod = await import(/* @vite-ignore */ REGISTRY_MODULE);
  OMNI_COMMS_REVISION_PATTERN = mod.OMNI_COMMS_REVISION_PATTERN;
  resolveRevisionReport = mod.resolveRevisionReport;
});

const BUILD = "a".repeat(40);
const OTHER = "b".repeat(40);

describe("DEF-13 revision resolver", () => {
  it("selects the build artifact when no deployment stamp exists", () => {
    const r = resolveRevisionReport(undefined, BUILD);
    expect(r.revision).toBe(BUILD);
    expect(r.revisionSource).toBe("build_artifact");
    expect(r.environmentRevision).toBeNull();
    expect(r.revisionStale).toBe(false);
    expect(r.revisionVerified).toBe(true);
  });

  it("accepts a deployment stamp that equals the build revision", () => {
    const r = resolveRevisionReport(BUILD, BUILD);
    expect(r.revisionSource).toBe("environment");
    expect(r.revisionStale).toBe(false);
    expect(r.revisionVerified).toBe(true);
  });

  it("marks a deployment stamp that disagrees with the build as stale", () => {
    const r = resolveRevisionReport(OTHER, BUILD);
    expect(r.environmentRevision).toBe(OTHER);
    expect(r.buildRevision).toBe(BUILD);
    expect(r.revisionStale).toBe(true);
  });

  it("ignores a malformed deployment stamp and falls back to the artifact", () => {
    for (const bad of ["", "   ", "not-a-revision", "abc123", `${BUILD}extra`]) {
      const r = resolveRevisionReport(bad, BUILD);
      expect(r.revisionSource).toBe("build_artifact");
      expect(r.environmentRevision).toBeNull();
      expect(r.revisionStale).toBe(false);
    }
  });

  it("reports nothing verifiable when neither source is well formed", () => {
    const r = resolveRevisionReport(undefined, undefined);
    expect(r.revision).toBeNull();
    expect(r.revisionSource).toBe("none");
    expect(r.revisionVerified).toBe(false);
  });
});

describe("DEF-13 legacy fallback removal", () => {
  const edgeSources = [
    "supabase/functions/omni-comms-runtime/index.ts",
    "supabase/functions/omni-comms-dispatch/index.ts",
    "supabase/functions/_shared/omni-comms/adapterRegistry.ts",
  ];

  it("never reads OMNI_COMMS_EDGE_REVISION from the environment", () => {
    for (const file of edgeSources) {
      const code = read(file).replace(/\/\/[^\n]*\n/g, "\n");
      expect(code).not.toMatch(/OMNI_COMMS_EDGE_REVISION/);
    }
  });

  it("resolves the deployed revision through the single canonical resolver", () => {
    for (const file of edgeSources.slice(0, 2)) {
      expect(read(file)).toMatch(/resolveDeployedRevision\(/);
    }
  });
});

describe("DEF-13 build artifact freshness", () => {
  it("commits a well-formed build revision and source-file count", () => {
    const artifact = read(
      "supabase/functions/_shared/omni-comms/adapterRegistry.ts",
    );
    const rev = /OMNI_COMMS_BUILD_REVISION = "([0-9a-f]{40})"/.exec(artifact);
    const count = /OMNI_COMMS_BUILD_SOURCE_FILE_COUNT = (\d+)/.exec(artifact);
    expect(rev).not.toBeNull();
    expect(OMNI_COMMS_REVISION_PATTERN.test(rev![1])).toBe(true);
    expect(Number(count![1])).toBeGreaterThan(0);
  });

  it("is not stale relative to the Omni-Comms source tree", () => {
    // Fails the build whenever runtime / dispatcher / shared source changed
    // without the build identity being regenerated.
    execFileSync(
      "node",
      ["scripts/omni-comms/generate-build-revision.mjs", "--check"],
      { cwd: ROOT, stdio: "pipe" },
    );
  });
});
