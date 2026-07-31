/**
 * Omni-Comms — Reference Seed Pack administration panel.
 *
 * Rendered as a tab inside the existing Overview permanent route
 * (`/admin/omnichannel-communications?view=reference-data`). It adds no new
 * route, no new table and no new sending path.
 *
 * The panel previews, applies and reconciles the built-in NON-PRODUCTION
 * reference catalogue so that every implemented Omni-Comms screen is
 * populated and demonstrable. It is simulation-only: it never enables live
 * delivery, never contacts a provider and never sends a message. Controlled
 * dry-runs remain a separate, governed action on the Dry Run tab.
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
  Wrench,
  XCircle,
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
  reconcilableActions,
  reconcileReferenceSeed,
  referenceSeedCoverage,
  referenceSeedReadiness,
  REFERENCE_SEED_LOCALE,
  REFERENCE_SEED_RECIPIENT_DOMAIN,
  type ReferenceSeedFailure,
  type ReferenceSeedGroup,
  type ReferenceSeedRunResult,
  type ReferenceSeedStatus,
} from "@/platform/omni-comms/application/referenceSeedService";

type Busy = null | "status" | "preview" | "apply" | "reconcile";

function CountBadge({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "positive" | "muted" | "danger";
}): JSX.Element {
  if (tone === "danger") {
    return (
      <Badge variant={value > 0 ? "destructive" : "secondary"}>
        {label}: {value}
      </Badge>
    );
  }
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
            <th className="text-right p-2 font-medium">Conflicts</th>
            <th className="text-right p-2 font-medium">Blocked</th>
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
              <td className="p-2 text-right">{g.conflicts}</td>
              <td className="p-2 text-right">{g.blocked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({
  status,
}: {
  status: ReferenceSeedStatus;
}): JSX.Element {
  const rows = referenceSeedCoverage(status);
  return (
    <div className="rounded-md border" data-testid="omni-comms-seed-coverage">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2 font-medium">Configuration path</th>
            <th className="text-right p-2 font-medium">Expected</th>
            <th className="text-right p-2 font-medium">Present</th>
            <th className="text-right p-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="p-2">{r.label}</td>
              <td className="p-2 text-right text-muted-foreground">
                {r.expected}
              </td>
              <td className="p-2 text-right">{r.present}</td>
              <td className="p-2 text-right">
                {r.complete ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Complete
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Incomplete
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReadinessTable({
  status,
}: {
  status: ReferenceSeedStatus;
}): JSX.Element {
  const rows = referenceSeedReadiness(status);
  return (
    <div className="rounded-md border" data-testid="omni-comms-seed-readiness">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2 font-medium">Readiness gate</th>
            <th className="text-left p-2 font-medium">Evidence</th>
            <th className="text-right p-2 font-medium">State</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t">
              <td className="p-2">{r.label}</td>
              <td className="p-2 text-muted-foreground">{r.detail}</td>
              <td className="p-2 text-right">
                <Badge variant={r.ready ? "default" : "secondary"}>
                  {r.ready ? "Ready" : "Not ready"}
                </Badge>
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
  const [dialogOpen, setDialogOpen] = React.useState<null | "apply" | "reconcile">(
    null,
  );
  const [busy, setBusy] = React.useState<Busy>("status");
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

  const runWrite = async (mode: "apply" | "reconcile"): Promise<void> => {
    if (!organizationId) return;
    setDialogOpen(null);
    setBusy(mode);
    setFailure(null);
    try {
      const input = {
        organizationId,
        confirmNonProduction: true,
        correlationId: `omni-reference-seed-${mode}-${Date.now()}`,
      };
      const result =
        mode === "apply"
          ? await applyReferenceSeed(rpc, input)
          : await reconcileReferenceSeed(rpc, input);
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
  const attention = reconcilableActions(result);

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
            contracts, template families, published {REFERENCE_SEED_LOCALE}{" "}
            templates pinned to reference layouts, routing, departmental sender
            identities and simulation-only sending profiles. Recipients are
            always on <code>{REFERENCE_SEED_RECIPIENT_DOMAIN}</code>. Live
            delivery is never enabled and nothing is ever sent — controlled
            dry-runs are executed separately on the Dry Run tab through the
            canonical Omni-Comms sending façade.
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
              <CountBadge
                label="Conflicts"
                value={status.conflicts}
                tone="danger"
              />
              <CountBadge
                label="Unresolved assets"
                value={status.unresolved_required_assets}
                tone="danger"
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

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={() => setDialogOpen("apply")}
              disabled={busy !== null || !safe || !confirmed}
              data-testid="omni-comms-seed-apply"
            >
              {busy === "apply" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Apply reference data
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen("reconcile")}
              disabled={busy !== null || !safe || !confirmed}
              data-testid="omni-comms-seed-reconcile"
            >
              {busy === "reconcile" ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Wrench className="h-4 w-4 mr-1" />
              )}
              Reconcile seed-owned records
            </Button>
          </div>
        </CardContent>
      </Card>

      {status ? (
        <Card data-testid="omni-comms-seed-verification">
          <CardHeader>
            <CardTitle className="text-base">
              Reference verification matrix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CoverageTable status={status} />
            <ReadinessTable status={status} />
            <p className="text-xs text-muted-foreground">
              Live sending readiness is permanently reported as not ready:
              every seeded provider profile is a simulation sandbox profile and
              can never satisfy a live send.
            </p>
          </CardContent>
        </Card>
      ) : null}

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
              {applied
                ? applied.mode === "reconcile"
                  ? "Reconciliation complete"
                  : "Reference data applied"
                : "Preview"}
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
              <CountBadge
                label="Conflicts"
                value={result.conflicts}
                tone="danger"
              />
              <CountBadge
                label="Blocked"
                value={result.blocked}
                tone="danger"
              />
            </div>
            <GroupTable groups={groups} />

            {attention.length > 0 ? (
              <div
                className="rounded-md border"
                data-testid="omni-comms-seed-attention"
              >
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Record</th>
                      <th className="text-left p-2 font-medium">Outcome</th>
                      <th className="text-left p-2 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attention.map((a) => (
                      <tr key={`${a.object_type}:${a.key}`} className="border-t">
                        <td className="p-2 font-mono text-xs">{a.key}</td>
                        <td className="p-2">
                          <Badge variant="destructive">{a.action}</Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">
                          {a.reason ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            <p className="text-xs text-muted-foreground">
              Re-running the seed creates nothing new; compatible records are
              reported as already present. Reconcile only repairs seed-owned
              records — records owned by an administrator are reported as
              conflicts and are never modified.
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
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/omnichannel-communications?view=dry-run">
                    Run controlled dry-run{" "}
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <AlertDialog
        open={dialogOpen !== null}
        onOpenChange={(open) => setDialogOpen(open ? dialogOpen : null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialogOpen === "reconcile"
                ? "Reconcile seed-owned records?"
                : "Apply reference data?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialogOpen === "reconcile"
                ? "This publishes seed-owned draft contracts and templates, activates seed-owned families and routes, and repairs missing layout selections. Records owned by an administrator are reported as conflicts and left untouched. Live delivery stays disabled and no message is sent."
                : "This creates non-production reference events, contracts, templates, routes and simulation-only sending profiles for the selected organisation. Live delivery stays disabled and no message is sent. Existing records are left untouched."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void runWrite(dialogOpen ?? "apply")}
              data-testid="omni-comms-seed-apply-confirm"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ReferenceSeedPanel;
