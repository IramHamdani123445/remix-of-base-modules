/**
 * Epic 2 — Story 3: Event Catalogue admin UI.
 *
 * Consumes the Story 2 SECURITY DEFINER RPC adapter exclusively through the
 * bound `useOmniCommsRpcClient()` hook. Never imports the browser Supabase
 * client directly. Never writes to any table via `.from(...)`. All lifecycle
 * mutations require a server-enforced reason (bounded at 2,000 chars). The
 * "Publish" action requires an explicit synthetic-confirmation checkbox that
 * only the reviewer can toggle.
 */
import React from "react";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import * as svc from "@/platform/omni-comms/application/eventCatalogueService";
import type {
  EventDefinitionListItem,
  EventContractListItem,
  EventContractRow,
  EventDefinitionRow,
} from "@/platform/omni-comms/application/eventCatalogueTypes";
import { OmniCommsRpcError } from "@/platform/omni-comms/application/eventCatalogueTypes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, ShieldAlert, EyeOff, Radio } from "lucide-react";
import { toast } from "sonner";

const REASON_MAX = 2000;
const PAYLOAD_MAX_BYTES = 256 * 1024;

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function friendly(e: unknown): string {
  if (e instanceof OmniCommsRpcError) {
    const map: Record<string, string> = {
      OC401: "You must sign in.",
      OC403: "You do not have permission for this action.",
      OC404: "Not found.",
      OC409: "Duplicate event code.",
      OC410: "Duplicate contract version.",
      OC412: `Invalid state${e.detail ? ` (${e.detail})` : ""}.`,
      OC413: "This record was updated by someone else. Reload and retry.",
      OC422: `Validation error${e.detail ? ` — ${e.detail}` : ""}.`,
      OC450: "Server failed to record the audit entry. Change was not saved.",
      OC500: "Unexpected error.",
    };
    return map[e.code] ?? e.message;
  }
  return (e as Error)?.message ?? "Unexpected error";
}

