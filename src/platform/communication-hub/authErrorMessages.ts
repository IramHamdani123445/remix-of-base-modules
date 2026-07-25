import { CommHubAuthError } from "./authSession";

/**
 * Communication Hub — authentication error catalogue.
 *
 * The server returns machine codes on the stable envelope (or on a thrown
 * CommHubAuthError). The UI never renders raw codes; it renders structured
 * operator-friendly details from this catalogue.
 *
 * Phase 4B3 — Authentication and retry-safety correction: authentication
 * failures are strictly separated from business send-decision blockers.
 * They MUST NOT be rendered as configuration / recipient / provider issues,
 * MUST NOT surface Send Decision log guidance, and MUST NOT trigger the
 * generic "Outcome not retry-safe" screen.
 */

export interface AuthErrorDetails {
  code: string;
  title: string;
  message: string;
  fix: string;
  severity: "low" | "medium" | "high" | "critical";
  /** When the code represents a pre-mutation auth failure, retry is safe. */
  retrySafe: boolean;
}

const SESSION_EXPIRED: AuthErrorDetails = {
  code: "session_expired",
  title: "Your session has expired",
  message:
    "Your authenticated session is no longer available. No Dry Run was started.",
  fix: "Refresh your session or sign in again, then retry.",
  severity: "medium",
  retrySafe: true,
};

const AUTH_CATALOGUE: Record<string, AuthErrorDetails> = {
  not_authenticated: SESSION_EXPIRED,
  UNAUTHENTICATED: SESSION_EXPIRED,
  UNAUTHENTICATED_TRANSITION: {
    ...SESSION_EXPIRED,
    code: "UNAUTHENTICATED_TRANSITION",
    message:
      "Your session expired between checks. No Dry Run runtime rows were created.",
  },
  authentication_required: SESSION_EXPIRED,
  session_expired: SESSION_EXPIRED,
  invalid_or_expired_jwt: {
    ...SESSION_EXPIRED,
    code: "invalid_or_expired_jwt",
    message:
      "Your access token has expired or is no longer valid. No Dry Run was started.",
  },
  authentication_header_missing: {
    ...SESSION_EXPIRED,
    code: "authentication_header_missing",
    message:
      "Your login session was not sent with the request. No Dry Run was started.",
  },
  authentication_token_expired: SESSION_EXPIRED,
  authentication_token_invalid: SESSION_EXPIRED,
  authentication_user_missing: {
    ...SESSION_EXPIRED,
    code: "authentication_user_missing",
    message:
      "We could not identify your account for this request. No Dry Run was started.",
  },
  authentication_service_unavailable: {
    ...SESSION_EXPIRED,
    code: "authentication_service_unavailable",
    title: "Authentication service unavailable",
    message:
      "The authentication service is temporarily unavailable. No Dry Run was started.",
    fix: "Wait a moment and retry. If the problem persists, sign in again.",
  },
  session_lookup_failed: {
    ...SESSION_EXPIRED,
    code: "session_lookup_failed",
    message:
      "We could not read your current session. No Dry Run was started.",
    fix: "Refresh the page. If the problem persists, sign in again.",
  },
  OPERATOR_ACCESS_TOKEN_EXPIRED: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_ACCESS_TOKEN_EXPIRED",
    message: "The operator access token has expired. No Dry Run was started.",
    fix: "Sign in again, then revalidate the selected Preview and approval.",
  },
  OPERATOR_TOKEN_TOO_CLOSE_TO_EXPIRY: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_TOKEN_TOO_CLOSE_TO_EXPIRY",
    title: "Session refresh required",
    message: "The access token does not have the five minutes required for this action.",
    fix: "Refresh the session before running the Dry Test.",
  },
  OPERATOR_REFRESH_REQUIRED: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_REFRESH_REQUIRED",
    title: "Session refresh required",
  },
  OPERATOR_REFRESH_FAILED: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_REFRESH_FAILED",
    title: "Session could not be refreshed",
    message: "The refresh token could not restore an action-ready session.",
    fix: "Sign in again.",
  },
  OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_JWT_NOT_PROPAGATED_TO_POSTGREST",
    title: "Platform JWT propagation fix required",
    message: "The Auth server confirmed the operator, but the database request did not receive that identity.",
    fix: "Do not retry the Dry Test. Platform support must repair JWT propagation.",
    retrySafe: false,
    severity: "high",
  },
  OPERATOR_IDENTITY_MISMATCH: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_IDENTITY_MISMATCH",
    title: "Operator identity mismatch",
    message: "The authenticated account changed across the action boundary.",
    fix: "Sign in again with the intended operator account.",
  },
  OPERATOR_AUTH_CLAIMS_MISSING: {
    ...SESSION_EXPIRED,
    code: "OPERATOR_AUTH_CLAIMS_MISSING",
    title: "Operator claims missing",
    message: "The database request did not contain authoritative operator claims.",
    fix: "Do not retry the Dry Test. Platform support must repair the authentication boundary.",
    retrySafe: false,
    severity: "high",
  },
};

export interface EnvelopeLike {
  status?: string;
  failure_stage?: string | null;
  failureStage?: string | null;
  message?: string | null;
  retry_reason?: string | null;
  blockers?: Array<{ code?: string; stage?: string; message?: string }>;
  retry_safe?: boolean;
}

/** Known auth codes — a stable predicate for envelope classification. */
export function isKnownAuthCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return Object.prototype.hasOwnProperty.call(AUTH_CATALOGUE, code);
}

/** Extract a canonical auth code from a thrown error or an envelope. */
export function extractAuthCode(input: unknown): string | null {
  if (input instanceof CommHubAuthError) return input.code;
  if (!input || typeof input !== "object") return null;
  const env = input as EnvelopeLike;
  const stage = env.failure_stage ?? env.failureStage ?? null;
  if (stage === "auth" || env.retry_reason === "AUTHENTICATION_REQUIRED") {
    const b = (env.blockers ?? []).find((x) => x?.code && isKnownAuthCode(x.code));
    if (b?.code) return b.code;
  }
  if (Array.isArray(env.blockers)) {
    const b = env.blockers.find((x) => x?.code && isKnownAuthCode(x.code));
    if (b?.code) return b.code;
  }
  return null;
}

/** Structured operator-facing details for an auth failure. */
export function getAuthErrorDetails(input: unknown): AuthErrorDetails | null {
  const code = extractAuthCode(input);
  if (!code) return null;
  return AUTH_CATALOGUE[code] ?? SESSION_EXPIRED;
}

/** True when the input represents an authentication failure. */
export function isAuthFailure(input: unknown): boolean {
  return getAuthErrorDetails(input) !== null;
}

/**
 * Legacy string-only helper retained for existing toast call sites.
 * New UI must prefer {@link getAuthErrorDetails} for the full structure.
 */
export function resolveAuthErrorMessage(input: unknown): string | null {
  const d = getAuthErrorDetails(input);
  return d ? `${d.title} — ${d.message}` : null;
}
