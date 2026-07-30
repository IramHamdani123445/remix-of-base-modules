// Omni-Comms Runtime — Slice 2c-iii controlled rendering blockers.
//
// These are the ONLY codes the rendering package may emit. They are bounded,
// structural, and never carry payload values, PII, secrets or stack frames.

export const RENDERING_BLOCKER_CODES = {
  template_snapshot_invalid: "template_snapshot_invalid",
  layout_snapshot_invalid: "layout_snapshot_invalid",
  asset_snapshot_invalid: "asset_snapshot_invalid",
  unresolved_required_token: "unresolved_required_token",
  unresolved_required_slot: "unresolved_required_slot",
  rendered_subject_too_large: "rendered_subject_too_large",
  rendered_html_too_large: "rendered_html_too_large",
  rendered_text_too_large: "rendered_text_too_large",
  rendering_failed: "rendering_failed",
} as const;

export type RenderingBlockerCode = keyof typeof RENDERING_BLOCKER_CODES;

/** Snapshot revalidation blockers (Slice 2c-iii §3). */
export const SNAPSHOT_REVALIDATION_CODES = {
  resolution_snapshot_missing: "resolution_snapshot_missing",
  snapshot_row_missing: "snapshot_row_missing",
  snapshot_checksum_mismatch: "snapshot_checksum_mismatch",
  snapshot_version_mutated: "snapshot_version_mutated",
  snapshot_ownership_mismatch: "snapshot_ownership_mismatch",
} as const;

export type SnapshotRevalidationCode = keyof typeof SNAPSHOT_REVALIDATION_CODES;

export class RenderingError extends Error {
  readonly code: RenderingBlockerCode | SnapshotRevalidationCode;

  constructor(code: RenderingBlockerCode | SnapshotRevalidationCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "RenderingError";
    this.code = code;
  }
}

export function isRenderingBlockerCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(RENDERING_BLOCKER_CODES, value);
}

export function isSnapshotRevalidationCode(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(SNAPSHOT_REVALIDATION_CODES, value);
}
