/**
 * Omni-Comms Setup Wizard — guided configuration panel.
 *
 * Lives INSIDE the existing Overview permanent route
 * (`/admin/omnichannel-communications`) as a tab. It adds no new route.
 *
 * The wizard is read-only guidance. It reads exactly one bounded aggregate
 * RPC (`omni_comms_setup_readiness`), renders fourteen guided steps and deep
 * links to the permanent screen that owns each change. It never mutates
 * configuration, never enqueues a job, never contacts a provider and never
 * re-implements resolution precedence.
 */
import React from "react";
import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "@/platform/omni-comms/admin/components/OmniCommsTenantSelector";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import { listAllEventDefinitionsForPicker } from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventDefinitionListItem } from "@/platform/omni-comms/application/eventCatalogueTypes";
import {
  buildSetupPlan,
  getSetupReadiness,
  mapSetupError,
  type SetupError,
  type SetupPlan,
} from "@/platform/omni-comms/application/setupReadinessService";
import SetupProgressSummary from "./SetupProgressSummary";
import SetupStepCard from "./SetupStepCard";

const NONE = "__none__";

const LOCALES = ["en", "en-GB", "es", "fr"];

export const SetupWizardPanel: React.FC = () => {
  const {
    organizationId,
    departmentId,
    availableOrganizations,
    loading: tenantLoading,
    error: tenantError,
  } = useOmniCommsTenant();
  const rpc = useOmniCommsRpcClient();

  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);
  const [eventsError, setEventsError] = React.useState(false);
  const [eventDefinitionId, setEventDefinitionId] = React.useState<string | null>(null);
  const [locale, setLocale] = React.useState("en");

  const [plan, setPlan] = React.useState<SetupPlan | null>(null);
  const [error, setError] = React.useState<SetupError | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Event picker — active definitions only.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listAllEventDefinitionsForPicker(rpc, {
          status: "active",
          maxItems: 300,
        });
        if (!cancelled) {
          setEvents(rows);
          setEventsError(false);
        }
      } catch {
        if (!cancelled) {
          setEvents([]);
          setEventsError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rpc]);

  const load = React.useCallback(
    async (signal?: { cancelled: boolean }) => {
      if (!organizationId) return;
      setLoading(true);
      try {
        const payload = await getSetupReadiness(rpc, {
          organizationId,
          departmentId,
          eventDefinitionId,
          channel: "email",
          locale,
        });
        if (signal?.cancelled) return;
        setPlan(buildSetupPlan(payload));
        setError(null);
      } catch (err) {
        if (signal?.cancelled) return;
        setError(mapSetupError(err));
        setPlan(null);
      } finally {
        if (!signal?.cancelled) setLoading(false);
      }
    },
    [organizationId, departmentId, eventDefinitionId, locale, rpc],
  );

  React.useEffect(() => {
    const signal = { cancelled: false };
    setPlan(null);
    setError(null);
    void load(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [load]);

  return (
    <div className="space-y-6" data-testid="omni-comms-setup-wizard">
      <Alert>
        <AlertTitle>Guided setup</AlertTitle>
        <AlertDescription className="text-sm">
          Configure one complete email path — organisation, department, pilot
          event and locale — one step at a time. Every status below is read
          from the deployed configuration, not from source code.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Pilot scope</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <OmniCommsTenantSelector />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 min-w-[240px]">
              <Label className="text-xs uppercase text-muted-foreground">
                Pilot event
              </Label>
              <Select
                value={eventDefinitionId ?? NONE}
                onValueChange={(v) => setEventDefinitionId(v === NONE ? null : v)}
                disabled={!organizationId || events.length === 0}
              >
                <SelectTrigger
                  className="mt-1"
                  data-testid="omni-comms-setup-event-select"
                >
                  <SelectValue placeholder="Select an active event" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>—</SelectItem>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code} — {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-40">
              <Label className="text-xs uppercase text-muted-foreground">
                Locale
              </Label>
              <Select value={locale} onValueChange={setLocale}>
                <SelectTrigger
                  className="mt-1"
                  data-testid="omni-comms-setup-locale-select"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCALES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-40">
              <Label className="text-xs uppercase text-muted-foreground">
                Channel
              </Label>
              <div
                className="mt-1 rounded-md border px-3 py-2 text-sm text-muted-foreground"
                data-testid="omni-comms-setup-channel"
              >
                Email (pilot only)
              </div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={!organizationId || loading}
            data-testid="omni-comms-setup-refresh"
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Re-check configuration
          </Button>

          {eventsError ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="omni-comms-setup-events-unavailable"
            >
              The event list could not be loaded. Select the pilot event from
              the Events screen and re-check.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {tenantLoading && (
        <p className="text-sm text-muted-foreground" data-testid="omni-comms-setup-tenant-loading">
          Loading tenant context…
        </p>
      )}

      {!tenantLoading && tenantError && (
        <Alert variant="destructive" data-testid="omni-comms-setup-tenant-error">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Tenant lookup failure</AlertTitle>
          <AlertDescription className="text-sm">
            The organisation list could not be loaded, so guided setup cannot run.
          </AlertDescription>
        </Alert>
      )}

      {!tenantLoading && !tenantError && availableOrganizations.length === 0 && (
        <Alert data-testid="omni-comms-setup-no-organisations">
          <AlertTitle>No authorised organisations</AlertTitle>
          <AlertDescription className="text-sm">
            You are not authorised for any organisation, so guided setup cannot run.
          </AlertDescription>
        </Alert>
      )}

      {!tenantLoading && !tenantError && availableOrganizations.length > 0 && !organizationId && (
        <Alert data-testid="omni-comms-setup-no-organisation-selected">
          <AlertTitle>No organisation selected</AlertTitle>
          <AlertDescription className="text-sm">
            Select an organisation above to begin guided setup.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" data-testid={`omni-comms-setup-error-${error.kind}`}>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Setup readiness unavailable</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>{error.message}</p>
            {error.retryable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void load()}
                data-testid="omni-comms-setup-retry"
              >
                Retry
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {plan && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Configuration steps</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SetupProgressSummary plan={plan} />
            <div className="space-y-3" data-testid="omni-comms-setup-steps">
              {plan.steps.map((s) => (
                <SetupStepCard
                  key={s.id}
                  step={s}
                  isNextRequired={plan.nextRequiredStep?.id === s.id}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SetupWizardPanel;
