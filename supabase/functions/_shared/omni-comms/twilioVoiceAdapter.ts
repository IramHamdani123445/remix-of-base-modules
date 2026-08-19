// Omni-Comms — shared, server-only Twilio Programmable Voice adapter.
//
// This is the ONLY place in Omni-Comms where an outbound voice call is placed.
// It mirrors the SMS and WhatsApp adapters exactly:
//
//   * credentials are read by bounded reference NAME only;
//   * the spoken script is delivered as inline TwiML built here — a caller can
//     never supply raw TwiML, so no markup injection is possible;
//   * an optional keypad question (IVR) is expressed as a <Gather>, and the
//     captured digit is reported back through the governed status callback;
//   * a transport failure or uncertain provider status is `outcome_unknown`,
//     never a definite failure;
//   * only bounded, non-sensitive provider fields are retained as evidence.

import {
  E164_PATTERN,
  normalizeE164,
  redactTwilioResponse,
  TWILIO_TIMEOUT_MS,
  type TwilioCredentials,
} from "./twilioSmsAdapter.ts";

export type VoiceOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

/** Twilio call states that are definitely terminal failures. */
const VOICE_FAILED_STATUSES = new Set(["failed", "canceled", "busy", "no-answer"]);

export interface TwilioVoiceSendInput {
  readonly credentials: TwilioCredentials;
  readonly from: string;
  readonly to: string;
  /** Rendered text to speak. Required unless an audio file is bound. */
  readonly script?: string | null;
  /** Pre-recorded https audio file. Takes precedence over the script. */
  readonly audioUrl?: string | null;
  readonly language?: string | null;
  readonly voiceName?: string | null;
  /** Digits the caller may press, e.g. "12". Enables the IVR question. */
  readonly gatherDigits?: string | null;
  readonly gatherPrompt?: string | null;
  readonly statusCallbackUrl?: string | null;
  /** Separate governed endpoint that receives the keypad answer. */
  readonly ivrActionUrl?: string | null;
  readonly idempotencyKey: string;
}

export interface TwilioVoiceSendResult {
  readonly status: VoiceOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
}

function failure(errorCode: string, errorDetail: string): TwilioVoiceSendResult {
  return {
    status: "failed",
    resultCode: "configuration_invalid",
    providerMessageId: null,
    providerStatusCode: null,
    providerResponse: { channel: "voice" },
    errorCode,
    errorDetail,
    latencyMs: 0,
  };
}

