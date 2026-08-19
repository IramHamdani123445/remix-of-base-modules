/**
 * Omni-Comms C1 / CG1 — canonical channel catalogue.
 *
 * SINGLE source of truth for which communication channels exist, which shared
 * administration resources each one exposes, and which seed namespace each
 * channel owns. Everything downstream (channel selector, generic tab shell,
 * workspace rail, seed packs, later adapter chunks) MUST read from this file
 * rather than hard-coding channel identifiers or tab lists.
 *
 * CG1 introduces the canonical CAPABILITY MATRIX. Two distinct concepts are
 * modelled and must never be collapsed:
 *
 *   - `schemaSupported` — the shared database object can physically store a
 *     row for this channel (the table constraint / server-side normaliser
 *     accepts the value).
 *   - `uiApplicable`    — the resource is part of the APPROVED operator
 *     workflow for this channel and is therefore mounted in the workspace.
 *
 * A resource is NEVER exposed merely because a shared table accepts the
 * channel value. `tabs` is DERIVED from `uiApplicable`, so the catalogue, the
 * workspace rail and the tests can never disagree.
 *
 * Boundaries (permanent):
 *   - No provider SDK imports here. This module is pure metadata.
 *   - No Legacy Communication Hub references.
 *   - `implemented: false` channels are fail-closed: no delivery adapter is
 *     installed and no message can be produced from the workspace.
 */

export const OMNI_COMMS_CHANNELS = [
  'email',
  'sms',
  'whatsapp',
  'push',
  'in_app',
  'webhook',
  'print',
  'voice',
] as const;

export type OmniCommsChannel = (typeof OMNI_COMMS_CHANNELS)[number];

/**
 * Generic administration tabs. Every channel selects a subset; the ordering
 * below is the canonical display order used by the generic tab shell.
 */
export const OMNI_COMMS_GENERIC_TABS = [
  'overview',
  'providers',
  'accounts',
  'identities',
  'endpoints',
  'bindings',
  'policies',
  'release-control',
  'test-centre',
  'diagnostics',
] as const;

export type OmniCommsGenericTab = (typeof OMNI_COMMS_GENERIC_TABS)[number];

/**
 * Configurable resources. `overview` is not a resource — it is the always-on
 * landing surface of every channel workspace.
 */
export const OMNI_COMMS_CHANNEL_RESOURCES = OMNI_COMMS_GENERIC_TABS.filter(
  (t) => t !== 'overview',
) as readonly Exclude<OmniCommsGenericTab, 'overview'>[];

export type OmniCommsChannelResource = (typeof OMNI_COMMS_CHANNEL_RESOURCES)[number];

/** Delivery shape a channel uses — drives which resources are meaningful. */
export type OmniCommsChannelKind =
  | 'addressed' // has sender identities + recipient addresses (email, sms, whatsapp, voice)
  | 'device' // targets registered devices/tokens (push)
  | 'inbound_surface' // rendered inside the product (in_app)
  | 'endpoint' // posts to a configured remote endpoint (webhook)
  | 'physical'; // produces a physical artefact (print)

/** Build chunk that owns delivery for this channel. */
export type OmniCommsChannelChunk = 'C6' | 'C7' | 'C8' | 'C9' | 'C10';

/**
 * Capability of ONE shared resource for ONE channel.
 *
 * `schemaSupported` describes the database contract. `uiApplicable` describes
 * the approved product workflow. They are deliberately independent.
 */
export interface OmniCommsChannelCapability {
  readonly schemaSupported: boolean;
  readonly uiApplicable: boolean;
  /** Truthful operator-facing reason, required whenever the two differ. */
  readonly reason: string;
}

export type OmniCommsChannelCapabilityMatrix = Readonly<
  Record<OmniCommsChannelResource, OmniCommsChannelCapability>
>;

