/**
 * Channel normalisation — the single vocabulary for "which channel is this?".
 *
 * Three vocabularies exist in live data and none of them match:
 *
 *   intake / ApplicationChannel        PUBLIC_ONLINE, STAFF_OFFLINE, ASSISTED_COUNTER,
 *                                      BACK_OFFICE_ENTRY, MIGRATED_LEGACY
 *   bn_product_channel_config          OFFLINE, ONLINE
 *   bn_product_version_workflow        ONLINE_PORTAL
 *   bn_workflow_template.channel_code  always null
 *
 * So `resolveProductWorkflow(versionId, 'STAFF_OFFLINE')` could never match a
 * channel-specific mapping: no row anywhere carries that spelling. Every
 * comparison of a channel must go through `normalizeChannelCode` — the defect
 * exists precisely because the same idea was spelled three ways in three
 * places, and a fourth spelling at a new call site would repeat it.
 */

/** The only two channel values the platform routes on. */
export type NormalizedChannel = 'ONLINE' | 'OFFLINE';

/**
 * Derived from the values actually present in the database and in the intake
 * code — deliberately not an invented vocabulary.
 */
const CHANNEL_ALIASES: Record<string, NormalizedChannel> = {
  // Offline / staff-mediated
  OFFLINE: 'OFFLINE',
  STAFF_OFFLINE: 'OFFLINE',
  STAFF_ASSISTED: 'OFFLINE',
  ASSISTED_COUNTER: 'OFFLINE',
  COUNTER: 'OFFLINE',
  WALK_IN: 'OFFLINE',
  BACK_OFFICE_ENTRY: 'OFFLINE',
  MIGRATED_LEGACY: 'OFFLINE',

  // Online / self-service
  ONLINE: 'ONLINE',
  ONLINE_PORTAL: 'ONLINE',
  PORTAL: 'ONLINE',
  SELF_SERVICE: 'ONLINE',
  PUBLIC_ONLINE: 'ONLINE',
};

/**
 * Normalise any channel spelling to ONLINE / OFFLINE.
 * Returns null for an unknown value — the caller must then report the gap
 * rather than guess a channel.
 */
export function normalizeChannelCode(
  channel: string | null | undefined,
): NormalizedChannel | null {
  const raw = String(channel ?? '')
    .trim()
    .toUpperCase()
    .replace(/[-\s.]/g, '_');
  if (!raw) return null;
  return CHANNEL_ALIASES[raw] ?? null;
}

/** True when two channel spellings mean the same channel. */
export function channelsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeChannelCode(a);
  const nb = normalizeChannelCode(b);
  return na !== null && na === nb;
}

/** Every spelling the normaliser knows — used by tests and diagnostics. */
export function knownChannelAliases(): string[] {
  return Object.keys(CHANNEL_ALIASES).sort();
}