/** Escapes text so it can never break out of the generated TwiML document. */
export function escapeTwiml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Builds the inline TwiML document for one governed voice message. */
export function buildVoiceTwiml(input: {
  readonly script?: string | null;
  readonly audioUrl?: string | null;
  readonly language?: string | null;
  readonly voiceName?: string | null;
  readonly gatherDigits?: string | null;
  readonly gatherPrompt?: string | null;
  readonly statusCallbackUrl?: string | null;
  readonly ivrActionUrl?: string | null;
}): string | null {
  const script = (input.script ?? "").trim();
  const audioUrl = (input.audioUrl ?? "").trim();
  if (script === "" && audioUrl === "") return null;

  const language = /^[a-z]{2}(-[A-Z]{2})?$/.test((input.language ?? "").trim())
    ? (input.language as string).trim()
    : "en-US";
  const voiceAttr = /^[A-Za-z][A-Za-z0-9.\- ]{0,40}$/.test((input.voiceName ?? "").trim())
    ? ` voice="${escapeTwiml((input.voiceName as string).trim())}"`
    : "";

  const speak = audioUrl !== "" && /^https:\/\/\S+$/.test(audioUrl)
    ? `<Play>${escapeTwiml(audioUrl)}</Play>`
    : `<Say language="${language}"${voiceAttr}>${escapeTwiml(script)}</Say>`;

  const digits = (input.gatherDigits ?? "").trim();
  if (digits !== "" && /^[0-9*#]{1,12}$/.test(digits)) {
    const prompt = (input.gatherPrompt ?? "").trim();
    const promptSay = prompt === ""
      ? ""
      : `<Say language="${language}"${voiceAttr}>${escapeTwiml(prompt)}</Say>`;
    // The keypad answer NEVER goes to the status callback endpoint.
    const action = (input.ivrActionUrl ?? "").trim();
    // `actionOnEmptyResult` guarantees the governed IVR endpoint is called even
    // when the caller presses nothing, so "no response" is recorded truthfully
    // instead of silently disappearing.
    const actionAttr = /^https:\/\/\S+$/.test(action)
      ? ` action="${escapeTwiml(action)}" method="POST" actionOnEmptyResult="true"`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?><Response>${speak}` +
      `<Gather numDigits="1" timeout="8"${actionAttr}>${promptSay}</Gather></Response>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${speak}</Response>`;
}

function basicAuth(credentials: TwilioCredentials): string {
  return `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`;
}

/**
 * Places one outbound voice call. Never throws: every path returns a bounded,
 * classified outcome so the caller can always write delivery evidence.
 */
export async function sendTwilioVoice(
  input: TwilioVoiceSendInput,
): Promise<TwilioVoiceSendResult> {
  const started = Date.now();

  const to = normalizeE164(input.to);
  if (!to) {
    return failure("recipient_not_e164", "The recipient number is not a usable international number.");
  }
  const from = normalizeE164(input.from);
  if (!from || !E164_PATTERN.test(from)) {
    return failure("sender_invalid", "The bound caller number is not usable.");
  }

  const twiml = buildVoiceTwiml(input);
  if (!twiml) {
    return failure("content_empty", "The voice message has neither a script nor an audio file.");
  }

  const form = new URLSearchParams({ To: to, From: from, Twiml: twiml });
  const callback = (input.statusCallbackUrl ?? "").trim();
  if (/^https:\/\/\S+$/.test(callback)) {
    form.set("StatusCallback", callback);
    form.set("StatusCallbackMethod", "POST");
    for (const evt of ["initiated", "ringing", "answered", "completed"]) {
      form.append("StatusCallbackEvent", evt);
    }
  }

  const endpoint =
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.credentials.accountSid)}/Calls.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TWILIO_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: basicAuth(input.credentials),
        "Content-Type": "application/x-www-form-urlencoded",
        // Deterministic: identical on every safe retry of this message.
        "I-Twilio-Idempotency-Token": String(input.idempotencyKey ?? "").slice(0, 200),
      },
      body: form,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const parsed = await res.json().catch(() => ({}));
    const evidence = { channel: "voice", ...redactTwilioResponse(parsed) };
    const providerStatus = String(
      (parsed as Record<string, unknown>)?.status ?? "",
    ).trim().toLowerCase();
    const callSid = String((parsed as Record<string, unknown>)?.sid ?? "").trim() || null;

    if (res.ok && callSid && !VOICE_FAILED_STATUSES.has(providerStatus)) {
      return {
        status: "accepted",
        resultCode: "accepted",
        providerMessageId: callSid,
        providerStatusCode: res.status,
        providerResponse: evidence,
        errorCode: null,
        errorDetail: null,
        latencyMs,
      };
    }
    if (res.status >= 500 || res.status === 429) {
      return {
        status: "outcome_unknown",
        resultCode: "outcome_unknown",
        providerMessageId: callSid,
        providerStatusCode: res.status,
        providerResponse: evidence,
        errorCode: `http_${res.status}`,
        errorDetail: "Twilio did not confirm the call outcome.",
        latencyMs,
      };
    }
    return {
      status: "failed",
      resultCode: "rejected",
      providerMessageId: callSid,
      providerStatusCode: res.status,
      providerResponse: evidence,
      errorCode: String((parsed as Record<string, unknown>)?.code ?? `http_${res.status}`),
      errorDetail: "Twilio rejected the outbound call.",
      latencyMs,
    };
  } catch {
    return {
      status: "outcome_unknown",
      resultCode: "outcome_unknown",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: { channel: "voice" },
      errorCode: "transport_failure",
      errorDetail: "Twilio could not be reached.",
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