export interface OmniCommsChannelDescriptor {
  /** Stable machine identifier. Used in URLs, DB rows and seed namespaces. */
  readonly channel: OmniCommsChannel;
  /** Operator-facing label. */
  readonly label: string;
  /** One-line description shown in the channel selector. */
  readonly description: string;
  readonly kind: OmniCommsChannelKind;
  /** Owning build chunk for the delivery adapter. */
  readonly chunk: OmniCommsChannelChunk;
  /**
   * True only when a genuine DELIVERY adapter is installed for this channel.
   * Configuration is available for every schema-supported channel; delivery is
   * a separate, stricter claim.
   */
  readonly implemented: boolean;
  /**
   * Whether the CURRENT database schema accepts this channel value at all.
   * Channels without schema support cannot be configured (fail-closed).
   */
  readonly databaseSupported: boolean;
  /** Canonical capability matrix. `tabs` is derived from it. */
  readonly capabilities: OmniCommsChannelCapabilityMatrix;
  /** Tabs this channel exposes, in canonical order. DERIVED — never authored. */
  readonly tabs: readonly OmniCommsGenericTab[];
  /**
   * Seed isolation namespace. Reference/simulation seed data for a channel
   * MUST be created under this namespace and MUST NOT be shared across
   * channels, so a channel's seed can be reset independently.
   */
  readonly seedNamespace: string;
  /** Reserved provider adapter names for this channel (none are deployed). */
  readonly reservedProviders: readonly string[];
}

const APPROVED = 'Part of the approved operator workflow for this channel.';
const NO_SCHEMA =
  'The shared database object does not accept this channel value yet.';

function cap(
  schemaSupported: boolean,
  uiApplicable: boolean,
  reason: string = uiApplicable ? APPROVED : NO_SCHEMA,
): OmniCommsChannelCapability {
  return { schemaSupported, uiApplicable, reason };
}

/** All resources unsupported — used by planned channels. */
function plannedMatrix(): OmniCommsChannelCapabilityMatrix {
  const out = {} as Record<OmniCommsChannelResource, OmniCommsChannelCapability>;
  for (const r of OMNI_COMMS_CHANNEL_RESOURCES) out[r] = cap(false, false, NO_SCHEMA);
  return out;
}

function matrix(
  entries: Partial<Record<OmniCommsChannelResource, OmniCommsChannelCapability>>,
): OmniCommsChannelCapabilityMatrix {
  const out = {} as Record<OmniCommsChannelResource, OmniCommsChannelCapability>;
  for (const r of OMNI_COMMS_CHANNEL_RESOURCES) {
    out[r] = entries[r] ?? cap(false, false, NO_SCHEMA);
  }
  return out;
}

/** Derive the canonical, ordered tab list from the capability matrix. */
export function deriveTabsFromCapabilities(
  m: OmniCommsChannelCapabilityMatrix,
): readonly OmniCommsGenericTab[] {
  return OMNI_COMMS_GENERIC_TABS.filter(
    (t) => t === 'overview' || m[t as OmniCommsChannelResource]?.uiApplicable,
  );
}

const RELEASE_CONTROL_EMAIL_ONLY =
  'Release Control governs the controlled Email pilot only. No Release '
  + 'Control contract exists for this channel.';

const NOT_IN_PRODUCT_WORKFLOW =
  'The shared table can represent this channel, but the resource is not part '
  + 'of the approved operator workflow for it.';

const PRINT_NO_EXTERNAL_PROVIDER =
  'Print is produced by the in-platform print spool. There is no external '
  + 'provider credential or delivery callback to test; production is proved '
  + 'by the archived PDF in the print queue.';

const IN_APP_NO_EXTERNAL_PROVIDER =
  'In-App is delivered by the internal portal adapter. There is no external '
  + 'provider credential or delivery callback to test; delivery is proved by '
  + 'the notification appearing in the recipient inbox.';

const IN_APP_NO_ENDPOINT =
  'In-App has no remote endpoint: the destination is the recipient portal '
  + 'inbox resolved from their application user account.';


const PUSH_IDENTITY_REASON =
  'Push targets registered device tokens. Sender identities are not part of '
  + 'the canonical Push product model.';

