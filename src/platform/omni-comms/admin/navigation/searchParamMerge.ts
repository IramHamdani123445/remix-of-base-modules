/**
 * Omni-Comms UI Phase 1 — safe query-parameter merge helpers.
 *
 * Every Omni-Comms navigation destination is expressed as a *relative href*
 * (`/admin/omnichannel-communications/channels?tab=identities`). Naively
 * navigating to such an href discards the operator's current working scope
 * (`?org=`, `?department=`, `?channel=`), which silently resets the workspace.
 *
 * These helpers are pure string/URLSearchParams utilities:
 *   - no React, no router, no RPC, no side effects;
 *   - explicit values in the target href always win over preserved ones;
 *   - unknown parameters are never invented and never dropped silently unless
 *     they are outside the declared preserve list.
 */

/**
 * Scope parameters that describe *where the operator is working*, as opposed
 * to *what they are looking at*. These are carried across module-local
 * navigation; everything else is destination-specific and is not carried.
 */
export const OMNI_COMMS_SCOPE_PARAMS = [
  'org',
  'organization',
  'organisation',
  'department',
  'dept',
  'channel',
] as const;

export type OmniCommsScopeParam = (typeof OMNI_COMMS_SCOPE_PARAMS)[number];

/** Normalise any accepted "current search" shape into URLSearchParams. */
export function toSearchParams(
  search: string | URLSearchParams | null | undefined,
): URLSearchParams {
  if (!search) return new URLSearchParams();
  if (search instanceof URLSearchParams) return new URLSearchParams(search);
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

/**
 * Merge a partial change-set into the current parameters without disturbing
 * any other parameter. A `null` value deletes the key.
 */
export function mergeSearchParams(
  current: string | URLSearchParams | null | undefined,
  changes: Readonly<Record<string, string | null>>,
): URLSearchParams {
  const params = toSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

export interface MergeHrefOptions {
  /** Parameter names carried over when absent from the target href. */
  readonly preserve?: readonly string[];
}

/**
 * Build a navigable href that keeps the operator's current scope.
 *
 * @param href     Target path, optionally with its own query string.
 * @param current  The current `location.search` (or URLSearchParams).
 */
export function mergeOmniCommsHref(
  href: string,
  current: string | URLSearchParams | null | undefined,
  options: MergeHrefOptions = {},
): string {
  const preserve = options.preserve ?? OMNI_COMMS_SCOPE_PARAMS;
  const hashIndex = href.indexOf('#');
  const hash = hashIndex >= 0 ? href.slice(hashIndex) : '';
  const withoutHash = hashIndex >= 0 ? href.slice(0, hashIndex) : href;

  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  const target = new URLSearchParams(
    queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : '',
  );

  const currentParams = toSearchParams(current);
  for (const key of preserve) {
    // Explicit values in the target href are authoritative.
    if (target.has(key)) continue;
    const value = currentParams.get(key);
    if (value !== null && value !== '') target.set(key, value);
  }

  const query = target.toString();
  return `${path}${query ? `?${query}` : ''}${hash}`;
}
