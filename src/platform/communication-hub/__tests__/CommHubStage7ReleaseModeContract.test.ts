/**
 * Stage 7/8 release-mode contract guardrail.
 *
 * Enforces that no browser source calls the overloaded legacy
 * `set_communication_operating_mode` RPC. Stage 7 (Manual Production)
 * and Stage 8 (Automated Production) must only use the canonical
 * `apply_communication_release_mode` RPC to avoid PostgREST overload
 * resolution failures.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) acc.push(full);
  }
  return acc;
}

describe("Stage 7/8 release-mode RPC contract", () => {
  const files = walk(SRC).filter(
    (f) =>
      !f.includes("integrations/supabase/types.ts") &&
      !f.includes("__tests__") &&
      !f.endsWith("globalSettingsService.ts") // has one comment-only reference
  );

  it("no browser source calls the overloaded legacy set_communication_operating_mode RPC", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Only flag actual RPC invocations, not comments.
      if (/rpc\(\s*["']set_communication_operating_mode["']/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("Stage 7 Manual Production panel invokes apply_communication_release_mode", () => {
    const src = readFileSync(
      join(SRC, "pages/admin/communicationHub/goLive/ManualProductionActivationPanel.tsx"),
      "utf8"
    );
    expect(src).toMatch(/applyReleaseMode\s*\(/);
    expect(src).toMatch(/newMode:\s*"MANUAL_PRODUCTION"/);
    expect(src).toMatch(/expectedVersion:/);
    expect(src).not.toMatch(/rpc\(\s*["']set_communication_operating_mode["']/);
  });

  it("Stage 8 Automated Production panel invokes apply_communication_release_mode", () => {
    const src = readFileSync(
      join(SRC, "pages/admin/communicationHub/goLive/AutomatedProductionActivationPanel.tsx"),
      "utf8"
    );
    expect(src).toMatch(/applyReleaseMode\s*\(/);
    expect(src).toMatch(/newMode:\s*"AUTOMATED_PRODUCTION"/);
    expect(src).toMatch(/expectedVersion:/);
    expect(src).not.toMatch(/rpc\(\s*["']set_communication_operating_mode["']\s*,[^)]*AUTOMATED/);
  });

  it("globalSettingsService.setOperatingMode uses apply_communication_release_mode", () => {
    const src = readFileSync(
      join(SRC, "platform/communication-hub/globalSettingsService.ts"),
      "utf8"
    );
    expect(src).toMatch(/rpc[^(]*\(\s*[\s\S]{0,80}?["']apply_communication_release_mode["']/);
    expect(src).not.toMatch(/rpc\(\s*["']set_communication_operating_mode["']/);
  });
});
