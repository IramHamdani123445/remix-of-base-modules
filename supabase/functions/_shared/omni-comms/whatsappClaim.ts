// Omni-Comms — WhatsApp dispatch-claim parsing.
//
// The database claim is the ONLY authority for the ContentSid, the positional
// content variables and the status-callback URL. This module never recomputes
// them and never accepts them from a caller: it validates the immutable server
// claim and fails closed BEFORE the provider is contacted.
//
// Pure functions only (no Deno, no network) so the rules are directly testable.

export const WHATSAPP_CONTENT_SID_RE = /^HX[0-9a-fA-F]{32}$/;

/** Bounded ceiling — a provider template can never legitimately exceed this. */
export const MAX_CONTENT_VARIABLES = 32;
export const MAX_CONTENT_VARIABLE_LENGTH = 1024;

export type WhatsAppClaimFailureCode =
  | "content_sid_invalid"
  | "content_variables_malformed"
  | "content_variables_unresolved"
  | "status_callback_missing"
  | "status_callback_invalid";

export interface WhatsAppClaimParseFailure {
  readonly ok: false;
  readonly code: WhatsAppClaimFailureCode;
  readonly detail: string;
}

export interface WhatsAppClaimParseSuccess {
  readonly ok: true;
  readonly contentSid: string | null;
  /** Canonical, numerically ordered variable map. Empty when free-form. */
  readonly contentVariables: Record<string, string>;
  readonly statusCallbackUrl: string | null;
}

export type WhatsAppClaimParseResult =
  | WhatsAppClaimParseSuccess
  | WhatsAppClaimParseFailure;

function fail(
  code: WhatsAppClaimFailureCode,
  detail: string,
): WhatsAppClaimParseFailure {
  return { ok: false, code, detail };
}

/**
 * Canonicalises the claim's `content_variables` into a bounded
 * `Record<string,string>` with numerically ordered 1-based keys.
 *
 * Ordering is stable so the provider-payload fingerprint of a safe retry is
 * byte-identical to the first attempt.
 */
export function canonicaliseContentVariables(
  raw: unknown,
): Record<string, string> | null {
  if (raw === null || raw === undefined) return {};
  let value = raw;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return {};
    try {
      value = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_CONTENT_VARIABLES) return null;

  const out: Record<string, string> = {};
  const keys: number[] = [];
  for (const [key, item] of entries) {
    if (!/^[1-9][0-9]*$/.test(key)) return null;
    if (typeof item !== "string") return null;
    if (item.length > MAX_CONTENT_VARIABLE_LENGTH) return null;
    keys.push(Number(key));
  }
  keys.sort((a, b) => a - b);
  for (const key of keys) {
    out[String(key)] = (value as Record<string, string>)[String(key)];
  }
  return out;
}

/** A server-approved runtime callback endpoint: absolute https, no credentials. */
export function isApprovedStatusCallbackUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 512) return false;
  if (!/^https:\/\//.test(trimmed)) return false;
  if (/[\s<>"'\\]/.test(trimmed)) return false;
  if (trimmed.includes("@")) return false; // never carry embedded credentials
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname.length > 0 && url.username === "";
  } catch {
    return false;
  }
}

/**
 * Validates one WhatsApp claim. A structured (ContentSid) business send must
 * carry a well-formed ContentSid, fully resolved variables and an approved
 * callback endpoint, or it is refused before any network call.
 */
export function parseWhatsAppClaim(
  claim: Record<string, unknown>,
): WhatsAppClaimParseResult {
  const rawSid = typeof claim.content_sid === "string" ? claim.content_sid.trim() : "";
  const structured = rawSid !== "";
  if (structured && !WHATSAPP_CONTENT_SID_RE.test(rawSid)) {
    return fail("content_sid_invalid", "The approved template reference is malformed.");
  }

  const variables = canonicaliseContentVariables(claim.content_variables);
  if (variables === null) {
    return fail("content_variables_malformed", "The claimed template variables are malformed.");
  }
  if (structured && Object.values(variables).some((v) => v.trim() === "")) {
    return fail("content_variables_unresolved", "A claimed template variable is unresolved.");
  }

  const rawCallback = claim.status_callback_url;
  const hasCallback = typeof rawCallback === "string" && rawCallback.trim() !== "";
  if (structured && !hasCallback) {
    return fail("status_callback_missing", "No server-approved status callback endpoint is configured.");
  }
  if (hasCallback && !isApprovedStatusCallbackUrl(rawCallback)) {
    return fail("status_callback_invalid", "The claimed status callback endpoint is not an approved https endpoint.");
  }

  return {
    ok: true,
    contentSid: structured ? rawSid : null,
    contentVariables: variables,
    statusCallbackUrl: hasCallback ? (rawCallback as string).trim() : null,
  };
}
