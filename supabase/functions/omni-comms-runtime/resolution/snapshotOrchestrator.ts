// Snapshot validation + orchestrator entry.
import type {
  AggregateSnapshot,
  ChannelResolution,
  NormalizedRecipient,
  RecipientInput,
  ResolvedDeliveryLeg,
  RuntimeRecipientResolution,
  RuntimeResolutionResult,
} from "./resolutionTypes.ts";
import { RuntimeResolutionError } from "./runtimeResolutionErrors.ts";
import { resolveEvent } from "./eventResolver.ts";
import { validatePayload } from "./contractValidator.ts";
import { resolveRoutes } from "./routeResolver.ts";
import { normalizeRecipients } from "./recipientResolver.ts";
import { evaluateChannel } from "./channelEligibility.ts";
import { destinationKeyFor } from "./channelKind.ts";
import { resolveTemplateForFamilyChannel } from "./templateResolver.ts";
import {
  EMPTY_ACTION_SNAPSHOT,
  buildActionResolutionEvidence,
  resolveCommunicationActions,
  type ActionOptionFulfilment,
  type ActionSnapshot,
} from "./actionResolver.ts";



const REQUIRED_SNAPSHOT_KEYS = [
  "snapshot_at",
  "organization_id",
  "event_contracts",
  "routes",
  "channel_settings",
  "template_families",
  "template_versions",
  "layouts",
  "layout_versions",
  "layout_assignments",
  "asset_assignments",
  "assets",
  "asset_versions",
  "senders",
  "bindings",
  "provider_accounts",
  "providers",
];

export function validateSnapshotShape(s: unknown): AggregateSnapshot {
  if (!s || typeof s !== "object" || Array.isArray(s)) {
    throw new RuntimeResolutionError("resolution_snapshot_invalid");
  }
  const snap = s as Record<string, unknown>;
  for (const key of REQUIRED_SNAPSHOT_KEYS) {
    if (!(key in snap)) {
      throw new RuntimeResolutionError("resolution_snapshot_invalid");
    }
  }
  const arrayKeys = REQUIRED_SNAPSHOT_KEYS.filter((k) => k !== "snapshot_at" && k !== "organization_id");
  for (const key of arrayKeys) {
    if (!Array.isArray(snap[key])) {
      throw new RuntimeResolutionError("resolution_snapshot_invalid");
    }
  }
  return snap as unknown as AggregateSnapshot;
}

export interface ProductCommunicationOverride {
  channel: string | null;
  is_enabled: boolean | null;
  template_family_code: string | null;
  sender_profile_code: string | null;
  recipient_source: string | null;
  delivery_mode: string | null;
}

export interface OrchestrationInput {
  snapshot: AggregateSnapshot;
  organizationId: string;
  departmentId: string | null;
  requestedChannels: string[];
  payload: unknown;
  recipients: RecipientInput[];
  mode: "dry_run" | "shadow" | "queued";
  /** Immutable business product context. Null when the event has no product. */
  productId?: string | null;
  /** Authoritative product-level overrides for THIS organisation + event. */
  productOverrides?: ProductCommunicationOverride[];
  /**
   * Communication Action (obligation) snapshot. When absent or empty the
   * runtime stays on the LEGACY per-channel route model, unchanged.
   */
  actionSnapshot?: ActionSnapshot;
  /** Semantic business role per recipient input index (claimant, employer…). */
  recipientRolesByIndex?: Record<number, string | null>;
}


/**
 * Per-property inheritance:
 *   organisation event/channel default -> department override -> product override.
 * Each property inherits SEPARATELY; an absent product property inherits the
 * already-resolved organisation/department value.
 */
