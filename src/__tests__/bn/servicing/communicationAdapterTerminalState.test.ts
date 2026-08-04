import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Source-of-truth assertions for the shared Benefits communication adapter
// terminal-state hardening. The authoritative proof is the seeded database
// harness (supabase/tests/bn/life_certificate_integration.sql); these checks
// guard against the migrations or the runner drifting away from it.

const MIGRATIONS_DIR = "supabase/migrations";

function latestMigrationContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(join(MIGRATIONS_DIR, files[i]), "utf8");
    if (body.includes(needle)) return body;
  }
  throw new Error(`no migration contains ${needle}`);
}

const transitionSql = latestMigrationContaining("_bn_comm_transition_allowed");
const harness = readFileSync("supabase/tests/bn/life_certificate_integration.sql", "utf8");
const runner = readFileSync("supabase/functions/bn-communication-adapter/index.ts", "utf8");

describe("communication transition matrix", () => {
  it("declares an explicit transition helper", () => {
    expect(transitionSql).toContain("FUNCTION public._bn_comm_transition_allowed");
    expect(transitionSql).toContain("IMMUTABLE");
  });

  it.each([
    ["DELIVERED", "p_to = 'DELIVERED'"],
    ["FAILED", "p_to = 'FAILED'"],
    ["CANCELLED", "p_to = 'CANCELLED'"],
  ])("keeps %s terminal", (_state, clause) => {
    expect(transitionSql).toContain(clause);
  });

  it("only allows service_role to evaluate the helper", () => {
    expect(transitionSql).toContain(
      "REVOKE ALL ON FUNCTION public._bn_comm_transition_allowed(text, text) FROM PUBLIC, anon, authenticated",
    );
  });

  it("guards synchronisation with the matrix", () => {
    expect(transitionSql).toMatch(
      /UPDATE public\.bn_life_certificate_communication_intent i[\s\S]*_bn_comm_transition_allowed/,
    );
  });
});

describe("dispatch cancellation safety", () => {
  it("re-reads the status under the row lock", () => {
    expect(transitionSql).toMatch(/FOR UPDATE;[\s\S]*v_status := COALESCE/);
  });

  it("returns a controlled no-op for cancelled intents", () => {
    expect(transitionSql).toContain("'error_code','E_INTENT_CANCELLED'");
    expect(transitionSql).toContain("'error_code','E_INTENT_TERMINAL_FAILED'");
    expect(transitionSql).toContain("'error_code','E_INTENT_ALREADY_DELIVERED'");
  });

  it("blocks anything that is not PENDING or RETRY", () => {
    expect(transitionSql).toContain("IF v_status NOT IN ('PENDING','RETRY') THEN");
  });
});

describe("failure recording safety", () => {
  it("locks the intent and preserves terminal states", () => {
    expect(transitionSql).toContain("IF v_status IN ('CANCELLED','DELIVERED','FAILED') THEN");
  });

  it("reports missing intents honestly", () => {
    expect(transitionSql).toContain("'error_code','E_INTENT_NOT_FOUND'");
  });
});

describe("adapter runner", () => {
  it("treats intentional terminal outcomes as non-retry successes", () => {
    expect(runner).toContain("TERMINAL_NO_OP_CODES");
    for (const code of [
      "E_INTENT_CANCELLED",
      "E_INTENT_ALREADY_DELIVERED",
      "E_INTENT_TERMINAL_FAILED",
    ]) {
      expect(runner).toContain(code);
    }
  });

  it("never records a failure for a terminal no-op", () => {
    expect(runner).toMatch(/status === "NO_OP" && TERMINAL_NO_OP_CODES\.has/);
  });
});

describe("seeded database harness coverage", () => {
  it.each([
    "cancelled intent created a communication_request",
    "cancelled intent created a recipient",
    "record_failure mutated cancelled intent",
    "sync changed cancelled intent",
    "DELIVERED regressed to",
    "FAILED became retryable",
    "post-selection cancellation ignored",
    "replay produced % requests",
    "delivered evidence altered",
  ])("proves: %s", (assertion) => {
    expect(harness).toContain(assertion);
  });

  it("inspects the intent status after record_failure_v1", () => {
    expect(harness).toMatch(
      /record_failure_v1\([\s\S]{0,400}SELECT delivery_status[\s\S]{0,200}WHERE id = c_cancel/,
    );
  });
});
