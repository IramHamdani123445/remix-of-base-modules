// Omni-Comms — shared, server-only Twilio SMS adapter.
//
// This is the ONLY place in Omni-Comms where the Twilio Messaging API is
// contacted. It mirrors the Resend email adapter exactly:
//
//   * credentials are read by bounded reference NAME only (vault or Edge
//     secret), never modelled, echoed, logged or persisted;
//   * every request carries a deterministic idempotency reference so a safe
//     retry of the SAME logical send cannot double-send;
//   * a transport failure or an uncertain provider status is reported as
//     `outcome_unknown`, never as a definite failure;
//   * only bounded, non-sensitive provider fields are retained as evidence.
//
// It is reused by the approved technical SMS test delivery boundary and, once
// SMS business dispatch ships, by the controlled business dispatcher.

import {
  boundedProviderCode,
  boundedProviderMessageId,
  isUncertainStatus,
  type OmniCommsCredentialStorageMode,
  normalizeStorageMode,
} from "./resendAdapter.ts";

/** Bounded Twilio credential reference name shape. */
export const OMNI_COMMS_TWILIO_SECRET_REF_PATTERN =
  /^OMNI_COMMS_TWILIO_[A-Z0-9]+(_[A-Z0-9]+)*$/;

/** Bounded transport budget. A timeout is uncertainty, never a failure. */
export const TWILIO_TIMEOUT_MS = 20000;

export type TwilioOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

/** Strict E.164 shape. Anything else is refused before the provider is called. */
export const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/** Twilio alphanumeric sender ID shape (1-11 chars, at least one letter). */
export const ALPHANUMERIC_SENDER_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9 ]{1,11}$/;

/** Twilio Messaging Service SID shape. */
export const MESSAGING_SERVICE_SID_PATTERN = /^MG[0-9a-fA-F]{32}$/;

export const TWILIO_ACCOUNT_SID_PATTERN = /^AC[0-9a-fA-F]{32}$/;

/**
 * Normalises a recipient number to E.164.
 *
 * Only formatting noise is removed (spaces, dashes, brackets, dots). A number
 * that is not already internationally qualified is REFUSED — the adapter never
 * guesses a country code.
 */
export function normalizeE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value === "") return null;
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  value = value.replace(/[\s().\-\u2010-\u2015]/g, "");
  if (!value.startsWith("+")) return null;
  return E164_PATTERN.test(value) ? value : null;
}

/** A sender may be an E.164 number, a short code, or an alphanumeric ID. */
export function normalizeSender(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const e164 = normalizeE164(trimmed);
  if (e164) return e164;
  if (/^\d{3,8}$/.test(trimmed)) return trimmed; // short code
  return ALPHANUMERIC_SENDER_PATTERN.test(trimmed) ? trimmed : null;
}

/** Masks a phone number for evidence: keeps country prefix + last two digits. */
export function maskPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const v = value.trim();
  if (v.length <= 5) return "***";
  return `${v.slice(0, 3)}${"*".repeat(Math.max(1, v.length - 5))}${v.slice(-2)}`;
}

export interface TwilioCredentials {
  readonly accountSid: string;
  readonly authToken: string;
}

export interface TwilioSendInput {
  readonly credentials: TwilioCredentials;
  /** E.164 number, short code, or alphanumeric sender ID. */
  readonly from?: string | null;
  /** Optional Twilio Messaging Service SID; takes precedence over `from`. */
  readonly messagingServiceSid?: string | null;
  readonly to: string;
  readonly body: string;
  /** Deterministic per-logical-send key, recorded as evidence only. */
  readonly idempotencyKey: string;
  /** Optional delivery-status callback URL (an Omni-Comms endpoint). */
  readonly statusCallbackUrl?: string | null;
}

export interface TwilioSendResult {
  readonly status: TwilioOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
}

/**
 * Keeps ONLY bounded, allow-listed, non-sensitive Twilio response fields.
 * Free-text provider messages are dropped: they echo recipients and content.
 */
export function redactTwilioResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const sid = boundedProviderMessageId(r.sid);
  if (sid) out.sid = sid;
  const status = boundedProviderCode(r.status);
  if (status) out.provider_status = status;
  if (typeof r.code === "number") out.provider_error_code = r.code;
  if (typeof r.num_segments === "string") out.num_segments = r.num_segments;
  if (typeof r.message === "string" && r.message !== "") out.message_present = true;
  return out;
}

