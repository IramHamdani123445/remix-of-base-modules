// Omni-Comms Runtime — Slice 2c-iii snapshot revalidation.
//
// Slice 2c-iii NEVER re-resolves configuration. It revalidates only that the
// EXACT persisted Slice 2c-ii snapshot identifiers still point at existing,
// checksum-identical, immutable, correctly-owned rows.

import type {
  LayoutSnapshot,
  PersistedChannelResolution,
  RenderContext,
  SenderSnapshot,
  TemplateSnapshot,
} from "./renderingTypes.ts";

export interface RevalidationOutcome {
  ok: boolean;
  blockers: string[];
  template: TemplateSnapshot | null;
  layout: LayoutSnapshot | null;
  sender: SenderSnapshot | null;
}

const IMMUTABLE_TEMPLATE_STATES = new Set(["published", "approved", "retired"]);
const IMMUTABLE_LAYOUT_STATES = new Set(["published", "active", "retired"]);

export function revalidateSnapshot(
  context: RenderContext,
  resolution: PersistedChannelResolution,
): RevalidationOutcome {
  const blockers: string[] = [];

  const template = resolution.template_version_id
    ? context.template_versions.find((t) => t.id === resolution.template_version_id) ?? null
    : null;
  const layout = resolution.layout_version_id
    ? context.layout_versions.find((l) => l.id === resolution.layout_version_id) ?? null
    : null;
  const sender = resolution.sender_identity_id
    ? context.senders.find((s) => s.id === resolution.sender_identity_id) ?? null
    : null;

  // (1) referenced rows still exist
  if (resolution.template_version_id && !template) blockers.push("snapshot_row_missing");
  if (resolution.layout_version_id && !layout) blockers.push("snapshot_row_missing");
  if (resolution.sender_identity_id && !sender) blockers.push("snapshot_row_missing");

  // (2) referenced IDs match the persisted snapshot exactly
  if (template && template.id !== resolution.template_version_id) blockers.push("snapshot_row_missing");
  if (layout && layout.id !== resolution.layout_version_id) blockers.push("snapshot_row_missing");
  if (layout && resolution.layout_id && layout.layout_id !== resolution.layout_id) {
    blockers.push("snapshot_row_missing");
  }
  if (template && resolution.template_family_id && template.template_family_id !== resolution.template_family_id) {
    blockers.push("snapshot_row_missing");
  }

  // (3) checksums match
  if (template && resolution.template_version_checksum && template.checksum !== resolution.template_version_checksum) {
    blockers.push("snapshot_checksum_mismatch");
  }
  if (layout && resolution.layout_checksum && layout.checksum !== resolution.layout_checksum) {
    blockers.push("snapshot_checksum_mismatch");
  }
  for (const asset of resolution.assets ?? []) {
    const row = context.asset_versions.find((a) => a.id === asset.asset_version_id);
    if (!row) {
      blockers.push("snapshot_row_missing");
      continue;
    }
    if (row.checksum !== asset.asset_checksum) blockers.push("snapshot_checksum_mismatch");
    if (row.asset_id !== asset.asset_id) blockers.push("snapshot_row_missing");
  }

  // (4) referenced versions remain immutable
  if (template && !IMMUTABLE_TEMPLATE_STATES.has(template.status)) blockers.push("snapshot_version_mutated");
  if (layout && !IMMUTABLE_LAYOUT_STATES.has(layout.status)) blockers.push("snapshot_version_mutated");

  // (5) organisation / department ownership stays consistent
  if (sender) {
    if (sender.organization_id !== context.request.organization_id) {
      blockers.push("snapshot_ownership_mismatch");
    }
    if (
      sender.department_id !== null &&
      context.request.department_id !== null &&
      sender.department_id !== context.request.department_id
    ) {
      blockers.push("snapshot_ownership_mismatch");
    }
  }

  const unique = [...new Set(blockers)].sort();
  return { ok: unique.length === 0, blockers: unique, template, layout, sender };
}
