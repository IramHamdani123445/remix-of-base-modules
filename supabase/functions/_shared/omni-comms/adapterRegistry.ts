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
import { OMNI_COMMS_FCM_SECRET_REF_PATTERN } from "./fcmPushAdapter.ts";
import { OMNI_COMMS_WEBHOOK_SECRET_REF_PATTERN } from "./outboundWebhookAdapter.ts";

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
    channel: "whatsapp",
    adapterKey: "twilio_whatsapp",
    label: "Twilio (WhatsApp)",
    deliveryImplemented: true,
    verificationImplemented: true,
    requiredCredentialPurposes: ["account_sid", "auth_token"],
    optionalCredentialPurposes: ["messaging_service_sid", "webhook_signing"],
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
  {
    channel: "push",
    adapterKey: "firebase_push",
    label: "Firebase Cloud Messaging (Push)",
    deliveryImplemented: true,
    verificationImplemented: false,
    requiredCredentialPurposes: ["service_account"],
    optionalCredentialPurposes: [],
    secretRefPattern: OMNI_COMMS_FCM_SECRET_REF_PATTERN,
    usesSendingDomain: false,
  },
  {
    // The subscriber endpoint is the "provider": the credential is the shared
    // signing secret that lets the subscriber verify authenticity.
    channel: "webhook",
    adapterKey: "outbound_webhook",
    label: "Outbound webhook",
    deliveryImplemented: true,
    verificationImplemented: false,
    requiredCredentialPurposes: ["webhook_signing_secret"],
    optionalCredentialPurposes: [],
    secretRefPattern: OMNI_COMMS_WEBHOOK_SECRET_REF_PATTERN,
    usesSendingDomain: false,
  },
  {
    channel: "voice",
    adapterKey: "twilio_voice",
    label: "Twilio Programmable Voice",
    deliveryImplemented: true,
    verificationImplemented: true,
    requiredCredentialPurposes: ["account_sid", "auth_token"],
    optionalCredentialPurposes: ["webhook_signing"],
    secretRefPattern: OMNI_COMMS_TWILIO_SECRET_REF_PATTERN,
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

/* ------------------------------------------------------------------ *
 * BEGIN GENERATED BUILD REVISION
 * Content hash of every Omni-Comms runtime, dispatcher and shared source.
 * ------------------------------------------------------------------ */
export const OMNI_COMMS_BUILD_REVISION = "03fcd61c75a933ebf3e750d52d925c34b1efea81";
export const OMNI_COMMS_BUILD_SOURCE_FILE_COUNT = 46;
/* END GENERATED BUILD REVISION */

// DEF-13 — deployment identity truth for the Omni-Comms runtime and dispatcher.
//
// The committed build artifact above is the DEFAULT deployment truth: a
// content hash of every runtime, dispatcher and shared adapter source file,
// so a deployed function can always state exactly which build is running.
//
// A deployment-automation stamp (`OMNI_COMMS_DEPLOYED_REVISION`) is consulted
// only when it is a well-formed 40-hex value, and a stamp that disagrees with
// the artifact is reported as `revisionStale` so certification fails closed —
// an override may never hide a build mismatch. The historic
// `OMNI_COMMS_EDGE_REVISION` variable is never consulted: a long-lived legacy
// stamp could survive a code change and silently mask a build mismatch.

export const OMNI_COMMS_REVISION_PATTERN = /^[0-9a-f]{40}$/;

export type DeployedRevisionSource = "environment" | "build_artifact" | "none";

export interface DeployedRevisionReport {
  /** The revision this deployment reports, or null when nothing is verifiable. */
  revision: string | null;
  /** Where the reported revision came from. */
  revisionSource: DeployedRevisionSource;
  /** True only when `revision` is a well-formed 40-hex value. */
  revisionVerified: boolean;
  /** The content-hash identity of the shipped sources, always present. */
  buildRevision: string | null;
  /** The raw deployment-automation stamp, when it is well formed. */
  environmentRevision: string | null;
  /** True when the stamp disagrees with the content hash actually shipped. */
  revisionStale: boolean;
}

/** Pure rule — exercised directly by the repository DEF-13 test suite. */
export function resolveRevisionReport(
  envValue: string | undefined,
  buildValue: string | undefined,
): DeployedRevisionReport {
  const env = (envValue ?? "").trim().toLowerCase();
  const build = (buildValue ?? "").trim().toLowerCase();

  const environmentRevision = OMNI_COMMS_REVISION_PATTERN.test(env) ? env : null;
  const buildRevision = OMNI_COMMS_REVISION_PATTERN.test(build) ? build : null;

  const revision = environmentRevision ?? buildRevision;
  const revisionSource: DeployedRevisionSource = environmentRevision
    ? "environment"
    : buildRevision
      ? "build_artifact"
      : "none";

  return {
    revision,
    revisionSource,
    revisionVerified: revision !== null,
    buildRevision,
    environmentRevision,
    revisionStale: environmentRevision !== null && buildRevision !== null &&
      environmentRevision !== buildRevision,
  };
}

export function resolveDeployedRevision(
  envValue: string | undefined = Deno.env.get("OMNI_COMMS_DEPLOYED_REVISION") ?? undefined,
): DeployedRevisionReport {
  return resolveRevisionReport(envValue, OMNI_COMMS_BUILD_REVISION);
}



// DEF-14 — certification simulation adapters.
//
// A simulation adapter is an INTERNAL delivery path. It contacts no external
// provider, resolves no credential, and transmits nothing outside the
// platform. It exists so a controlled pilot can be certified end to end
// without live sending credentials, and it is only ever selected when the
// database claim resolved a provider whose capability row is marked
// `certification_safe` and `requires_external_credentials = false`.

export const SIMULATION_ADAPTERS: ReadonlySet<string> = new Set([
  "simulation_email",
  "simulation_sms",
  "simulation_inapp",
]);

export function isSimulationAdapter(adapterCode: unknown): boolean {
  return typeof adapterCode === "string" && SIMULATION_ADAPTERS.has(adapterCode);
}

export interface SimulatedOutcome {
  status: "accepted";
  resultCode: "simulated_accepted";
  providerMessageId: string;
  providerStatusCode: number | null;
  providerResponse: Record<string, unknown>;
  errorCode: null;
  errorDetail: null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Record a deterministic accepted outcome WITHOUT contacting any provider.
 *
 * The simulated provider message id is derived from the deterministic
 * idempotency key, so a safe retry of the same message reproduces exactly the
 * same identifier instead of inventing a second delivery identity.
 */
export async function simulateDelivery(input: {
  adapterCode: string;
  channel: string;
  idempotencyKey: string;
}): Promise<SimulatedOutcome> {
  const fingerprint = await sha256Hex(`${input.adapterCode}:${input.idempotencyKey}`);
  return {
    status: "accepted",
    resultCode: "simulated_accepted",
    providerMessageId: `sim_${fingerprint.slice(0, 24)}`,
    providerStatusCode: null,
    providerResponse: {
      channel: input.channel,
      adapter: input.adapterCode,
      simulated: true,
      provider_contacted: false,
    },
    errorCode: null,
    errorDetail: null,
  };
}

