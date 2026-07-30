/**
 * Omni-Comms Health — Live Diagnostics tab.
 *
 * Reads ACTUAL deployed configuration and runtime state for the selected
 * organisation (and optional department) through the four bounded
 * `omni_comms_health_*` RPCs plus one safe Edge health probe.
 *
 * This tab never reads Omni-Comms tables directly, never mutates, never
 * contacts a provider and never displays credential material.
 */
import React from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "@/platform/omni-comms/admin/components/OmniCommsTenantSelector";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import { useOmniCommsEdgeHealthProbe } from "@/platform/omni-comms/admin/hooks/useOmniCommsEdgeHealthProbe";
import {
  buildLiveDiagnostics,
  getHealthSummary,
  mapHealthError,
} from "@/platform/omni-comms/application/healthDiagnosticsService";
import {
  HEALTH_DEFAULT_REFRESH_MS,
  type HealthError,
  type LiveDiagnosticsResult,
} from "@/platform/omni-comms/application/healthDiagnosticsTypes";
import HealthPostureCard from "./HealthPostureCard";
import DiagnosticCategoryCard from "./DiagnosticCategoryCard";
import RecommendedActions from "./RecommendedActions";

export const LiveDiagnosticsTab: React.FC = () => {
  const {
    organizationId,
    departmentId,
    availableOrganizations,
    availableDepartments,
    loading: tenantLoading,
    error: tenantError,
  } = useOmniCommsTenant();
  const rpc = useOmniCommsRpcClient();
  const { result: edgeResult, probe } = useOmniCommsEdgeHealthProbe();

  const [diagnostics, setDiagnostics] = React.useState<LiveDiagnosticsResult | null>(null);
  const [error, setError] = React.useState<HealthError | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [lastCheckedAt, setLastCheckedAt] = React.useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = React.useState(false);

  const orgName =
    availableOrganizations.find((o) => o.id === organizationId)?.name ?? null;
  const deptName = availableDepartments.find((d) => d.id === departmentId)?.name ?? null;

  const load = React.useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!organizationId) return;
      setLoading(true);
      try {
        const edge = await probe();
        const summary = await getHealthSummary(rpc, { organizationId, departmentId });
        if (signal?.cancelled) return;
        setDiagnostics(
          buildLiveDiagnostics({
            summary,
            edge,
            organizationName: orgName,
            departmentName: deptName,
          }),
        );
        setError(null);
      } catch (err) {
        if (signal?.cancelled) return;
        setError(mapHealthError(err));
        setDiagnostics(null);
      } finally {
        if (!signal?.cancelled) {
          setLoading(false);
          setLastCheckedAt(new Date().toISOString());
        }
      }
    },
    [organizationId, departmentId, rpc, probe, orgName, deptName],
  );

  // Initial + tenant-change load. Cancels in-flight work on unmount/change.
  React.useEffect(() => {
    const signal = { cancelled: false };
    setDiagnostics(null);
    setError(null);
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  // Auto-refresh. Off by default; never faster than 30s; always cleared.
  React.useEffect(() => {
    if (!autoRefresh || !organizationId) return;
    const signal = { cancelled: false };
    const id = window.setInterval(() => {
      void load(signal);
    }, HEALTH_DEFAULT_REFRESH_MS);
    return () => {
      signal.cancelled = true;
      window.clearInterval(id);
    };
  }, [autoRefresh, organizationId, load]);

  return (
    <div className="space-y-6" data-testid="omni-comms-live-diagnostics">
      <Alert>
        <AlertTitle>Live Diagnostics</AlertTitle>
        <AlertDescription className="text-sm">
          Readiness describes what the source code says exists. Live Diagnostics
          describes what this deployed environment can currently use.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tenant scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OmniCommsTenantSelector />
          <div className="flex flex-wrap items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              disabled={!organizationId || loading}
              data-testid="omni-comms-health-refresh"
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Refresh diagnostics
            </Button>
            <div className="flex items-center gap-2">
              <Switch
                id="omni-comms-health-auto-refresh"
                checked={autoRefresh}
                onCheckedChange={setAutoRefresh}
                data-testid="omni-comms-health-auto-refresh"
              />
              <Label htmlFor="omni-comms-health-auto-refresh" className="text-sm">
                Auto-refresh (60s)
              </Label>
            </div>
            <span
              className="text-xs text-muted-foreground"
              data-testid="omni-comms-health-last-checked"
            >
              Last checked:{" "}
              {lastCheckedAt ? new Date(lastCheckedAt).toLocaleTimeString() : "never"}
            </span>
          </div>
        </CardContent>
      </Card>

      {tenantLoading && (
        <p className="text-sm text-muted-foreground" data-testid="omni-comms-health-tenant-loading">
          Loading tenant context…
        </p>
      )}

      {!tenantLoading && tenantError && (
        <Alert variant="destructive" data-testid="omni-comms-health-tenant-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Tenant lookup failure</AlertTitle>
          <AlertDescription className="text-sm">
            The organisation list could not be loaded. Diagnostics are unavailable.
          </AlertDescription>
        </Alert>
      )}

      {!tenantLoading && !tenantError && availableOrganizations.length === 0 && (
        <Alert data-testid="omni-comms-health-no-organisations">
          <AlertTitle>No authorised organisations</AlertTitle>
          <AlertDescription className="text-sm">
            You are not authorised for any organisation, so live diagnostics cannot run.
          </AlertDescription>
        </Alert>
      )}

      {!tenantLoading && !tenantError && availableOrganizations.length > 0 && !organizationId && (
        <Alert data-testid="omni-comms-health-no-organisation-selected">
          <AlertTitle>No organisation selected</AlertTitle>
          <AlertDescription className="text-sm">
            Select an organisation above to run live diagnostics.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" data-testid={`omni-comms-health-error-${error.kind}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Diagnostics unavailable</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>{error.message}</p>
            {error.retryable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void load()}
                data-testid="omni-comms-health-retry"
              >
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {edgeResult && !edgeResult.available && (
        <Alert data-testid="omni-comms-health-edge-unavailable">
          <AlertTitle>Runtime function probe unavailable</AlertTitle>
          <AlertDescription className="text-sm">
            The safe health probe for omni-comms-runtime did not respond. Diagnostics
            continue from database evidence only.
          </AlertDescription>
        </Alert>
      )}

      {diagnostics && (
        <div className="space-y-6">
          <HealthPostureCard
            posture={diagnostics.posture}
            reason={diagnostics.postureReason}
            generatedAt={diagnostics.generatedAt}
          />
          <RecommendedActions actions={diagnostics.recommendations} />
          {diagnostics.categories.map((c) => (
            <DiagnosticCategoryCard key={c.code} category={c} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LiveDiagnosticsTab;