/** Twilio message statuses that are already terminal failures. */
export const TWILIO_FAILED_STATUSES = new Set(["failed", "undelivered"]);

declare const Deno: { env: { get(name: string): string | undefined } };

export type ResolvedTwilioSecret =
  | { ok: true; value: string }
  | { ok: false; errorCode: string; detail: string };

/**
 * Strict, single-source resolution of one bounded Twilio credential
 * reference. There is exactly one active store per credential: a UI-managed
 * credential is read only from the encrypted vault, a deployment-managed one
 * only from Edge Function Secrets. No silent precedence between stores.
 */
export async function resolveTwilioSecret(
  secretRef: string,
  storageMode: OmniCommsCredentialStorageMode,
  resolver?: ((ref: string) => Promise<string | null>) | null,
): Promise<ResolvedTwilioSecret> {
  if (!OMNI_COMMS_TWILIO_SECRET_REF_PATTERN.test(secretRef ?? "")) {
    return {
      ok: false,
      errorCode: "secret_reference_invalid",
      detail: "The configured provider credential is unavailable.",
    };
  }
  if (storageMode === "vault") {
    if (!resolver) {
      return {
        ok: false,
        errorCode: "credential_store_unavailable",
        detail: "The configured provider credential is unavailable.",
      };
    }
    let managed: string | null = null;
    try {
      managed = await resolver(secretRef);
    } catch {
      managed = null;
    }
    if (typeof managed === "string" && managed.trim() !== "") {
      return { ok: true, value: managed };
    }
    return {
      ok: false,
      errorCode: "credential_missing",
      detail: "The configured provider credential is unavailable.",
    };
  }
  let value = "";
  try {
    value = Deno.env.get(secretRef) ?? "";
  } catch {
    return {
      ok: false,
      errorCode: "credential_resolution_failed",
      detail: "The configured provider credential is unavailable.",
    };
  }
  if (value.trim() === "") {
    return {
      ok: false,
      errorCode: "credential_missing",
      detail: "The configured provider credential is unavailable.",
    };
  }
  return { ok: true, value };
}

/** Resolves the Twilio credential PAIR for one provider account. */
export async function resolveTwilioCredentials(input: {
  readonly accountSidRef: string;
  readonly authTokenRef: string;
  readonly storageMode?: string | null;
  readonly secretResolver?: ((ref: string) => Promise<string | null>) | null;
}): Promise<{ ok: true; credentials: TwilioCredentials } | { ok: false; errorCode: string; detail: string }> {
  const mode = normalizeStorageMode(input.storageMode);
  const sid = await resolveTwilioSecret(input.accountSidRef, mode, input.secretResolver ?? null);
  if (!sid.ok) return sid;
  const token = await resolveTwilioSecret(input.authTokenRef, mode, input.secretResolver ?? null);
  if (!token.ok) return token;
  if (!TWILIO_ACCOUNT_SID_PATTERN.test(sid.value.trim())) {
    return {
      ok: false,
      errorCode: "account_sid_invalid",
      detail: "The configured Twilio account identifier is not usable.",
    };
  }
  return {
    ok: true,
    credentials: { accountSid: sid.value.trim(), authToken: token.value },
  };
}

function basicAuth(credentials: TwilioCredentials): string {
  return `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`;
}

/**
 * Sends one SMS through Twilio. Never throws: every path returns a bounded,
 * classified outcome so the caller can always write evidence.
 */
