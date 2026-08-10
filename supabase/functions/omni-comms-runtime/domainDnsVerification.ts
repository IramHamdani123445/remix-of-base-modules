// Omni-Comms — trusted server-side sending-domain DNS verification.
//
// Purpose: when the runtime credential is intentionally sending-only (and so
// cannot read the provider's domain API), an operator may verify the domain
// in the provider's own console. That claim alone is NOT trusted. This module
// independently resolves the DNS records the provider requires and records
// what the SERVER observed, so 'verified' is always backed by evidence.
//
// Boundaries (permanent):
//   - No credential material is read, used or logged here.
//   - No provider API is contacted and no email is ever sent.
//   - Only DNS-over-HTTPS resolution and bounded SECURITY DEFINER RPCs.

export type DnsRecordType = "TXT" | "MX" | "CNAME" | "A";
export type DnsMatchMode = "contains" | "equals";

export interface ExpectedDnsRecord {
  recordType: DnsRecordType;
  name: string;
  expectedValue: string;
  matchMode: DnsMatchMode;
  required: boolean;
  purpose?: string | null;
}

export interface DnsEvidenceEntry extends ExpectedDnsRecord {
  observed: string[];
  matched: boolean;
  resolverStatus: string;
}

export interface DnsVerificationOutcome {
  allMatched: boolean;
  resultCode:
    | "verified"
    | "dns_mismatch"
    | "dns_records_missing"
    | "dns_lookup_failed";
  detail: string;
  evidence: DnsEvidenceEntry[];
}

const DOH_ENDPOINT = "https://dns.google/resolve";
const USER_AGENT = "SSB-OmniComms-DomainVerification/1.0";

const DNS_TYPE_CODES: Record<DnsRecordType, number> = {
  A: 1,
  CNAME: 5,
  MX: 15,
  TXT: 16,
};

const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9_]([a-z0-9-]*[a-z0-9])?)*$/i;

/** Normalises a resolver answer for comparison: unquote, de-escape, trim dot. */
export function normaliseDnsValue(raw: string): string {
  let v = String(raw ?? "").trim();
  // Long TXT answers arrive as several quoted strings; join them.
  if (v.includes('"')) {
    const parts = v.match(/"([^"]*)"/g);
    if (parts && parts.length > 0) {
      v = parts.map((p) => p.slice(1, -1)).join("");
    }
  }
  v = v.replace(/\\"/g, '"').trim();
  if (v.endsWith(".") && !v.endsWith("..")) v = v.slice(0, -1);
  return v.replace(/\s+/g, " ");
}

export function dnsValueMatches(
  observed: string,
  expected: string,
  mode: DnsMatchMode,
): boolean {
  const o = normaliseDnsValue(observed).toLowerCase();
  const e = normaliseDnsValue(expected).toLowerCase();
  if (e === "") return false;
  return mode === "equals" ? o === e : o.includes(e);
}

/** Rejects anything that is not a plain hostname, so no SSRF-shaped input. */
export function isSafeDnsName(name: string): boolean {
  const n = String(name ?? "").trim().replace(/\.$/, "");
  return n.length > 0 && n.length <= 253 && HOSTNAME_PATTERN.test(n);
}

export function parseExpectedDnsRecords(raw: unknown): ExpectedDnsRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: ExpectedDnsRecord[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const recordType = String(
      r.recordType ?? r.record_type ?? "",
    ).toUpperCase() as DnsRecordType;
    const name = String(r.name ?? "").trim();
    const expectedValue = String(r.expectedValue ?? r.expected_value ?? "").trim();
    const matchMode = (String(r.matchMode ?? r.match_mode ?? "contains") === "equals"
      ? "equals"
      : "contains") as DnsMatchMode;
    if (!(recordType in DNS_TYPE_CODES)) continue;
    if (!isSafeDnsName(name) || expectedValue === "") continue;
    out.push({
      recordType,
      name,
      expectedValue,
      matchMode,
      required: r.required !== false,
      purpose: typeof r.purpose === "string" ? r.purpose : null,
    });
  }
  return out;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function resolveOne(
  record: ExpectedDnsRecord,
  fetchImpl: FetchLike,
): Promise<{ observed: string[]; resolverStatus: string }> {
  const url =
    `${DOH_ENDPOINT}?name=${encodeURIComponent(record.name)}` +
    `&type=${DNS_TYPE_CODES[record.recordType]}`;
  try {
    const res = await fetchImpl(url, {
      headers: { accept: "application/dns-json", "user-agent": USER_AGENT },
    });
    if (!res.ok) return { observed: [], resolverStatus: `resolver_http_${res.status}` };
    const body = (await res.json()) as Record<string, unknown>;
    const answers = Array.isArray(body.Answer) ? body.Answer : [];
    const observed = answers
      .map((a) => normaliseDnsValue(String((a as Record<string, unknown>).data ?? "")))
      .filter((v) => v !== "");
    if (observed.length === 0) return { observed, resolverStatus: "no_records" };
    return { observed, resolverStatus: "ok" };
  } catch {
    return { observed: [], resolverStatus: "resolver_unavailable" };
  }
}

