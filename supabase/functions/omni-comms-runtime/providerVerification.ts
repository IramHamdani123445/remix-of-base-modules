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
  | "invalid_credentials"
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
  invalid_credentials: "Resend rejected the configured API key.",
  secret_missing: "No Edge secret is configured for the secret reference.",
  provider_unavailable: "Resend could not be reached.",
  rate_limited: "Resend rate limited the verification request.",
  configuration_incomplete: "Provider account configuration is incomplete.",
};

export function statusForResult(code: VerificationResultCode): VerificationStatus {
  return code === "verified" ? "verified" : "failed";
}

export function detailForResult(code: VerificationResultCode): string {
  return DETAIL[code];
}

/** Bounded secret-reference name shape. */
export const SECRET_REF_PATTERN = /^[A-Z][A-Z0-9_]{2,63}$/;

/**
 * Safe, non-sending Resend credential probe.
 * Uses the read-only domains listing endpoint; it dispatches no email.
 */
export async function probeResendCredential(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProbeOutcome> {
  let res: Response;
  try {
    res = await fetchImpl("https://api.resend.com/domains", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return { resultCode: "provider_unavailable", detail: DETAIL.provider_unavailable };
  }
  // The body is intentionally not read, logged, or persisted.
  try { await res.text(); } catch { /* ignore */ }

  if (res.status === 200) return { resultCode: "verified", detail: DETAIL.verified };
  if (res.status === 401 || res.status === 403) {
    return { resultCode: "invalid_credentials", detail: DETAIL.invalid_credentials };
  }
  if (res.status === 429) return { resultCode: "rate_limited", detail: DETAIL.rate_limited };
  return { resultCode: "provider_unavailable", detail: DETAIL.provider_unavailable };
}

export interface VerificationDeps {
  /** service-role supabase client */
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  getSecret: (name: string) => string | undefined;
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

  const secretRef = String(ctx.secret_ref ?? "");
  let outcome: ProbeOutcome;
  if (!SECRET_REF_PATTERN.test(secretRef)) {
    outcome = {
      resultCode: "configuration_incomplete",
      detail: DETAIL.configuration_incomplete,
    };
  } else {
    const key = deps.getSecret(secretRef);
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
