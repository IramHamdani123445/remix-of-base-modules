// Asset resolution for layout slots. department → organization; unresolved.
import type { AggregateSnapshot, ResolvedAsset } from "./resolutionTypes.ts";
import type { ResolvedLayout } from "./layoutResolver.ts";

export interface AssetResolutionResult {
  assets: ResolvedAsset[];
  blockers: string[];
}

interface Slot {
  code: string;
  required?: boolean;
  asset_type?: string;
  kind?: string; // "content" slots don't require assets
}

export function resolveAssetsForLayout(
  snap: AggregateSnapshot,
  layout: ResolvedLayout,
  channel: string,
  organizationId: string,
  departmentId: string | null,
): AssetResolutionResult {
  const rawSlots = Array.isArray(layout.slots) ? (layout.slots as Slot[]) : [];
  const assets: ResolvedAsset[] = [];
  const blockers: string[] = [];

  // A slot holds rendered content — not a branding asset — when it declares
  // kind = "content" or uses a reserved `content` / `content_*` slot code.
  const isContentSlot = (s: Slot) =>
    s.kind === "content" || s.code === "content" || s.code.startsWith("content_");
  const nonContent = rawSlots.filter((s) => s && s.code && !isContentSlot(s));
  const ordered = [...nonContent].sort((a, b) => (a.code < b.code ? -1 : 1));

  for (const slot of ordered) {
    const candidates = snap.asset_assignments.filter(
      (a) =>
        a.slot_code === slot.code &&
        a.organization_id === organizationId &&
        (a.output_channel === null || a.output_channel === channel) &&
        (a.department_id === null || a.department_id === departmentId),
    );
    const dept = candidates.find((a) => a.department_id === departmentId && departmentId !== null);
    const org = candidates.find((a) => a.department_id === null);
    const winner = dept ?? org;
    if (!winner) {
      if (slot.required !== false) blockers.push("asset_slot_unresolved");
      continue;
    }
    const asset = snap.assets.find(
      (a) => a.id === winner.asset_id && a.organization_id === organizationId && a.status === "active",
    );
    if (!asset || !asset.active_version_id) {
      blockers.push("asset_slot_unresolved");
      continue;
    }
    if (slot.asset_type && asset.asset_type !== slot.asset_type) {
      blockers.push("asset_type_mismatch");
      continue;
    }
    const version = snap.asset_versions.find(
      (v) => v.id === asset.active_version_id && v.status === "published",
    );
    if (!version || !version.checksum) {
      blockers.push("asset_version_unresolved");
      continue;
    }
    assets.push({
      slot: slot.code,
      required: slot.required !== false,
      assetId: asset.id,
      assetVersionId: version.id,
      assetType: asset.asset_type,
      assetChecksum: version.checksum,
      inheritanceSource: dept ? "department" : "organization",
    });
  }
  return { assets, blockers };
}
