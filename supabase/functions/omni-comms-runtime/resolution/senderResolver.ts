// Sender + binding + provider + account resolution.
// Precedence: route-pinned → department → organization.
import type { AggregateSnapshot } from "./resolutionTypes.ts";
import type { WinningRoute } from "./routeResolver.ts";

export interface ResolvedSender {
  senderIdentityId: string;
  senderProviderBindingId: string | null;
  providerId: string | null;
  providerAccountId: string | null;
  senderChannelReady: boolean;
  liveDeliveryReady: boolean;
  blockers: string[];
}

export function resolveSenderForRoute(
  snap: AggregateSnapshot,
  route: WinningRoute,
  eventDefinitionId: string,
  organizationId: string,
  departmentId: string | null,
): ResolvedSender | null {
  const activeForChan = snap.senders.filter(
    (s) =>
      s.status === "active" &&
      s.channel === route.channel &&
      s.organization_id === organizationId,
  );

  let chosen: typeof activeForChan[number] | undefined;
  if (route.senderIdentityId) {
    chosen = activeForChan.find((s) => s.id === route.senderIdentityId);
    if (!chosen) return blocked("sender_unresolved");
    if (chosen.channel !== route.channel) return blocked("sender_channel_mismatch");
    if (chosen.organization_id !== organizationId) return blocked("sender_ownership_mismatch");
  } else {
    const scoped = activeForChan.filter(
      (s) => s.event_definition_id === eventDefinitionId || s.event_definition_id === null,
    );
    const dept = scoped.find((s) => s.department_id === departmentId && departmentId !== null);
    const org = scoped.find((s) => s.department_id === null);
    chosen = dept ?? org;
    if (!chosen) return null;
  }

  const bindings = snap.bindings
    .filter((b) => b.sender_identity_id === chosen!.id && b.status === "active")
    .sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : 1));

  if (bindings.length === 0) {
    return {
      senderIdentityId: chosen.id,
      senderProviderBindingId: null,
      providerId: null,
      providerAccountId: null,
      senderChannelReady: false,
      liveDeliveryReady: false,
      blockers: ["sender_provider_binding_unresolved"],
    };
  }

  const binding = bindings[0];
  const account = snap.provider_accounts.find(
    (pa) => pa.id === binding.provider_account_id && pa.status === "active",
  );
  const provider = account
    ? snap.providers.find((p) => p.id === account.provider_id && p.status === "active")
    : undefined;

  const bl: string[] = [];
  if (binding.verification_status !== "verified") bl.push("sender_verification_pending");
  if (!account) bl.push("provider_account_inactive");
  if (!provider) bl.push("provider_inactive");
  if (account && !account.secret_reference_configured) bl.push("provider_credentials_unavailable");

  const senderChannelReady = bl.filter((b) =>
    b === "sender_verification_pending" ||
    b === "provider_credentials_unavailable"
  ).length === bl.length; // only "soft" blockers
  const liveDeliveryReady = bl.length === 0;

  return {
    senderIdentityId: chosen.id,
    senderProviderBindingId: binding.id,
    providerId: provider?.id ?? null,
    providerAccountId: account?.id ?? null,
    senderChannelReady,
    liveDeliveryReady,
    blockers: bl,
  };
}

function blocked(code: string): ResolvedSender {
  return {
    senderIdentityId: "",
    senderProviderBindingId: null,
    providerId: null,
    providerAccountId: null,
    senderChannelReady: false,
    liveDeliveryReady: false,
    blockers: [code],
  };
}