interface CatalogueSeed
  extends Omit<OmniCommsChannelDescriptor, 'tabs' | 'seedNamespace'> {}

const SEEDS: readonly CatalogueSeed[] = [
  {
    channel: 'email',
    label: 'Email',
    description: 'Transactional email via the Resend provider account.',
    kind: 'addressed',
    chunk: 'C6',
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      identities: cap(true, true),
      endpoints: cap(true, true),
      bindings: cap(true, true),
      policies: cap(true, true),
      'release-control': cap(true, true),
      'test-centre': cap(true, true),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['resend'],
  },
  {
    channel: 'sms',
    label: 'SMS',
    description: 'Short message delivery through the Twilio SMS adapter.',
    kind: 'addressed',
    chunk: 'C7',
    // A genuine server-only Twilio delivery adapter is deployed.
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      identities: cap(true, true),
      // CG1 — the server-side endpoint normaliser accepts SMS
      // delivery_callback and inbound_callback.
      endpoints: cap(true, true),
      bindings: cap(true, true),
      policies: cap(true, true),
      // Release Control is channel-generic; SMS has a deployed adapter.
      'release-control': cap(true, true),
      'test-centre': cap(true, true),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['twilio'],
  },
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    description: 'Template-governed WhatsApp Business messaging.',
    kind: 'addressed',
    chunk: 'C8',
    // A real server-only Twilio WhatsApp adapter ships in
    // `_shared/omni-comms/twilioWhatsAppAdapter.ts`, with signed callback
    // verification and structured (ContentSid) template support.
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      identities: cap(true, true),
      // CG1 — the server-side endpoint normaliser accepts the WhatsApp
      // business_webhook endpoint type.
      endpoints: cap(true, true),
      bindings: cap(true, true),
      policies: cap(true, true),
      // Release Control is channel-generic; WhatsApp has a deployed adapter.
      'release-control': cap(true, true),
      'test-centre': cap(true, true),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['twilio_whatsapp'],
  },
  {
    channel: 'push',
    label: 'Push',
    description: 'Mobile and web push notifications to registered devices.',
    kind: 'device',
    chunk: 'C9',
    // A real server-only Firebase Cloud Messaging adapter ships in
    // `_shared/omni-comms/fcmPushAdapter.ts`, targeting the governed device
    // register and retiring tokens the provider permanently rejects.
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      // Representable, but deliberately hidden: the canonical Push product
      // model has no sender identity.
      identities: cap(true, false, PUSH_IDENTITY_REASON),
      endpoints: cap(false, false, NO_SCHEMA),
      bindings: cap(true, true),
      policies: cap(true, true),
      // Release Control is channel-generic; Push has a deployed adapter.
      'release-control': cap(true, true),
      'test-centre': cap(true, true),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['firebase_push'],
  },
  {
    channel: 'in_app',
    label: 'In-App',
    description: 'Messages surfaced inside the product notification centre.',
    kind: 'inbound_surface',
    chunk: 'C9',
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      identities: cap(true, true),
      endpoints: cap(true, false, IN_APP_NO_ENDPOINT),
      bindings: cap(true, true),
      policies: cap(true, true),
      'release-control': cap(true, true),
      // The shared Test Centre proves an EXTERNAL provider credential and a
      // delivery callback. The internal in-app adapter has neither: the proof
      // is the notification appearing in the recipient's own inbox.
      'test-centre': cap(true, false, IN_APP_NO_EXTERNAL_PROVIDER),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['internal_in_app'],
  },
  {
    channel: 'webhook',
    label: 'Webhook',
    description: 'Machine-to-machine delivery to a configured remote endpoint.',
    kind: 'endpoint',
    chunk: 'C10',
    // A real server-only signed outbound adapter ships in
    // `_shared/omni-comms/outboundWebhookAdapter.ts`.
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      // The subscriber endpoint IS the destination: there is no sender
      // identity to resolve for a machine-to-machine delivery.
      identities: cap(
        true,
        false,
        'Webhook delivery addresses a configured subscriber endpoint, so no sender identity is resolved.',
      ),
      endpoints: cap(true, true),
      bindings: cap(true, true),
      policies: cap(true, true),
      'release-control': cap(true, true),
      'test-centre': cap(true, true),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['outbound_webhook'],
  },
  {
    channel: 'print',
    label: 'Print',
    description: 'Physical letter production and archived PDF artefacts.',
    kind: 'physical',
    chunk: 'C10',
    implemented: true,
    databaseSupported: true,
    capabilities: matrix({
      providers: cap(true, true),
      accounts: cap(true, true),
      identities: cap(true, true),
      endpoints: cap(true, true),
      bindings: cap(true, true),
      policies: cap(true, true),
      'release-control': cap(true, true),
      // The shared Test Centre proves an EXTERNAL provider credential and
      // delivery callback. The internal print spool has neither, so the proof
      // for Print is the archived PDF in the print production queue.
      'test-centre': cap(true, false, PRINT_NO_EXTERNAL_PROVIDER),
      diagnostics: cap(true, true),
    }),
    reservedProviders: ['print_spool'],
  },

  {
    channel: 'voice',
    label: 'Voice',
    description: 'Outbound voice / IVR notification calls.',
    kind: 'addressed',
    chunk: 'C10',
    implemented: false,
    databaseSupported: false,
    capabilities: plannedMatrix(),
    reservedProviders: [],
  },
];

