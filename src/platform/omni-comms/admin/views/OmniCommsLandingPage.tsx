/**
 * Omnichannel Communications — administrator Dashboard (Overview route).
 *
 * Answers, in order:
 *   1. What is this module and what is its current posture?
 *   2. Is the selected tenant configured?
 *   3. What is the single next required action?
 *   4. Where do I go to do it?
 *
 * The dashboard renders only facts returned by the bounded read-only setup
 * readiness RPC and the safe Edge health probe. It invents no metrics, shows
 * no delivery counts and never mutates anything.
 */
import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Info, LayoutDashboard, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useOmniCommsTenant } from "../../context/OmniCommsTenantContext";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import { useOmniCommsCertificationPosture } from "../hooks/useOmniCommsCertificationPosture";
import {
  buildPostureFacets,
  isNonProduction,
  OMNI_COMMS_PENDING_POSTURE_LINES,
} from "../posture/omniCommsPosture";
import {
  OmniCommsPostureBadgeList,
  OmniCommsInlineWarning,
} from "../components/OmniCommsPostureBadge";
import {
  omniCommsNavItems,
  overviewViewHref,
  resolveOverviewView,
  type OmniCommsOverviewView,
} from "../navigation/omniCommsNavigation";
import {
  buildSetupPlan,
  getSetupReadiness,
  mapSetupError,
  stepTargetHref,
  type SetupError,
  type SetupPlan,
} from "../../application/setupReadinessService";
import SetupWizardPanel from "./setup/SetupWizardPanel";
import ControlledDryRunPanel from "./dryrun/ControlledDryRunPanel";
import ReferenceSeedPanel from "./seed/ReferenceSeedPanel";


// ── Dashboard body ────────────────────────────────────────────────────────

