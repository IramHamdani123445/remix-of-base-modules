// Omni-Comms — shared, server-only Twilio WhatsApp adapter.
//
// This is the ONLY place in Omni-Comms where the Twilio WhatsApp API is
// contacted. It mirrors the SMS adapter exactly:
//
//   * credentials are read by bounded reference NAME only (vault or Edge
//     secret), never modelled, echoed, logged or persisted;
//   * every request carries a deterministic idempotency reference so a safe
//     retry of the SAME logical send cannot double-send;
//   * a transport failure or uncertain provider status is `outcome_unknown`,
//     never a definite failure;
//   * only bounded, non-sensitive provider fields are retained as evidence;
//   * a structured, provider-approved template (ContentSid + variables) takes
//     precedence over free-form body text, exactly as WhatsApp requires
//     outside an open service window.

import {
  isUncertainStatus,
  type OmniCommsCredentialStorageMode,
} from "./resendAdapter.ts";
import {
  E164_PATTERN,
  normalizeE164,
  redactTwilioResponse,
  resolveTwilioCredentials,
  TWILIO_FAILED_STATUSES,
  TWILIO_TIMEOUT_MS,
  type TwilioCredentials,
} from "./twilioSmsAdapter.ts";

export { resolveTwilioCredentials };

/** Twilio Content template (ContentSid) shape. */
export const WHATSAPP_CONTENT_SID_PATTERN = /^HX[0-9a-fA-F]{32}$/;

export type WhatsAppOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

export interface TwilioWhatsAppSendInput {
  readonly credentials: TwilioCredentials;
  /** The registered WhatsApp business number in E.164 (no `whatsapp:` prefix). */
  readonly from: string;
  /** Recipient number in E.164 (no `whatsapp:` prefix). */
  readonly to: string;
  /** Rendered free-form body. Required unless a ContentSid is supplied. */
  readonly body?: string | null;
  /** Provider-approved template reference. Takes precedence over `body`. */
  readonly contentSid?: string | null;
  /** Ordered variables for the approved template. */
  readonly contentVariables?: Record<string, string> | null;
  /** Optional https media attachment. */
  readonly mediaUrl?: string | null;
  readonly idempotencyKey: string;
  readonly statusCallbackUrl?: string | null;
}

export interface TwilioWhatsAppSendResult {
  readonly status: WhatsAppOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
}

function failure(
  errorCode: string,
  errorDetail: string,
): TwilioWhatsAppSendResult {
  return {
    status: "failed",
    resultCode: "configuration_invalid",
    providerMessageId: null,
    providerStatusCode: null,
    providerResponse: {},
    errorCode,
    errorDetail,
    latencyMs: 0,
  };
}

function basicAuth(credentials: TwilioCredentials): string {
  return `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`;
}

/**
 * Sends one WhatsApp message through Twilio. Never throws: every path returns
 * a bounded, classified outcome so the caller can always write evidence.
 */
export async function sendTwilioWhatsApp(
  input: TwilioWhatsAppSendInput,
): Promise<TwilioWhatsAppSendResult> {
  const started = Date.now();

  const to = normalizeE164(input.to);
  if (!to) return failure("recipient_not_e164", "The recipient number is not a usable international number.");

  const from = normalizeE164(input.from);
  if (!from || !E164_PATTERN.test(from)) {
    return failure("sender_invalid", "The bound WhatsApp business number is not usable.");
  }

  const contentSid = typeof input.contentSid === "string"
      && WHATSAPP_CONTENT_SID_PATTERN.test(input.contentSid.trim())
    ? input.contentSid.trim()
    : null;
  const body = (input.body ?? "").trim();
  if (!contentSid && body === "") {
    return failure("body_empty", "The rendered WhatsApp message is empty and no approved template is bound.");
  }

  const form = new URLSearchParams({
    To: `whatsapp:${to}`,
    From: `whatsapp:${from}`,
  });
  if (contentSid) {
    form.set("ContentSid", contentSid);
    const vars = input.contentVariables ?? null;
    if (vars && Object.keys(vars).length > 0) {
      form.set("ContentVariables", JSON.stringify(vars));
    }
  } else {
    form.set("Body", body);
  }
  if (typeof input.mediaUrl === "string" && /^https:\/\/[^\s"']+$/.test(input.mediaUrl.trim())) {
    form.set("MediaUrl", input.mediaUrl.trim());
  }
  if (input.statusCallbackUrl && /^https:\/\/[^\s"'<>]+$/.test(input.statusCallbackUrl.trim())) {
    form.set("StatusCallback", input.statusCallbackUrl.trim());
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
        // Twilio does not honour an idempotency header here; the deterministic
        // key is enforced by the Omni-Comms claim transaction and retained as
        // bounded evidence only.
        "I-Twilio-Client": "lovable-omni-comms",
      },
      body: form,
    });

    const payload = await res.json().catch(() => null);
    const redacted = redactTwilioResponse(payload);
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const uncertain = isUncertainStatus(res.status);
      return {
        status: uncertain ? "outcome_unknown" : "failed",
        resultCode: uncertain ? "provider_outcome_unknown" : "provider_rejected",
        providerMessageId: null,
        providerStatusCode: res.status,
        providerResponse: { ...redacted, channel: "whatsapp", latency_ms: latencyMs },
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
        providerMessageId: (redacted.sid as string | undefined) ?? null,
        providerStatusCode: res.status,
        providerResponse: { ...redacted, channel: "whatsapp", latency_ms: latencyMs },
        errorCode: "provider_reported_failure",
        errorDetail: "The provider reported the message as failed.",
        latencyMs,
      };
    }

    return {
      status: "accepted",
      resultCode: "provider_accepted",
      providerMessageId: (redacted.sid as string | undefined) ?? null,
      providerStatusCode: res.status,
      providerResponse: {
        ...redacted,
        channel: "whatsapp",
        structured_template: contentSid !== null,
        latency_ms: latencyMs,
      },
      errorCode: null,
      errorDetail: null,
      latencyMs,
    };
  } catch (_err) {
    const latencyMs = Date.now() - started;
    return {
      status: "outcome_unknown",
      resultCode: "transport_uncertain",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: { channel: "whatsapp", latency_ms: latencyMs },
      errorCode: "transport_uncertain",
      errorDetail: "The provider could not be reached conclusively.",
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verifies an inbound Twilio webhook signature (X-Twilio-Signature).
 *
 * Twilio signs `url + sorted(key + value)` with HMAC-SHA1 keyed by the account
 * auth token, base64 encoded. Verification is constant-time and fail-closed:
 * any missing input returns false.
 */
export async function verifyTwilioSignature(input: {
  readonly authToken: string;
  readonly url: string;
  readonly params: Record<string, string>;
  readonly signature: string | null;
}): Promise<boolean> {
  const signature = (input.signature ?? "").trim();
  if (!signature || !input.authToken || !input.url) return false;

  let payload = input.url;
  for (const key of Object.keys(input.params).sort()) {
    payload += key + input.params[key];
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/** Normalises a Twilio message status into an Omni-Comms callback event. */
export function normalizeTwilioCallbackEvent(status: string | null | undefined): string | null {
  switch (String(status ?? "").trim().toLowerCase()) {
    case "queued":
    case "accepted":
    case "sending":
      return "callback_queued";
    case "sent":
      return "callback_sent";
    case "delivered":
      return "callback_delivered";
    case "read":
      return "callback_opened";
    case "undelivered":
    case "failed":
      return "callback_bounced";
    default:
      return null;
  }
}

export type { OmniCommsCredentialStorageMode };