export const OMNI_COMMS_CHANNEL_CATALOGUE: readonly OmniCommsChannelDescriptor[] =
  SEEDS.map((s) => ({
    ...s,
    tabs: deriveTabsFromCapabilities(s.capabilities),
    seedNamespace: `omni_comms_seed:${s.channel}`,
  }));

const BY_CHANNEL = new Map<string, OmniCommsChannelDescriptor>(
  OMNI_COMMS_CHANNEL_CATALOGUE.map((d) => [d.channel, d]),
);

export function isOmniCommsChannel(value: unknown): value is OmniCommsChannel {
  return typeof value === 'string' && BY_CHANNEL.has(value);
}

/**
 * Resolve a raw (URL) value to a descriptor, never throwing.
 *
 * Catalogue-first: an unknown, empty or missing value resolves to `null` so
 * the caller renders the channel catalogue. No channel is ever silently
 * selected on the operator's behalf.
 */
export function findChannelDescriptor(
  raw: string | null | undefined,
): OmniCommsChannelDescriptor | null {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return BY_CHANNEL.get(key) ?? null;
}

export function getChannelDescriptor(
  channel: OmniCommsChannel,
): OmniCommsChannelDescriptor {
  return BY_CHANNEL.get(channel)!;
}

export function getImplementedChannels(): readonly OmniCommsChannelDescriptor[] {
  return OMNI_COMMS_CHANNEL_CATALOGUE.filter((d) => d.implemented);
}

/** Capability lookup — the ONE way to ask "is this resource offered here?". */
export function channelCapability(
  channel: OmniCommsChannel,
  resource: OmniCommsChannelResource,
): OmniCommsChannelCapability {
  return getChannelDescriptor(channel).capabilities[resource];
}

export function isResourceUiApplicable(
  channel: OmniCommsChannel,
  resource: OmniCommsChannelResource,
): boolean {
  return channelCapability(channel, resource).uiApplicable;
}

/** True when the tab is part of this channel's approved workspace. */
export function isTabApplicable(
  channel: OmniCommsChannel,
  tab: OmniCommsGenericTab,
): boolean {
  if (tab === 'overview') return true;
  return isResourceUiApplicable(channel, tab as OmniCommsChannelResource);
}

/**
 * Resolve a requested tab for a channel. An out-of-capability tab (stale deep
 * link, hand-edited URL, channel switch) always falls back to Overview.
 */
export function resolveApplicableTab(
  channel: OmniCommsChannel,
  requested: OmniCommsGenericTab,
): OmniCommsGenericTab {
  return isTabApplicable(channel, requested) ? requested : 'overview';
}

