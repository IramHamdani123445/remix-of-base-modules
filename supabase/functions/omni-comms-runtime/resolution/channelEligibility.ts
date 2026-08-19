// Combines destination availability, channel settings, template/layout/asset,
// and sender readiness into a per-recipient/per-channel ChannelResolution.
import type {
  AggregateSnapshot,
  ChannelResolution,
  NormalizedRecipient,
} from "./resolutionTypes.ts";
import type { WinningRoute } from "./routeResolver.ts";
import { resolveTemplateForRoute } from "./templateResolver.ts";
import { resolveLayoutForTemplate } from "./layoutResolver.ts";
import { resolveAssetsForLayout } from "./assetResolver.ts";
import { resolveSenderForRoute } from "./senderResolver.ts";
import {
  channelKind,
  destinationKeyFor,
  requiresSenderIdentity,
} from "./channelKind.ts";
import {
  resolvePushRegistrations,
  resolveVoiceOriginatingIdentity,
  resolveWebhookSubscription,
} from "./channelKindResolvers.ts";

export function evaluateChannel(
  snap: AggregateSnapshot,
  route: WinningRoute,
  recipient: NormalizedRecipient,
  eventDefinitionId: string,
  organizationId: string,
  departmentId: string | null,
): ChannelResolution {
  const blockers: string[] = [];
  const channel = route.channel;

  // Channel setting.
  const settings = snap.channel_settings.filter(
    (cs) =>
      cs.channel === channel &&
      cs.organization_id === organizationId &&
      (cs.department_id === null || cs.department_id === departmentId),
  );
  const dept = settings.find((s) => s.department_id === departmentId && departmentId !== null);
  const org = settings.find((s) => s.department_id === null);
  const eff = dept ?? org;
  if (!eff) blockers.push("channel_setting_missing");
  else if (!eff.enabled) blockers.push("channel_disabled");

  // ── Channel-kind specific resolution ────────────────────────────────
  // "recipient destination + sender identity" is the ADDRESSED rule. Device,
  // internal and endpoint channels resolve their own way and must never be
  // blocked for the absence of a human destination they do not have.
  const kind = channelKind(channel);
  if (kind === null) blockers.push("channel_not_supported");

  const destKey = destinationKeyFor(channel);
  if (destKey) {
    const dest = recipient.normalizedDestinations[destKey];
    if (!dest) blockers.push("recipient_destination_missing");
  }

  let pushRegistrationCount: number | undefined;
  let webhookSubscriptionId: string | undefined;
  let webhookEndpointId: string | undefined;
  let webhookEndpointChecksum: string | undefined;
  let voiceOriginatingIdentityId: string | undefined;

  if (kind === "device") {
    // Push: recipient identity → authoritative user → governed registrations.
    const push = resolvePushRegistrations(snap, recipient, organizationId);
    pushRegistrationCount = push.count;
    for (const b of push.blockers) blockers.push(b);
  }

  if (kind === "internal") {
    // In-App: the recipient identity IS the destination. It never depends on
    // a device token or a push destination.
    if (!recipient.recipientReference) {
      blockers.push("recipient_identity_unresolved");
    }
  }

  if (kind === "endpoint") {
    // Webhook: no human destination, no sender identity. The Communication
    // Action binds the exact subscriber endpoint.
    const hook = resolveWebhookSubscription(
      snap,
      route,
      eventDefinitionId,
      organizationId,
      departmentId,
    );
    webhookSubscriptionId = hook.subscriptionId ?? undefined;
    webhookEndpointId = hook.endpointId ?? undefined;
    webhookEndpointChecksum = hook.endpointChecksum ?? undefined;
    for (const b of hook.blockers) blockers.push(b);
  }

  if (channel === "voice") {
    const origin = resolveVoiceOriginatingIdentity(
      snap,
      organizationId,
      departmentId,
    );
    voiceOriginatingIdentityId = origin.identityId ?? undefined;
    for (const b of origin.blockers) blockers.push(b);
  }

  // Template.
  const template = resolveTemplateForRoute(
    snap, route, eventDefinitionId, organizationId, departmentId,
    recipient.localeFallbackCandidates,
  );
  if (!template) blockers.push("template_family_unresolved");
  else if (template.blockers.length > 0) {
    for (const b of template.blockers) blockers.push(b);
  } else if (!template.versionId) {
    blockers.push("template_version_unresolved");
  }

  // Layout (only if template resolved).
  let layout = null as ReturnType<typeof resolveLayoutForTemplate> | null;
  if (template && template.versionId) {
    layout = resolveLayoutForTemplate(snap, template, channel, organizationId, departmentId);
    if (!layout) blockers.push("layout_unresolved");
    else if (layout.blockers.length > 0) for (const b of layout.blockers) blockers.push(b);
  }

  // Assets (only if layout resolved).
  let assets: ChannelResolution["assets"] = [];
  if (layout && layout.blockers.length === 0) {
    const ar = resolveAssetsForLayout(snap, layout, channel, organizationId, departmentId);
    assets = ar.assets;
    for (const b of ar.blockers) blockers.push(b);
  }

  // Sender — ADDRESSED and PHYSICAL channels only. A Webhook, Push or In-App
  // leg carries NO sender identity; inventing one would be a lie in the plan.
  const sender = requiresSenderIdentity(channel)
    ? resolveSenderForRoute(snap, route, eventDefinitionId, organizationId, departmentId)
    : null;
  if (requiresSenderIdentity(channel)) {
    if (!sender) blockers.push("sender_unresolved");
    else for (const b of sender.blockers) blockers.push(b);
  }

  const hardBlockers = blockers.filter((b) =>
    b !== "provider_credentials_unavailable" &&
    b !== "live_delivery_disabled" &&
    b !== "sender_verification_pending"
  );

  return {
    channel,
    eventRouteId: route.id,
    isRequired: route.isRequired,
    templateFamilyId: template?.familyId || undefined,
    templateFamilyScope: template?.familyScope,
    templateVersionId: template?.versionId || undefined,
    templateVersionChecksum: template?.checksum || undefined,
    templateVersionNumber: template?.versionNumber || undefined,
    layoutId: layout?.layoutId || undefined,
    layoutVersionId: layout?.layoutVersionId || undefined,
    layoutInheritance: layout?.inheritance,
    layoutChecksum: layout?.checksum || undefined,
    assets,
    senderIdentityId: sender?.senderIdentityId || undefined,
    senderProviderBindingId: sender?.senderProviderBindingId || undefined,
    providerId: sender?.providerId || undefined,
    providerAccountId: sender?.providerAccountId || undefined,
    senderChannelReady: hardBlockers.length === 0,
    liveDeliveryReady: blockers.length === 0,
    channelKind: kind ?? undefined,
    pushRegistrationCount,
    webhookSubscriptionId,
    webhookEndpointId,
    webhookEndpointChecksum,
    voiceOriginatingIdentityId,
    blockers,
  };
}