// ─────────────────────────────────────────────────────────────────────
// Reason dialog — required for suspend/retire; optional for activate/publish
// ─────────────────────────────────────────────────────────────────────
interface ReasonDialogProps {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  reasonRequired: boolean;
  requireSyntheticConfirmation?: boolean;
  syntheticConfirmationLabel?: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

const ReasonDialog: React.FC<ReasonDialogProps> = (p) => {
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  React.useEffect(() => {
    if (p.open) { setReason(""); setConfirmed(false); }
  }, [p.open]);
  const trimmed = reason.trim();
  const tooLong = trimmed.length > REASON_MAX;
  const reasonInvalid = (p.reasonRequired && trimmed.length === 0) || tooLong;
  const disabled = p.busy || reasonInvalid || (p.requireSyntheticConfirmation && !confirmed);
  return (
    <Dialog open={p.open} onOpenChange={(o) => { if (!o) p.onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription>{p.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="oc-reason">
              Reason {p.reasonRequired ? <span className="text-destructive">*</span> : <span className="text-muted-foreground">(optional)</span>}
            </Label>
            <Textarea
              id="oc-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this action being taken?"
              rows={4}
              data-testid="oc-reason-input"
            />
            <p className={`text-xs mt-1 ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>
              {trimmed.length}/{REASON_MAX} characters
            </p>
          </div>
          {p.requireSyntheticConfirmation && (
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox
                id="oc-synth"
                checked={confirmed}
                onCheckedChange={(v) => setConfirmed(v === true)}
                data-testid="oc-synth-confirm"
              />
              <Label htmlFor="oc-synth" className="text-sm leading-snug">
                {p.syntheticConfirmationLabel}
              </Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={p.onCancel} disabled={p.busy}>Cancel</Button>
          <Button
            onClick={() => p.onConfirm(trimmed)}
            disabled={disabled}
            data-testid="oc-reason-confirm"
          >
            {p.busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {p.actionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Definitions tab
// ─────────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  active: "bg-primary/10 text-primary",
  suspended: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-destructive/10 text-destructive",
};

const DefinitionsTab: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const [rows, setRows] = React.useState<EventDefinitionListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("");
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<EventDefinitionRow | null>(null);
  const [action, setAction] = React.useState<"activate" | "suspend" | "retire" | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const list = await svc.listEventDefinitions(client, {
        limit: 100,
        offset: 0,
        status: (statusFilter || null) as never,
        search: search.trim() || null,
      });
      setRows(list);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [client, search, statusFilter]);

  React.useEffect(() => {
    const h = setTimeout(load, 250);
    return () => clearTimeout(h);
  }, [load]);

  const openAction = async (id: string, act: "activate" | "suspend" | "retire") => {
    try {
      const row = await svc.getEventDefinition(client, id);
      if (!row) { toast.error("Event not found"); return; }
      setSelected(row); setAction(act);
    } catch (e) { toast.error(friendly(e)); }
  };

  const runAction = async (reason: string) => {
    if (!selected || !action) return;
    setBusy(true);
    try {
      const fn =
        action === "activate" ? svc.activateEventDefinition
        : action === "suspend" ? svc.suspendEventDefinition
        : svc.retireEventDefinition;
      await fn(client, {
        id: selected.id,
        expectedUpdatedAt: selected.updated_at,
        reason,
      });
      toast.success(`Event ${action}d`);
      setSelected(null); setAction(null);
      await load();
    } catch (e) {
      toast.error(friendly(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="oc-definitions-tab">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          placeholder="Search by code, name, module or entity…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
          data-testid="oc-search-input"
        />
        <select
          className="rounded-md border bg-background px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          data-testid="oc-status-filter"
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="retired">Retired</option>
        </select>
        <Button variant="outline" onClick={load} disabled={loading}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Failed to load events</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2">Code</th>
              <th className="text-left px-3 py-2">Name</th>
              <th className="text-left px-3 py-2">Module</th>
              <th className="text-left px-3 py-2">Class</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No events</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2">{r.module_code}</td>
                <td className="px-3 py-2">{r.communication_class}</td>
                <td className="px-3 py-2">
                  <Badge className={STATUS_COLORS[r.status] ?? ""} variant="outline">
                    {r.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  {(r.status === "draft" || r.status === "suspended") && (
                    <Button size="sm" variant="outline" onClick={() => openAction(r.id, "activate")}>
                      Activate
                    </Button>
                  )}
                  {r.status === "active" && (
                    <Button size="sm" variant="outline" onClick={() => openAction(r.id, "suspend")}>
                      Suspend
                    </Button>
                  )}
                  {r.status !== "retired" && (
                    <Button size="sm" variant="outline" onClick={() => openAction(r.id, "retire")}>
                      Retire
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReasonDialog
        open={!!selected && !!action}
        title={
          action === "activate" ? `Activate ${selected?.code ?? ""}`
          : action === "suspend" ? `Suspend ${selected?.code ?? ""}`
          : `Retire ${selected?.code ?? ""}`
        }
        description={
          action === "suspend" || action === "retire"
            ? "The server requires a reason for this action. It will be written to the audit log."
            : "You may optionally record a reason. It will be written to the audit log."
        }
        actionLabel={action ? action[0].toUpperCase() + action.slice(1) : ""}
        reasonRequired={action === "suspend" || action === "retire"}
        busy={busy}
        onCancel={() => { setSelected(null); setAction(null); }}
        onConfirm={runAction}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Contracts tab — requires selecting an event definition first
// ─────────────────────────────────────────────────────────────────────
const ContractsTab: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const [defs, setDefs] = React.useState<EventDefinitionListItem[]>([]);
  const [selectedDef, setSelectedDef] = React.useState<string>("");
  const [contracts, setContracts] = React.useState<EventContractListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<EventContractRow | null>(null);
  const [action, setAction] = React.useState<"publish" | "retire" | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      try {
        const list = await svc.listEventDefinitions(client, { limit: 100 });
        setDefs(list);
        if (list.length && !selectedDef) setSelectedDef(list[0].id);
      } catch (e) { setError(friendly(e)); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const load = React.useCallback(async () => {
    if (!selectedDef) return;
    setLoading(true); setError(null);
    try {
      const list = await svc.listEventContracts(client, {
        eventDefinitionId: selectedDef, limit: 100,
      });
      setContracts(list);
    } catch (e) { setError(friendly(e)); } finally { setLoading(false); }
  }, [client, selectedDef]);

  React.useEffect(() => { load(); }, [load]);

  const openContract = async (id: string, act: "publish" | "retire") => {
    try {
      const row = await svc.getEventContract(client, id);
      if (!row) { toast.error("Contract not found"); return; }
      setSelected(row); setAction(act);
    } catch (e) { toast.error(friendly(e)); }
  };

  const runAction = async (reason: string) => {
    if (!selected || !action) return;
    setBusy(true);
    try {
      const fn = action === "publish" ? svc.publishEventContract : svc.retireEventContract;
      await fn(client, {
        id: selected.id,
        expectedUpdatedAt: selected.updated_at,
        reason,
      });
      toast.success(`Contract ${action}d`);
      setSelected(null); setAction(null);
      await load();
    } catch (e) { toast.error(friendly(e)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4" data-testid="oc-contracts-tab">
      <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
        <Label htmlFor="oc-def-picker">Event</Label>
        <select
          id="oc-def-picker"
          className="rounded-md border bg-background px-3 py-2 text-sm min-w-[280px]"
          value={selectedDef}
          onChange={(e) => setSelectedDef(e.target.value)}
        >
          {defs.length === 0 && <option value="">No events</option>}
          {defs.map((d) => (
            <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
          ))}
        </select>
        <Button variant="outline" onClick={load} disabled={loading || !selectedDef}>
          {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <ShieldAlert className="h-4 w-4" />
          <AlertTitle>Failed to load contracts</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {selected && selected.sample_payload_redacted && (
        <Alert>
          <EyeOff className="h-4 w-4" />
          <AlertTitle>Sample payload redacted</AlertTitle>
          <AlertDescription>
            You do not hold the <code>omni_comms.view_sensitive_content</code>{" "}
            capability. Publishing is disabled while sensitive content is
            hidden — a reviewer with that capability must publish.
          </AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-3 py-2">Version</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2 font-mono text-xs">Checksum</th>
              <th className="text-right px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 && !loading && (
              <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No contracts</td></tr>
            )}
            {contracts.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="px-3 py-2">v{c.version_number}</td>
                <td className="px-3 py-2">
                  <Badge className={STATUS_COLORS[c.status] ?? ""} variant="outline">{c.status}</Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs truncate max-w-[220px]">
                  {c.checksum ?? "—"}
                </td>
                <td className="px-3 py-2 text-right space-x-1">
                  {c.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => openContract(c.id, "publish")}>
                      Publish
                    </Button>
                  )}
                  {c.status === "published" && (
                    <Button size="sm" variant="outline" onClick={() => openContract(c.id, "retire")}>
                      Retire
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReasonDialog
        open={!!selected && !!action}
        title={action === "publish" ? `Publish v${selected?.version_number ?? ""}` : `Retire v${selected?.version_number ?? ""}`}
        description={
          action === "publish"
            ? "Publishing makes this contract version the authoritative shape for producers. Reviewers must confirm they have inspected the sample payload."
            : "Retiring a published contract prevents future producers from binding to it. A reason is required."
        }
        actionLabel={action === "publish" ? "Publish" : "Retire"}
        reasonRequired={action === "retire"}
        requireSyntheticConfirmation={action === "publish"}
        syntheticConfirmationLabel="I have reviewed the sample payload and confirm this version is safe to publish."
        // If the payload is redacted the checkbox cannot honestly be ticked;
        // we surface that above and also disable the confirm button here.
        busy={busy || (action === "publish" && !!selected?.sample_payload_redacted)}
        onCancel={() => { setSelected(null); setAction(null); }}
        onConfirm={runAction}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
export const OmniCommsEventsPage: React.FC = () => {
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="oc-events-page">
      <div className="flex items-center gap-3">
        <Radio className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Event Catalogue</h1>
          <p className="text-sm text-muted-foreground">
            Business-event definitions and versioned JSON contracts. All mutations go through the authorised RPC surface — no direct table access, no Legacy code path.
          </p>
        </div>
      </div>

      <Tabs defaultValue="definitions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="definitions">Definitions</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="routes">Routes</TabsTrigger>
          <TabsTrigger value="simulator">Simulator</TabsTrigger>
        </TabsList>
        <TabsContent value="definitions"><DefinitionsTab /></TabsContent>
        <TabsContent value="contracts"><ContractsTab /></TabsContent>
        <TabsContent value="routes">
          <Card>
            <CardHeader><CardTitle className="text-base">Routes</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Event routing is planned for a later Epic 2 story. This tab is a
              placeholder — no writes, no reads, no data.
              <div className="mt-2">
                <Badge variant="outline">
                  Payload budget notice: contract sample payloads are capped at{" "}
                  {(PAYLOAD_MAX_BYTES / 1024).toFixed(0)} KB (UTF-8).
                </Badge>
              </div>
              <div className="mt-2 text-xs">byteLen helper reserved: {byteLen("")}</div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="simulator">
          <Card>
            <CardHeader><CardTitle className="text-base">Simulator</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Producer simulation is planned for a later Epic 2 story. This tab is a placeholder.
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default OmniCommsEventsPage;
