/**
 * Omni-Comms C1 — typed frontend channel UI registry.
 *
 * SINGLE source of truth for the operator-facing channel catalogue rendered on
 * /admin/omnichannel-communications/channels.
 *
 * Boundaries (permanent):
 *   - Pure metadata. No React, no RPC, no provider SDK, no send behaviour.
 *   - `planned` channels are fail-closed: no mutation controls are offered and
 *     the database schema is NOT extended in C1.
 */
import type { OmniCommsChannel } from '@/platform/omni-comms/domain/channelCatalogue';

/** Workspace tab vocabulary (mirrors useOmniCommsTabParam). */
export const CHANNEL_WORKSPACE_TABS = [
  'overview',
  'accounts',
  'identities',
  'endpoints',
  'bindings',
  'policies',
  'test-centre',
  'diagnostics',
] as const;

export type ChannelWorkspaceTab = (typeof CHANNEL_WORKSPACE_TABS)[number];

export const CHANNEL_WORKSPACE_TAB_LABELS: Record<ChannelWorkspaceTab, string> = {
  overview: 'Overview',
  accounts: 'Accounts',
  identities: 'Identities',
  endpoints: 'Endpoints',
  bindings: 'Bindings',
  policies: 'Policies',
  'test-centre': 'Test Centre',
  diagnostics: 'Diagnostics',
};

/**
 * Implementation state as presented to operators.
 *  - configuring     — real configuration surface is wired (email only in C1)
 *  - not_configured  — schema supports the channel, no surface yet
 *  - planned         — database extension required; nothing configurable
 */
export type ChannelImplementationState =
  | 'configuring'
  | 'not_configured'
  | 'planned';

export const CHANNEL_IMPLEMENTATION_LABEL: Record<
  ChannelImplementationState,
  string
> = {
  configuring: 'Configuring',
  not_configured: 'Not configured',
  planned: 'Planned',
};

export interface ChannelAccountsCopy {
  /** What a "provider account" means for this channel. */
  readonly meaning: string;
  /** Illustrative providers — never installed or created by this screen. */
  readonly examples: readonly string[];
  /** Build chunk that will implement the capability. */
  readonly futureBuild: string;
}

export interface ChannelUiDefinition {
  readonly code: OmniCommsChannel;
  readonly name: string;
  readonly description: string;
  /** lucide-react icon identifier. */
  readonly icon: string;
  readonly implementationState: ChannelImplementationState;
  /** Whether the CURRENT database schema supports this channel value. */
  readonly databaseSupported: boolean;
  readonly tabs: readonly ChannelWorkspaceTab[];
  /** Short truthful status sentence shown on the catalogue card. */
  readonly statusText: string;
  readonly accounts: ChannelAccountsCopy;
  /** Explanatory identity empty state. */
  readonly identities: string;
  /** Future endpoint responsibilities (UI shell only in C1). */
  readonly endpoints: readonly string[];
  /** Binding empty-state explanation. */
  readonly bindings: string;
  /** Future policy fields — displayed, never saved, for non-email channels. */
  readonly policies: readonly string[];
}

const COMMON_TABS = [...CHANNEL_WORKSPACE_TABS] as ChannelWorkspaceTab[];

const FUTURE_POLICY_FIELDS: readonly string[] = [
  'Enabled state',
  'Test-only state',
  'Rate limits',
  'Quiet hours',
  'Country restrictions',
  'Recipient limits',
  'Media/attachment limits',
  'Retry profile',
  'Cost controls',
];

