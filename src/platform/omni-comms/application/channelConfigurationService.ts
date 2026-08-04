/**
 * Omni-Comms CG1 — bounded application service that composes the EXISTING
 * generic summary RPCs into one channel-aware configuration projection.
 *
 * Boundaries (permanent):
 *   - No new RPC, no new table, no migration. Only the bounded SECURITY
 *     DEFINER summaries already shipped in C2–C5 are called.
 *   - Release Control summary/mutation contracts are Email-only and are NEVER
 *     invoked from here.
 *   - No provider SDK, no sending facade, no dispatch, no delivery claim.
 *   - A resource that is not part of the approved workflow for the channel is
 *     never requested from the server.
 */
import type { OmniCommsRpcClient } from './omniCommsRpcErrors';
import {
  OMNI_COMMS_CHANNEL_RESOURCES,
  channelCapability,
  type OmniCommsChannel,
  type OmniCommsChannelResource,
} from '@/platform/omni-comms/domain/channelCatalogue';
import { getChannelProviderAdminSummary } from './channelProviderAdminService';
import { getChannelProviderAccountSummary } from './channelProviderAccountService';
import { getChannelIdentitySummary } from './channelIdentityService';
import { getChannelEndpointSummary } from './channelEndpointService';
import { getChannelBindingSummary } from './channelBindingService';
import { getChannelPolicySummary } from './channelPolicyService';
import { identityChannelSupported } from './channelIdentityTypes';
import { endpointChannelSupported } from './channelEndpointTypes';
import type {
  ChannelConfigurationSummary,
  ChannelResourceSummary,
} from './channelConfigurationTypes';

const ACTIVE = 'active';

function counted(
  resource: OmniCommsChannelResource,
  rows: readonly { status?: string | null }[],
): ChannelResourceSummary {
  const total = rows.length;
  const active = rows.filter((r) => r.status === ACTIVE).length;
  return {
    resource,
    state: 'ready',
    total,
    active,
    message:
      total === 0
        ? 'No genuine records are configured for this scope.'
        : `${total} configured · ${active} active.`,
  };
}

function unavailable(
  resource: OmniCommsChannelResource,
  error: unknown,
): ChannelResourceSummary {
  const detail = error instanceof Error ? error.message : 'Unknown error';
  return {
    resource,
    state: 'unavailable',
    total: null,
    active: null,
    message: `This resource could not be read. ${detail}`,
  };
}

function notApplicable(
  channel: OmniCommsChannel,
  resource: OmniCommsChannelResource,
): ChannelResourceSummary {
  return {
    resource,
    state: 'not_applicable',
    total: null,
    active: null,
    message: channelCapability(channel, resource).reason,
  };
}

export interface LoadChannelConfigurationSummaryInput {
  readonly organizationId: string;
  readonly departmentId: string | null;
  readonly channel: OmniCommsChannel;
  /** Restrict the load to a subset of resources (e.g. catalogue counts). */
  readonly resources?: readonly OmniCommsChannelResource[];
}

/**
 * Compose the generic per-resource summaries for one channel.
 *
 * Every applicable resource is fetched independently: a single failing read is
 * reported as `unavailable` for that resource instead of collapsing the whole
 * workspace or silently reporting zero.
 */
