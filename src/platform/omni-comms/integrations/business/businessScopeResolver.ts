/**
 * Omni-Comms — centralised business scope resolution.
 *
 * FINAL PLATFORM MODEL. A business module must never resolve tenant
 * configuration before raising a communication. It provides business facts;
 * this boundary derives the trusted scope:
 *
 *   organisation  — tenant / ownership / evidence boundary (always resolved)
 *   department    — OPTIONAL context used only to select an override
 *
 * Department is CONTEXT, never a delivery instruction. When no department can
 * be derived, organisation configuration applies.
 *
 * Resolution is memoised per module code for the lifetime of the page so a
 * module raising several events does not repeatedly re-resolve the same
 * enterprise context. Never throws.
 */
import { resolveOrganizationContext } from '@/lib/org/organizationContextResolver';

export interface BusinessCommunicationScope {
  organizationId: string | null;
  departmentId: string | null;
  /** Where the department came from. `none` means organisation defaults apply. */
  departmentSource: 'explicit' | 'module_context' | 'none';
}

const EMPTY_SCOPE: BusinessCommunicationScope = {
  organizationId: null,
  departmentId: null,
  departmentSource: 'none',
};

const cache = new Map<string, Promise<BusinessCommunicationScope>>();

/** Test-only. Clears the per-module memoisation. */
export function __resetBusinessScopeCache(): void {
  cache.clear();
}

async function loadModuleScope(moduleCode: string): Promise<BusinessCommunicationScope> {
  try {
    const ctx = await resolveOrganizationContext({ moduleCode });
    const organizationId: string | null = ctx?.organization?.id ?? null;
    const departmentId: string | null =
      ctx?.department?.department_id ?? ctx?.department?.id ?? null;
    return {
      organizationId,
      departmentId: departmentId ?? null,
      departmentSource: departmentId ? 'module_context' : 'none',
    };
  } catch {
    return EMPTY_SCOPE;
  }
}

/**
 * Resolve the communication scope for a business module.
 *
 * Explicit values always win — the trusted integration layer may supply an
 * organisation when it already knows it — otherwise the enterprise module
 * context is used. The runtime still authoritatively re-verifies organisation
 * access server-side; nothing here grants access.
 */
export async function resolveBusinessCommunicationScope(input: {
  moduleCode: string;
  organizationId?: string | null;
  departmentId?: string | null;
}): Promise<BusinessCommunicationScope> {
  const moduleCode = String(input?.moduleCode ?? '').trim();
  const explicitOrg = input?.organizationId?.trim() || null;
  const explicitDept = input?.departmentId?.trim() || null;

  if (explicitOrg && explicitDept) {
    return {
      organizationId: explicitOrg,
      departmentId: explicitDept,
      departmentSource: 'explicit',
    };
  }
  if (!moduleCode) {
    return explicitOrg
      ? { organizationId: explicitOrg, departmentId: explicitDept, departmentSource: explicitDept ? 'explicit' : 'none' }
      : EMPTY_SCOPE;
  }

  let pending = cache.get(moduleCode);
  if (!pending) {
    pending = loadModuleScope(moduleCode);
    cache.set(moduleCode, pending);
  }
  const derived = await pending;

  return {
    organizationId: explicitOrg ?? derived.organizationId,
    departmentId: explicitDept ?? derived.departmentId,
    departmentSource: explicitDept
      ? 'explicit'
      : derived.departmentId
        ? 'module_context'
        : 'none',
  };
}
