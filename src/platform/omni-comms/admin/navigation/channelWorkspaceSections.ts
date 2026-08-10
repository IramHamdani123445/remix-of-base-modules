/**
 * Omni-Comms UX Simplification — channel workspace SECTION model.
 *
 * This replaces the ten-destination vertical rail with five task-shaped
 * sections an operator can reason about:
 *
 *   Overview → Delivery Setup → Test & Verify → Go Live → Health
 *
 * Boundaries (permanent):
 *   - Pure metadata. No React, no RPC, no provider SDK, no send behaviour.
 *   - The tab VOCABULARY is untouched. Every section is composed from existing
 *     `?tab=` codes declared in `domain/channelCatalogue.ts`, so every existing
 *     deep link (`?tab=identities`, `?tab=release-control`, …) still resolves
 *     to exactly the same surface — it is simply presented inside a section.
 *   - No tab code is added, renamed or removed here.
 *   - `advanced` is a forbidden route/name segment (architecture Rule 10).
 */
import {
  OMNI_COMMS_GENERIC_TABS,
  type OmniCommsGenericTab,
} from '@/platform/omni-comms/domain/channelCatalogue';

export const CHANNEL_WORKSPACE_SECTIONS = [
  'overview',
  'delivery-setup',
  'test-verify',
  'go-live',
  'health',
] as const;

export type ChannelWorkspaceSection =
  (typeof CHANNEL_WORKSPACE_SECTIONS)[number];

export interface ChannelSectionDefinition {
  readonly id: ChannelWorkspaceSection;
  /** Operator-facing label. Plain product language, never architecture. */
  readonly label: string;
  /** One sentence explaining the job this section does. */
  readonly description: string;
  /**
   * Existing `?tab=` codes this section presents, in operator order.
   * The first entry is the section's default destination.
   */
  readonly tabs: readonly OmniCommsGenericTab[];
}

/**
 * Section definitions. The union of every `tabs` array is exactly the generic
 * tab vocabulary — asserted by {@link validateChannelSectionModel}.
 */
export const CHANNEL_SECTION_DEFINITIONS: readonly ChannelSectionDefinition[] = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'What works today, what is blocked and what to do next.',
    tabs: ['overview'],
  },
  {
    id: 'delivery-setup',
    label: 'Delivery Setup',
    description:
      'Everything needed before a message can be delivered: provider account, '
      + 'credentials, sender addresses, sending domains, routing and rules.',
    tabs: [
      'accounts',
      'identities',
      'endpoints',
      'bindings',
      'policies',
      'providers',
    ],
  },
  {
    id: 'test-verify',
    label: 'Test & Verify',
    description: 'Prove the setup works before anything reaches a real person.',
    tabs: ['test-centre'],
  },
  {
    id: 'go-live',
    label: 'Go Live',
    description: 'Request, approve and control real delivery.',
    tabs: ['release-control'],
  },
  {
    id: 'health',
    label: 'Health',
    description: 'Delivery evidence and diagnostics for this channel.',
    tabs: ['diagnostics'],
  },
] as const;

/**
 * Operator-facing tab labels used INSIDE a section.
 *
 * These deliberately differ from the legacy architecture labels: an operator
 * looks for "Sender addresses", not "Identities".
 */
export const CHANNEL_SECTION_TAB_LABELS: Record<OmniCommsGenericTab, string> = {
  overview: 'Overview',
  accounts: 'Provider account',
  identities: 'Sender addresses',
  endpoints: 'Sending domains',
  bindings: 'Delivery routing',
  policies: 'Sending rules',
  providers: 'Provider catalog',
  'test-centre': 'Test & Verify',
  'release-control': 'Go Live',
  diagnostics: 'Health',
};

/** Short helper text shown under each Delivery Setup step. */
export const CHANNEL_SECTION_TAB_HINTS: Record<OmniCommsGenericTab, string> = {
  overview: 'Readiness, blockers and the next action.',
  accounts: 'Connect the service that actually delivers the message.',
  identities: 'The address recipients see the message come from.',
  endpoints: 'The domain the provider is allowed to send on your behalf.',
  bindings: 'Which sender uses which provider account, and in what order.',
  policies: 'Limits and safety rules applied to every send.',
  providers: 'Providers this channel supports.',
  'test-centre': 'Run a preflight and a controlled test delivery.',
  'release-control': 'Propose, approve and activate controlled live delivery.',
  diagnostics: 'Read-only delivery evidence and diagnostics.',
};

