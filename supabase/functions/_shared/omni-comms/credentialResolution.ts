// Omni-Comms — shared, server-only credential VALUE resolution.
//
// Boundaries (permanent):
//   * A credential is addressed by bounded reference NAME only.
//   * The value is never logged, echoed, persisted or returned to a browser.
//   * The provider account's declared storage mode is authoritative: a vault
//     account never silently falls back to an Edge secret and vice versa.

import {
  isManagedSecretRef,
  type ManagedSecretResolver,
} from "./managedSecrets.ts";

export type OmniCommsStorageMode = "vault" | "edge_env" | string;

export interface ResolveSecretInput {
  readonly secretRef: string;
  readonly pattern: RegExp;
  readonly storageMode: OmniCommsStorageMode;
  readonly secretResolver?: ManagedSecretResolver;
}

export type ResolvedSecret =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly errorCode: string; readonly detail: string };

/** Resolves one bounded secret reference to its value, or a bounded failure. */
export async function resolveOmniCommsSecret(
  input: ResolveSecretInput,
): Promise<ResolvedSecret> {
  const ref = String(input.secretRef ?? "").trim();
  if (ref === "" || !input.pattern.test(ref)) {
    return {
      ok: false,
      errorCode: "secret_reference_invalid",
      detail: "The configured credential reference name is not permitted.",
    };
  }

  if (input.storageMode === "vault") {
    if (!isManagedSecretRef(ref) || !input.secretResolver) {
      return {
        ok: false,
        errorCode: "secret_reference_invalid",
        detail: "The managed credential reference cannot be resolved.",
      };
    }
    const value = await input.secretResolver(ref);
    if (!value) {
      return {
        ok: false,
        errorCode: "secret_not_configured",
        detail: "The managed credential is not present for this account.",
      };
    }
    return { ok: true, value };
  }

  const raw = (Deno.env.get(ref) ?? "").trim();
  if (raw === "") {
    return {
      ok: false,
      errorCode: "secret_not_configured",
      detail: "The referenced Edge secret is not configured.",
    };
  }
  return { ok: true, value: raw };
}
