// Omni-Comms Slice 2c-i — server-side canonicalization (Deno).
//
// Deterministic pure port of src/platform/omni-comms/runtime/canonicalize.ts,
// intentionally duplicated because Deno edge-runtime cannot import from
// the browser source tree. Kept byte-for-byte-compatible on the wire
// format so the SHA-256 of canonicalJsonString() matches on both sides.
// Any change here MUST be mirrored in the browser file.

export interface CanonicalRecipient {
  recipientType: string;
  /**
   * First-class SEMANTIC business role (claimant, employer_contact, ...).
   * Distinct from the persistence recipientType. Survives the trusted
   * boundary and is persisted immutably on omni_comms_recipient.
   */
  recipientRole: string | null;
  recipientReference: string | null;
  displayName: string | null;
  locale: string | null;
  email: string | null;
  phone: string | null;
  pushDestination: string | null;
}

export interface CanonicalCallerContext {
  moduleCode: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface CanonicalRequest {
  eventCode: string;
  organizationId: string;
  departmentId: string | null;
  mode: string;
  requestedChannels: string[];
  recipients: CanonicalRecipient[];
  payload: Record<string, unknown>;
  callerContext: CanonicalCallerContext;
  /**
   * Immutable business resolution context (product, offered recipient roles).
   * Business meaning only — never configuration decisions, never secrets.
   */
  businessContext: CanonicalBusinessContext;
}

export interface CanonicalBusinessContext {
  productId: string | null;
  recipientRoles: string[];
}

export class CanonicalizationError extends Error {
  readonly code: string;
  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "CanonicalizationError";
    this.code = code;
  }
}

const MAX_PAYLOAD_BYTES = 262144;
const MAX_JSON_DEPTH = 20;
const MAX_RECIPIENTS = 500;
/**
 * Canonical persisted recipient vocabulary. Mirrors the
 * `omni_comms_recipient_recipient_type_check` constraint exactly, so a
 * recipient that could never be stored is refused BEFORE any request row is
 * created instead of failing later as an opaque persistence error.
 */
const APPROVED_RECIPIENT_TYPES = new Set([
  "user",
  "contact",
  "group",
  "external",
  "system",
  "synthetic_test",
]);
const APPROVED_CHANNELS = new Set([
  "email", "sms", "whatsapp", "push", "in_app", "print",
]);
const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function trimOrNull(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") {
    throw new CanonicalizationError("invalid_input", "non_string_field");
  }
  const t = v.trim();
  if (t.length === 0) return null;
  if (t.length > max) {
    throw new CanonicalizationError("invalid_input", "field_too_long");
  }
  return t;
}

function normalizeUuidOrThrow(v: string, field: string): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new CanonicalizationError("invalid_input", `${field}_not_uuid`);
  }
  return v.toLowerCase();
}

function normalizeUuidOrNull(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) {
    throw new CanonicalizationError("invalid_input", `${field}_not_uuid`);
  }
  return v.toLowerCase();
}

// deno-lint-ignore no-explicit-any
const ROLE_RE = /^[a-z][a-z0-9_]{0,63}$/;

function canonicalizeRole(v: unknown): string | null {
  const t = trimOrNull(v, 64);
  if (t === null) return null;
  const lower = t.toLowerCase();
  if (!ROLE_RE.test(lower)) {
    throw new CanonicalizationError("invalid_input", "recipient_role_invalid");
  }
  return lower;
}

function canonicalizeRecipient(r: any): CanonicalRecipient {
  if (!r || typeof r !== "object" || Array.isArray(r)) {
    throw new CanonicalizationError("invalid_input", "recipient_not_object");
  }
  const type = trimOrNull(r.recipientType, 64);
  if (!type) {
    throw new CanonicalizationError("invalid_input", "recipient_type_required");
  }
  if (!APPROVED_RECIPIENT_TYPES.has(type)) {
    throw new CanonicalizationError("recipient_type_invalid", `unknown_${type}`);
  }
  const email = trimOrNull(r.email, 320);
  const phone = trimOrNull(r.phone, 64);
  const push = trimOrNull(r.pushDestination, 500);
  return {
    recipientType: type,
    recipientRole: canonicalizeRole(r.recipientRole ?? null),
    recipientReference: trimOrNull(r.recipientReference, 128),
    displayName: trimOrNull(r.displayName, 200),
    locale: trimOrNull(r.locale, 32),
    email: email ? email.toLowerCase() : null,
    phone: phone ?? null,
    pushDestination: push ?? null,
  };
}

function canonicalizePayload(input: unknown, depth = 0): unknown {
  if (depth > MAX_JSON_DEPTH) {
    throw new CanonicalizationError("invalid_input", "payload_depth_exceeded");
  }
  if (input === null) return null;
  const t = typeof input;
  if (t === "string" || t === "boolean") return input;
  if (t === "number") {
    if (!Number.isFinite(input as number)) {
      throw new CanonicalizationError("payload_invalid", "non_finite_number");
    }
    return input;
  }
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") {
    throw new CanonicalizationError("payload_invalid", `unsupported_${t}`);
  }
  if (Array.isArray(input)) {
    return (input as unknown[]).map((v) => canonicalizePayload(v, depth + 1));
  }
  if (t === "object") {
    const keys = Object.keys(input as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      const v = (input as Record<string, unknown>)[k];
      if (v === undefined) {
        throw new CanonicalizationError("payload_invalid", "undefined_field");
      }
      out[k] = canonicalizePayload(v, depth + 1);
    }
    return out;
  }
  throw new CanonicalizationError("payload_invalid", "unsupported_value");
}

