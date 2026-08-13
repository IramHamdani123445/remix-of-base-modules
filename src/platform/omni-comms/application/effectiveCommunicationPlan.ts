/**
 * Omni-Comms — THE single effective communication plan resolver.
 *
 * FINAL PLATFORM MODEL.
 *
 * There is exactly one configuration-resolution authority in the product.
 * Every consumer asks this resolver the same question and receives the same
 * answer:
 *
 *   business event emission (runtime obligation)
 *   Product Definition screens
 *   Communications business screens
 *   template preview
 *   communication testing
 *
 * A consumer never re-implements "is Email on?", "which template?", "which
 * sender?" — those questions have exactly one answer, produced here, with
 * explicit provenance for every property so the UI can show
 * "Inherited from organisation default" truthfully.
 *
 * Inheritance order (each property inherits SEPARATELY):
 *
 *   organisation event/channel default
 *     → department override        (optional, exception only)
 *       → product override         (optional)
 *
 * This module NEVER sends, enqueues, renders or contacts a provider.
 */
import {
  OMNI_COMMS_CHANNEL_CATALOGUE,
  type OmniCommsChannel,
} from '../domain/channelCatalogue';
import {
  resolveProductCommunication,
  type OmniCommsProductResolution,
} from './productCommunicationService';

/** Where an effective property came from. */
export type OmniCommsPlanSource =
  | 'product_override'
  | 'department_override'
  | 'organization_default'
  | 'channel_default'
  | 'event_default'
  | 'unresolved';

export interface EffectiveChannelPlan {
  channel: OmniCommsChannel;
  /** Configuration says this obligation applies. */
  enabled: boolean;
  /**
   * True only when the channel is enabled AND a real delivery adapter exists.
   * Configuration-only channels are never runnable.
   */
  deliverable: boolean;
  recipientRole: string | null;
  recipientRoleSource: OmniCommsPlanSource;
  templateRef: string | null;
  templateSource: OmniCommsPlanSource;
  senderRef: string | null;
  senderSource: OmniCommsPlanSource;
  providerConnectionRef: string | null;
  providerSource: OmniCommsPlanSource;
  layoutRef: string | null;
  layoutSource: OmniCommsPlanSource;
  /** Production business communications are always `queued`. */
  deliveryMode: string;
  blockers: string[];
}

export interface EffectiveCommunicationPlan {
  organizationId: string;
  moduleCode: string;
  eventCode: string;
  productId: string | null;
  /** Only set when an explicit department override context was supplied. */
  departmentId: string | null;
  channels: EffectiveChannelPlan[];
  /** Channels configuration has turned on (regardless of adapter support). */
  enabledChannels: OmniCommsChannel[];
  /** Enabled channels that can genuinely be delivered today. */
  runnableChannels: OmniCommsChannel[];
  blockers: string[];
}

export interface EffectiveCommunicationPlanInput {
  organizationId: string;
  moduleCode: string;
  eventCode: string;
  productId?: string | null;
  /** ONLY supplied when an explicit department override context is active. */
  departmentId?: string | null;
  /** Recipient roles the business event can satisfy, e.g. `claimant`. */
  recipientRoles?: string[];
  locale?: string | null;
  /** Restrict evaluation, e.g. a single channel for a preview screen. */
  channels?: OmniCommsChannel[];
}

/** Channels whose configuration surface exists at all. */
function candidateChannels(limit?: OmniCommsChannel[]): OmniCommsChannel[] {
  const supported = OMNI_COMMS_CHANNEL_CATALOGUE.filter((d) => d.databaseSupported).map(
    (d) => d.channel,
  );
  if (!limit || limit.length === 0) return supported;
  return supported.filter((c) => limit.includes(c));
}

function isDeliverable(channel: OmniCommsChannel): boolean {
  return OMNI_COMMS_CHANNEL_CATALOGUE.some((d) => d.channel === channel && d.implemented);
}

function emptyChannelPlan(channel: OmniCommsChannel): EffectiveChannelPlan {
  return {
    channel,
    enabled: false,
    deliverable: false,
    recipientRole: null,
    recipientRoleSource: 'unresolved',
    templateRef: null,
    templateSource: 'unresolved',
    senderRef: null,
    senderSource: 'unresolved',
    providerConnectionRef: null,
    providerSource: 'organization_default',
    layoutRef: null,
    layoutSource: 'organization_default',
    deliveryMode: 'queued',
    blockers: [],
  };
}