export function applyProductOverrides(
  snap: AggregateSnapshot,
  routes: ReturnType<typeof resolveRoutes>,
  overrides: ProductCommunicationOverride[],
): { routes: ReturnType<typeof resolveRoutes>; provenance: Record<string, string> } {
  const provenance: Record<string, string> = {};
  if (!overrides || overrides.length === 0) return { routes, provenance };

  const out: ReturnType<typeof resolveRoutes> = [];
  for (const route of routes) {
    const ov = overrides.find(
      (o) => String(o.channel ?? "").toLowerCase() === route.channel.toLowerCase(),
    );
    if (!ov) {
      out.push(route);
      continue;
    }
    if (ov.is_enabled === false) {
      provenance[`${route.channel}.enabled_source`] = "product_override";
      continue; // Product turned this channel OFF for this product.
    }
    const next = { ...route };
    if (ov.is_enabled === true) provenance[`${route.channel}.enabled_source`] = "product_override";
    if (ov.template_family_code) {
      const fam = snap.template_families.find(
        (f) => f.code === ov.template_family_code && f.status === "active",
      );
      if (fam) {
        next.templateFamilyId = fam.id;
        provenance[`${route.channel}.template_source`] = "product_override";
      }
    }
    if (ov.sender_profile_code) {
      const sender = snap.senders.find(
        (s) => s.code === ov.sender_profile_code && s.status === "active",
      );
      if (sender) {
        next.senderIdentityId = sender.id;
        provenance[`${route.channel}.sender_source`] = "product_override";
      }
    }
    out.push(next);
  }
  return { routes: out, provenance };
}

