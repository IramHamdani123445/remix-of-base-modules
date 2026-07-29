/**
 * Omnichannel Communications — Overview / landing page.
 *
 * Post-stabilization: shows an accurate status snapshot for every permanent
 * route (Events, Templates, Shared Assets & Layouts, Channels, Operations,
 * Preferences, Health) derived from the route registry, together with the
 * next approved work item. Replaces obsolete pre-operational placeholder copy
 * wording that predated Epics 2, 3 and Accelerated Builds 1–2.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  HeartPulse,
  Info,
  Radio,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { OMNI_COMMS_ROUTE_REGISTRY } from "../../registry/routeRegistry";
import { OMNI_COMMS_READINESS_MANIFEST } from "../../registry/readinessManifest";

type StatusKind = "available" | "coming-soon";

interface StatusRow {
  key: string;
  title: string;
  summary: string;
  to?: string;
  kind: StatusKind;
}

function statusFor(path: string): "Available" | "Not implemented" | "Placeholder" | undefined {
  return OMNI_COMMS_ROUTE_REGISTRY.find((r) => r.path === path)?.state;
}

function toKind(path: string): StatusKind {
  return statusFor(path) === "Available" ? "available" : "coming-soon";
}

const ROWS: StatusRow[] = [
  {
    key: "events",
    title: "Events",
    summary:
      "Event definitions and JSON contracts are authored, validated, approved and versioned through the Events administration screen.",
    to: "/admin/omnichannel-communications/events",
    kind: toKind("/admin/omnichannel-communications/events"),
  },
  {
    key: "templates",
    title: "Templates",
    summary:
      "Template families and versions are authored, previewed with synthetic data and lifecycle-managed via the Templates administration screen.",
    to: "/admin/omnichannel-communications/templates",
    kind: toKind("/admin/omnichannel-communications/templates"),
  },
  {
    key: "assets",
    title: "Shared Assets and Layouts",
    summary:
      "Shared branding assets, layout versions and organisation / department inheritance are managed inside the Templates Assembly tab.",
    to: "/admin/omnichannel-communications/templates",
    kind: "available",
  },
  {
    key: "channels",
    title: "Channels",
    summary:
      "Email provider (Resend), provider accounts, sender identities, provider bindings and channel settings are configured on the Channels workspace.",
    to: "/admin/omnichannel-communications/channels",
    kind: toKind("/admin/omnichannel-communications/channels"),
  },
  {
    key: "operations",
    title: "Operations (runtime)",
    summary:
      "Runtime requests, messages and dispatch processing will be introduced in Accelerated Build 3.",
    to: "/admin/omnichannel-communications/operations",
    kind: toKind("/admin/omnichannel-communications/operations"),
  },
  {
    key: "preferences",
    title: "Preferences",
    summary:
      "Recipient preferences, channel opt-outs and preference resolution are planned for a later build.",
    to: "/admin/omnichannel-communications/preferences",
    kind: toKind("/admin/omnichannel-communications/preferences"),
  },
  {
    key: "health",
    title: "Health / Readiness",
    summary:
      "Verified foundation, current build status, registries and architecture rule results are reported on the Health screen.",
    to: "/admin/omnichannel-communications/health",
    kind: toKind("/admin/omnichannel-communications/health"),
  },
];

function StatusBadge({ kind }: { kind: StatusKind }): JSX.Element {
  if (kind === "available") {
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-700">
        <CheckCircle2 className="h-3 w-3 mr-1" /> Available
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      <Clock className="h-3 w-3 mr-1" /> Coming soon
    </Badge>
  );
}

export const OmniCommsLandingPage: React.FC = () => {
  const next = OMNI_COMMS_READINESS_MANIFEST.nextStep;
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
            Event catalogue, templates, shared assets and email channel
            configuration are operational. Runtime dispatch and recipient
            preferences are planned.
          </p>
        </div>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Current status</AlertTitle>
        <AlertDescription>
          Events, Templates, Shared Assets &amp; Layouts and Channels are
          available. Operations and Preferences are Coming Soon. Communication
          Hub — Legacy continues to run in parallel until cutover.
        </AlertDescription>
      </Alert>

      <Card data-testid="omni-comms-landing-status-grid">
        <CardHeader>
          <CardTitle className="text-base">Capability status</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ROWS.map((row) => (
              <li
                key={row.key}
                data-testid={`omni-comms-landing-row-${row.key}`}
                className="rounded-md border p-3 flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{row.title}</span>
                  <StatusBadge kind={row.kind} />
                </div>
                <p className="text-sm text-muted-foreground">{row.summary}</p>
                {row.to ? (
                  <div>
                    <Button asChild size="sm" variant="ghost">
                      <Link to={row.to}>
                        Open <ArrowRight className="h-3 w-3 ml-1" />
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card data-testid="omni-comms-landing-next-card">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-primary" aria-hidden="true" />
            Next approved work
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <strong>{next.epic} — {next.story}:</strong> {next.title}
          </p>
          <p className="text-muted-foreground">
            Detailed foundation state, registries and architecture-check
            results are available on the Health screen.
          </p>
          <div>
            <Button asChild size="sm" variant="outline">
              <Link to="/admin/omnichannel-communications/health">
                Open Readiness <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OmniCommsLandingPage;