/** Seed namespace for a channel — the only legal prefix for its seed rows. */
export function channelSeedNamespace(channel: OmniCommsChannel): string {
  return getChannelDescriptor(channel).seedNamespace;
}

/**
 * Seed isolation guard: a seed key belongs to exactly one channel namespace.
 * Returns false for keys owned by another channel or with no namespace.
 */
export function isSeedKeyIsolatedTo(
  seedKey: string,
  channel: OmniCommsChannel,
): boolean {
  const own = channelSeedNamespace(channel);
  if (!seedKey.startsWith(`${own}.`)) return false;
  return !OMNI_COMMS_CHANNEL_CATALOGUE.some(
    (d) => d.channel !== channel && seedKey.startsWith(`${d.seedNamespace}.`),
  );
}

/** Validate catalogue integrity. Returns a list of violations (empty = valid). */
export function validateChannelCatalogue(): string[] {
  const errors: string[] = [];
  const seenChannel = new Set<string>();
  const seenNamespace = new Set<string>();

  for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
    if (seenChannel.has(d.channel)) errors.push(`Duplicate channel: ${d.channel}`);
    seenChannel.add(d.channel);

    if (seenNamespace.has(d.seedNamespace)) {
      errors.push(`Duplicate seed namespace: ${d.seedNamespace}`);
    }
    seenNamespace.add(d.seedNamespace);

    if (d.seedNamespace !== `omni_comms_seed:${d.channel}`) {
      errors.push(`Seed namespace must be omni_comms_seed:${d.channel}`);
    }
    if (!d.tabs.includes('overview')) {
      errors.push(`Channel ${d.channel} must expose the overview tab`);
    }
    if (d.tabs.length !== new Set(d.tabs).size) {
      errors.push(`Channel ${d.channel} has duplicate tabs`);
    }
    const order = OMNI_COMMS_GENERIC_TABS as readonly string[];
    const sorted = [...d.tabs].sort((a, b) => order.indexOf(a) - order.indexOf(b));
    if (sorted.join(',') !== d.tabs.join(',')) {
      errors.push(`Channel ${d.channel} tabs are not in canonical order`);
    }
    if (!d.implemented && d.reservedProviders.length > 0) {
      errors.push(`Channel ${d.channel} is not implemented but declares providers`);
    }
    if (d.implemented && !d.databaseSupported) {
      errors.push(`Channel ${d.channel} is implemented but has no schema support`);
    }

    // Capability integrity.
    for (const r of OMNI_COMMS_CHANNEL_RESOURCES) {
      const c = d.capabilities[r];
      if (!c) {
        errors.push(`Channel ${d.channel} is missing capability ${r}`);
        continue;
      }
      if (c.uiApplicable && !c.schemaSupported) {
        errors.push(
          `Channel ${d.channel} exposes ${r} without database schema support`,
        );
      }
      if (!c.reason.trim()) {
        errors.push(`Channel ${d.channel} capability ${r} has no reason`);
      }
      if (!d.databaseSupported && (c.schemaSupported || c.uiApplicable)) {
        errors.push(
          `Planned channel ${d.channel} must not claim capability ${r}`,
        );
      }
    }

    // Release Control is channel-generic, but it may only be exposed for a
    // channel that has a genuine deployed delivery adapter.
    if (!d.implemented && d.capabilities['release-control'].uiApplicable) {
      errors.push(`Channel ${d.channel} must not expose Release Control`);
    }

    const derived = deriveTabsFromCapabilities(d.capabilities);
    if (derived.join(',') !== d.tabs.join(',')) {
      errors.push(`Channel ${d.channel} tabs are not derived from capabilities`);
    }
  }

  if (OMNI_COMMS_CHANNEL_CATALOGUE.length !== OMNI_COMMS_CHANNELS.length) {
    errors.push('Catalogue length does not match the channel identifier list');
  }
  for (const c of OMNI_COMMS_CHANNELS) {
    if (!seenChannel.has(c)) errors.push(`Missing catalogue entry for ${c}`);
  }
  return errors;
}
