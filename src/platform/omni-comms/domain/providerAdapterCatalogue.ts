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
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [
      {
        purpose: 'account_sid',
        displayName: 'Twilio account SID secret',
        required: true,
        secretRefPattern: KEY('sms', 'twilio'),
      },
      {
        purpose: 'auth_token',
        displayName: 'Twilio auth token secret',
        required: true,
        secretRefPattern: KEY('sms', 'twilio'),
      },
    ],
    notes: 'Registration and configuration only — no SMS adapter is deployed.',
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
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [],
    notes: 'Registration only — the in-app surface is delivered in build C9.',
  },
  {
    adapterKey: 'print_spool',
    label: 'Print spool / letter production',
    channel: 'print',
    deliveryImplemented: false,
    verificationImplemented: false,
    credentials: [],
    notes: 'Registration only — physical production ships in build C10.',
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

export const NO_DELIVERY_ADAPTER_MESSAGE =
  'This provider can be registered and configured, but no delivery adapter is installed for it yet.';
