/**
 * Omni-Comms CG1 — generic channel configuration summary DTOs.
 *
 * A provider-independent, channel-aware projection composed from the EXISTING
 * bounded summary RPCs. No new table, no new RPC, no migration.
 *
 * Truthfulness rules (permanent):
 *   - An unloaded or failed resource is NEVER represented as zero. It carries
 *     an explicit `loading` or `unavailable` state and null counts.
 *   - A resource that is not part of the approved workflow for the channel is
 *     `not_applicable`, with the canonical capability reason.
 */
import type {
  OmniCommsChannel,
  OmniCommsChannelResource,
} from '@/platform/omni-comms/domain/channelCatalogue';

export type ChannelResourceState =
  | 'loading'
  | 'ready'
  | 'unavailable'
  | 'not_applicable';

export interface ChannelResourceSummary {
  readonly resource: OmniCommsChannelResource;
  readonly state: ChannelResourceState;
  /** Genuine (non reference) record count. Null unless `state === 'ready'`. */
  readonly total: number | null;
  /** Genuine active record count. Null unless `state === 'ready'`. */
  readonly active: number | null;
  /** Truthful operator-facing explanation for the current state. */
  readonly message: string;
}

export type ChannelResourceSummaryMap = Readonly<
  Record<OmniCommsChannelResource, ChannelResourceSummary>
>;

export interface ChannelConfigurationSummary {
  readonly channel: OmniCommsChannel;
  readonly organizationId: string;
  readonly departmentId: string | null;
  readonly resources: ChannelResourceSummaryMap;
  /** True while at least one applicable resource is still loading. */
  readonly loading: boolean;
  /** Resources that could not be read. */
  readonly unavailableResources: readonly OmniCommsChannelResource[];
  readonly generatedAt: string;
}

/** Display helper — never renders an unloaded count as zero. */
export function formatResourceCount(
  summary: ChannelResourceSummary | undefined,
  which: 'total' | 'active' = 'total',
): string {
  if (!summary) return 'Unknown';
  if (summary.state === 'loading') return 'Loading…';
  if (summary.state === 'unavailable') return 'Unavailable';
  if (summary.state === 'not_applicable') return 'Not applicable';
  const value = which === 'total' ? summary.total : summary.active;
  return value === null ? 'Unknown' : String(value);
}
