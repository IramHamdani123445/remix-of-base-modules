// Omni-Comms — shared, server-only Firebase Cloud Messaging (Push) adapter.
//
// This is the ONLY place in Omni-Comms where FCM is contacted. It follows the
// same discipline as the Email, SMS and WhatsApp adapters:
//
//   * the service-account credential is read by bounded reference NAME only;
//   * one logical push fans out to the recipient's registered devices, and each
//     device carries the SAME deterministic collapse identity so a safe retry
//     of the same message cannot produce a second visible notification;
//   * transport failure or an uncertain provider status is `outcome_unknown`,
//     never a definite failure;
//   * only bounded, non-sensitive provider fields are retained as evidence —
//     never a device token, never a credential;
//   * a permanently rejected device token is reported back so the governed
//     device register can retire it.

import { resolveOmniCommsSecret } from "./credentialResolution.ts";
import type { ManagedSecretResolver } from "./managedSecrets.ts";

export const OMNI_COMMS_FCM_SECRET_REF_PATTERN =
  /^OMNI_COMMS_FCM_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

export const FCM_TIMEOUT_MS = 20000;

/** Provider codes that mean "this device token will never work again". */
const FCM_PERMANENT_TOKEN_ERRORS = new Set([
  "UNREGISTERED",
  "INVALID_ARGUMENT",
  "SENDER_ID_MISMATCH",
]);

export type PushOutcomeStatus = "accepted" | "failed" | "outcome_unknown";

export interface PushDeviceTarget {
  readonly token: string;
  readonly platform: string;
  /** Governed registration identity (omni_comms_push_device.id). */
  readonly deviceId?: string | null;
}

/**
 * Per-installation outcome. The raw device token is deliberately absent: the
 * governed registration identity is the only thing recorded as evidence.
 */
export interface PushDeviceOutcome {
  readonly deviceId: string | null;
  readonly platform: string;
  readonly status: "accepted" | "rejected" | "uncertain";
  readonly providerMessageId: string | null;
  readonly rejectionClassification: string | null;
  readonly errorCode: string | null;
}

export interface FcmSendInput {
  readonly serviceAccountRef: string;
  readonly storageMode: string;
  readonly secretResolver?: ManagedSecretResolver;
  readonly devices: readonly PushDeviceTarget[];
  readonly title: string;
  readonly body: string;
  readonly imageUrl?: string | null;
  readonly actionUrl?: string | null;
  readonly collapseKey?: string | null;
  readonly priority?: string | null;
  readonly ttlSeconds?: number | null;
  /** Deterministic: identical on every safe retry of this message. */
  readonly idempotencyKey: string;
}

export interface FcmSendResult {
  readonly status: PushOutcomeStatus;
  readonly resultCode: string;
  readonly providerMessageId: string | null;
  readonly providerStatusCode: number | null;
  readonly providerResponse: Record<string, unknown>;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
  readonly latencyMs: number;
  /** Device tokens the provider permanently rejected. */
  readonly retiredTokens: readonly { token: string; reason: string }[];
  /** One entry per targeted installation, in the order they were attempted. */
  readonly deviceOutcomes: readonly PushDeviceOutcome[];
}