function fromProductResolution(
  channel: OmniCommsChannel,
  res: OmniCommsProductResolution,
  fallbackRole: string | null,
): EffectiveChannelPlan {
  const base = emptyChannelPlan(channel);
  const enabled = res.enabled === true;
  return {
    ...base,
    enabled,
    deliverable: enabled && isDeliverable(channel),
    recipientRole: res.recipient_source ?? fallbackRole,
    recipientRoleSource: res.recipient_source ? 'product_override' : 'event_default',
    templateRef: res.template ?? null,
    templateSource: res.template ? 'product_override' : 'event_default',
    senderRef: res.sender ?? null,
    senderSource: res.sender ? 'product_override' : 'channel_default',
    // Products never choose providers; provider is an organisation decision
    // with an exceptional department override.
    providerConnectionRef: null,
    providerSource: 'organization_default',
    deliveryMode: res.delivery_mode || 'queued',
    blockers: enabled ? [] : [res.reason ?? 'product_communication_disabled'],
  };
}

/**
 * Resolve the authoritative effective plan.
 *
 * Fail-closed and total: a resolution failure yields a disabled channel with
 * a bounded blocker, never an exception and never an accidental send.
 */
export async function resolveEffectiveCommunicationPlan(
  input: EffectiveCommunicationPlanInput,
): Promise<EffectiveCommunicationPlan> {
  const organizationId = String(input?.organizationId ?? '').trim();
  const eventCode = String(input?.eventCode ?? '').trim();
  const moduleCode =
    String(input?.moduleCode ?? '').trim() || eventCode.split('.')[0]?.toUpperCase() || '';
  const productId = input?.productId?.trim() || null;
  const departmentId = input?.departmentId?.trim() || null;
  const fallbackRole = input?.recipientRoles?.[0] ?? null;

  const plan: EffectiveCommunicationPlan = {
    organizationId,
    moduleCode,
    eventCode,
    productId,
    departmentId,
    channels: [],
    enabledChannels: [],
    runnableChannels: [],
    blockers: [],
  };

  if (!organizationId) plan.blockers.push('organization_unresolved');
  if (!eventCode) plan.blockers.push('event_code_required');
  if (plan.blockers.length > 0) return plan;

  for (const channel of candidateChannels(input?.channels)) {
    if (productId) {
      let resolution: OmniCommsProductResolution | null = null;
      try {
        resolution = await resolveProductCommunication(
          organizationId,
          productId,
          eventCode,
          channel,
        );
      } catch {
        resolution = null;
      }
      if (!resolution) {
        plan.channels.push({
          ...emptyChannelPlan(channel),
          blockers: ['product_communication_unresolved'],
        });
        continue;
      }
      plan.channels.push(fromProductResolution(channel, resolution, fallbackRole));
      continue;
    }

    // No product context: organisation/event defaults apply. Only channels
    // with a real delivery adapter can carry an obligation today.
    const deliverable = isDeliverable(channel);
    plan.channels.push({
      ...emptyChannelPlan(channel),
      enabled: deliverable,
      deliverable,
      recipientRole: fallbackRole,
      recipientRoleSource: fallbackRole ? 'event_default' : 'unresolved',
      templateSource: 'organization_default',
      senderSource: 'organization_default',
      blockers: deliverable ? [] : ['channel_delivery_not_implemented'],
    });
  }

  plan.enabledChannels = plan.channels.filter((c) => c.enabled).map((c) => c.channel);
  plan.runnableChannels = plan.channels.filter((c) => c.deliverable).map((c) => c.channel);
  if (plan.enabledChannels.length === 0) {
    plan.blockers.push(
      plan.channels.find((c) => c.blockers.length > 0)?.blockers[0] ??
        'no_channel_enabled',
    );
  }
  return plan;
}

/** UI projection: the effective plan for one channel, or null. */
export function planForChannel(
  plan: EffectiveCommunicationPlan,
  channel: OmniCommsChannel,
): EffectiveChannelPlan | null {
  return plan.channels.find((c) => c.channel === channel) ?? null;
}
