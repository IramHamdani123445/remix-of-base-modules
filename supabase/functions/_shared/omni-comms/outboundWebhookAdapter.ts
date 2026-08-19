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

/**
 * True when the address is loopback, private, link-local, cloud-metadata,
 * multicast or otherwise reserved. Covers IPv4 and IPv6, including the
 * IPv4-mapped IPv6 form.
 */
export function isForbiddenIpAddress(raw: string): boolean {
  const value = String(raw ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (value === "") return true;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const [a, b] = value.split(".").map((p) => Number(p));
    if ([a, b].some((n) => Number.isNaN(n))) return true;
    if (a === 0 || a === 10 || a === 127) return true; // this-network, RFC1918, loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a >= 224) return true; // multicast + reserved + broadcast
    return false;
  }

  if (value.includes(":")) {
    // IPv4-mapped IPv6, e.g. ::ffff:127.0.0.1
    const mapped = value.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isForbiddenIpAddress(mapped[1]);
    if (value === "::" || value === "::1") return true; // unspecified + loopback
    if (/^f[cd][0-9a-f]{2}:/.test(value)) return true; // unique local
    if (/^fe[89ab][0-9a-f]:/.test(value)) return true; // link-local
    if (/^ff[0-9a-f]{2}:/.test(value)) return true; // multicast
    if (/^(2001:0?db8|64:ff9b|100::)/.test(value)) return true; // documentation/reserved
    return false;
  }

  return false;
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
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost") return false;
  if (host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return false;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return !isForbiddenIpAddress(host);
  }
  return true;
}

export interface HostResolutionOutcome {
  readonly ok: boolean;
  readonly code: string;
  readonly addresses: readonly string[];
}

/**
 * Server-side A/AAAA resolution. Every resolved address must be public, and
 * the set is resolved twice — immediately before the request is issued — so a
 * DNS-rebinding answer that changes between validation and connection is
 * rejected rather than dialled.
 */
export async function resolveWebhookHost(hostname: string): Promise<HostResolutionOutcome> {
  const host = String(hostname ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "") return { ok: false, code: "endpoint_host_invalid", addresses: [] };

  // A literal address needs no resolution; it was already range-checked.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) {
    return isForbiddenIpAddress(host)
      ? { ok: false, code: "endpoint_address_forbidden", addresses: [host] }
      : { ok: true, code: "endpoint_address_public", addresses: [host] };
  }

  const lookup = async (): Promise<string[]> => {
    const resolver = (Deno as unknown as {
      resolveDns?: (h: string, t: string) => Promise<string[]>;
    }).resolveDns;
    if (typeof resolver !== "function") return [];
    const found: string[] = [];
    for (const type of ["A", "AAAA"]) {
      try {
        found.push(...(await resolver(host, type)));
      } catch {
        // a missing record type is not an error on its own
      }
    }
    return found;
  };

  const first = await lookup();
  if (first.length === 0) {
    return { ok: false, code: "endpoint_host_unresolvable", addresses: [] };
  }
  if (first.some((a) => isForbiddenIpAddress(a))) {
    return { ok: false, code: "endpoint_address_forbidden", addresses: [] };
  }

  const second = await lookup();
  if (second.length === 0 || second.some((a) => isForbiddenIpAddress(a))) {
    return { ok: false, code: "endpoint_address_unstable", addresses: [] };
  }
  const firstSet = new Set(first);
  if (!second.every((a) => firstSet.has(a))) {
    return { ok: false, code: "endpoint_address_unstable", addresses: [] };
  }

  return { ok: true, code: "endpoint_address_public", addresses: second };
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
  // Resolved immediately before connecting so a rebinding answer cannot slip
  // a private address between validation and the request itself.
  const resolution = await resolveWebhookHost(new URL(url).hostname);
  if (!resolution.ok) {
    return failure(resolution.code, "The subscriber endpoint address is not permitted.");
  }

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
