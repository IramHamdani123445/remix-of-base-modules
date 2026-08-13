/**
 * Omni-Comms — SIMPLE operator section model.
 *
 * A normal administrator sees exactly three areas:
 *
 *   Overview → Settings → Activity
 *
 * The five-stage workflow (Overview / Delivery Setup / Test & Verify /
 * Go Live / Health) is no longer advertised. Every legacy `?tab=` code still
 * resolves — it is simply mapped into one of the three areas, so bookmarks and
 * support links keep working.
 *
 * Boundaries (permanent):
 *   - Pure metadata. No React, no RPC, no provider SDK, no send behaviour.
 *   - The tab VOCABULARY is untouched; nothing is added, renamed or removed.
 *   - `advanced` is a forbidden route/name segment.
 */
import {
  OMNI_COMMS_GENERIC_TABS,
  type OmniCommsGenericTab,
} from '@/platform/omni-comms/domain/channelCatalogue';

export const CHANNEL_SIMPLE_SECTIONS = ['overview', 'settings', 'activity'] as const;

export type ChannelSimpleSection = (typeof CHANNEL_SIMPLE_SECTIONS)[number];

export interface ChannelSimpleSectionDefinition {
  readonly id: ChannelSimpleSection;
  readonly label: string;
  readonly description: string;
  /** The `?tab=` code this area lands on. */
  readonly landingTab: OmniCommsGenericTab;
}

export const CHANNEL_SIMPLE_SECTION_DEFINITIONS:
readonly ChannelSimpleSectionDefinition[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Is automatic delivery on, is it healthy, and what is waiting.',
    landingTab: 'overview',
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Provider, sender, domain, routing, limits and business communications.',
    landingTab: 'accounts',
  },
  {
    id: 'activity',
    label: 'Activity',
    description: 'What has been sent, what is queued and what needs review.',
    landingTab: 'diagnostics',
  },
] as const;

/**
 * Legacy `?tab=` → simple area.
 *
 * `test-centre` and `release-control` fold into Overview: the test action and
 * the delivery switch both live there now. Their detailed governance surfaces
 * remain reachable through Technical details.
 */
const SIMPLE_SECTION_FOR_TAB: Readonly<Record<OmniCommsGenericTab, ChannelSimpleSection>> = {
  overview: 'overview',
  'test-centre': 'overview',
  'release-control': 'overview',
  accounts: 'settings',
  identities: 'settings',
  endpoints: 'settings',
  bindings: 'settings',
  policies: 'settings',
  providers: 'settings',
  diagnostics: 'activity',
};

/** Tabs presented as configuration cards inside Settings, in operator order. */
export const CHANNEL_SETTINGS_TABS: readonly OmniCommsGenericTab[] = [
  'accounts',
  'identities',
  'endpoints',
  'bindings',
  'policies',
  'providers',
];

/** Tabs only support engineers need. Reachable through Technical details. */
export const CHANNEL_TECHNICAL_TABS: readonly OmniCommsGenericTab[] = [
  'release-control',
  'test-centre',
  'diagnostics',
];

export function simpleSectionForTab(
  tab: string | null | undefined,
): ChannelSimpleSection {
  const t = (tab ?? '').trim().toLowerCase() as OmniCommsGenericTab;
  return SIMPLE_SECTION_FOR_TAB[t] ?? 'overview';
}

export function getSimpleSectionDefinition(
  section: ChannelSimpleSection,
): ChannelSimpleSectionDefinition {
  return (
    CHANNEL_SIMPLE_SECTION_DEFINITIONS.find((s) => s.id === section)
    ?? CHANNEL_SIMPLE_SECTION_DEFINITIONS[0]
  );
}

export function landingTabForSimpleSection(
  section: ChannelSimpleSection,
): OmniCommsGenericTab {
  return getSimpleSectionDefinition(section).landingTab;
}

/** Operator-facing card titles for the Settings area. */
export const CHANNEL_SETTINGS_CARD_LABELS: Record<OmniCommsGenericTab, string> = {
  overview: 'Overview',
  accounts: 'Email provider',
  identities: 'Sender',
  endpoints: 'Sending domain',
  bindings: 'Delivery routing',
  policies: 'Production limits',
  providers: 'Supported providers',
  'test-centre': 'Test delivery',
  'release-control': 'Delivery authorisation',
  diagnostics: 'Delivery evidence',
};

/** One plain sentence per Settings card. */
export const CHANNEL_SETTINGS_CARD_HINTS: Record<OmniCommsGenericTab, string> = {
  overview: 'Readiness and the next action.',
  accounts: 'The service that actually delivers the message.',
  identities: 'The address recipients see the message come from.',
  endpoints: 'The domain the provider may send on your behalf.',
  bindings: 'Which sender uses which provider account.',
  policies: 'Recipient and volume limits applied to every send.',
  providers: 'Providers this channel can use.',
  'test-centre': 'Send a test message to a person you choose.',
  'release-control': 'Authorisation history and governance evidence.',
  diagnostics: 'Read-only delivery evidence.',
};

/**
 * Where a health row sends the operator when it needs attention. Keys are the
 * server's delivery indicator keys — never invented in the browser.
 */
export const HEALTH_INDICATOR_TAB: Readonly<Record<string, OmniCommsGenericTab>> = {
  provider: 'accounts',
  sender_domain: 'identities',
  events_templates: 'bindings',
  dispatcher: 'release-control',
  callbacks: 'accounts',
  safety: 'policies',
};

export function tabForHealthIndicator(key: string | null | undefined): OmniCommsGenericTab {
  return HEALTH_INDICATOR_TAB[(key ?? '').trim()] ?? 'accounts';
}

/** Structural self-check used by tests. */
export function validateChannelSimpleSectionModel(): string[] {
  const problems: string[] = [];
  for (const tab of OMNI_COMMS_GENERIC_TABS) {
    if (!SIMPLE_SECTION_FOR_TAB[tab]) {
      problems.push(`${tab}: not mapped to a simple area`);
    }
  }
  for (const section of CHANNEL_SIMPLE_SECTION_DEFINITIONS) {
    if (!(OMNI_COMMS_GENERIC_TABS as readonly string[]).includes(section.landingTab)) {
      problems.push(`${section.id}: landing tab is outside the canonical vocabulary`);
    }
  }
  return problems;
}
