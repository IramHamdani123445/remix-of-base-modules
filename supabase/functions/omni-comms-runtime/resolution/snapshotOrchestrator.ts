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

export interface OrchestrationInput {
  snapshot: AggregateSnapshot;
  organizationId: string;
  departmentId: string | null;
  requestedChannels: string[];
  payload: unknown;
  recipients: RecipientInput[];
  mode: "dry_run" | "shadow" | "queued";
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
  if (winningRoutes.length === 0) requestBlockers.push("event_route_missing");

  // Normalize + dedupe recipients.
  const normalized = await normalizeRecipients(input.recipients);
  if (normalized.length === 0) requestBlockers.push("recipient_input_invalid");

  const recipientResolutions: RuntimeRecipientResolution[] = normalized.map((r) =>
    resolveRecipient(input.snapshot, r, winningRoutes, event.eventDefinitionId, input.organizationId, input.departmentId, input.mode)
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