const DashboardView: React.FC = () => {
  const { organizationId, departmentId, availableOrganizations } = useOmniCommsTenant();
  const rpc = useOmniCommsRpcClient();
  const {
    posture: certification,
    edge,
    environment,
    probing,
    refresh: probe,
  } = useOmniCommsCertificationPosture();

  const [plan, setPlan] = React.useState<SetupPlan | null>(null);
  const [error, setError] = React.useState<SetupError | null>(null);
  const [loading, setLoading] = React.useState(false);

  const orgName =
    availableOrganizations.find((o) => o.id === organizationId)?.name ?? null;

  const load = React.useCallback(async () => {
    if (!organizationId) {
      setPlan(null);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const payload = await getSetupReadiness(rpc, { organizationId, departmentId });
      setPlan(buildSetupPlan(payload));
      setError(null);
    } catch (err) {
      setError(mapSetupError(err));
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, departmentId, rpc]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const facets = buildPostureFacets({
    screenAvailable: true,
    configurationReady: plan ? plan.dryRunReady : null,
    runtimeAvailable: edge ? edge.available : null,
    certification:
      certification.state === "certified"
        ? "certified"
        : certification.state === "pending"
          ? "pending"
          : "unknown",
    liveDeliveryEnabled: edge?.liveDeliveryEnabled === true,
    environment,
  });

  const nextStep = plan?.nextRequiredStep ?? null;

  return (
    <div className="space-y-6" data-testid="omni-comms-dashboard">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4 text-primary" aria-hidden="true" />
            Module posture
          </CardTitle>
          <CardDescription>
            Screen availability, configuration readiness, runtime, certification
            and delivery are independent states.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <OmniCommsPostureBadgeList facets={facets} />
          <p className="text-sm text-muted-foreground" data-testid="omni-comms-dashboard-certification-reason">
            {certification.reason}
          </p>
          <ul className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
            {OMNI_COMMS_PENDING_POSTURE_LINES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="omni-comms-dashboard-next-action">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">Next required action</CardTitle>
            <CardDescription>
              {organizationId
                ? `Configuration path for ${orgName ?? "the selected organisation"}.`
                : "Select an organisation in the header to evaluate configuration."}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void load();
              probe();
            }}
            disabled={loading || probing}
            aria-label="Refresh dashboard"
          >
            {loading || probing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Configuration readiness unavailable</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : !organizationId ? (
            <p className="text-muted-foreground">
              No organisation selected. Nothing is evaluated and no state is
              assumed.
            </p>
          ) : loading && !plan ? (
            <p className="text-muted-foreground">Evaluating configuration…</p>
          ) : plan ? (
            <>
              <p>
                <strong>
                  {plan.completedSteps} of {plan.totalSteps}
                </strong>{" "}
                configuration steps are complete for this scope.
              </p>
              {nextStep ? (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="font-medium">
                    Step {nextStep.index}: {nextStep.title}
                  </p>
                  <p className="text-muted-foreground">{nextStep.purpose}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link to={overviewViewHref("setup")}>
                        Open Setup readiness
                        <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                    {nextStep.target ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={stepTargetHref(nextStep)}>
                          {nextStep.target.label}
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p>
                  Every configuration step for this scope is complete. Live
                  delivery remains disabled.
                </p>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Where to go next</CardTitle>
          <CardDescription>
            Every administration destination in this module.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-3 sm:grid-cols-2">
            {omniCommsNavItems(environment).map((item) => (
              <li
                key={item.id}
                data-testid={`omni-comms-dashboard-link-${item.id}`}
                className="rounded-md border p-3"
              >
                <p className="font-medium">{item.label}</p>
                <p className="mb-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
                <Button asChild size="sm" variant="ghost">
                  <Link to={item.href}>
                    Open
                    <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
                  </Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Legacy remains active</AlertTitle>
        <AlertDescription>
          Communication Hub — Legacy continues to operate unchanged. No cutover,
          redirect or deprecation has been applied.
        </AlertDescription>
      </Alert>

      {!isNonProduction(environment) ? (
        <OmniCommsInlineWarning>
          Non-production tooling (safe test, reference data) is hidden outside
          non-production environments.
        </OmniCommsInlineWarning>
      ) : null}
    </div>
  );
};

// ── Page ──────────────────────────────────────────────────────────────────

export const OmniCommsLandingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  // Single canonical parser shared with the module header, deep links and
  // tests. This page never parses `?view=` itself.
  const requested = resolveOverviewView(searchParams.get("view"));
  const { environment } = useOmniCommsCertificationPosture({ autoProbe: false });
  const nonProduction = isNonProduction(environment);

  // Safe test is a non-production surface. In production it is not rendered
  // AND a direct `?view=safe-test` deep link falls back to the Dashboard.
  const view: OmniCommsOverviewView =
    (requested === "safe-test" || requested === "reference-data") && !nonProduction
      ? "dashboard"
      : requested;

  return (
    <div data-testid="omni-comms-landing" className="space-y-6">
      {/*
        UI Phase 1 — this page no longer renders its own tab strip. Dashboard,
        Setup readiness and Safe test are already offered exactly once, by the
        module navigation in `OmniCommsModuleHeader`. The `?view=` vocabulary,
        its aliases and every deep link are unchanged; this component simply
        renders the resolved view.
      */}
      <Tabs value={view} className="w-full">


        <TabsContent value="dashboard" className="mt-4">
          <DashboardView />
        </TabsContent>

        <TabsContent value="setup" className="mt-4">
          <SetupWizardPanel />
        </TabsContent>

        {nonProduction ? (
          <TabsContent value="safe-test" className="mt-4">
            <ControlledDryRunPanel />
          </TabsContent>
        ) : null}

        {/*
          Reference data is a non-production configuration tool, not a primary
          administration destination. It stays URL-addressable
          (`?view=reference-data`) and is reached from Setup readiness.
        */}
        {nonProduction ? (
          <TabsContent
            value="reference-data"
            className="mt-4"
            data-testid="omni-comms-landing-tab-reference-data"
          >
            <ReferenceSeedPanel />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
};

export default OmniCommsLandingPage;
