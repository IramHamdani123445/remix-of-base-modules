// Omni-Comms — server-only resolution of UI-managed provider credentials.
//
// Provider credentials configured from the Omni-Comms Admin UI are written
// into the encrypted database vault by
// `omni_comms_priv_store_managed_secret` and are addressed by the SAME
// bounded secret REFERENCE name used by legacy Edge Function Secrets.
//
// Rules enforced here (they cannot be bypassed by a caller):
//   * only a service-role client may resolve a credential;
//   * a credential VALUE is never returned to the browser, logged, or written
//     into evidence — only the resolver's caller (an adapter) ever sees it;
//   * an unbounded or malformed reference name is rejected BEFORE any lookup;
//   * a resolution failure is silent (null), never an exception, so the
//     calling adapter always produces a bounded, classified outcome.

/** Bounded Omni-Comms secret-reference name shape. */
export const MANAGED_SECRET_REF_PATTERN =
  /^OMNI_COMMS_[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

/** Resolves a bounded reference NAME to its credential VALUE, or null. */
export type ManagedSecretResolver = (
  secretRef: string,
) => Promise<string | null>;

/** Minimal service-role client shape needed for credential resolution. */
export interface ManagedSecretAdminClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export function isManagedSecretRef(value: unknown): value is string {
  return typeof value === "string" && MANAGED_SECRET_REF_PATTERN.test(value);
}

/**
 * Builds a vault-backed resolver. Returns null for every unknown, malformed
 * or unavailable reference so the caller can fall back to a legacy Edge
 * Function Secret without changing its failure classification.
 */
export function createVaultSecretResolver(
  admin: ManagedSecretAdminClient,
): ManagedSecretResolver {
  return async (secretRef: string): Promise<string | null> => {
    if (!isManagedSecretRef(secretRef)) return null;
    try {
      const { data, error } = await admin.rpc(
        "omni_comms_priv_resolve_managed_secret",
        { p_secret_ref: secretRef },
      );
      if (error) return null;
      if (typeof data !== "string") return null;
      const trimmed = data.trim();
      return trimmed === "" ? null : trimmed;
    } catch {
      return null;
    }
  };
}
