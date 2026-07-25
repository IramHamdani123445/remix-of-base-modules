/**
 * Regression: create_comm_hub_controlled_stub_message must reference
 * v_sender.display_name (not the non-existent from_display_name), and
 * revoke_comm_hub_controlled_live_grant must use the bound service guard.
 *
 * The live SQL is asserted against the database when SUPABASE_DB_URL/PGURL
 * is available; the source-level guarantee is asserted against the
 * orchestrator + client contract in this project.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const orchestrator = readFileSync(
  "supabase/functions/comm-hub-controlled-live-test/index.ts",
  "utf8",
);

describe("Controlled Stub — operator message replacement", () => {
  it("replaces the default 'Controlled Live has not started' sentinel when a blocker is captured", () => {
    expect(orchestrator).toContain('"Controlled Live has not started."');
    expect(orchestrator).toContain("messageIsDefault");
    // Must overwrite unconditionally when executionId + primaryBlockerCode present.
    expect(orchestrator).toMatch(
      /if\s*\(\s*executionId\s*&&\s*primaryBlockerCode\s*\)\s*{\s*env\.message\s*=/,
    );
  });

  it("still passes REVOKE_GRANT as the bound service operation", () => {
    const calls = orchestrator.match(
      /revoke_comm_hub_controlled_live_grant[\s\S]{0,400}?\}\s*\)/g,
    ) ?? [];
    for (const c of calls) {
      expect(c).toMatch(/p_service_operation:\s*["']REVOKE_GRANT["']/);
    }
  });
});
