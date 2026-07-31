/**
 * Omni-Comms — Reference Seed Pack administration panel.
 *
 * Rendered as a tab inside the existing Overview permanent route
 * (`/admin/omnichannel-communications?view=reference-data`). It adds no new
 * route, no new table and no new sending path.
 *
 * The panel previews and applies the built-in NON-PRODUCTION reference
 * catalogue so that every implemented Omni-Comms screen is populated and
 * demonstrable. It is simulation-only: it never enables live delivery, never
 * contacts a provider and never sends a message.
 */
import React from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "@/platform/omni-comms/admin/components/OmniCommsTenantSelector";
import { useOmniCommsRpcClient } from "@/platform/omni-comms/admin/hooks/useOmniCommsRpcClient";
import {
  applyReferenceSeed,
  getReferenceSeedStatus,
  groupReferenceSeedActions,
  isSeedComplete,
  isSeedSafe,
  mapReferenceSeedFailure,
  previewReferenceSeed,
  REFERENCE_SEED_LOCALE,
  REFERENCE_SEED_RECIPIENT_DOMAIN,
  type ReferenceSeedFailure,
  type ReferenceSeedGroup,
  type ReferenceSeedRunResult,
  type ReferenceSeedStatus,
} from "@/platform/omni-comms/application/referenceSeedService";

function CountBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "positive" | "muted";
}): JSX.Element {
  const className =
    tone === "positive"
      ? "bg-emerald-600 hover:bg-emerald-700"
      : tone === "muted"
        ? ""
        : "bg-primary hover:bg-primary/90";
  return (
    <Badge
      variant={tone === "muted" ? "secondary" : "default"}
      className={tone === "muted" ? undefined : className}
    >
      {label}: {value}
    </Badge>
  );
}