const SECTION_FOR_TAB = new Map<OmniCommsGenericTab, ChannelWorkspaceSection>();
for (const section of CHANNEL_SECTION_DEFINITIONS) {
  for (const tab of section.tabs) SECTION_FOR_TAB.set(tab, section.id);
}

/** Which section presents a given `?tab=` code. Unknown values → Overview. */
export function sectionForTab(
  tab: string | null | undefined,
): ChannelWorkspaceSection {
  const t = (tab ?? '').trim().toLowerCase() as OmniCommsGenericTab;
  return SECTION_FOR_TAB.get(t) ?? 'overview';
}

/** The section's default `?tab=` code. */
export function defaultTabForSection(
  section: ChannelWorkspaceSection,
): OmniCommsGenericTab {
  const def = CHANNEL_SECTION_DEFINITIONS.find((s) => s.id === section);
  return def ? def.tabs[0] : 'overview';
}

export function getSectionDefinition(
  section: ChannelWorkspaceSection,
): ChannelSectionDefinition {
  return (
    CHANNEL_SECTION_DEFINITIONS.find((s) => s.id === section)
    ?? CHANNEL_SECTION_DEFINITIONS[0]
  );
}

export interface ChannelSectionView extends ChannelSectionDefinition {
  /** Tabs of this section the selected channel actually supports. */
  readonly availableTabs: readonly OmniCommsGenericTab[];
}

/**
 * Build the sections offered for one channel.
 *
 * A section with no supported tab is omitted entirely, so a channel is never
 * shown a destination it cannot use.
 */
export function buildChannelSections(
  supportedTabs: readonly OmniCommsGenericTab[],
): ChannelSectionView[] {
  const supported = new Set<string>(supportedTabs);
  const out: ChannelSectionView[] = [];
  for (const section of CHANNEL_SECTION_DEFINITIONS) {
    const availableTabs = section.tabs.filter((t) => supported.has(t));
    if (availableTabs.length > 0) out.push({ ...section, availableTabs });
  }
  return out;
}

/**
 * Deep-link target for a readiness/go-live blocker.
 *
 * The Overview readiness summary offers exactly one primary action, and that
 * action must land on the surface that fixes the blocker.
 */
export const READINESS_CHECK_TAB: Readonly<Record<string, OmniCommsGenericTab>> =
  {
    adapter: 'accounts',
    account: 'accounts',
    credentials: 'accounts',
    identity: 'identities',
    sending_domain: 'endpoints',
    sending_domain_verification: 'endpoints',
    event_callback: 'endpoints',
    callback_receiver: 'endpoints',
    callback_evidence: 'endpoints',
    binding: 'bindings',
    binding_verification: 'bindings',
    policy: 'policies',
    policy_state: 'policies',
    configuration_preflight: 'test-centre',
    technical_test: 'test-centre',
    provider_delivery_test: 'test-centre',
    release_control_configured: 'release-control',
    release_prerequisites: 'release-control',
    release_control: 'release-control',
    business_dispatch: 'release-control',
    business_delivery_attempt: 'diagnostics',
    business_delivery_confirmed: 'diagnostics',
    pilot_safety: 'diagnostics',
  };

/** Resolve where an operator must go to clear a blocker. */
export function tabForReadinessCheck(
  key: string | null | undefined,
): OmniCommsGenericTab {
  return READINESS_CHECK_TAB[(key ?? '').trim()] ?? 'overview';
}

/** Structural self-check used by tests. */
export function validateChannelSectionModel(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const section of CHANNEL_SECTION_DEFINITIONS) {
    if (section.tabs.length === 0) {
      problems.push(`${section.id}: section presents no tab`);
    }
    for (const tab of section.tabs) {
      if (seen.has(tab)) problems.push(`${tab}: presented by more than one section`);
      seen.add(tab);
      if (!(OMNI_COMMS_GENERIC_TABS as readonly string[]).includes(tab)) {
        problems.push(`${tab}: not part of the canonical tab vocabulary`);
      }
    }
  }
  for (const tab of OMNI_COMMS_GENERIC_TABS) {
    if (!seen.has(tab)) problems.push(`${tab}: not presented by any section`);
  }
  return problems;
}