export async function orchestrateResolution(
  input: OrchestrationInput,
): Promise<RuntimeResolutionResult> {
  const event = resolveEvent(input.snapshot);
  const requestBlockers: string[] = [];

  // Validate payload against contract schema.
  const issues = validatePayload(event.jsonSchema, input.payload);
  if (issues.length > 0) requestBlockers.push("payload_schema_violation");

  // Resolve winning routes.
  const winningRoutes = resolveRoutes(
    input.snapshot,
    input.organizationId,
    input.departmentId,
    input.requestedChannels,
  );
  const { routes: effectiveRoutes, provenance: productProvenance } = applyProductOverrides(
    input.snapshot,
    winningRoutes,
    input.productOverrides ?? [],
  );
  if (winningRoutes.length === 0) requestBlockers.push("event_route_missing");
  else if (effectiveRoutes.length === 0) {
    // Product configuration truthfully says no channel applies. This is a
    // terminal business/policy outcome, not a recoverable configuration gap.
    requestBlockers.push("no_communication_configured");
  }

  // Normalize + dedupe recipients.
  const normalized = await normalizeRecipients(input.recipients);
  if (normalized.length === 0) requestBlockers.push("recipient_input_invalid");

  const actionSnapshot: ActionSnapshot =
    input.actionSnapshot ?? EMPTY_ACTION_SNAPSHOT;

  const recipientResolutions: RuntimeRecipientResolution[] = [];
  const actionEvidence: Array<Record<string, unknown>> = [];

  for (const r of normalized) {
    const resolution = resolveRecipient(
      input.snapshot,
      r,
      effectiveRoutes,
      event.eventDefinitionId,
      input.organizationId,
      input.departmentId,
      input.mode,
    );

    // ── Communication Action (obligation) layer — dual mode ───────────────
    // When the event has no active actions the LEGACY route model above is
    // authoritative and nothing below changes behaviour.
    if (actionSnapshot.communication_actions.length > 0) {
      const channelResFor = (channel: string) =>
        resolution.channelResolutions.find((c) => c.channel === channel) ?? null;
      const isLive = input.mode === "queued";
      const channelsWithVariant = resolution.channelResolutions
        .filter((c) => Boolean(c.templateVersionId))
        .map((c) => c.channel);
      const readyChannels = resolution.channelResolutions
        .filter((c) => (isLive ? c.liveDeliveryReady : c.senderChannelReady))
        .map((c) => c.channel);
      // Destination availability is a CHANNEL-KIND question. Only addressed
      // channels have a human destination; device, internal and endpoint
      // channels resolve their own target and are never "destination-less".
      const destinationFor = (channel: string): boolean => {
        const key = destinationKeyFor(channel);
        if (!key) return true;
        if (key === "print") return true;
        return Boolean(r.normalizedDestinations[key]);
      };

      // Authoritative ACTION template binding, resolved per option so that two
      // actions on the same channel are evaluated independently.
      const actionTemplateByOption = new Map<
        string,
        ReturnType<typeof resolveTemplateForFamilyChannel>
      >();
      for (const opt of actionSnapshot.action_channel_options) {
        if (opt.status !== "active") continue;
        if (!opt.template_family_id) {
          actionTemplateByOption.set(opt.id, null);
          continue;
        }
        actionTemplateByOption.set(
          opt.id,
          resolveTemplateForFamilyChannel(
            input.snapshot,
            opt.template_family_id,
            opt.channel,
            input.organizationId,
            input.departmentId,
            r.localeFallbackCandidates,
          ),
        );
      }

      const optionFulfilment: Record<string, ActionOptionFulfilment> = {};
      for (const opt of actionSnapshot.action_channel_options) {
        if (opt.status !== "active") continue;
        const cr = channelResFor(opt.channel);
        const bound = actionTemplateByOption.get(opt.id) ?? null;
        optionFulfilment[opt.id] = {
          // Action-bound families must publish their OWN channel variant.
          variantAvailable: opt.template_family_id
            ? bound !== null
            : Boolean(cr?.templateVersionId),
          channelReady: Boolean(
            cr && (isLive ? cr.liveDeliveryReady : cr.senderChannelReady),
          ),
          destinationAvailable: destinationFor(opt.channel),
        };
      }

      const actionResult = resolveCommunicationActions(
        {
          snapshot: actionSnapshot,
          recipientRole: input.recipientRolesByIndex?.[r.inputIndex] ?? null,
          recipientReference: r.recipientReference,
          requestedChannels: input.requestedChannels,
          readyChannels,
          channelsWithVariant,
          digitalDestinationAvailable: Boolean(
            r.normalizedDestinations.email || r.normalizedDestinations.phone,
          ),
          optionFulfilment,
        },
        input.departmentId,
      );

      // Build the canonical multi-leg plan. Legs are NOT deduplicated by
      // channel: each action keeps its own obligation and template binding.
      const legs: ResolvedDeliveryLeg[] = actionResult.deliveryLegs.map((l) => {
        const cr = channelResFor(l.channel);
        const bound = actionTemplateByOption.get(l.optionId) ?? null;
        const useAction = Boolean(l.templateFamilyId && bound);
        return {
          legKey: `${l.communicationActionId}:${l.channel}:${l.optionId}`,
          communicationActionId: l.communicationActionId,
          communicationActionCode: l.communicationActionCode,
          recipientRole: l.recipientRole,
          obligation: l.obligation,
          satisfactionRule: l.satisfactionRule,
          channel: l.channel,
          actionChannelOptionId: l.optionId,
          deliveryPolicyId: l.policyId,
          deliveryPolicyVersion: l.policyVersion,
          deliveryPolicyMode: l.policyMode,
          resolutionReason: l.selectionReason,
          isFallback: l.isFallback,
          templateFamilyId: useAction ? l.templateFamilyId : cr?.templateFamilyId ?? null,
          templateFamilySource: useAction ? "action_option" : "route_fallback",
          templateVersionId: useAction ? bound!.versionId : cr?.templateVersionId,
          templateVersionNumber: useAction ? bound!.versionNumber : cr?.templateVersionNumber,
          templateVersionChecksum: useAction ? bound!.checksum : cr?.templateVersionChecksum,
          layoutId: useAction ? bound!.layoutId ?? undefined : cr?.layoutId,
          layoutVersionId: useAction
            ? bound!.pinnedLayoutVersionId ?? cr?.layoutVersionId
            : cr?.layoutVersionId,
          layoutChecksum: cr?.layoutChecksum,
          layoutInheritance: cr?.layoutInheritance,
          assets: cr?.assets ?? [],
          senderIdentityId: cr?.senderIdentityId,
          senderProviderBindingId: cr?.senderProviderBindingId,
          providerId: cr?.providerId,
          providerAccountId: cr?.providerAccountId,
          eventRouteId: cr?.eventRouteId,
          senderChannelReady: Boolean(cr?.senderChannelReady),
          liveDeliveryReady: Boolean(cr?.liveDeliveryReady),
          // Kind-specific truth travels with the leg. Nothing is invented:
          // an absent field means the kind does not apply to this channel.
          channelKind: cr?.channelKind,
          pushRegistrationCount: cr?.pushRegistrationCount,
          webhookSubscriptionId: cr?.webhookSubscriptionId,
          webhookEndpointId: cr?.webhookEndpointId,
          webhookEndpointChecksum: cr?.webhookEndpointChecksum,
          voiceOriginatingIdentityId: cr?.voiceOriginatingIdentityId,
          blockers: cr?.blockers ?? [],
        };
      });
      resolution.deliveryLegs = legs;

      const selected = new Set(actionResult.selectedChannels);
      resolution.channelResolutions = resolution.channelResolutions.filter((c) =>
        selected.has(c.channel)
      );
      resolution.resolvedChannels = resolution.resolvedChannels.filter((c) =>
        selected.has(c)
      );
      for (const b of actionResult.blockers) {
        if (!resolution.blockers.includes(b)) resolution.blockers.push(b);
      }
      actionEvidence.push(buildActionResolutionEvidence(actionResult));
    }

    recipientResolutions.push(resolution);

  }

  return {
    event: {
      eventDefinitionId: event.eventDefinitionId,
      eventContractId: event.eventContractId,
      eventContractVersion: event.eventContractVersion,
      eventContractChecksum: event.eventContractChecksum,
    },
    requestedChannels: input.requestedChannels,
    recipients: recipientResolutions,
    blockers: requestBlockers,
    resolutionProvenance: {
      resolver_version: "plan.v2",
      product_id: input.productId ?? null,
      product_override_applied: Object.keys(productProvenance).length > 0,
      department_override_applied: winningRoutes.some((r) => r.inheritedFrom === "department"),
      action_model_applied: actionSnapshot.communication_actions.length > 0,
      action_resolution: actionEvidence,
      ...productProvenance,
    },
  };
}


