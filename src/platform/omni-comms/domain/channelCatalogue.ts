/**
 * Omni-Comms C1 — canonical channel catalogue.
 *
 * SINGLE source of truth for which communication channels exist, what
 * administration tabs each one exposes, and which seed namespace each channel
 * owns. Everything downstream (channel selector, generic tab shell, seed
 * packs, later adapter chunks C6–C10) MUST read from this file rather than
 * hard-coding channel identifiers.
 *
 * Boundaries (permanent):
 *   - No provider SDK imports here. This module is pure metadata.
 *   - No Legacy Communication Hub references.
 *   - `implemented: false` channels are fail-closed: the shell renders a
 *     reserved placeholder and no configuration surface is mounted.
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
  'accounts',
  'identities',
  'endpoints',
  'bindings',
  'policies',
  'test',
  'diagnostics',
] as const;

export type OmniCommsGenericTab = (typeof OMNI_COMMS_GENERIC_TABS)[number];

/** Delivery shape a channel uses — drives which tabs are meaningful. */
export type OmniCommsChannelKind =
  | 'addressed' // has sender identities + recipient addresses (email, sms, whatsapp, voice)
  | 'device' // targets registered devices/tokens (push)
  | 'inbound_surface' // rendered inside the product (in_app)
  | 'endpoint' // posts to a configured remote endpoint (webhook)
  | 'physical'; // produces a physical artefact (print)

/** Build chunk that owns delivery for this channel. */
export type OmniCommsChannelChunk = 'C6' | 'C7' | 'C8' | 'C9' | 'C10';

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
   * True only when the channel has a real administration surface wired.
   * Everything else renders the reserved placeholder (fail-closed).
   */
  readonly implemented: boolean;
  /** Tabs this channel exposes, in canonical order. */
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

function tabs(...t: OmniCommsGenericTab[]): readonly OmniCommsGenericTab[] {
  const order = OMNI_COMMS_GENERIC_TABS as readonly string[];
  return [...new Set(t)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

export const OMNI_COMMS_CHANNEL_CATALOGUE: readonly OmniCommsChannelDescriptor[] = [
  {
    channel: 'email',
    label: 'Email',
    description: 'Transactional email via the Resend provider account.',
    kind: 'addressed',
    chunk: 'C6',
    implemented: true,
    tabs: tabs('overview', 'accounts', 'identities', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.email',
    reservedProviders: ['resend'],
  },
  {
    channel: 'sms',
    label: 'SMS',
    description: 'Short message delivery through a reserved SMS adapter.',
    kind: 'addressed',
    chunk: 'C7',
    implemented: false,
    tabs: tabs('overview', 'accounts', 'identities', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.sms',
    reservedProviders: [],
  },
  {
    channel: 'whatsapp',
    label: 'WhatsApp',
    description: 'Template-governed WhatsApp Business messaging.',
    kind: 'addressed',
    chunk: 'C8',
    implemented: false,
    tabs: tabs('overview', 'accounts', 'identities', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.whatsapp',
    reservedProviders: [],
  },
  {
    channel: 'push',
    label: 'Push',
    description: 'Mobile and web push notifications to registered devices.',
    kind: 'device',
    chunk: 'C9',
    implemented: false,
    tabs: tabs('overview', 'accounts', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.push',
    reservedProviders: [],
  },
  {
    channel: 'in_app',
    label: 'In-App',
    description: 'Messages surfaced inside the product notification centre.',
    kind: 'inbound_surface',
    chunk: 'C9',
    implemented: false,
    tabs: tabs('overview', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.in_app',
    reservedProviders: [],
  },
  {
    channel: 'webhook',
    label: 'Webhook',
    description: 'Machine-to-machine delivery to a configured remote endpoint.',
    kind: 'endpoint',
    chunk: 'C10',
    implemented: false,
    tabs: tabs('overview', 'endpoints', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.webhook',
    reservedProviders: [],
  },
  {
    channel: 'print',
    label: 'Print',
    description: 'Physical letter production and archived PDF artefacts.',
    kind: 'physical',
    chunk: 'C10',
    implemented: false,
    tabs: tabs('overview', 'identities', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.print',
    reservedProviders: [],
  },
  {
    channel: 'voice',
    label: 'Voice',
    description: 'Outbound voice / IVR notification calls.',
    kind: 'addressed',
    chunk: 'C10',
    implemented: false,
    tabs: tabs('overview', 'accounts', 'identities', 'bindings', 'policies', 'test', 'diagnostics'),
    seedNamespace: 'omni-comms.seed.voice',
    reservedProviders: [],
  },
] as const;

export const OMNI_COMMS_DEFAULT_CHANNEL: OmniCommsChannel = 'email';

const BY_CHANNEL = new Map<string, OmniCommsChannelDescriptor>(
  OMNI_COMMS_CHANNEL_CATALOGUE.map((d) => [d.channel, d]),
);

export function isOmniCommsChannel(value: unknown): value is OmniCommsChannel {
  return typeof value === 'string' && BY_CHANNEL.has(value);
}

/** Resolve a raw (URL) value to a descriptor, never throwing. */
export function resolveChannelDescriptor(
  raw: string | null | undefined,
): OmniCommsChannelDescriptor {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return BY_CHANNEL.get(key) ?? BY_CHANNEL.get(OMNI_COMMS_DEFAULT_CHANNEL)!;
}

export function getChannelDescriptor(
  channel: OmniCommsChannel,
): OmniCommsChannelDescriptor {
  return BY_CHANNEL.get(channel)!;
}

export function getImplementedChannels(): readonly OmniCommsChannelDescriptor[] {
  return OMNI_COMMS_CHANNEL_CATALOGUE.filter((d) => d.implemented);
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

    if (d.seedNamespace !== `omni-comms.seed.${d.channel}`) {
      errors.push(`Seed namespace must be omni-comms.seed.${d.channel}`);
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
  }

  if (OMNI_COMMS_CHANNEL_CATALOGUE.length !== OMNI_COMMS_CHANNELS.length) {
    errors.push('Catalogue length does not match the channel identifier list');
  }
  for (const c of OMNI_COMMS_CHANNELS) {
    if (!seenChannel.has(c)) errors.push(`Missing catalogue entry for ${c}`);
  }
  return errors;
}
