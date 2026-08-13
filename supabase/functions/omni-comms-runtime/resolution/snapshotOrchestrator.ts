// Snapshot validation + orchestrator entry.
import type {
  AggregateSnapshot,
  ChannelResolution,
  NormalizedRecipient,
  RecipientInput,
  RuntimeRecipientResolution,
  RuntimeResolutionResult,
} from "./resolutionTypes.ts";
import { RuntimeResolutionError } from "./runtimeResolutionErrors.ts";
import { resolveEvent } from "./eventResolver.ts";
import { validatePayload } from "./contractValidator.ts";
import { resolveRoutes } from "./routeResolver.ts";
import { normalizeRecipients } from "./recipientResolver.ts";
import { evaluateChannel } from "./channelEligibility.ts";

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

  const recipientResolutions: RuntimeRecipientResolution[] = normalized.map((r) =>
    resolveRecipient(input.snapshot, r, effectiveRoutes, event.eventDefinitionId, input.organizationId, input.departmentId, input.mode)
  );

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
