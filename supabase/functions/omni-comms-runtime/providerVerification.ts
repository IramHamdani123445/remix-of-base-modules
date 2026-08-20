// Omni-Comms Step 1 — Resend provider-account credential verification.
//
// Trusted server-side action. The browser sends ONLY the provider-account id
// and the organisation context. This module:
//   1. authenticates the actor (JWT),
//   2. resolves the account through a service-role-only RPC that itself
//      enforces omni_comms.configure and organisation access,
//      returning the bounded secret REFERENCE name (never a key),
//   3. reads the actual key from the Edge environment,
//   4. performs a safe, non-sending Resend credential probe,
//   5. persists only a bounded result and returns no secret data.
//
// It never sends an email, never creates a message, delivery attempt or
// dispatch job, and never logs or returns key material.

export type VerificationResultCode =
  | "verified"
  | "restricted_api_key"
  | "invalid_credentials"
  | "request_rejected"
  | "secret_missing"
  | "provider_unavailable"
  | "rate_limited"
  | "configuration_incomplete";

export type VerificationStatus = "pending" | "verified" | "failed";

export interface ProbeOutcome {
  resultCode: VerificationResultCode;
  detail: string;
}

/** Bounded, non-sensitive detail messages. Never contains provider payloads. */
const DETAIL: Record<VerificationResultCode, string> = {
  verified: "Resend credential accepted.",
  restricted_api_key:
    "Resend authenticated the key, but it has sending-only access and cannot read domains.",
  invalid_credentials: "Resend rejected the configured API key.",
  request_rejected:
    "Resend rejected the verification request format. No credential conclusion was drawn.",
  secret_missing: "No Edge secret is configured for the secret reference.",
  provider_unavailable: "Resend could not be reached.",
  rate_limited: "Resend rate limited the verification request.",
  configuration_incomplete: "Provider account configuration is incomplete.",
};

export function statusForResult(code: VerificationResultCode): VerificationStatus {
  if (code === "verified") return "verified";
  // A restricted (sending-access) key is AUTHENTIC — it simply lacks the
  // domain-read permission. It must never be recorded as a failed credential.
  // A rejected request format says nothing about the credential either.
  if (code === "restricted_api_key" || code === "request_rejected") return "pending";
  return "failed";
}

export function detailForResult(code: VerificationResultCode): string {
  return DETAIL[code];
}

/**
 * Bounded secret-reference name shape.
 * Only Resend-scoped Omni-Comms references may ever be resolved from the Edge
 * environment. Any other reference is rejected BEFORE Deno.env.get() is called.
 */
export const SECRET_REF_PATTERN = /^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/**
 * Bounded, non-sensitive client identifier sent to Resend. Contains no secret,
 * user, recipient or claim information.
 */
export const OMNI_COMMS_USER_AGENT = "OmniComms-Admin-Verification/1.0";

/** Bounded provider error codes Resend may return on the domains endpoint. */
export const RESEND_RESTRICTED_CODES = new Set([
  "restricted_api_key",
  "insufficient_permissions",
  "not_authorized",
]);
const RESEND_INVALID_CODES = new Set([
  "invalid_api_key",
  "missing_api_key",
  "unauthorized",
  "invalid_access",
]);
const RESEND_REQUEST_CODES = new Set([
  "validation_error",
  "invalid_request",
  "missing_required_field",
  "not_found",
  "method_not_allowed",
]);

/** Bounded, non-sensitive projection of a Resend response used for classification. */
export interface ResendProbeResponse {
  httpStatus: number;
  /** Provider-stated error name only. Never headers, payloads or credentials. */
  providerErrorCode: string | null;
  body: unknown;
}

/** Pure classifier — maps a bounded provider response to an Omni-Comms code. */
export function classifyResendResponse(
  res: Pick<ResendProbeResponse, "httpStatus" | "providerErrorCode">,
): VerificationResultCode {
  const code = (res.providerErrorCode ?? "").trim().toLowerCase();
  if (res.httpStatus === 200) return "verified";
  if (RESEND_RESTRICTED_CODES.has(code)) return "restricted_api_key";
  if (RESEND_INVALID_CODES.has(code)) return "invalid_credentials";
  if (RESEND_REQUEST_CODES.has(code)) return "request_rejected";
  if (res.httpStatus === 429) return "rate_limited";
  if (res.httpStatus === 401) return "invalid_credentials";
  // 403 without an explicit provider code means authenticated-but-not-permitted.
  if (res.httpStatus === 403) return "restricted_api_key";
  if (res.httpStatus === 400 || res.httpStatus === 404 || res.httpStatus === 405 ||
      res.httpStatus === 422) {
    return "request_rejected";
  }
  return "provider_unavailable";
}

