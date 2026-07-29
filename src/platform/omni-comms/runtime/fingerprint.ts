/**
 * Omni-Comms Slice 2b — request fingerprint.
 *
 * SHA-256(canonical UTF-8 JSON), lowercase hex.
 *
 * Correlation-ID policy: correlationId is operational tracing metadata
 * and does NOT participate in the fingerprint. Changing correlationId
 * on an otherwise-identical replay must produce the same fingerprint,
 * i.e. must safely replay the original request row.
 *
 * Uses only Web Crypto's SubtleCrypto and TextEncoder — never Node
 * Buffer or crypto module — so the same code executes deterministically
 * in browser and Node runtimes.
 */
import { canonicalJsonString, type CanonicalRequest } from './canonicalize';

function toHex(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  const chars = new Array<string>(view.length);
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    chars[i] = (b < 16 ? '0' : '') + b.toString(16);
  }
  return chars.join('');
}

export async function computeRequestFingerprint(
  canonical: CanonicalRequest,
): Promise<string> {
  const json = canonicalJsonString(canonical);
  const bytes = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}
