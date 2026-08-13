/**
 * Omni-Comms — internal scope resolution.
 *
 * FINAL PLATFORM MODEL.
 *
 *   Organisation is the tenant / ownership / evidence boundary. It is
 *   resolved from the trusted application context, NOT chosen again on every
 *   Omni-Comms screen. When the authorised user has exactly one organisation
 *   there is no selector at all; when they genuinely have several there is
 *   ONE compact selector in the module header.
 *
 *   Department is NOT persistent UI state. It is an optional override
 *   dimension supplied only when an operator explicitly edits a department
 *   override, inspects technical evidence, or resolves a business entity that
 *   belongs to a department.
 *
 * This hook is a read model over the existing tenant provider, so tenancy,
 * RLS and permission behaviour are unchanged.
 */
import { useOmniCommsTenant } from './OmniCommsTenantContext';

export interface OmniCommsScope {
  organizationId: string | null;
  organizationName: string | null;
  /** True only when the user genuinely has more than one organisation. */
  requiresOrganizationChoice: boolean;
  availableOrganizations: { id: string; name: string }[];
  loading: boolean;
  error: string | null;
  setOrganizationId: (id: string | null) => void;
}

export function useOmniCommsScope(): OmniCommsScope {
  const tenant = useOmniCommsTenant();
  return {
    organizationId: tenant.organizationId,
    organizationName: tenant.organizationName,
    requiresOrganizationChoice: tenant.availableOrganizations.length > 1,
    availableOrganizations: tenant.availableOrganizations,
    loading: tenant.loading,
    error: tenant.error,
    setOrganizationId: tenant.setOrganizationId,
  };
}

/**
 * Department context for the ONE place it is legitimate: an explicit
 * department override editor or a technical-evidence surface. Normal pages
 * must not call this.
 */
export function useOmniCommsDepartmentOverrideContext() {
  const tenant = useOmniCommsTenant();
  return {
    departmentId: tenant.departmentId,
    departmentName: tenant.departmentName,
    overrideActive: tenant.departmentOverrideActive,
    availableDepartments: tenant.availableDepartments,
    setDepartmentId: tenant.setDepartmentId,
    clearDepartmentOverride: tenant.clearDepartmentOverride,
  };
}