/** Reads ONLY the provider error name from a bounded Resend error body. */
export function readProviderErrorCode(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const raw = typeof b.name === "string"
    ? b.name
    : typeof (b.error as Record<string, unknown> | undefined)?.name === "string"
      ? ((b.error as Record<string, unknown>).name as string)
      : typeof b.type === "string"
        ? b.type
        : null;
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase().slice(0, 64);
  return /^[a-z0-9_]+$/.test(trimmed) ? trimmed : null;
}

/**
 * Single read-only Resend request used by every verification probe.
 * Sends no email and never returns credential material or provider headers.
 */
export async function resendDomainsRequest(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResendProbeResponse | null> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/domains", {
      method: "GET",
      headers: {
        // Server-side only. Never returned, logged or persisted.
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "User-Agent": OMNI_COMMS_USER_AGENT,
      },
    });
  } catch {
    return null;
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return {
    httpStatus: res.status,
    providerErrorCode: res.status === 200 ? null : readProviderErrorCode(body),
    body: res.status === 200 ? body : null,
  };
}

/**
 * Safe, non-sending Resend credential probe.
 * Uses the read-only domains listing endpoint; it dispatches no email.
 */
export async function probeResendCredential(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  const res = await resendDomainsRequest(apiKey, fetchImpl);
  if (!res) {
    return { resultCode: "provider_unavailable", detail: DETAIL.provider_unavailable };
  }
  const resultCode = classifyResendResponse(res);
  return { resultCode, detail: DETAIL[resultCode] };
}

/**
 * Bounded sending-domain record. Only the domain name and its provider-stated
 * verification status are ever surfaced — never DNS values, tokens or keys.
 */
export interface ResendDomainRecord {
  name: string;
  status: string;
  region: string | null;
}

/** Pure parser for the Resend `GET /domains` payload. */
export function parseResendDomains(payload: unknown): ResendDomainRecord[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ResendDomainRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim().toLowerCase() : "";
    if (!name) continue;
    out.push({
      name,
      status: typeof r.status === "string" ? r.status.trim().toLowerCase() : "unknown",
      region: typeof r.region === "string" ? r.region : null,
    });
  }
  return out;
}

/**
 * Read-only sending-domain listing. Sends no email and returns no credential
 * material — only bounded domain names and provider-stated statuses.
 */
export async function probeResendDomains(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{
  resultCode: VerificationResultCode;
  domains: ResendDomainRecord[];
  /** Bounded diagnostics — HTTP status and provider error NAME only. */
  httpStatus: number | null;
  providerErrorCode: string | null;
}> {
  const res = await resendDomainsRequest(apiKey, fetchImpl);
  if (!res) {
    return {
      resultCode: "provider_unavailable",
      domains: [],
      httpStatus: null,
      providerErrorCode: null,
    };
  }
  const resultCode = classifyResendResponse(res);
  return {
    resultCode,
    domains: resultCode === "verified" ? parseResendDomains(res.body) : [],
    httpStatus: res.httpStatus,
    providerErrorCode: res.providerErrorCode,
  };
}

/**

 * Bounded Twilio credential reference name shape. Only Twilio-scoped
 * Omni-Comms references may ever be resolved from the credential store.
 */
export const TWILIO_SECRET_REF_PATTERN = /^OMNI_COMMS_TWILIO_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** Pure classifier for a bounded Twilio account-read probe response. */
export function classifyTwilioResponse(httpStatus: number): VerificationResultCode {
  if (httpStatus === 200) return "verified";
  if (httpStatus === 401) return "invalid_credentials";
  if (httpStatus === 403) return "restricted_api_key";
  if (httpStatus === 429) return "rate_limited";
  if (httpStatus === 404) return "invalid_credentials";
  if (httpStatus === 400 || httpStatus === 405 || httpStatus === 422) return "request_rejected";
  return "provider_unavailable";
}

/**
 * Safe, non-sending Twilio credential probe: reads the account resource only.
 * Sends no SMS and never returns or logs credential material.
 */
export async function probeTwilioCredential(
  accountSid: string,
  authToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  if (!/^AC[0-9a-fA-F]{32}$/.test(accountSid)) {
    return { resultCode: "configuration_incomplete", detail: DETAIL.configuration_incomplete };
  }
  let res: Response;
  try {
    res = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
          Accept: "application/json",
          "User-Agent": OMNI_COMMS_USER_AGENT,
        },
      },
    );
  } catch {
    return { resultCode: "provider_unavailable", detail: DETAIL.provider_unavailable };
  }
  const resultCode = classifyTwilioResponse(res.status);
  return { resultCode, detail: DETAIL[resultCode] };
}

