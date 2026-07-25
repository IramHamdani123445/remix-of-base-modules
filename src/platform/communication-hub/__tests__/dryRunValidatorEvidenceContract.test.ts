/**
 * Regression contract for validate_comm_hub_dry_run_certification.
 *
 * The Dry Run architecture writes a certified request+message+trace but
 * NEVER creates a delivery attempt or invokes a provider. The validator
 * must therefore:
 *   - NOT require communication_delivery_attempt_id
 *   - Require request/message/trace and validate message linkage/context
 *   - Reject any provider or delivery attempt evidence
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function latestValidatorMigration(): string {
  const dir = "supabase/migrations";
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (let i = files.length - 1; i >= 0; i--) {
    const body = readFileSync(join(dir, files[i]), "utf8");
    if (body.includes("FUNCTION public.validate_comm_hub_dry_run_certification")) {
      return body;
    }
  }
  throw new Error("validator migration not found");
}

const sql = latestValidatorMigration();

describe("validate_comm_hub_dry_run_certification evidence contract", () => {
  it("no longer requires communication_delivery_attempt_id", () => {
    expect(sql).not.toMatch(
      /communication_delivery_attempt_id IS NULL[\s\S]{0,120}dry_run_evidence_incomplete/,
    );
  });

  it("requires request_id, message_id and trace_id", () => {
    expect(sql).toMatch(/communication_request_id IS NULL/);
    expect(sql).toMatch(/communication_message_id IS NULL/);
    expect(sql).toMatch(/trace_id IS NULL/);
    expect(sql).toContain("dry_run_evidence_incomplete");
  });

  it("emits dry_run_message_linkage_invalid on request/message mismatch", () => {
    expect(sql).toContain("dry_run_message_linkage_invalid");
    expect(sql).toMatch(/request_id IS DISTINCT FROM v_cert\.communication_request_id/);
  });

  it("requires certified message send_context = 'dry_run'", () => {
    expect(sql).toMatch(/send_context,''\)\s*<>\s*'dry_run'/);
  });

  it("blocks when provider_call_attempted or delivery attempts exist", () => {
    expect(sql).toContain("dry_run_provider_attempt_detected");
    expect(sql).toMatch(/provider_call_attempted, false\)/);
    expect(sql).toMatch(/FROM public\.communication_delivery_attempt\s+WHERE message_id/);
  });

  it("does not synthesize or backfill a delivery attempt", () => {
    expect(sql).not.toMatch(/INSERT INTO public\.communication_delivery_attempt/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.communication_dry_run_certification[\s\S]{0,200}communication_delivery_attempt_id/i);
  });
});