export async function loadChannelConfigurationSummary(
  client: OmniCommsRpcClient,
  input: LoadChannelConfigurationSummaryInput,
): Promise<ChannelConfigurationSummary> {
  const { organizationId, departmentId, channel } = input;
  const wanted = new Set<OmniCommsChannelResource>(
    input.resources ?? OMNI_COMMS_CHANNEL_RESOURCES,
  );

  const resources = {} as Record<OmniCommsChannelResource, ChannelResourceSummary>;
  const jobs: Promise<void>[] = [];

  const run = (
    resource: OmniCommsChannelResource,
    load: () => Promise<ChannelResourceSummary>,
  ) => {
    jobs.push(
      load()
        .then((r) => {
          resources[resource] = r;
        })
        .catch((e) => {
          resources[resource] = unavailable(resource, e);
        }),
    );
  };

  for (const resource of OMNI_COMMS_CHANNEL_RESOURCES) {
    const capability = channelCapability(channel, resource);
    if (!capability.uiApplicable || !wanted.has(resource)) {
      resources[resource] = notApplicable(channel, resource);
      continue;
    }

    switch (resource) {
      case 'providers':
        run(resource, async () =>
          counted(
            resource,
            (await getChannelProviderAdminSummary(client, channel)).providers,
          ),
        );
        break;
      case 'accounts':
        run(resource, async () =>
          counted(
            resource,
            (await getChannelProviderAccountSummary(client, organizationId, channel))
              .accounts,
          ),
        );
        break;
      case 'identities':
        if (!identityChannelSupported(channel)) {
          resources[resource] = notApplicable(channel, resource);
          break;
        }
        run(resource, async () =>
          counted(
            resource,
            (
              await getChannelIdentitySummary(
                client,
                organizationId,
                channel,
                departmentId,
              )
            ).identities,
          ),
        );
        break;
      case 'endpoints':
        if (!endpointChannelSupported(channel)) {
          resources[resource] = notApplicable(channel, resource);
          break;
        }
        run(resource, async () =>
          counted(
            resource,
            (
              await getChannelEndpointSummary(
                client,
                organizationId,
                channel,
                departmentId,
              )
            ).endpoints,
          ),
        );
        break;
      case 'bindings':
        if (!identityChannelSupported(channel)) {
          resources[resource] = notApplicable(channel, resource);
          break;
        }
        run(resource, async () =>
          counted(
            resource,
            (
              await getChannelBindingSummary(
                client,
                organizationId,
                channel,
                departmentId,
              )
            ).bindings,
          ),
        );
        break;
      case 'policies':
        if (!isPolicyChannel(channel)) {
          resources[resource] = notApplicable(channel, resource);
          break;
        }
        run(resource, async () => {
          const policy = await getChannelPolicySummary(client, {
            organizationId,
            departmentId,
            channel,
            includeReference: false,
          });
          const configured = policy.effective_policy ? 1 : 0;
          return {
            resource,
            state: 'ready',
            total: configured,
            active: configured,
            message: policy.effective_policy
              ? `Effective policy resolved from ${policy.effective_source}.`
              : 'No genuine channel policy is configured for this scope.',
          };
        });
        break;
      // Release Control is an Email-only governance contract and is never
      // summarised here. Test Centre and Diagnostics own their own reads.
      case 'release-control':
      case 'test-centre':
      case 'diagnostics':
      default:
        resources[resource] = {
          resource,
          state: 'not_applicable',
          total: null,
          active: null,
          message:
            'This surface owns its own bounded read and is not summarised here.',
        };
        break;
    }
  }

  await Promise.all(jobs);

  const unavailableResources = OMNI_COMMS_CHANNEL_RESOURCES.filter(
    (r) => resources[r].state === 'unavailable',
  );

  return {
    channel,
    organizationId,
    departmentId,
    resources,
    loading: false,
    unavailableResources,
    generatedAt: new Date().toISOString(),
  };
}

/** Resources shown as counts on the channel catalogue cards. */
export const CHANNEL_CATALOGUE_COUNT_RESOURCES: readonly OmniCommsChannelResource[] =
  ['accounts', 'identities'];

/**
 * Genuine catalogue counts for every channel whose workflow exposes them.
 * Channels with no applicable resource are not queried at all.
 */
export async function loadChannelCatalogueCounts(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId: string | null },
  channels: readonly OmniCommsChannel[],
): Promise<Record<string, ChannelConfigurationSummary>> {
  const entries = await Promise.all(
    channels.map(async (channel) => [
      channel,
      await loadChannelConfigurationSummary(client, {
        organizationId: input.organizationId,
        departmentId: input.departmentId,
        channel,
        resources: CHANNEL_CATALOGUE_COUNT_RESOURCES,
      }),
    ] as const),
  );
  return Object.fromEntries(entries);
}
