// Omni-Comms Runtime — Slice 2c-iii slot rendering.
//
// Slots are filled EXCLUSIVELY from the persisted asset-version manifest of
// the Slice 2c-ii snapshot. No current-configuration lookup occurs here.

import { RenderingError } from "./renderingErrors.ts";
import type { LayoutSlotDefinition, LayoutSnapshot } from "./renderingTypes.ts";

export interface SlotRenderInput {
  layout: LayoutSnapshot;
  /** Persisted asset entries from the resolution snapshot. */
  assets: Array<{
    slot: string;
    required: boolean;
    asset_version_id: string;
    asset_checksum: string;
    asset_type: string;
  }>;
}

export interface SlotRenderResult {
  /** Slot code → rendered slot marker (deterministic, content-free). */
  slotValues: Record<string, string>;
  /** Sorted, deduplicated required slots with no persisted asset. */
  unresolvedRequiredSlots: string[];
  /** Stable slot order used for rendering. */
  slotOrder: string[];
}

/** Parse and validate the layout slot schema. Structural failure blocks. */
export function parseLayoutSlots(layout: LayoutSnapshot): LayoutSlotDefinition[] {
  const raw = layout.slots;
  if (!Array.isArray(raw)) throw new RenderingError("layout_snapshot_invalid", "slots must be an array");

  const defs: LayoutSlotDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RenderingError("layout_snapshot_invalid", "slot entry must be an object");
    }
    const e = entry as Record<string, unknown>;
    const code = typeof e.code === "string" ? e.code : typeof e.slot_code === "string" ? e.slot_code : null;
    if (!code) throw new RenderingError("layout_snapshot_invalid", "slot code missing");
    if (seen.has(code)) throw new RenderingError("layout_snapshot_invalid", "duplicate slot code");
    seen.add(code);
    const orderRaw = typeof e.order === "number"
      ? e.order
      : typeof e.slot_order === "number"
        ? e.slot_order
        : defs.length;
    defs.push({
      code,
      order: orderRaw,
      required: e.required === true || e.is_required === true,
    });
  }

  // Stable order: declared order, then code — never insertion-dependent.
  return defs.sort((a, b) => (a.order - b.order) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export function renderSlots(input: SlotRenderInput): SlotRenderResult {
  const defs = parseLayoutSlots(input.layout);

  const bySlot = new Map<string, SlotRenderInput["assets"][number]>();
  for (const asset of input.assets) {
    if (!asset || typeof asset.slot !== "string" || typeof asset.asset_version_id !== "string") {
      throw new RenderingError("asset_snapshot_invalid", "asset entry malformed");
    }
    // Deterministic collision policy: lowest asset_version_id wins.
    const existing = bySlot.get(asset.slot);
    if (!existing || asset.asset_version_id < existing.asset_version_id) {
      bySlot.set(asset.slot, asset);
    }
  }

  const slotValues: Record<string, string> = {};
  const unresolvedRequired: string[] = [];

  for (const def of defs) {
    const asset = bySlot.get(def.code);
    if (!asset) {
      if (def.required) unresolvedRequired.push(def.code);
      slotValues[def.code] = "";
      continue;
    }
    slotValues[def.code] =
      `<!--omni-comms:slot ${def.code} ${asset.asset_type} ${asset.asset_version_id}-->`;
  }

  return {
    slotValues,
    unresolvedRequiredSlots: [...new Set(unresolvedRequired)].sort(),
    slotOrder: defs.map((d) => d.code),
  };
}
