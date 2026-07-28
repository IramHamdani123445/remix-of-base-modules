/**
 * Omnichannel Communications — landing / readiness placeholder.
 *
 * Root route of the new parallel system. Displays a static readiness statement
 * only. No metrics, no provider status, no operational controls, no data
 * reads from Legacy or Omni-Comms tables.
 */
import React from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Radio, Info, HeartPulse, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const SHELL_ROUTES: Array<{ label: string; to: string }> = [
  { label: "Operations", to: "/admin/omnichannel-communications/operations" },
  { label: "Events", to: "/admin/omnichannel-communications/events" },
  { label: "Templates", to: "/admin/omnichannel-communications/templates" },
  { label: "Channels", to: "/admin/omnichannel-communications/channels" },
  { label: "Preferences", to: "/admin/omnichannel-communications/preferences" },
  { label: "Health", to: "/admin/omnichannel-communications/health" },
];

export const OmniCommsLandingPage: React.FC = () => {
  return (
    <div
      data-testid="omni-comms-landing"
      className="container mx-auto p-6 space-y-6"
    >
      <div className="flex items-center gap-3">
        <Radio className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Omnichannel Communications</h1>
          <p className="text-sm text-muted-foreground">
            Parallel replacement system — shell only.
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Shell established — not operational</AlertTitle>
        <AlertDescription>
          This is the new Omnichannel Communications system. It runs in parallel
          with Communication Hub — Legacy, which remains fully operational.
          No sending, no template authoring, no provider integration and no
          business events have been migrated yet.
        </AlertDescription>
      </Alert>

      <Card data-testid="omni-comms-landing-readiness-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" aria-hidden="true" />
            Readiness
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            View architecture decisions, foundation status, planned objects and reserved integrations.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/omnichannel-communications/health">
              Open Readiness
              <ArrowRight className="h-4 w-4 ml-1" aria-hidden="true" />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shell sections</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            {SHELL_ROUTES.map((r) => (
              <li key={r.to}>
                <Link
                  className="text-primary hover:underline"
                  to={r.to}
                >
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
};

export default OmniCommsLandingPage;