export interface VerificationDeps {



  /** service-role supabase client */
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  /**
   * Resolves a bounded credential reference NAME to its VALUE. May be async:
   * UI-managed credentials are resolved from the encrypted vault through a
   * service-role-only RPC, with a deployment-managed Edge Function Secret as
   * the fallback. The value never leaves this module.
   */
  getSecret: (name: string) => string | undefined | Promise<string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface VerificationRequest {
  actorId: string;
  organizationId: string;
  providerAccountId: string;
  correlationId?: string | null;
}

export interface VerificationResponse {
  status: number;
  body: Record<string, unknown>;
}

const DENIAL_STATUS: Record<string, number> = {
  authentication_required: 401,
  permission_denied: 403,
  organization_access_denied: 403,
  not_found: 404,
  invalid_input: 400,
  concurrent_update: 409,
};

export async function runProviderVerification(
  req: VerificationRequest,
  deps: VerificationDeps,
): Promise<VerificationResponse> {
  if (!req.organizationId || !req.providerAccountId) {
    return { status: 400, body: { ok: false, code: "invalid_input" } };
  }

  const ctxRes = await deps.admin.rpc(
    "omni_comms_priv_provider_account_verification_context",
    {
      p_actor_id: req.actorId,
      p_organization_id: req.organizationId,
      p_provider_account_id: req.providerAccountId,
    },
  );
  if (ctxRes.error) {
    return { status: 500, body: { ok: false, code: "verification_context_failed" } };
  }
  const ctx = (ctxRes.data ?? {}) as Record<string, unknown>;
  if (ctx.allowed !== true) {
    const code = typeof ctx.code === "string" ? ctx.code : "permission_denied";
    if (code === "configuration_incomplete") {
      // Bounded, persisted business outcome — but we cannot persist without a
      // resolvable account context, so report without mutation.
      return {
        status: 200,
        body: {
          ok: false,
          code: "configuration_incomplete",
          verificationStatus: "failed",
          detail: DETAIL.configuration_incomplete,
        },
      };
    }
    return { status: DENIAL_STATUS[code] ?? 403, body: { ok: false, code } };
  }

  const accountUpdatedAt = typeof ctx.updated_at === "string" ? ctx.updated_at : null;
  if (!accountUpdatedAt) {
    return { status: 500, body: { ok: false, code: "verification_context_failed" } };
  }

  const secretRef = String(ctx.secret_ref ?? "");
  const adapterKey = String(ctx.adapter_key ?? "resend");
  let outcome: ProbeOutcome;
  if (adapterKey === "twilio") {
    // Twilio SMS: two bounded references (Account SID + Auth Token).
    const tokenRef = String(ctx.auth_token_secret_ref ?? "");
    if (!TWILIO_SECRET_REF_PATTERN.test(secretRef) || !TWILIO_SECRET_REF_PATTERN.test(tokenRef)) {
      outcome = {
        resultCode: "configuration_incomplete",
        detail: DETAIL.configuration_incomplete,
      };
    } else {
      const sid = await deps.getSecret(secretRef);
      const token = await deps.getSecret(tokenRef);
      if (!sid || sid.trim() === "" || !token || token.trim() === "") {
        outcome = { resultCode: "secret_missing", detail: DETAIL.secret_missing };
      } else {
        outcome = await probeTwilioCredential(sid.trim(), token.trim(), deps.fetchImpl ?? fetch);
      }
    }
  } else if (!SECRET_REF_PATTERN.test(secretRef)) {
    outcome = {
      resultCode: "configuration_incomplete",
      detail: DETAIL.configuration_incomplete,
    };
  } else {
    const key = await deps.getSecret(secretRef);
    if (!key || key.trim() === "") {
      outcome = { resultCode: "secret_missing", detail: DETAIL.secret_missing };
    } else {
      outcome = await probeResendCredential(key, deps.fetchImpl ?? fetch);
    }
  }


  const recRes = await deps.admin.rpc(
    "omni_comms_priv_record_provider_verification",
    {
      p_actor_id: req.actorId,
      p_organization_id: req.organizationId,
      p_provider_account_id: req.providerAccountId,
      p_expected_updated_at: accountUpdatedAt,
      p_status: statusForResult(outcome.resultCode),
      p_result_code: outcome.resultCode,
      p_detail: outcome.detail,
      p_correlation_id: req.correlationId ?? null,
    },
  );
  if (recRes.error) {
    return { status: 500, body: { ok: false, code: "verification_persist_failed" } };
  }
  const rec = (recRes.data ?? {}) as Record<string, unknown>;
  if (rec.allowed !== true) {
    const code = typeof rec.code === "string" ? rec.code : "permission_denied";
    // concurrent_update => the account changed during the probe; the stale
    // result is deliberately NOT persisted.
    return { status: DENIAL_STATUS[code] ?? 403, body: { ok: false, code } };
  }

  return {
    status: 200,
    body: {
      ok: outcome.resultCode === "verified",
      code: outcome.resultCode,
      verificationStatus: rec.verification_status,
      verificationResultCode: rec.verification_result_code,
      verificationDetail: rec.verification_detail,
      verificationCheckedAt: rec.verification_checked_at,
      updatedAt: rec.updated_at,
      emailsSent: 0,
      deliveryAttemptsCreated: 0,
      dispatchJobsCreated: 0,
    },
  };
}

/**
 * Read-only sending-domain readiness report for a provider account.
 *
 * Authorisation reuses the same service-role verification-context RPC as
 * credential verification. Nothing is persisted, no email is sent and no
 * credential value is ever returned.
 */
export async function runProviderDomainStatus(
  req: VerificationRequest,
  deps: VerificationDeps,
): Promise<VerificationResponse> {
  if (!req.organizationId || !req.providerAccountId) {
    return { status: 400, body: { ok: false, code: "invalid_input" } };
  }
  const ctxRes = await deps.admin.rpc(
    "omni_comms_priv_provider_account_verification_context",
    {
      p_actor_id: req.actorId,
      p_organization_id: req.organizationId,
      p_provider_account_id: req.providerAccountId,
    },
  );
  if (ctxRes.error) {
    return { status: 500, body: { ok: false, code: "verification_context_failed" } };
  }
  const ctx = (ctxRes.data ?? {}) as Record<string, unknown>;
  if (ctx.allowed !== true) {
    const code = typeof ctx.code === "string" ? ctx.code : "permission_denied";
    return { status: DENIAL_STATUS[code] ?? 403, body: { ok: false, code } };
  }
  const secretRef = String(ctx.secret_ref ?? "");
  if (!SECRET_REF_PATTERN.test(secretRef)) {
    return { status: 200, body: { ok: false, code: "configuration_incomplete", domains: [] } };
  }
  const key = await deps.getSecret(secretRef);
  if (!key || key.trim() === "") {
    return { status: 200, body: { ok: false, code: "secret_missing", domains: [] } };
  }
  const probe = await probeResendDomains(key, deps.fetchImpl ?? fetch);
  return {
    status: 200,
    body: {
      ok: probe.resultCode === "verified",
      code: probe.resultCode,
      domains: probe.domains,
      httpStatus: probe.httpStatus,
      providerErrorCode: probe.providerErrorCode,
      emailsSent: 0,
      deliveryAttemptsCreated: 0,
      dispatchJobsCreated: 0,
    },
  };
}
