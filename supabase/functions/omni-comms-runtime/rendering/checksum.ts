// Omni-Comms Runtime — Slice 2c-iii deterministic checksum utilities.
//
// No clock reads, no randomness, no network, no provider SDK.

/** Stable, deterministic JSON serialization: object keys sorted, arrays kept. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = sortValue(src[key]);
  return out;
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface RenderChecksumInput {
  templateVersionId: string | null;
  templateChecksum: string | null;
  layoutVersionId: string | null;
  layoutChecksum: string | null;
  assets: Array<{ assetVersionId: string; checksum: string }>;
  senderIdentityId: string | null;
  renderedSubject: string | null;
  renderedHtml: string | null;
  renderedText: string | null;
}

/**
 * Exact render checksum contract:
 *   sha256:<lowercase hex of SHA-256 over the canonical JSON below>
 * Asset entries are ordered by assetVersionId so the ordering is stable and
 * independent of resolution order.
 */
export async function computeRenderChecksum(input: RenderChecksumInput): Promise<string> {
  const assets = [...input.assets]
    .map((a) => ({ assetVersionId: a.assetVersionId, checksum: a.checksum }))
    .sort((a, b) => (a.assetVersionId < b.assetVersionId ? -1 : a.assetVersionId > b.assetVersionId ? 1 : 0));

  const material = canonicalJson({
    assets,
    layoutChecksum: input.layoutChecksum,
    layoutVersionId: input.layoutVersionId,
    renderedHtml: input.renderedHtml,
    renderedSubject: input.renderedSubject,
    renderedText: input.renderedText,
    senderIdentityId: input.senderIdentityId,
    templateChecksum: input.templateChecksum,
    templateVersionId: input.templateVersionId,
  });

  return `sha256:${await sha256Hex(material)}`;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
