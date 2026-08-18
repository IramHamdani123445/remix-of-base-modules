/**
 * Omni-Comms C2.1 — provider adapter catalogue.
 *
 * Declares which provider adapters an operator may register for a channel and
 * which named credential purposes each one needs. This is pure metadata used
 * to pre-fill the Providers form; the database remains the source of truth for
 * what is actually registered.
 *
 * Boundaries (permanent):
 *   - No provider SDK import. No network call. No credential VALUE is ever
 *     modelled here — only secret REFERENCE name patterns.
 *   - `deliveryImplemented` is truthful: only adapters with a real server-side
 *     Omni-Comms implementation may claim it. Everything else can be
 *     registered and configured, but cannot deliver until its adapter ships.
 */
import type { OmniCommsChannel } from './channelCatalogue';

export interface ProviderCredentialRequirementTemplate {
  readonly purpose: string;
  readonly displayName: string;
  readonly description?: string;
  readonly required: boolean;
  /** Accepted Edge secret reference NAME pattern (regex source). */
  readonly secretRefPattern: string;
}

export interface ProviderAdapterDescriptor {
  readonly adapterKey: string;
  readonly label: string;
  readonly channel: OmniCommsChannel;
  /** True only when a real Omni-Comms server-side adapter exists. */
  readonly deliveryImplemented: boolean;
  /** True when a real server-side credential verifier exists. */
  readonly verificationImplemented: boolean;
  readonly credentials: readonly ProviderCredentialRequirementTemplate[];
  readonly notes: string;
}

const KEY = (channel: string, name: string) =>
  `^OMNI_COMMS_${channel.toUpperCase()}_${name.toUpperCase()}_[A-Z0-9_]+$`;

