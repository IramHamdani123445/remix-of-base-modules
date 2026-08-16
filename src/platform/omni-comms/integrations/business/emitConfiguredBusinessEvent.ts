/**
 * Omni-Comms — configuration-aware business integration helper.
 *
 * THE RECOMMENDED ENTRYPOINT FOR EVERY BUSINESS MODULE.
 *
 * Final product principle:
 *
 *   BUSINESS MODULES PROVIDE FACTS.
 *   COMMUNICATION CONFIGURATION DECIDES WHAT TO SEND.
 *   OMNI-COMMS RESOLVES CHANNEL / TEMPLATE / SENDER / PROVIDER / POLICY.
 *
 * A caller supplies only:
 *   - the business event code
 *   - the business entity identity (and, when repeatable, its occurrence)
 *   - optional product / organisation context
 *   - recipient facts keyed by SEMANTIC ROLE
 *   - the business data that satisfies the published event contract
 *
 * A caller NEVER supplies (and cannot influence):
 *   provider · provider account · sender identity · template · channel ·
 *   delivery mode · release control · scheduler · HTML · subject · callback ·
 *   idempotency string.
 *
 * Delegates to `emitBusinessCommunication` → `sendCommunication`. It never
 * imports a provider SDK, never contacts a provider and never writes to a
 * communication table. It is total: a communication failure can never break
 * the business transaction that raised it.
 */
import { emitBusinessCommunication } from './emitBusinessCommunication';
import { resolveBusinessCommunicationScope } from './businessScopeResolver';
import { resolveEffectiveCommunicationPlan } from '../../application/effectiveCommunicationPlan';
import { buildConfiguredEventIdempotencyKey } from './configuredEventIdentity';


import {
  OMNI_COMMS_RECIPIENT_TYPES,
  type BusinessProducerOutcome,
  type BusinessProducerResult,
  type OmniCommsRecipientType,
} from './businessProducerTypes';

/**
 * Outcomes visible to a business caller. `skipped` means the Hub decided the
 * obligation does not apply (for example a product override turned the
 * communication off) — it is not a failure.
 */
export type ConfiguredBusinessEventOutcome = BusinessProducerOutcome | 'skipped';

/**
 * Recipient facts supplied by the business module, keyed by semantic role
 * (`claimant`, `employer_contact`, `case_owner`, …). The template only ever
 * sees `recipient.*`; it never performs contact resolution.
 */
export interface ConfiguredBusinessEventRecipient {
  /** Stable business reference for the recipient (claim number, reg no, …). */
  reference?: string | null;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  locale?: string | null;
  /**
   * Whether the recipient is outside the organisation. Defaults to
   * `external`, which is the canonical persisted vocabulary for members of
   * the public. Internal staff recipients use `internal`.
   */
  audience?: 'external' | 'internal';
}

export interface ConfiguredBusinessEventInput {
  /** Published business event code, e.g. `BENEFITS.CLAIM.SUBMITTED`. */
  eventCode: string;
  /** Registered caller module. Derived from the event code when omitted. */
  moduleCode?: string;
  entity: {
    /** Durable entity table/type, e.g. `bn_claim`. Derived when omitted. */
    type?: string;
    id: string;
    /**
     * Occurrence key. Only needed when the same business event can legitimately
     * happen more than once for the same entity. Defaults to `default`.
     */
    occurrence?: string;
  };
  context?: {
    /** Product override context, when the entity belongs to a product. */
    productId?: string | null;
    /** Supplied only by trusted integration code that already knows it. */
    organizationId?: string | null;
    /** Optional department context. Never required to choose a template. */
    departmentId?: string | null;
  };
  /** Recipient facts keyed by semantic role. */
  recipients: Record<string, ConfiguredBusinessEventRecipient>;
  /** Business facts matching the published event contract. */
  data: Record<string, unknown>;
  correlationId?: string | null;
}

export interface ConfiguredBusinessEventResult
  extends Omit<BusinessProducerResult, 'outcome'> {
  outcome: ConfiguredBusinessEventOutcome;
  /** Resolved scope evidence, for module-side logging only. */
  organizationId: string | null;
  departmentId: string | null;
  departmentSource: 'explicit' | 'module_context' | 'none';
  /** Set when the Hub decided this obligation does not apply. */
  skippedReason: string | null;
  /** Channels the authoritative effective plan turned on. */
  enabledChannels: string[];
  /** Enabled channels with a real delivery adapter. */
  runnableChannels: string[];
  /** Effective template/sender chosen by the plan, for module-side logging. */
  effectiveTemplate: string | null;
  effectiveSender: string | null;
}

function deriveModuleCode(eventCode: string): string {
  return String(eventCode ?? '').split('.')[0]?.trim().toUpperCase() ?? '';
}

function deriveEntityType(eventCode: string): string {
  const parts = String(eventCode ?? '').split('.');
  return (parts[1] ?? 'entity').trim().toLowerCase();
}

function toRecipientType(
  audience: ConfiguredBusinessEventRecipient['audience'],
): OmniCommsRecipientType {
  // `internal` maps to the canonical persisted value `user`; members of the
  // public map to `external`. Semantic business roles never reach this field.
  const value = audience === 'internal' ? 'user' : 'external';
  return (
    (OMNI_COMMS_RECIPIENT_TYPES as readonly string[]).includes(value)
      ? value
      : 'external'
  ) as OmniCommsRecipientType;
}