function GroupTable({ groups }: { groups: ReferenceSeedGroup[] }): JSX.Element {
  return (
    <div className="rounded-md border" data-testid="omni-comms-seed-groups">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2 font-medium">Object</th>
            <th className="text-right p-2 font-medium">To create</th>
            <th className="text-right p-2 font-medium">Created</th>
            <th className="text-right p-2 font-medium">Already present</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.objectType} className="border-t">
              <td className="p-2">{g.label}</td>
              <td className="p-2 text-right">{g.planned}</td>
              <td className="p-2 text-right">{g.created}</td>
              <td className="p-2 text-right text-muted-foreground">
                {g.existing}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const ReferenceSeedPanel: React.FC = () => {
  const { organizationId } = useOmniCommsTenant();
  const rpc = useOmniCommsRpcClient();

  const [status, setStatus] = React.useState<ReferenceSeedStatus | null>(null);
  const [preview, setPreview] = React.useState<ReferenceSeedRunResult | null>(
    null,
  );
  const [applied, setApplied] = React.useState<ReferenceSeedRunResult | null>(
    null,
  );
  const [confirmed, setConfirmed] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<null | "status" | "preview" | "apply">(
    "status",
  );
  const [failure, setFailure] = React.useState<ReferenceSeedFailure | null>(
    null,
  );

  const loadStatus = React.useCallback(async () => {
    if (!organizationId) return;
    setBusy("status");
    setFailure(null);
    try {
      setStatus(await getReferenceSeedStatus(rpc, organizationId));
    } catch (error) {
      setFailure(mapReferenceSeedFailure(error));
    } finally {
      setBusy(null);
    }
  }, [organizationId, rpc]);

  React.useEffect(() => {
    setPreview(null);
    setApplied(null);
    setConfirmed(false);
    void loadStatus();
  }, [loadStatus]);

  const onPreview = async (): Promise<void> => {
    if (!organizationId) return;
    setBusy("preview");
    setFailure(null);
    try {
      setPreview(await previewReferenceSeed(rpc, organizationId));
      setApplied(null);
    } catch (error) {
      setFailure(mapReferenceSeedFailure(error));
    } finally {
      setBusy(null);
    }
  };

  const onApply = async (): Promise<void> => {
    if (!organizationId) return;
    setDialogOpen(false);
    setBusy("apply");
    setFailure(null);
    try {
      const result = await applyReferenceSeed(rpc, {
        organizationId,
        confirmNonProduction: true,
        correlationId: `omni-reference-seed-${Date.now()}`,
      });
      setApplied(result);
      setPreview(null);
      setStatus(await getReferenceSeedStatus(rpc, organizationId));
    } catch (error) {
      setFailure(mapReferenceSeedFailure(error));
    } finally {
      setBusy(null);
    }
  };

  const safe = isSeedSafe(status);
  const complete = isSeedComplete(status);
  const result = applied ?? preview;
  const groups = result ? groupReferenceSeedActions(result.actions) : [];

  if (!organizationId) {
    return (
      <Card data-testid="omni-comms-seed-panel">
        <CardHeader>
          <CardTitle className="text-base">Reference data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Select an organisation</AlertTitle>
            <AlertDescription>
              Choose the organisation you want to populate with reference data.
            </AlertDescription>
          </Alert>
          <OmniCommsTenantSelector />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" data-testid="omni-comms-seed-panel">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" aria-hidden="true" />
            Reference Seed Pack (non-production)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Populates every implemented Omnichannel Communications screen with
            a realistic reference catalogue: business events, published data
            contracts, template families, published{" "}
            {REFERENCE_SEED_LOCALE} templates, routing, departmental sender
            identities and simulation-only sending profiles. Recipients are
            always on <code>{REFERENCE_SEED_RECIPIENT_DOMAIN}</code>. Live
            delivery is never enabled and nothing is ever sent.
          </p>

          <OmniCommsTenantSelector />

          <Separator />

          {status ? (
            <div
              className="flex flex-wrap gap-2"
              data-testid="omni-comms-seed-status"
            >
              <CountBadge
                label="Events present"
                value={status.present_events}
                tone="muted"
              />
              <CountBadge
                label="Events expected"
                value={status.expected_events}
                tone="muted"
              />
              <CountBadge
                label="Routes present"
                value={status.present_routes}
                tone="muted"
              />
              <CountBadge
                label="Published templates"
                value={status.present_published_versions}
                tone="muted"
              />
              <Badge variant={complete ? "default" : "secondary"}>
                {complete ? "Catalogue complete" : "Catalogue incomplete"}
              </Badge>
            </div>
          ) : null}

          {status && !safe ? (
            <Alert variant="destructive" data-testid="omni-comms-seed-unsafe">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Seeding is blocked for this organisation</AlertTitle>
              <AlertDescription>
                {status.live_requests > 0
                  ? "Non dry-run communication requests exist for this organisation. "
                  : ""}
                {status.live_delivery_enabled_channels > 0
                  ? "At least one channel has live delivery enabled. "
                  : ""}
                The reference seed only runs against non-production tenants.
              </AlertDescription>
            </Alert>
          ) : null}

          {safe ? (
            <Alert data-testid="omni-comms-seed-safe">
              <ShieldCheck className="h-4 w-4" />
              <AlertTitle>Non-production posture verified</AlertTitle>
              <AlertDescription>
                No live traffic and no live-delivery-enabled channels were
                found. The seed creates simulation-only sending profiles and
                leaves live delivery disabled.
              </AlertDescription>
            </Alert>
          ) : null}

          {failure ? (
            <Alert variant="destructive" data-testid="omni-comms-seed-error">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{failure.title}</AlertTitle>
              <AlertDescription>{failure.message}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadStatus()}
              disabled={busy !== null}
              data-testid="omni-comms-seed-refresh"
            >
              {busy === "status" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Refresh status
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onPreview()}
              disabled={busy !== null || !safe}
              data-testid="omni-comms-seed-preview"
            >
              {busy === "preview" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Preview reference data
            </Button>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="omni-comms-seed-confirm"
              checked={confirmed}
              onCheckedChange={(v) => setConfirmed(v === true)}
              disabled={!safe || busy !== null}
              data-testid="omni-comms-seed-confirm"
            />
            <Label
              htmlFor="omni-comms-seed-confirm"
              className="text-sm font-normal leading-snug"
            >
              I confirm this organisation is a non-production tenant and that
              reference data may be created in it.
            </Label>
          </div>

          <Button
            size="sm"
            onClick={() => setDialogOpen(true)}
            disabled={busy !== null || !safe || !confirmed}
            data-testid="omni-comms-seed-apply"
          >
            {busy === "apply" ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : null}
            Apply reference data
          </Button>
        </CardContent>
      </Card>

      {result ? (
        <Card data-testid="omni-comms-seed-result">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              {applied ? (
                <CheckCircle2
                  className="h-4 w-4 text-emerald-600"
                  aria-hidden="true"
                />
              ) : (
                <Database className="h-4 w-4 text-primary" aria-hidden="true" />
              )}
              {applied ? "Reference data applied" : "Preview"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <CountBadge
                label="To create"
                value={result.planned}
                tone="neutral"
              />
              <CountBadge
                label="Created"
                value={result.created}
                tone="positive"
              />
              <CountBadge
                label="Already present"
                value={result.existing}
                tone="muted"
              />
            </div>
            <GroupTable groups={groups} />
            <p className="text-xs text-muted-foreground">
              Re-running the seed creates nothing new; existing records are
              reported as already present and are never modified.
            </p>
            {applied ? (
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications/events">
                    Open Events <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications/templates">
                    Open Templates <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications/channels">
                    Open Channels <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications/health">
                    Open Health <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply reference data?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates non-production reference events, contracts,
              templates, routes and simulation-only sending profiles for the
              selected organisation. Live delivery stays disabled and no
              message is sent. Existing records are left untouched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onApply()}
              data-testid="omni-comms-seed-apply-confirm"
            >
              Apply reference data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ReferenceSeedPanel;
