/**
 * Omni-Comms Tenant Context
 *
 * Shared organisation / department selector used by every Omni-Comms admin
 * screen (Templates Assembly, Channels, and future Operations). Replaces the
 * per-screen `window.localStorage["omni_comms.active_org_id"]` + manual UUID
 * workaround that lived inside the Channels page.
 *
 * Contract required by the UI stabilization gate:
 *   organizationId
 *   organizationName
 *   departmentId
 *   departmentName
 *   availableOrganizations
 *   availableDepartments
 *   loading
 *   error
 *
 * Data sources are the canonical enterprise tables already used by the ERP:
 *   - `core_organization` for authorised organisations
 *   - `core_department` for departments belonging to the selected org.
 *     This is the same table the Omni-Comms department-ownership guard
 *     validates against, so selected department ids always match the ids
 *     stored on Omni-Comms configuration rows.

 *
 * Selection state is held in React state (no page reload) and mirrored to
 * sessionStorage for cross-tab stability inside a single Omni-Comms session.
 * No permission or capability decision is made here — routes are already
 * guarded by `OmniCommsAdminRoute` (`omni_comms.view`).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "@/integrations/supabase/client";

const SESSION_ORG_KEY = "omni_comms.tenant.org_id";
const SESSION_DEPT_KEY = "omni_comms.tenant.department_id";

export interface OmniCommsOrganizationOption {
  id: string;
  name: string;
}

export interface OmniCommsDepartmentOption {
  id: string;
  name: string;
  code: string | null;
  organizationId: string;
}

export interface OmniCommsTenantContextValue {
  organizationId: string | null;
  organizationName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  availableOrganizations: OmniCommsOrganizationOption[];
  availableDepartments: OmniCommsDepartmentOption[];
  loading: boolean;
  error: string | null;
  setOrganizationId: (id: string | null) => void;
  setDepartmentId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

const OmniCommsTenantContext = createContext<OmniCommsTenantContextValue | null>(null);

const sb = supabase as unknown as {
  from: (t: string) => any;
};

function readSession(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    const v = window.sessionStorage?.getItem(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (value == null) {
      window.sessionStorage?.removeItem(key);
    } else {
      window.sessionStorage?.setItem(key, value);
    }
  } catch {
    /* ignore */
  }
}

export const OmniCommsTenantProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [orgs, setOrgs] = useState<OmniCommsOrganizationOption[]>([]);
  const [depts, setDepts] = useState<OmniCommsDepartmentOption[]>([]);
  const [organizationId, setOrgIdState] = useState<string | null>(() =>
    readSession(SESSION_ORG_KEY),
  );
  const [departmentId, setDeptIdState] = useState<string | null>(() =>
    readSession(SESSION_DEPT_KEY),
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrganizations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await sb
        .from("core_organization")
        .select("id, legal_name, short_name, status")
        .order("legal_name", { ascending: true });
      if (err) throw err;
      const rows = (data ?? []) as Array<{
        id: string;
        legal_name: string | null;
        short_name: string | null;
        status: string | null;
      }>;
      const active = rows
        .filter((r) => (r.status ?? "active").toLowerCase() !== "archived")
        .map((r) => ({
          id: r.id,
          name: r.legal_name ?? r.short_name ?? r.id,
        }));
      setOrgs(active);
      // If current selection is no longer available, clear it.
      if (organizationId && !active.some((o) => o.id === organizationId)) {
        setOrgIdState(null);
        writeSession(SESSION_ORG_KEY, null);
        setDeptIdState(null);
        writeSession(SESSION_DEPT_KEY, null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load organisations");
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  const loadDepartments = useCallback(async (orgId: string | null) => {
    if (!orgId) {
      setDepts([]);
      return;
    }
    try {
      const { data, error: err } = await sb
        .from("core_department")
        .select("id, code, name, organization_id, is_active")
        .eq("organization_id", orgId)
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (err) throw err;
      const rows = (data ?? []) as Array<{
        id: string;
        code: string | null;
        name: string | null;
        organization_id: string;
      }>;
      const mapped: OmniCommsDepartmentOption[] = rows.map((r) => ({
        id: r.id,
        name: r.name ?? r.code ?? r.id,
        code: r.code ?? null,
        organizationId: r.organization_id,
      }));

      setDepts(mapped);
      // Reset department if it no longer belongs to the selected org.
      if (departmentId && !mapped.some((d) => d.id === departmentId)) {
        setDeptIdState(null);
        writeSession(SESSION_DEPT_KEY, null);
      }
    } catch {
      setDepts([]);
    }
  }, [departmentId]);

  useEffect(() => {
    void loadOrganizations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadDepartments(organizationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  const setOrganizationId = useCallback((id: string | null) => {
    setOrgIdState(id);
    writeSession(SESSION_ORG_KEY, id);
    // Changing org invalidates department selection.
    setDeptIdState(null);
    writeSession(SESSION_DEPT_KEY, null);
  }, []);

  const setDepartmentId = useCallback((id: string | null) => {
    setDeptIdState(id);
    writeSession(SESSION_DEPT_KEY, id);
  }, []);

  const refresh = useCallback(async () => {
    await loadOrganizations();
    await loadDepartments(organizationId);
  }, [loadOrganizations, loadDepartments, organizationId]);

  const value = useMemo<OmniCommsTenantContextValue>(() => {
    const org = orgs.find((o) => o.id === organizationId) ?? null;
    const dept = depts.find((d) => d.id === departmentId) ?? null;
    return {
      organizationId,
      organizationName: org?.name ?? null,
      departmentId,
      departmentName: dept?.name ?? null,
      availableOrganizations: orgs,
      availableDepartments: depts,
      loading,
      error,
      setOrganizationId,
      setDepartmentId,
      refresh,
    };
  }, [
    orgs,
    depts,
    organizationId,
    departmentId,
    loading,
    error,
    setOrganizationId,
    setDepartmentId,
    refresh,
  ]);

  return (
    <OmniCommsTenantContext.Provider value={value}>
      {children}
    </OmniCommsTenantContext.Provider>
  );
};

export function useOmniCommsTenant(): OmniCommsTenantContextValue {
  const ctx = useContext(OmniCommsTenantContext);
  if (!ctx) {
    throw new Error(
      "useOmniCommsTenant must be used within <OmniCommsTenantProvider>",
    );
  }
  return ctx;
}

/** Test-only helper. Not exported from a public barrel. */
export const __OMNI_COMMS_TENANT_INTERNAL__ = {
  SESSION_ORG_KEY,
  SESSION_DEPT_KEY,
};
