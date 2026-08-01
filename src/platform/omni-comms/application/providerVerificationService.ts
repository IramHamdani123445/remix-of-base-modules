/**
 * Omni-Comms Step 1 — Resend provider-account credential verification client.
 *
 * Calls the trusted `omni-comms-runtime` Edge Function's
 * `/verify-provider-credentials` path. The browser sends ONLY the
 * provider-account id and organisation context; it never sees, sends, or
 * receives API-key material. No email is sent by this action.
 */
import { supabase } from "@/integrations/supabase/client";

/** Only Resend-scoped Omni-Comms secret references may be verified. */
export const OMNI_COMMS_RESEND_SECRET_REF_PATTERN =
  /^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

export type ProviderVerificationResultCode =
  | "verified"
  | "invalid_credentials"
  | "secret_missing"
  | "provider_unavailable"
  | "rate_limited"
  | "configuration_incomplete";

export interface ProviderVerificationResponse {
  ok: boolean;
  code: string;
  verificationStatus?: string | null;
  verificationResultCode?: string | null;
  verificationDetail?: string | null;
  verificationCheckedAt?: string | null;
  updatedAt?: string | null;
  httpStatus: number;
}

const FUNCTION_NAME = "omni-comms-runtime";

function functionsBaseUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  return url ? `${url.replace(/\/$/, "")}/functions/v1` : "/functions/v1";
}

export const PROVIDER_VERIFICATION_MESSAGES: Record<string, string> = {
  verified: "Credentials verified with Resend.",
  invalid_credentials: "Resend rejected the configured API key.",
  secret_missing: "No Edge secret exists for this secret reference.",
  provider_unavailable: "Resend could not be reached. Try again shortly.",
  rate_limited: "Resend rate limited the check. Try again shortly.",
  configuration_incomplete: "Provider account configuration is incomplete.",
  permission_denied: "You do not have permission to verify credentials.",
  organization_access_denied: "You do not have access to this organisation.",
  authentication_required: "Sign in again to verify credentials.",
  not_found: "Provider account not found.",
  invalid_input: "Verification request was incomplete.",
  concurrent_update:
    "The account changed during verification. The result was not saved — reload and verify again.",
};

export async function verifyProviderCredentials(params: {
  organizationId: string;
  providerAccountId: string;
  correlationId?: string | null;
}): Promise<ProviderVerificationResponse> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const anon = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

  const res = await fetch(
    `${functionsBaseUrl()}/${FUNCTION_NAME}/verify-provider-credentials`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(anon ? { apikey: anon } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        organizationId: params.organizationId,
        providerAccountId: params.providerAccountId,
        correlationId: params.correlationId ?? null,
      }),
    },
  );

  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* bounded */ }

  return {
    ok: body.ok === true,
    code: typeof body.code === "string" ? body.code : "provider_unavailable",
    verificationStatus: (body.verificationStatus as string) ?? null,
    verificationResultCode: (body.verificationResultCode as string) ?? null,
    verificationDetail: (body.verificationDetail as string) ?? null,
    verificationCheckedAt: (body.verificationCheckedAt as string) ?? null,
    updatedAt: (body.updatedAt as string) ?? null,
    httpStatus: res.status,
  };
}
