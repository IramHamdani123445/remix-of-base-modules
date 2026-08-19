/**
 * Omni-Comms Runtime — kind-specific resolution for the non-addressed
 * channels.
 *
 * These resolvers are PURE: they read only the aggregate snapshot. They never
 * accept a device token, a webhook URL, a signing secret, a caller number or
 * a provider identifier from the caller — every one of those is resolved from
 * governed configuration here.
 */
import type {
  AggregateSnapshot,
  NormalizedRecipient,
} from "./resolutionTypes.ts";
import type { WinningRoute } from "./routeResolver.ts";

export interface PushRegistrationResolution {
  count: number;
  blockers: string[];
}

/**
 * Push resolves: recipient identity → governed active registrations.
 * A missing recipient identity is an identity failure, not a "destination"
 * failure; a recipient with no live installation is simply not reachable.
 */
export function resolvePushRegistrations(
  snap: AggregateSnapshot,
  recipient: NormalizedRecipient,
  organizationId: string,
): PushRegistrationResolution {
  const blockers: string[] = [];
  const reference = recipient.recipientReference;
  if (!reference) {
    return { count: 0, blockers: ["recipient_identity_unresolved"] };
  }
  const registrations = (snap.push_registrations ?? []).filter(
    (r) =>
      r.organization_id === organizationId &&
      r.recipient_reference === reference &&
      r.status === "active",
  );
  if (registrations.length === 0) blockers.push("push_registration_missing");
  return { count: registrations.length, blockers };
}

export interface WebhookSubscriptionResolution {
  subscriptionId: string | null;
  endpointId: string | null;
  endpointChecksum: string | null;
  blockers: string[];
}

/**
 * Webhook resolves: Communication Action / event → governed subscription →
 * exact endpoint. The generic sender resolver is never consulted, and no
 * recipient destination is required.
 */
export function resolveWebhookSubscription(
  snap: AggregateSnapshot,
  route: WinningRoute,
  eventDefinitionId: string,
  organizationId: string,
  departmentId: string | null,
): WebhookSubscriptionResolution {
  const empty: WebhookSubscriptionResolution = {
    subscriptionId: null,
    endpointId: null,
    endpointChecksum: null,
    blockers: ["webhook_subscription_unresolved"],
  };
  const candidates = (snap.webhook_subscriptions ?? []).filter(
    (s) =>
      s.status === "active" &&
      s.organization_id === organizationId &&
      (s.department_id === null || s.department_id === departmentId) &&
      (s.event_definition_id === null ||
        s.event_definition_id === eventDefinitionId),
  );
  if (candidates.length === 0) return empty;

  // Department-scoped subscriptions beat organisation-wide ones; an
  // event-pinned subscription beats a catch-all.
  const ranked = [...candidates].sort((a, b) => {
    const scope = (s: typeof a) =>
      (s.department_id !== null ? 0 : 1) + (s.event_definition_id !== null ? 0 : 2);
    const byScope = scope(a) - scope(b);
    if (byScope !== 0) return byScope;
    return a.id < b.id ? -1 : 1;
  });

  const chosen = ranked[0];
  const blockers: string[] = [];
  if (!chosen.endpoint_id) blockers.push("webhook_endpoint_unresolved");
  // The endpoint checksum is the tamper evidence carried onto the message; a
  // subscription without one cannot be proven to still address the same URL.
  if (!chosen.endpoint_checksum) blockers.push("webhook_endpoint_unverified");
  return {
    subscriptionId: chosen.id,
    endpointId: chosen.endpoint_id,
    endpointChecksum: chosen.endpoint_checksum,
    blockers,
  };
}

export interface VoiceOriginResolution {
  identityId: string | null;
  blockers: string[];
}

/**
 * Voice is ADDRESSED: the recipient phone is the destination and the platform
 * owns the originating number. The caller never supplies a caller id, a
 * Twilio account or any TwiML.
 */
export function resolveVoiceOriginatingIdentity(
  snap: AggregateSnapshot,
  organizationId: string,
  departmentId: string | null,
): VoiceOriginResolution {
  const identities = (snap.voice_identities ?? []).filter(
    (v) =>
      v.status === "active" &&
      v.organization_id === organizationId &&
      (v.department_id === null || v.department_id === departmentId),
  );
  if (identities.length === 0) {
    return { identityId: null, blockers: ["voice_originating_identity_missing"] };
  }
  const dept = identities.find(
    (v) => v.department_id === departmentId && departmentId !== null,
  );
  const chosen = dept ?? identities.find((v) => v.department_id === null) ??
    identities[0];
  const blockers: string[] = [];
  if (chosen.verification_status !== "verified") {
    blockers.push("voice_originating_identity_unverified");
  }
  if (!chosen.provider_account_id) {
    blockers.push("provider_account_inactive");
  }
  return { identityId: chosen.id, blockers };
}