export const OMNI_COMMS_CHANNEL_UI_CATALOGUE: readonly ChannelUiDefinition[] = [
  {
    code: 'email',
    name: 'Email',
    description:
      'Transactional email configuration: provider account, sender identities, bindings and channel policy.',
    icon: 'Mail',
    implementationState: 'configuring',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'Configuration in progress. Provider dispatch is not implemented.',
    accounts: {
      meaning:
        'A credentialed email provider account resolved from an Edge Function secret reference.',
      examples: ['Resend'],
      futureBuild: 'C6 — Resend email end-to-end',
    },
    identities: 'Email sender identities (from address, from name, reply-to).',
    endpoints: [
      'Sending domains',
      'SPF',
      'DKIM',
      'Bounce and complaint callbacks',
    ],
    bindings: 'Sender identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'sms',
    name: 'SMS',
    description: 'Short message delivery to mobile numbers.',
    icon: 'MessageSquare',
    implementationState: 'not_configured',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'No configuration exists for this organisation yet.',
    accounts: {
      meaning:
        'A telecom or aggregator account that accepts outbound SMS on behalf of the organisation.',
      examples: ['Twilio', 'Vonage', 'A local telecom gateway'],
      futureBuild: 'C7 — SMS adapter',
    },
    identities: 'Sender ID or originating number.',
    endpoints: ['Delivery receipt callback', 'Inbound SMS callback'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'whatsapp',
    name: 'WhatsApp',
    description: 'Template-governed WhatsApp Business messaging.',
    icon: 'MessagesSquare',
    implementationState: 'not_configured',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'No configuration exists for this organisation yet.',
    accounts: {
      meaning:
        'A WhatsApp Business account provisioned through Meta or an approved business solution provider.',
      examples: [
        'Meta WhatsApp Cloud API',
        'Twilio WhatsApp',
        'An approved BSP',
      ],
      futureBuild: 'C8 — WhatsApp adapter',
    },
    identities: 'WhatsApp business number and phone-number ID.',
    endpoints: [
      'Meta/BSP webhook',
      'Verify token',
      'Callback signing secret',
    ],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'push',
    name: 'Push Notifications',
    description: 'Mobile and web push notifications to registered devices.',
    icon: 'BellRing',
    implementationState: 'not_configured',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'No configuration exists for this organisation yet.',
    accounts: {
      meaning:
        'A push messaging project holding the credentials used to reach device tokens.',
      examples: ['Firebase', 'APNs', 'OneSignal'],
      futureBuild: 'C9 — Push and In-App',
    },
    identities: 'Mobile or web application identity.',
    endpoints: ['Firebase/APNs application endpoint and credentials'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'in_app',
    name: 'In-App Notifications',
    description: 'Messages surfaced inside the product notification centre.',
    icon: 'Inbox',
    implementationState: 'not_configured',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'No configuration exists for this organisation yet.',
    accounts: {
      meaning:
        'An internal delivery account; no external provider contract is required.',
      examples: ['Internal Omni-Comms provider'],
      futureBuild: 'C9 — Push and In-App',
    },
    identities: 'Application or system identity.',
    endpoints: ['Internal realtime/application endpoint'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'webhook',
    name: 'Webhooks',
    description: 'Machine-to-machine delivery to a configured remote endpoint.',
    icon: 'Webhook',
    implementationState: 'planned',
    databaseSupported: false,
    tabs: COMMON_TABS,
    statusText:
      'Planned. Database extension required before this channel can be configured.',
    accounts: {
      meaning:
        'A destination system contract, including signing configuration and delivery credentials.',
      examples: ['Internal integration endpoint'],
      futureBuild: 'C10 — Webhook, Print and Voice',
    },
    identities: 'Integration identity.',
    endpoints: ['Destination URL and signing configuration'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'print',
    name: 'Print and Correspondence',
    description: 'Physical letter production and archived correspondence.',
    icon: 'Printer',
    implementationState: 'not_configured',
    databaseSupported: true,
    tabs: COMMON_TABS,
    statusText: 'No configuration exists for this organisation yet.',
    accounts: {
      meaning:
        'A document rendering or print fulfilment service used to produce physical correspondence.',
      examples: ['Internal renderer', 'Print-service provider'],
      futureBuild: 'C10 — Webhook, Print and Voice',
    },
    identities: 'Issuing authority and letterhead profile.',
    endpoints: ['Document renderer or print-service endpoint'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
  {
    code: 'voice',
    name: 'Voice and IVR',
    description: 'Outbound voice and IVR notification calls.',
    icon: 'PhoneCall',
    implementationState: 'planned',
    databaseSupported: false,
    tabs: COMMON_TABS,
    statusText:
      'Planned. Database extension required before this channel can be configured.',
    accounts: {
      meaning:
        'A voice carrier account permitted to place outbound calls for the organisation.',
      examples: ['Voice carrier or telephony gateway'],
      futureBuild: 'C10 — Webhook, Print and Voice',
    },
    identities: 'Originating number and voice profile.',
    endpoints: ['IVR callbacks', 'Call-status callbacks'],
    bindings: 'Identity → provider account → priority/fallback.',
    policies: FUTURE_POLICY_FIELDS,
  },
] as const;

const BY_CODE = new Map<string, ChannelUiDefinition>(
  OMNI_COMMS_CHANNEL_UI_CATALOGUE.map((d) => [d.code, d]),
);

/** Resolve a raw URL value. Unknown values return null (catalogue fallback). */
export function resolveChannelUi(
  raw: string | null | undefined,
): ChannelUiDefinition | null {
  if (typeof raw !== 'string') return null;
  return BY_CODE.get(raw.trim().toLowerCase()) ?? null;
}

export function getChannelUi(code: OmniCommsChannel): ChannelUiDefinition {
  return BY_CODE.get(code)!;
}

/** Only `configuring` channels expose real mutation controls in C1. */
export function isChannelConfigurable(def: ChannelUiDefinition): boolean {
  return def.implementationState === 'configuring';
}

/** Planned channels expose no configurable tabs beyond read-only explanation. */
export function isTabDisabled(
  def: ChannelUiDefinition,
  tab: ChannelWorkspaceTab,
): boolean {
  if (def.implementationState !== 'planned') return false;
  return tab !== 'overview' && tab !== 'endpoints';
}

/** Structural self-check used by tests. */
export function validateChannelUiCatalogue(): string[] {
  const problems: string[] = [];
  if (OMNI_COMMS_CHANNEL_UI_CATALOGUE.length !== 8) {
    problems.push('catalogue must declare exactly eight channels');
  }
  for (const d of OMNI_COMMS_CHANNEL_UI_CATALOGUE) {
    if (d.implementationState === 'planned' && d.databaseSupported) {
      problems.push(`${d.code}: planned channels must not claim schema support`);
    }
    if (d.implementationState !== 'configuring' && d.code === 'email') {
      problems.push('email must be presented as configuring');
    }
    if (d.tabs.length === 0) problems.push(`${d.code}: no tabs declared`);
  }
  return problems;
}