export const OMNI_COMMS_PROVIDER_ADAPTERS: readonly ProviderAdapterDescriptor[] = [
  {
    adapterKey: 'resend',
    label: 'Resend',
    channel: 'email',
    deliveryImplemented: true,
    verificationImplemented: true,
    credentials: [
      {
        purpose: 'api_key',
        displayName: 'Resend API key',
        description: 'Edge secret holding the Resend API key.',
        required: true,
        secretRefPattern: '^OMNI_COMMS_RESEND_[A-Z0-9_]+$',
      },
    ],
    notes: 'Controlled test delivery and credential verification are implemented.',
  },
  {
    adapterKey: 'smtp',
    label: 'Generic SMTP relay',
    channel: 'email',
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [
      {
        purpose: 'smtp_username',
        displayName: 'SMTP username secret',
        required: true,
        secretRefPattern: KEY('email', 'smtp'),
      },
      {
        purpose: 'smtp_password',
        displayName: 'SMTP password secret',
        required: true,
        secretRefPattern: KEY('email', 'smtp'),
      },
    ],
    notes: 'Registration and configuration only — no SMTP adapter is deployed.',
  },
  {
    adapterKey: 'twilio',
    label: 'Twilio (SMS)',
    channel: 'sms',
    // A real server-only Twilio adapter ships in
    // `_shared/omni-comms/twilioSmsAdapter.ts`; approved technical test
    // delivery and read-only credential verification are implemented.
    deliveryImplemented: true,
    verificationImplemented: true,
    credentials: [
      {
        purpose: 'account_sid',
        displayName: 'Twilio account SID secret',
        description: 'Edge secret (or vault reference) holding the Twilio account SID.',
        required: true,
        secretRefPattern: '^OMNI_COMMS_TWILIO_[A-Z0-9_]+$',
      },
      {
        purpose: 'auth_token',
        displayName: 'Twilio auth token secret',
        description: 'Edge secret (or vault reference) holding the Twilio auth token.',
        required: true,
        secretRefPattern: '^OMNI_COMMS_TWILIO_[A-Z0-9_]+$',
      },
      {
        purpose: 'messaging_service_sid',
        displayName: 'Twilio Messaging Service SID (optional)',
        description: 'When present it takes precedence over the sender number.',
        required: false,
        secretRefPattern: '^OMNI_COMMS_TWILIO_[A-Z0-9_]+$',
      },
    ],
    notes:
      'Approved technical SMS test delivery and credential verification are implemented. Business SMS dispatch remains governed by the SMS delivery gate.',
  },

  {
    adapterKey: 'sms_gateway',
    label: 'Local SMS gateway',
    channel: 'sms',
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [
      {
        purpose: 'api_key',
        displayName: 'Gateway API key secret',
        required: true,
        secretRefPattern: KEY('sms', 'gateway'),
      },
    ],
    notes: 'Registration and configuration only — no SMS adapter is deployed.',
  },
  {
    adapterKey: 'meta_whatsapp',
    label: 'Meta WhatsApp Cloud API',
    channel: 'whatsapp',
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [
      {
        purpose: 'access_token',
        displayName: 'Permanent access token secret',
        required: true,
        secretRefPattern: KEY('whatsapp', 'meta'),
      },
      {
        purpose: 'app_secret',
        displayName: 'App secret',
        required: true,
        secretRefPattern: KEY('whatsapp', 'meta'),
      },
    ],
    notes: 'Registration and configuration only — no WhatsApp adapter is deployed.',
  },
  {
    adapterKey: 'firebase_push',
    label: 'Firebase Cloud Messaging',
    channel: 'push',
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [
      {
        purpose: 'service_account',
        displayName: 'Service account JSON secret',
        required: true,
        secretRefPattern: KEY('push', 'firebase'),
      },
    ],
    notes: 'Registration and configuration only — no push adapter is deployed.',
  },
  {
    adapterKey: 'internal_in_app',
    label: 'Internal in-app delivery',
    channel: 'in_app',
    // Internal production adapter: the portal notification inbox is the
    // "provider", so there is no external credential and nothing to verify.
    deliveryImplemented: true,
    verificationImplemented: false,
    credentials: [],
    notes:
      'Internal production — notifications are projected into the recipient portal inbox exactly once per message. No external credential is required, so nothing needs verifying.',
  },
  {
    adapterKey: 'print_spool',
    label: 'Print spool / letter production',
    channel: 'print',
    deliveryImplemented: true,
    verificationImplemented: false,
    credentials: [],
    notes:
      'Internal production — artefacts are written to the shared document store. No external credential is required, so nothing needs verifying.',
  },

];

/** Channels whose schema currently accepts a provider row. */
export const PROVIDER_REGISTRABLE_CHANNELS: readonly OmniCommsChannel[] = [
  'email',
  'sms',
  'in_app',
  'push',
  'whatsapp',
  'print',
];

export function providerRegistrationSupported(channel: OmniCommsChannel): boolean {
  return PROVIDER_REGISTRABLE_CHANNELS.includes(channel);
}

export function adaptersForChannel(
  channel: OmniCommsChannel,
): readonly ProviderAdapterDescriptor[] {
  return OMNI_COMMS_PROVIDER_ADAPTERS.filter((a) => a.channel === channel);
}

export function findAdapter(
  adapterKey: string,
): ProviderAdapterDescriptor | undefined {
  return OMNI_COMMS_PROVIDER_ADAPTERS.find((a) => a.adapterKey === adapterKey);
}

export function adapterDeliveryImplemented(adapterKey: string): boolean {
  return findAdapter(adapterKey)?.deliveryImplemented === true;
}

/**
 * True when the adapter genuinely needs no external credential (an internal
 * production adapter such as the Print spool). Such an account is complete the
 * moment it exists and can be activated without a verification step.
 */
export function adapterCredentialFree(adapterKey: string): boolean {
  const adapter = findAdapter(adapterKey);
  return Boolean(adapter && adapter.credentials.length === 0 && adapter.deliveryImplemented);
}

export const CREDENTIAL_FREE_ADAPTER_MESSAGE =
  'No external credential is required for this provider.';

export const NO_DELIVERY_ADAPTER_MESSAGE =
  'This provider can be registered and configured, but no delivery adapter is installed for it yet.';
