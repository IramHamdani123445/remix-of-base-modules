// Omni-Comms — server-only delivery adapter registry.
//
// ONE place that answers, for any channel:
//   - is a genuine delivery adapter deployed?
//   - which credential purposes must the provider account carry?
//   - which secret-reference NAME pattern is permitted?
//
// Boundaries (permanent):
//   - No credential VALUE is modelled here — only reference name patterns.
//   - A channel may only claim delivery when a real adapter module ships.
//   - Callers (test delivery, business dispatch, callbacks) must consult this
//     registry instead of hard-coding channel `if` branches.

import { OMNI_COMMS_SECRET_REF_PATTERN } from "./resendAdapter.ts";
import { OMNI_COMMS_TWILIO_SECRET_REF_PATTERN } from "./twilioSmsAdapter.ts";

export interface OmniCommsAdapterDescriptor {
  /** Canonical channel value used by the database. */
  readonly channel: string;
  /** Adapter key registered on `omni_comms_provider.adapter_key`. */
  readonly adapterKey: string;
  readonly label: string;
  /** True only when a genuine server-side send implementation is deployed. */
  readonly deliveryImplemented: boolean;
  /** True when a genuine read-only credential verifier is deployed. */
  readonly verificationImplemented: boolean;
  /** Credential purposes that MUST be present on the provider account. */
  readonly requiredCredentialPurposes: readonly string[];
  /** Credential purposes the adapter may optionally use. */
  readonly optionalCredentialPurposes: readonly string[];
  /** Permitted Edge secret reference NAME pattern. */
  readonly secretRefPattern: RegExp;
  /** True when the channel resolves a verified sending domain. */
  readonly usesSendingDomain: boolean;
}

export const OMNI_COMMS_ADAPTERS: readonly OmniCommsAdapterDescriptor[] = [
  {
    channel: "email",
    adapterKey: "resend",
    label: "Resend",
    deliveryImplemented: true,
    verificationImplemented: true,
    requiredCredentialPurposes: ["api_key"],
    optionalCredentialPurposes: ["webhook_signing_secret"],
    secretRefPattern: OMNI_COMMS_SECRET_REF_PATTERN,
    usesSendingDomain: true,
  },
  {
    channel: "sms",
    adapterKey: "twilio",
    label: "Twilio (SMS)",
    deliveryImplemented: true,
    verificationImplemented: true,
    requiredCredentialPurposes: ["account_sid", "auth_token"],
    optionalCredentialPurposes: ["messaging_service_sid"],
    secretRefPattern: OMNI_COMMS_TWILIO_SECRET_REF_PATTERN,
    usesSendingDomain: false,
  },
  {
    // Internal production channel: the recipient portal inbox is the
    // "provider", so no external credential exists and no secret reference is
    // ever accepted. Delivery is a governed, exactly-once projection.
    channel: "in_app",
    adapterKey: "internal_in_app",
    label: "Internal in-app delivery",
    deliveryImplemented: true,
    verificationImplemented: false,
    requiredCredentialPurposes: [],
    optionalCredentialPurposes: [],
    secretRefPattern: /^(?!)/,
    usesSendingDomain: false,
  },
  {
    // Internal production channel: the artefact store is the "provider", so no
    // external credential exists and no secret reference is ever accepted.
    channel: "print",
    adapterKey: "print_spool",
    label: "Print spool / letter production",
    deliveryImplemented: true,
    verificationImplemented: false,
    requiredCredentialPurposes: [],
    optionalCredentialPurposes: [],
    secretRefPattern: /^(?!)/,
    usesSendingDomain: false,
  },
];


/** Resolves the deployed adapter for a channel, or null when none ships. */
export function adapterForChannel(
  channel: string | null | undefined,
): OmniCommsAdapterDescriptor | null {
  const key = String(channel ?? "").trim().toLowerCase();
  return OMNI_COMMS_ADAPTERS.find((a) => a.channel === key) ?? null;
}

/** True when a genuine delivery adapter is deployed for the channel. */
export function channelDeliverySupported(channel: string | null | undefined): boolean {
  return adapterForChannel(channel)?.deliveryImplemented === true;
}

/** Validates a configured secret reference NAME against the channel pattern. */
export function secretReferenceAcceptable(
  channel: string | null | undefined,
  secretRef: string | null | undefined,
): boolean {
  const adapter = adapterForChannel(channel);
  if (!adapter) return false;
  const ref = String(secretRef ?? "").trim();
  return ref !== "" && adapter.secretRefPattern.test(ref);
}

/** Channels a caller may currently ask the runtime to deliver on. */
export function deliverableChannels(): readonly string[] {
  return OMNI_COMMS_ADAPTERS.filter((a) => a.deliveryImplemented).map((a) => a.channel);
}