/** Resolves every expectation and reports exactly what the server observed. */
export async function collectDnsEvidence(
  expected: readonly ExpectedDnsRecord[],
  fetchImpl: FetchLike,
): Promise<DnsVerificationOutcome> {
  if (expected.length === 0) {
    return {
      allMatched: false,
      resultCode: "dns_records_missing",
      detail: "No DNS expectations were recorded for this domain.",
      evidence: [],
    };
  }

  const evidence: DnsEvidenceEntry[] = [];
  for (const record of expected) {
    const { observed, resolverStatus } = await resolveOne(record, fetchImpl);
    evidence.push({
      ...record,
      observed,
      resolverStatus,
      matched: observed.some((o) =>
        dnsValueMatches(o, record.expectedValue, record.matchMode)
      ),
    });
  }

  const required = evidence.filter((e) => e.required);
  const allMatched = required.length > 0 && required.every((e) => e.matched);
  const lookupFailed = evidence.some((e) =>
    e.resolverStatus.startsWith("resolver_")
  );
  const missing = required.filter((e) => e.resolverStatus === "no_records");

  let resultCode: DnsVerificationOutcome["resultCode"];
  let detail: string;
  if (allMatched) {
    resultCode = "verified";
    detail = `All ${required.length} required DNS records were observed by the server.`;
  } else if (lookupFailed) {
    resultCode = "dns_lookup_failed";
    detail = "The DNS resolver could not be reached for one or more records.";
  } else if (missing.length > 0) {
    resultCode = "dns_records_missing";
    detail = `${missing.length} required DNS record(s) are not published yet.`;
  } else {
    resultCode = "dns_mismatch";
    detail = `${required.filter((e) => !e.matched).length} required DNS record(s) do not match the expected value.`;
  }

  return { allMatched, resultCode, detail, evidence };
}

interface AdminClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export interface VerifySendingDomainInput {
  actorId: string | null;
  organizationId: string;
  domainVerificationId: string;
}

export interface VerifySendingDomainResult {
  status: number;
  body: Record<string, unknown>;
}

const CODE_STATUS: Record<string, number> = {
  authentication_required: 401,
  permission_denied: 403,
  organization_access_denied: 403,
  not_found: 404,
  configuration_incomplete: 422,
  invalid_input: 400,
};

/** Full request handler: authorise → resolve DNS → persist evidence. */
export async function runSendingDomainVerification(
  input: VerifySendingDomainInput,
  deps: { admin: AdminClient; fetchImpl?: FetchLike },
): Promise<VerifySendingDomainResult> {
  const { admin } = deps;
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as FetchLike);

  if (!input.actorId) {
    return { status: 401, body: { ok: false, code: "authentication_required" } };
  }
  if (!input.organizationId || !input.domainVerificationId) {
    return { status: 400, body: { ok: false, code: "invalid_input" } };
  }

  const ctxRes = await admin.rpc("omni_comms_priv_domain_verification_context", {
    p_actor_id: input.actorId,
    p_organization_id: input.organizationId,
    p_domain_verification_id: input.domainVerificationId,
  });
  if (ctxRes.error) {
    return { status: 500, body: { ok: false, code: "verification_unavailable" } };
  }
  const ctx = (ctxRes.data ?? {}) as Record<string, unknown>;
  if (ctx.allowed !== true) {
    const code = String(ctx.code ?? "not_found");
    return { status: CODE_STATUS[code] ?? 400, body: { ok: false, code } };
  }

  const expected = parseExpectedDnsRecords(ctx.expected_dns);
  const outcome = await collectDnsEvidence(expected, fetchImpl);

  const recordRes = await admin.rpc("omni_comms_priv_record_domain_verification", {
    p_actor_id: input.actorId,
    p_organization_id: input.organizationId,
    p_domain_verification_id: input.domainVerificationId,
    p_all_matched: outcome.allMatched,
    p_dns_evidence: outcome.evidence,
    p_result_code: outcome.resultCode,
    p_detail: outcome.detail,
  });
  if (recordRes.error) {
    return { status: 500, body: { ok: false, code: "verification_not_recorded" } };
  }
  const recorded = (recordRes.data ?? {}) as Record<string, unknown>;

  return {
    status: 200,
    body: {
      ok: true,
      code: outcome.resultCode,
      status: recorded.status ?? null,
      detail: outcome.detail,
      domainName: ctx.domain_name ?? null,
      verificationSource: ctx.verification_source ?? null,
      evidence: outcome.evidence,
    },
  };
}