function blocked(
  eventCode: string,
  blockers: string[],
  scope: { organizationId: string | null; departmentId: string | null; departmentSource: ConfiguredBusinessEventResult['departmentSource'] },
  skippedReason: string | null = null,
): ConfiguredBusinessEventResult {
  return {
    outcome: 'blocked',
    blockers,
    requestId: null,
    idempotencyKey: null,
    mode: 'queued',
    eventCode,
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    departmentSource: scope.departmentSource,
    skippedReason,
    enabledChannels: [],
    runnableChannels: [],
    effectiveTemplate: null,
    effectiveSender: null,
  };
}

/**
 * Raise a configured business communication obligation.
 *
 * Production business communications are always `queued`. Dry-run and shadow
 * remain engineering/governance facilities reached through the dedicated test
 * boundary, never through this helper.
 */
export async function emitConfiguredBusinessEvent(
  input: ConfiguredBusinessEventInput,
): Promise<ConfiguredBusinessEventResult> {
  const eventCode = String(input?.eventCode ?? '').trim();
  const emptyScope = {
    organizationId: null,
    departmentId: null,
    departmentSource: 'none' as const,
  };

  if (!eventCode) return blocked('', ['event_code_required'], emptyScope);
  if (!input?.entity?.id) return blocked(eventCode, ['entity_id_required'], emptyScope);

  const moduleCode = input.moduleCode?.trim() || deriveModuleCode(eventCode);
  const roles = Object.keys(input?.recipients ?? {});
  if (roles.length === 0) {
    return blocked(eventCode, ['recipients_required'], emptyScope);
  }

  const scope = await resolveBusinessCommunicationScope({
    moduleCode,
    organizationId: input.context?.organizationId ?? null,
    departmentId: input.context?.departmentId ?? null,
  });

  if (!scope.organizationId) {
    return blocked(eventCode, ['organization_unresolved'], scope);
  }

  // ONE authoritative resolution. The plan — not the business module and not
  // a hard-coded channel list — decides which channels carry an obligation,
  // which template and sender apply and which recipient role is addressed.
  const productId = input.context?.productId?.trim() || null;
  const plan = await resolveEffectiveCommunicationPlan({
    organizationId: scope.organizationId,
    moduleCode,
    eventCode,
    productId,
    // Department is resolution CONTEXT only, never a delivery instruction.
    departmentId: scope.departmentId,
    recipientRoles: roles,
  });

  if (plan.enabledChannels.length === 0) {
    const reason = plan.blockers[0] ?? 'no_channel_enabled';
    return {
      ...blocked(eventCode, [reason], scope),
      outcome: 'skipped',
      skippedReason: reason,
    };
  }
  if (plan.runnableChannels.length === 0) {
    const reason = 'channel_delivery_not_implemented';
    return {
      ...blocked(eventCode, [reason], scope),
      outcome: 'skipped',
      skippedReason: reason,
    };
  }

  const recipients = roles.map((role) => {
    const r = input.recipients[role] ?? {};
    return {
      recipientType: toRecipientType(r.audience),
      // Semantic business role stays first class; it is never squeezed into
      // the canonical persistence vocabulary.
      recipientRole: role,
      recipientReference: r.reference ?? role,
      displayName: r.displayName ?? null,
      locale: r.locale ?? null,
      email: r.email ?? null,
      phone: r.phone ?? null,
    };
  });

  const entityType = input.entity.type?.trim() || deriveEntityType(eventCode);
  const occurrence = input.entity.occurrence?.trim() || 'default';

  // v2 business identity: configuration changes never mint a new obligation.
  const idempotencyKeyOverride = await buildConfiguredEventIdempotencyKey({
    organizationId: scope.organizationId,
    moduleCode,
    eventCode,
    entityType,
    entityId: String(input.entity.id),
    occurrence,
  });

  const primary = plan.channels.find((c) => c.channel === plan.runnableChannels[0]) ?? null;

  const result = await emitBusinessCommunication({
    moduleCode,
    eventCode,
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    entityType,
    entityId: String(input.entity.id),
    // Deterministic occurrence identity — callers never handcraft a key.
    entityVersion: occurrence,
    // Production business communications are always queued.
    mode: 'queued',
    idempotencyKeyOverride,
    // No channel is requested. The Hub — Communication Actions, channel
    // options, delivery policy and product configuration — is the single
    // authority that decides which legs are produced. A business caller that
    // narrows channels here would silently override that authority.

    resolutionContext: { productId, recipientRoles: roles },
    correlationId:
      input.correlationId?.trim() ||
      `${eventCode.toLowerCase()}:${String(input.entity.id).trim()}`,
    recipients,
    payload: { ...(input.data ?? {}) },
  });

  return {
    ...result,
    organizationId: scope.organizationId,
    departmentId: scope.departmentId,
    departmentSource: scope.departmentSource,
    skippedReason: null,
    enabledChannels: [...plan.enabledChannels],
    runnableChannels: [...plan.runnableChannels],
    effectiveTemplate: primary?.templateRef ?? null,
    effectiveSender: primary?.senderRef ?? null,
  };
}