function detectCycle(v: unknown, seen: WeakSet<object>): void {
  if (v === null || typeof v !== "object") return;
  if (seen.has(v as object)) {
    throw new CanonicalizationError("payload_invalid", "cyclic_object");
  }
  seen.add(v as object);
  if (Array.isArray(v)) {
    for (const x of v) detectCycle(x, seen);
  } else {
    for (const k of Object.keys(v as Record<string, unknown>)) {
      detectCycle((v as Record<string, unknown>)[k], seen);
    }
  }
  seen.delete(v as object);
}

// deno-lint-ignore no-explicit-any
export function canonicalizeRequest(input: any): CanonicalRequest {
  if (!input || typeof input !== "object") {
    throw new CanonicalizationError("invalid_input", "input_not_object");
  }
  const eventCode = trimOrNull(input.eventCode, 128);
  if (!eventCode) {
    throw new CanonicalizationError("invalid_input", "event_code_required");
  }
  if (!input.organizationId) {
    throw new CanonicalizationError("organization_required");
  }
  const organizationId = normalizeUuidOrThrow(input.organizationId, "organization_id");
  const departmentId = normalizeUuidOrNull(input.departmentId ?? null, "department_id");

  if (!Array.isArray(input.recipients) || input.recipients.length === 0) {
    throw new CanonicalizationError("recipients_required");
  }
  if (input.recipients.length > MAX_RECIPIENTS) {
    throw new CanonicalizationError("recipient_limit_exceeded");
  }
  const recipients = input.recipients.map(canonicalizeRecipient);

  const rawChannels = Array.isArray(input.requestedChannels)
    ? input.requestedChannels
    : [];
  const normalizedChannels = new Set<string>();
  for (const c of rawChannels) {
    if (typeof c !== "string") {
      throw new CanonicalizationError("channel_invalid", "channel_not_string");
    }
    const t = c.trim().toLowerCase();
    if (!APPROVED_CHANNELS.has(t)) {
      throw new CanonicalizationError("channel_invalid", `unknown_${t}`);
    }
    normalizedChannels.add(t);
  }
  const requestedChannels = Array.from(normalizedChannels).sort();

  if (
    !input.payload ||
    typeof input.payload !== "object" ||
    Array.isArray(input.payload)
  ) {
    throw new CanonicalizationError("payload_invalid");
  }
  detectCycle(input.payload, new WeakSet<object>());
  const payload = canonicalizePayload(input.payload) as Record<string, unknown>;

  const ctx = input.callerContext ?? {};
  const callerContext: CanonicalCallerContext = {
    moduleCode: trimOrNull(ctx.moduleCode ?? null, 64),
    entityType: trimOrNull(ctx.entityType ?? null, 64),
    entityId: trimOrNull(ctx.entityId ?? null, 128),
  };

  const rc = (input as { resolutionContext?: { productId?: string | null; recipientRoles?: string[] } })
    .resolutionContext ?? {};
  const roles = Array.isArray(rc.recipientRoles) ? rc.recipientRoles : [];
  const normalizedRoles = Array.from(
    new Set(roles.map((x) => canonicalizeRole(x)).filter((x): x is string => x !== null)),
  ).sort();
  if (normalizedRoles.length > 16) {
    throw new CanonicalizationError("invalid_input", "recipient_roles_too_many");
  }
  const businessContext: CanonicalBusinessContext = {
    productId: normalizeUuidOrNull(rc.productId ?? null, "product_id"),
    recipientRoles: normalizedRoles,
  };

  const canonical: CanonicalRequest = {
    eventCode,
    organizationId,
    departmentId,
    mode: input.mode,
    requestedChannels,
    recipients,
    payload,
    callerContext,
    businessContext,
  };

  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new CanonicalizationError("payload_too_large", `payload_bytes:${bytes}`);
  }

  return canonical;
}

export function canonicalJsonString(c: CanonicalRequest): string {
  const stable = {
    callerContext: c.callerContext,
    departmentId: c.departmentId,
    eventCode: c.eventCode,
    mode: c.mode,
    organizationId: c.organizationId,
    payload: c.payload,
    recipients: c.recipients.map((r) => {
      // Legacy fingerprint continuity: the role key is present in the hashed
      // form ONLY when a role was actually supplied, so pre-v2 requests keep
      // their original fingerprint and replay safely.
      const base: Record<string, unknown> = {
        recipientType: r.recipientType,
        recipientReference: r.recipientReference,
        displayName: r.displayName,
        locale: r.locale,
        email: r.email,
        phone: r.phone,
        pushDestination: r.pushDestination,
      };
      if (r.recipientRole) base.recipientRole = r.recipientRole;
      return base;
    }),
    requestedChannels: c.requestedChannels,
  } as Record<string, unknown>;
  const bc = c.businessContext;
  if (bc && (bc.productId || (bc.recipientRoles?.length ?? 0) > 0)) {
    (stable as Record<string, unknown>).businessContext = {
      productId: bc.productId ?? null,
      recipientRoles: bc.recipientRoles ?? [],
    };
  }
  return JSON.stringify(stable);
}

export async function computeRequestFingerprint(
  canonical: CanonicalRequest,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJsonString(canonical));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < view.length; i++) {
    const b = view[i];
    out += (b < 16 ? "0" : "") + b.toString(16);
  }
  return out;
}
