// Omni-Comms — shared, server-only Resend adapter.
//
// This is the ONLY place in Omni-Comms where the Resend HTTP API is contacted.
// It is reused by:
//   * C5B `omni-comms-test-delivery` — approved technical test deliveries;
//   * C7 `omni-comms-dispatch`      — controlled business Email dispatch.
//
// Rules enforced here (they cannot be bypassed by a caller):
//   * the credential is read from Edge Function Secrets by NAME only, and the
//     name must match the bounded Omni-Comms secret-reference pattern;
//   * the secret VALUE is never returned, logged, or embedded in evidence;
//   * every request carries a caller-supplied deterministic `Idempotency-Key`,
//     so any safe retry of the SAME logical send cannot double-send;
//   * a transport failure or an uncertain provider status is reported as
//     `outcome_unknown`, never as a definite failure;
//   * only bounded, non-sensitive provider fields are returned as evidence.

export const OMNI_COMMS_SECRET_REF_PATTERN =
  /^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$/;

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Bounded transport budget. A timeout is uncertainty, never a failure. */
export const RESEND_TIMEOUT_MS = 20000;

export type ResendOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

export interface ResendSendInput {
  /** Bounded credential reference NAME (never a value). */
  readonly secretRef: string;
  readonly fromAddress: string;
  readonly fromName?: string | null;
  readonly replyTo?: string | null;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | null;
  /** Deterministic per-logical-send key. The SAME key is used on every retry. */
  readonly idempotencyKey: string;
}

export interface ResendSendResult {
  readonly status: ResendOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
}

/** Keeps only bounded, non-sensitive fields from a provider response. */
export function redactProviderResponse(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of ["id", "name", "message", "statusCode", "error"]) {
    const v = r[key];
    if (typeof v === "string") out[key] = v.slice(0, 300);
    else if (typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}

/** A provider status that may still have produced a send. */
export function isUncertainStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Resolves the credential VALUE for a bounded reference name. */
export function resolveSecret(
  secretRef: string,
): { ok: true; apiKey: string } | { ok: false; errorCode: string; detail: string } {
  if (!OMNI_COMMS_SECRET_REF_PATTERN.test(secretRef ?? "")) {
    return {
      ok: false,
      errorCode: "secret_reference_invalid",
      detail: "The configured credential reference name is not permitted.",
    };
  }
  const apiKey = Deno.env.get(secretRef) ?? "";
  if (apiKey.trim() === "") {
    return {
      ok: false,
      errorCode: "credential_missing",
      detail: `No stored value for credential reference ${secretRef}.`,
    };
  }
  return { ok: true, apiKey };
}

/**
 * Sends one Email through Resend. Never throws: every path returns a bounded,
 * classified outcome so the caller can always write evidence.
 */
export async function sendResendEmail(
  input: ResendSendInput,
): Promise<ResendSendResult> {
  const started = Date.now();
  const secret = resolveSecret(input.secretRef);
  if (!secret.ok) {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: secret.errorCode,
      errorDetail: secret.detail,
      latencyMs: 0,
    };
  }
  if (!input.fromAddress) {
    return {
      status: "failed",
      resultCode: "configuration_invalid",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: "from_address_missing",
      errorDetail: "The bound sender identity has no from address.",
      latencyMs: 0,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEND_TIMEOUT_MS);
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${secret.apiKey}`,
        "Content-Type": "application/json",
        // Deterministic: identical for every safe retry of this logical send.
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.fromName
          ? `${input.fromName} <${input.fromAddress}>`
          : input.fromAddress,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const body = await res.json().catch(() => null);
    const redacted = redactProviderResponse(body);
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const uncertain = isUncertainStatus(res.status);
      return {
        status: uncertain ? "outcome_unknown" : "failed",
        resultCode: uncertain ? "provider_outcome_unknown" : "provider_rejected",
        providerMessageId: null,
        providerStatusCode: res.status,
        providerResponse: { ...redacted, latency_ms: latencyMs },
        errorCode: typeof redacted.name === "string"
          ? redacted.name
          : uncertain
            ? "provider_outcome_unknown"
            : "provider_error",
        errorDetail: typeof redacted.message === "string" ? redacted.message : null,
        latencyMs,
      };
    }

    return {
      status: "accepted",
      resultCode: "provider_accepted",
      providerMessageId: typeof redacted.id === "string" ? redacted.id : null,
      providerStatusCode: res.status,
      providerResponse: { ...redacted, latency_ms: latencyMs },
      errorCode: null,
      errorDetail: null,
      latencyMs,
    };
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === "AbortError";
    const detail = aborted
      ? "provider request timed out"
      : e instanceof Error
        ? e.message
        : "provider request failed";
    // The request may have reached the provider — never assert failure.
    return {
      status: "outcome_unknown",
      resultCode: "provider_outcome_unknown",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: {},
      errorCode: aborted ? "provider_timeout" : "provider_unreachable",
      errorDetail: detail,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Accepted Resend callback types, mapped to normalized Omni-Comms names. */
export const RESEND_CALLBACK_EVENTS: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

/** Legacy C5B evidence names (kept so C5B evidence is unchanged). */
export const RESEND_TEST_EVENT_NAMES: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delivery_delayed",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.opened": "opened",
  "email.clicked": "clicked",
};

export function maskEmail(e: unknown): string | null {
  if (typeof e !== "string" || e === "") return null;
  const [local, domain] = e.split("@");
  if (!domain) return "***";
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${"*".repeat(Math.max(1, local.length - head.length))}@${domain}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
