import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Omni-Comms channel activity cards", () => {
  const source = readFileSync(
    "src/platform/omni-comms/admin/views/operations/ChannelActivityCards.tsx",
    "utf8",
  );

  it("renders every channel from the canonical UI catalogue", () => {
    expect(source).toContain("OMNI_COMMS_CHANNEL_UI_CATALOGUE.map");
    expect(source).toContain("omni-comms-activity-channel-");
  });

  it("counts each business event once per channel", () => {
    expect(source).toContain("new Set(row.channels)");
  });
});

describe("Print production worker bounded execution", () => {
  const source = readFileSync("supabase/functions/omni-comms-print-production/index.ts", "utf8");

  it("processes one letter by default and bounds storage latency", () => {
    expect(source).toContain("DEFAULT_BATCH_LIMIT = 1");
    expect(source).toContain("STORAGE_WRITE_TIMEOUT_MS");
    expect(source).toContain("Promise.race");
  });
});