function resolveRecipient(
  snap: AggregateSnapshot,
  norm: NormalizedRecipient,
  routes: ReturnType<typeof resolveRoutes>,
  eventDefinitionId: string,
  organizationId: string,
  departmentId: string | null,
  mode: "dry_run" | "shadow" | "queued",
): RuntimeRecipientResolution {
  const perChannel: ChannelResolution[] = routes.map((rt) =>
    evaluateChannel(snap, rt, norm, eventDefinitionId, organizationId, departmentId)
  );

  // Determine resolvedChannels: those with senderChannelReady in dry_run/shadow;
  // liveDeliveryReady in queued.
  const isLive = mode === "queued";
  const resolvedChannels = perChannel
    .filter((c) => (isLive ? c.liveDeliveryReady : c.senderChannelReady))
    .map((c) => c.channel);

  const blockers = [...norm.blockers];
  for (const c of perChannel) {
    for (const b of c.blockers) {
      if (!blockers.includes(b)) blockers.push(b);
    }
  }
  if (perChannel.length === 0) blockers.push("event_route_missing");

  return {
    inputIndex: norm.inputIndex,
    fingerprint: norm.fingerprint,
    recipientType: norm.recipientType,
    recipientReference: norm.recipientReference,
    displayName: norm.displayName,
    normalizedLocale: norm.normalizedLocale,
    normalizedDestinations: norm.normalizedDestinations,
    resolvedChannels,
    blockers,
    channelResolutions: perChannel,
  };
}

/** Determine per-recipient eligibility status for persistence. */
export function recipientEligibilityStatus(
  r: RuntimeRecipientResolution,
): "eligible" | "partially_eligible" | "blocked" | "invalid" {
  if (r.blockers.includes("recipient_destination_invalid")) return "invalid";
  const total = r.channelResolutions.length;
  const ok = r.resolvedChannels.length;
  if (total === 0) return "blocked";
  if (ok === 0) return "blocked";
  if (ok < total) return "partially_eligible";
  return "eligible";
}
