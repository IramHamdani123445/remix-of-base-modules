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

const CHANNEL_TO_DEST: Record<string, keyof NormalizedRecipient["normalizedDestinations"]> = {
  email: "email",
  sms: "phone",
  whatsapp: "phone",
  push: "push",
  in_app: "push",
  print: "push",
};

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

  // Destination.
  const destKey = CHANNEL_TO_DEST[channel];
  const dest = destKey ? recipient.normalizedDestinations[destKey] : null;
  if (!dest) blockers.push("recipient_destination_missing");

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

  // Sender.
  const sender = resolveSenderForRoute(snap, route, eventDefinitionId, organizationId, departmentId);
  if (!sender) blockers.push("sender_unresolved");
  else for (const b of sender.blockers) blockers.push(b);

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
    blockers,
  };
}
