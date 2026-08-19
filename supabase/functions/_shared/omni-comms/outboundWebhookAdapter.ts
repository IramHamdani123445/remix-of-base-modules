// Omni-Comms — shared, server-only outbound Webhook adapter.
//
// This is the ONLY place in Omni-Comms where a subscriber endpoint is called.
//
//   * the signing secret is read by bounded reference NAME only and never
//     logged, echoed or persisted;
//   * every request is signed with HMAC-SHA256 over `timestamp.body`, so the
//     subscriber can verify authenticity and reject replays;
//   * the deterministic idempotency key travels as a header so a safe retry of
//     the same message is recognisable by the subscriber;
//   * only a plain https address is permitted, and the response body is never
//     retained — only a bounded status summary;
//   * a transport failure or 5xx is `outcome_unknown`, never a definite
//     failure.

import { resolveOmniCommsSecret } from "./credentialResolution.ts";
import type { ManagedSecretResolver } from "./managedSecrets.ts";

export const OMNI_COMMS_WEBHOOK_SECRET_REF_PATTERN =
  /^OMNI_COMMS_WEBHOOK_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

export const WEBHOOK_DEFAULT_TIMEOUT_MS = 10000;
export const WEBHOOK_MAX_TIMEOUT_MS = 30000;

/** Headers a subscriber configuration may never override. */
const RESERVED_HEADERS = new Set([
  "content-type",
  "authorization",
  "host",
  "content-length",
  "x-omni-comms-signature",
  "x-omni-comms-timestamp",
  "x-omni-comms-idempotency-key",
  "x-omni-comms-event",
  "x-omni-comms-schema-version",
]);

export type WebhookOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

export interface WebhookSendInput {
  readonly endpointUrl: string;
  readonly httpMethod?: string | null;
  readonly timeoutMs?: number | null;
  readonly signingSecretRef: string;
  readonly storageMode: string;
  readonly secretResolver?: ManagedSecretResolver;
  readonly customHeaders?: Record<string, unknown> | null;
  readonly eventCode: string;
  readonly schemaVersion: string;
  /** Rendered JSON payload text produced by the template. */
  readonly payload: string;
  readonly idempotencyKey: string;
}

export interface WebhookSendResult {
  readonly status: WebhookOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
}

function failure(errorCode: string, errorDetail: string): WebhookSendResult {
  return {
    status: "failed",
    resultCode: "configuration_invalid",
    providerMessageId: null,
    providerStatusCode: null,
    providerResponse: { channel: "webhook" },
    errorCode,
    errorDetail,
    latencyMs: 0,
  };
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Rejects non-https, credentialed and obviously internal destinations. */
export function webhookUrlAcceptable(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username !== "" || url.password !== "") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map((p) => Number(p));
    if (a === 10 || a === 127 || a === 0 || a === 169 && b === 254) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
  }
  if (host === "::1" || host.startsWith("[")) return false;
  return true;
}

/**
 * Delivers one signed webhook. Never throws: every path returns a bounded,
 * classified outcome so the caller can always write delivery evidence.
 */
export async function sendOutboundWebhook(
  input: WebhookSendInput,
): Promise<WebhookSendResult> {
  const started = Date.now();

  const url = String(input.endpointUrl ?? "").trim();
  if (!webhookUrlAcceptable(url)) {
    return failure("endpoint_url_invalid", "The subscriber endpoint address is not permitted.");
  }

  const method = String(input.httpMethod ?? "POST").trim().toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") {
    return failure("http_method_invalid", "The subscriber endpoint method is not permitted.");
  }

  const payloadText = String(input.payload ?? "").trim();
  if (payloadText === "") {
    return failure("content_empty", "The rendered webhook payload is empty.");
  }
  try {
    const parsed = JSON.parse(payloadText);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return failure("payload_not_object", "The rendered webhook payload is not a JSON object.");
    }
  } catch {
    return failure("payload_not_json", "The rendered webhook payload is not valid JSON.");
  }

  const secret = await resolveOmniCommsSecret({
    secretRef: input.signingSecretRef,
    pattern: OMNI_COMMS_WEBHOOK_SECRET_REF_PATTERN,
    storageMode: input.storageMode,
    secretResolver: input.secretResolver,
  });
  if (!secret.ok) return failure(secret.errorCode, secret.detail);

  const timestamp = String(Math.floor(Date.now() / 1000));
  let signature: string;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret.value),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    signature = hex(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payloadText}`)),
    );
  } catch {
    return failure("signing_failed", "The webhook signature could not be produced.");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "omni-comms/1.0",
    "X-Omni-Comms-Signature": `t=${timestamp},v1=${signature}`,
    "X-Omni-Comms-Timestamp": timestamp,
    "X-Omni-Comms-Idempotency-Key": String(input.idempotencyKey ?? "").slice(0, 200),
    "X-Omni-Comms-Event": String(input.eventCode ?? "").slice(0, 120),
    "X-Omni-Comms-Schema-Version": String(input.schemaVersion ?? "1.0").slice(0, 20),
  };
  for (const [rawKey, rawValue] of Object.entries(input.customHeaders ?? {})) {
    const key = String(rawKey ?? "").trim();
    if (!/^[A-Za-z0-9-]{1,60}$/.test(key)) continue;
    if (RESERVED_HEADERS.has(key.toLowerCase())) continue;
    if (typeof rawValue !== "string") continue;
    headers[key] = rawValue.slice(0, 400);
  }

  const timeoutMs = Math.min(
    Math.max(Number(input.timeoutMs ?? WEBHOOK_DEFAULT_TIMEOUT_MS) || WEBHOOK_DEFAULT_TIMEOUT_MS, 1000),
    WEBHOOK_MAX_TIMEOUT_MS,
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: payloadText,
      redirect: "manual",
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const evidence = {
      channel: "webhook",
      provider_status: res.status,
      http_method: method,
      schema_version: headers["X-Omni-Comms-Schema-Version"],
    };

    if (res.status >= 200 && res.status < 300) {
      return {
        status: "accepted",
        resultCode: "accepted",
        providerMessageId: (res.headers.get("x-request-id") ?? "").slice(0, 200) || null,
        providerStatusCode: res.status,
        providerResponse: evidence,
        errorCode: null,
        errorDetail: null,
        latencyMs,
      };
    }
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      return {
        status: "outcome_unknown",
        resultCode: "outcome_unknown",
        providerMessageId: null,
        providerStatusCode: res.status,
        providerResponse: evidence,
        errorCode: `http_${res.status}`,
        errorDetail: "The subscriber did not confirm receipt.",
        latencyMs,
      };
    }
    return {
      status: "failed",
      resultCode: "rejected",
      providerMessageId: null,
      providerStatusCode: res.status,
      providerResponse: evidence,
      errorCode: `http_${res.status}`,
      errorDetail: "The subscriber rejected the webhook.",
      latencyMs,
    };
  } catch {
    return {
      status: "outcome_unknown",
      resultCode: "outcome_unknown",
      providerMessageId: null,
      providerStatusCode: null,
      providerResponse: { channel: "webhook" },
      errorCode: "transport_failure",
      errorDetail: "The subscriber endpoint could not be reached.",
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
