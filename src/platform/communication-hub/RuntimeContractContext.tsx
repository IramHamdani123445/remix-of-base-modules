/**
 * Checkpoint A — Shared runtime-contract context.
 *
 * Fetches the runtime contract report once, exposes it via context, and
 * lets every provider-contacting UI element gate itself with a single
 * shared source of truth. Panels must not fetch the report independently.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  auditRuntimeContract,
  capabilityPasses,
  type RuntimeContractReport,
} from "@/platform/communication-hub/runtimeContractService";

interface RuntimeContractState {
  report: RuntimeContractReport | null;
  loading: boolean;
  error: string | null;
  loadedAt: string | null;
  refresh: () => Promise<void>;
}

const RuntimeContractContext = createContext<RuntimeContractState | undefined>(undefined);

export function RuntimeContractProvider({ children }: { children: ReactNode }) {
  const [report, setReport] = useState<RuntimeContractReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await auditRuntimeContract();
      setReport(r);
      setLoadedAt(new Date().toISOString());
    } catch (e: any) {
      setError(e?.message ?? "runtime contract audit failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<RuntimeContractState>(
    () => ({ report, loading, error, loadedAt, refresh }),
    [report, loading, error, loadedAt, refresh],
  );

  return (
    <RuntimeContractContext.Provider value={value}>
      {children}
    </RuntimeContractContext.Provider>
  );
}

export function useRuntimeContract(): RuntimeContractState {
  const v = useContext(RuntimeContractContext);
  if (!v) {
    throw new Error("useRuntimeContract must be used inside RuntimeContractProvider");
  }
  return v;
}

export interface CapabilityStatus {
  passes: boolean;
  loading: boolean;
  error: string | null;
  failing: Array<{
    requirement: string;
    object_name: string;
    status: string;
    fix_action: string | null;
  }>;
}

/**
 * Gate for a single capability. Returns passes=false while loading or on error,
 * so provider-contacting UI is disabled by default (fail-closed).
 */
export function useRuntimeCapability(capability: string): CapabilityStatus {
  const { report, loading, error } = useRuntimeContract();
  return useMemo<CapabilityStatus>(() => {
    if (loading || error || !report) {
      return { passes: false, loading, error, failing: [] };
    }
    const failing = report.checks
      .filter((c) => c.capability === capability && c.status !== "PASS")
      .map((c) => ({
        requirement: c.requirement,
        object_name: c.object_name,
        status: c.status,
        fix_action: c.fix_action,
      }));
    return {
      passes: capabilityPasses(report, capability),
      loading: false,
      error: null,
      failing,
    };
  }, [report, loading, error, capability]);
}

/**
 * Gate that requires ALL listed capabilities to PASS. Fail-closed while loading.
 */
export function useRuntimeCapabilities(capabilities: string[]): CapabilityStatus {
  const { report, loading, error } = useRuntimeContract();
  return useMemo<CapabilityStatus>(() => {
    if (loading || error || !report) {
      return { passes: false, loading, error, failing: [] };
    }
    const failing = report.checks
      .filter((c) => capabilities.includes(c.capability) && c.status !== "PASS")
      .map((c) => ({
        requirement: c.requirement,
        object_name: c.object_name,
        status: c.status,
        fix_action: c.fix_action,
      }));
    return {
      passes: capabilities.every((cap) => capabilityPasses(report, cap)),
      loading: false,
      error: null,
      failing,
    };
  }, [report, loading, error, capabilities]);
}