function failure(errorCode: string, errorDetail: string): FcmSendResult {
  return {
    status: "failed",
    resultCode: "configuration_invalid",
    providerMessageId: null,
    providerStatusCode: null,
    providerResponse: {},
    errorCode,
    errorDetail,
    latencyMs: 0,
    retiredTokens: [],
    deviceOutcomes: [],
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToPkcs8(pem: string): Uint8Array | null {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\\n/g, "")
    .replace(/\s+/g, "");
  if (body === "") return null;
  try {
    const raw = atob(body);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

interface ServiceAccount {
  readonly project_id: string;
  readonly client_email: string;
  readonly private_key: string;
}

function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId = String(parsed.project_id ?? "").trim();
    const clientEmail = String(parsed.client_email ?? "").trim();
    const privateKey = String(parsed.private_key ?? "");
    if (!projectId || !clientEmail || !privateKey.includes("PRIVATE KEY")) return null;
    return { project_id: projectId, client_email: clientEmail, private_key: privateKey };
  } catch {
    return null;
  }
}

/** Mints a short-lived Google OAuth access token for the FCM send scope. */
async function mintAccessToken(account: ServiceAccount): Promise<string | null> {
  const pkcs8 = pemToPkcs8(account.private_key);
  if (!pkcs8) return null;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = base64url(new TextEncoder().encode(JSON.stringify({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })));
  const signingInput = `${header}.${claim}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)),
  );
  const assertion = `${signingInput}.${base64url(signature)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FCM_TIMEOUT_MS);
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const parsed = (await res.json()) as Record<string, unknown>;
    const token = String(parsed.access_token ?? "").trim();
    return token === "" ? null : token;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one push message to every registered device of the recipient. Never
 * throws: every path returns a bounded, classified outcome so the caller can
 * always write delivery evidence.
 */
export async function sendFcmPush(input: FcmSendInput): Promise<FcmSendResult> {
  const started = Date.now();

  const title = (input.title ?? "").trim();
  const body = (input.body ?? "").trim();
  if (title === "" || body === "") {
    return failure("content_empty", "The rendered push notification has no title or body.");
  }
  const devices = (input.devices ?? []).filter((d) => typeof d?.token === "string" && d.token.trim() !== "");
  if (devices.length === 0) {
    return failure("push_no_active_device", "The recipient has no active registered device.");
  }

  const secret = await resolveOmniCommsSecret({
    secretRef: input.serviceAccountRef,
    pattern: OMNI_COMMS_FCM_SECRET_REF_PATTERN,
    storageMode: input.storageMode,
    secretResolver: input.secretResolver,
  });
  if (!secret.ok) return failure(secret.errorCode, secret.detail);

  const account = parseServiceAccount(secret.value);
  if (!account) {
    return failure("credential_malformed", "The configured Firebase service account is not usable.");
  }

  const accessToken = await mintAccessToken(account);
  if (!accessToken) {
    return failure("credential_rejected", "Firebase refused the configured service account.");
  }

  const endpoint =
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`;
  const collapseKey = (input.collapseKey ?? input.idempotencyKey).slice(0, 60);
  const highPriority = String(input.priority ?? "high").toLowerCase() === "high";
  const ttl = typeof input.ttlSeconds === "number" && input.ttlSeconds > 0
    ? Math.min(Math.floor(input.ttlSeconds), 2419200)
    : null;

  let accepted = 0;
  let uncertain = 0;
  let firstMessageId: string | null = null;
  let lastStatus: number | null = null;
  let lastErrorCode: string | null = null;
  const retiredTokens: { token: string; reason: string }[] = [];
  const deviceOutcomes: PushDeviceOutcome[] = [];

  for (const device of devices) {
    const platform = String(device.platform ?? "").toLowerCase();
    const message: Record<string, unknown> = {
      token: device.token,
      notification: {
        title,
        body,
        ...(input.imageUrl ? { image: input.imageUrl } : {}),
      },
      data: {
        omni_comms_idempotency_key: input.idempotencyKey,
        ...(input.actionUrl ? { action_url: input.actionUrl } : {}),
      },
      android: {
        priority: highPriority ? "HIGH" : "NORMAL",
        collapse_key: collapseKey,
        ...(ttl ? { ttl: `${ttl}s` } : {}),
      },
      apns: {
        headers: {
          "apns-priority": highPriority ? "10" : "5",
          "apns-collapse-id": collapseKey,
          ...(ttl ? { "apns-expiration": String(Math.floor(Date.now() / 1000) + ttl) } : {}),
        },
      },
      webpush: {
        headers: { Topic: collapseKey, ...(ttl ? { TTL: String(ttl) } : {}) },
        ...(input.actionUrl ? { fcm_options: { link: input.actionUrl } } : {}),
      },
    };
    if (platform === "web") delete (message as Record<string, unknown>).apns;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FCM_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      lastStatus = res.status;
      const parsed = await res.json().catch(() => ({})) as Record<string, unknown>;

      if (res.ok) {
        accepted += 1;
        const name = String(parsed.name ?? "").trim();
        const deviceMessageId = name === "" ? null : name.slice(0, 200);
        if (!firstMessageId) firstMessageId = deviceMessageId;
        deviceOutcomes.push({
          deviceId: device.deviceId ?? null,
          platform,
          status: "accepted",
          providerMessageId: deviceMessageId,
          rejectionClassification: null,
          errorCode: null,
        });
        continue;
      }

      const errObj = (parsed.error ?? {}) as Record<string, unknown>;
      const providerCode = String(errObj.status ?? "").trim().toUpperCase();
      lastErrorCode = providerCode || `http_${res.status}`;

      if (res.status === 404 || FCM_PERMANENT_TOKEN_ERRORS.has(providerCode)) {
        retiredTokens.push({ token: device.token, reason: providerCode || "unregistered" });
        deviceOutcomes.push({
          deviceId: device.deviceId ?? null,
          platform,
          status: "rejected",
          providerMessageId: null,
          rejectionClassification: "token_retired",
          errorCode: (providerCode || "unregistered").slice(0, 80),
        });
        continue;
      }
      if (res.status >= 500 || res.status === 429) {
        uncertain += 1;
        deviceOutcomes.push({
          deviceId: device.deviceId ?? null,
          platform,
          status: "uncertain",
          providerMessageId: null,
          rejectionClassification: null,
          errorCode: String(lastErrorCode ?? `http_${res.status}`).slice(0, 80),
        });
      } else {
        deviceOutcomes.push({
          deviceId: device.deviceId ?? null,
          platform,
          status: "rejected",
          providerMessageId: null,
          rejectionClassification: "provider_rejected",
          errorCode: String(lastErrorCode ?? `http_${res.status}`).slice(0, 80),
        });
      }
    } catch {
      // A transport failure is never a definite delivery failure.
      uncertain += 1;
      lastErrorCode = "transport_failure";
      deviceOutcomes.push({
        deviceId: device.deviceId ?? null,
        platform,
        status: "uncertain",
        providerMessageId: null,
        rejectionClassification: null,
        errorCode: "transport_failure",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  const latencyMs = Date.now() - started;
  const evidence: Record<string, unknown> = {
    channel: "push",
    devices_targeted: devices.length,
    devices_accepted: accepted,
    devices_retired: retiredTokens.length,
    devices_uncertain: uncertain,
    provider_status: lastStatus,
  };

  if (accepted > 0) {
    return {
      status: "accepted",
      resultCode: "accepted",
      providerMessageId: firstMessageId,
      providerStatusCode: lastStatus,
      providerResponse: evidence,
      errorCode: null,
      errorDetail: null,
      latencyMs,
      retiredTokens,
      deviceOutcomes,
    };
  }
  if (uncertain > 0) {
    return {
      status: "outcome_unknown",
      resultCode: "outcome_unknown",
      providerMessageId: null,
      providerStatusCode: lastStatus,
      providerResponse: evidence,
      errorCode: lastErrorCode,
      errorDetail: "The push provider did not confirm the outcome.",
      latencyMs,
      retiredTokens,
      deviceOutcomes,
    };
  }
  return {
    status: "failed",
    resultCode: "rejected",
    providerMessageId: null,
    providerStatusCode: lastStatus,
    providerResponse: evidence,
    errorCode: lastErrorCode ?? "push_all_devices_rejected",
    errorDetail: "Every registered device was rejected by the push provider.",
    latencyMs,
    retiredTokens,
    deviceOutcomes,
  };
}