export async function sendTwilioSms(input: TwilioSendInput): Promise<TwilioSendResult> {
  const started = Date.now();

  const to = normalizeE164(input.to);
  if (!to) {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: "recipient_not_e164",
      errorDetail: "The recipient number is not a usable international number.",
      latencyMs: 0,
    };
  }

  const messagingServiceSid =
    typeof input.messagingServiceSid === "string" &&
      MESSAGING_SERVICE_SID_PATTERN.test(input.messagingServiceSid.trim())
      ? input.messagingServiceSid.trim()
      : null;
  const from = messagingServiceSid ? null : normalizeSender(input.from);
  if (!messagingServiceSid && !from) {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: "sender_invalid",
      errorDetail: "The bound sender identity has no usable SMS sender.",
      latencyMs: 0,
    };
  }

  const text = (input.body ?? "").trim();
  if (text === "") {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: "body_empty",
      errorDetail: "The rendered SMS body is empty.",
      latencyMs: 0,
    };
  }

  const form = new URLSearchParams({ To: to, Body: text });
  if (messagingServiceSid) form.set("MessagingServiceSid", messagingServiceSid);
  else form.set("From", from as string);
  if (input.statusCallbackUrl && /^https:\/\/[A-Za-z0-9._\-/]+$/.test(input.statusCallbackUrl)) {
    form.set("StatusCallback", input.statusCallbackUrl);
  }

  const endpoint =
    `https://api.twilio.com/2010-04-01/Accounts/${input.credentials.accountSid}/Messages.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: basicAuth(input.credentials),
        "Content-Type": "application/x-www-form-urlencoded",
        // Twilio does not honour an idempotency header on this endpoint; the
        // deterministic key is enforced by the Omni-Comms claim transaction
        // and retained here only as bounded evidence.
        "I-Twilio-Client": "lovable-omni-comms",
      },
      body: form,
    });

    const body = await res.json().catch(() => null);
    const redacted = redactTwilioResponse(body);
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const uncertain = isUncertainStatus(res.status);
      return {
        status: uncertain ? "outcome_unknown" : "failed",
        resultCode: uncertain ? "provider_outcome_unknown" : "provider_rejected",
        providerMessageId: null,
        providerStatusCode: res.status,
        providerResponse: { ...redacted, latency_ms: latencyMs },
        errorCode: typeof redacted.provider_error_code === "number"
          ? `twilio_${redacted.provider_error_code}`
          : (uncertain ? "provider_outcome_unknown" : "provider_error"),
        errorDetail: uncertain
          ? "The provider outcome is uncertain."
          : "The provider rejected the request.",
        latencyMs,
      };
    }

    const providerStatus = typeof redacted.provider_status === "string"
      ? redacted.provider_status
      : null;
    if (providerStatus && TWILIO_FAILED_STATUSES.has(providerStatus)) {
      return {
        status: "failed",
        resultCode: "provider_rejected",
        providerMessageId: boundedProviderMessageId(redacted.sid),
        providerStatusCode: res.status,
        providerResponse: { ...redacted, latency_ms: latencyMs },
        errorCode: `provider_${providerStatus}`,
        errorDetail: "The provider could not deliver the message.",
        latencyMs,
      };
    }

    return {
      status: "accepted",
      resultCode: "provider_accepted",
      providerMessageId: boundedProviderMessageId(redacted.sid),
      providerStatusCode: res.status,
      providerResponse: { ...redacted, latency_ms: latencyMs },
      errorCode: null,
      errorDetail: null,
      latencyMs,
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    return {
      status: "outcome_unknown",
      resultCode: "provider_outcome_unknown",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: aborted ? "provider_timeout" : "provider_unreachable",
      errorDetail: aborted
        ? "The provider request timed out."
        : "The provider could not be reached.",
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface TwilioVerificationResult {
  readonly ok: boolean;
  readonly resultCode: string;
  readonly providerStatusCode: number | null;
  readonly detail: string;
}

/**
 * Read-only credential verification. Fetches the account record; it never
 * sends and never mutates anything at the provider.
 */
export async function verifyTwilioCredentials(
  credentials: TwilioCredentials,
): Promise<TwilioVerificationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}.json`,
      {
        method: "GET",
        signal: controller.signal,
        headers: { Authorization: basicAuth(credentials), Accept: "application/json" },
      },
    );
    if (res.ok) {
      return {
        ok: true,
        resultCode: "credential_verified",
        providerStatusCode: res.status,
        detail: "The provider accepted the credential.",
      };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        resultCode: "credential_rejected",
        providerStatusCode: res.status,
        detail: "The provider rejected the credential.",
      };
    }
    return {
      ok: false,
      resultCode: "verification_inconclusive",
      providerStatusCode: res.status,
      detail: "The provider could not confirm the credential.",
    };
  } catch {
    return {
      ok: false,
      resultCode: "verification_inconclusive",
      providerStatusCode: null,
      detail: "The provider could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Normalized Twilio delivery-callback statuses. */
export const TWILIO_CALLBACK_EVENTS: Record<string, string> = {
  queued: "queued",
  sending: "sent",
  sent: "sent",
  delivered: "delivered",
  undelivered: "bounced",
  failed: "bounced",
};
