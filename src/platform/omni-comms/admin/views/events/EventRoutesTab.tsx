/**
 * Event Routes administration tab.
 *
 * Routes bind a business event to a channel for an organisation (optionally a
 * department), and carry the obligation flag, preference policy, template
 * family and sender identity. All mutations go through the bound RPC adapter.
 */
import React from "react";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useOmniCommsRpcClient } from "../../hooks/useOmniCommsRpcClient";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "../../components/OmniCommsTenantSelector";
import { OmniCommsEmptyState } from "../../components/OmniCommsEmptyState";
import * as routeSvc from "@/platform/omni-comms/application/eventRouteService";
import type {
  EventRouteListItem, EventRouteLifecycle, OmniCommsChannel,
  PreferencePolicy, SenderResolutionPolicy,
} from "@/platform/omni-comms/application/eventRouteService";
import * as ecSvc from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventDefinitionListItem } from "@/platform/omni-comms/application/eventCatalogueTypes";
import * as tplSvc from "@/platform/omni-comms/application/templateCatalogueService";
import type { TemplateFamilyListItem } from "@/platform/omni-comms/application/templateCatalogueTypes";
import { getEmailConfigSummary } from "@/platform/omni-comms/application/channelManagementService";

const NONE = "__none__";

const LIFECYCLE_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  active: "bg-primary/10 text-primary",
  suspended: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-destructive/10 text-destructive",
};

interface SenderOption { id: string; label: string }

interface EditorState {
  open: boolean;
  route: EventRouteListItem | null;
}

export interface EventRoutesTabProps {
  canConfigure: boolean;
  friendly: (e: unknown) => string;
}

export const EventRoutesTab: React.FC<EventRoutesTabProps> = ({ canConfigure, friendly }) => {
  const client = useOmniCommsRpcClient();
  const { organizationId, departmentId } = useOmniCommsTenant();

  const [rows, setRows] = React.useState<EventRouteListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lifecycleFilter, setLifecycleFilter] = React.useState<string>("");
  const [channelFilter, setChannelFilter] = React.useState<string>("");

  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);
  const [families, setFamilies] = React.useState<TemplateFamilyListItem[]>([]);
  const [senders, setSenders] = React.useState<SenderOption[]>([]);

  const [editor, setEditor] = React.useState<EditorState>({ open: false, route: null });
  const [lifecycleTarget, setLifecycleTarget] = React.useState<{
    route: EventRouteListItem; state: "active" | "suspended" | "retired";
  } | null>(null);

  const load = React.useCallback(async () => {
    if (!organizationId) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const list = await routeSvc.listEventRoutes(client, {
        organizationId,
        departmentId: departmentId ?? null,
        channel: (channelFilter || null) as OmniCommsChannel | null,
        lifecycleState: (lifecycleFilter || null) as EventRouteLifecycle | null,
        limit: 200,
      });
      setRows(list);
    } catch (e) {
      setError(friendly(e));
    } finally { setLoading(false); }
  }, [client, organizationId, departmentId, channelFilter, lifecycleFilter, friendly]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    (async () => {
      try {
        const evs = await ecSvc.listAllEventDefinitionsForPicker(client, { maxItems: 1000 });
        setEvents(evs);
      } catch { setEvents([]); }
    })();
  }, [client]);

  React.useEffect(() => {
    if (!organizationId) { setFamilies([]); setSenders([]); return; }
    (async () => {
      try {
        const r = await tplSvc.listTemplateFamilies(client, { limit: 200 });
        setFamilies(r.items);
      } catch { setFamilies([]); }
      try {
        const summary = await getEmailConfigSummary(client, organizationId) as unknown as {
          sender_identities?: Array<{ id: string; code: string; display_name?: string | null; status: string }>;
        };
        setSenders(
          (summary?.sender_identities ?? [])
            .filter((s) => s.status === "active")
            .map((s) => ({ id: s.id, label: `${s.code}${s.display_name ? ` — ${s.display_name}` : ""}` })),
        );
      } catch { setSenders([]); }
    })();
  }, [client, organizationId]);

  if (!organizationId) {
    return (
      <div className="space-y-4" data-testid="oc-routes-tab">
        <Card><CardContent className="pt-4"><OmniCommsTenantSelector /></CardContent></Card>
        <OmniCommsEmptyState
          title="Select an organisation"
          description="Event routes are scoped to an organisation and optionally a department. Choose an organisation above to view or create routes."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="oc-routes-tab">
      <Card><CardContent className="pt-4"><OmniCommsTenantSelector /></CardContent></Card>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={lifecycleFilter || "all"} onValueChange={(v) => setLifecycleFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-44" data-testid="oc-route-lifecycle-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All lifecycle states</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="retired">Retired</SelectItem>
          </SelectContent>
        </Select>
        <Select value={channelFilter || "all"} onValueChange={(v) => setChannelFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-40" data-testid="oc-route-channel-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {routeSvc.OMNI_COMMS_CHANNELS.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <div className="flex-1" />
        <Button
          disabled={!canConfigure}
          onClick={() => setEditor({ open: true, route: null })}
          data-testid="oc-route-new"
        >
          <Plus className="h-4 w-4 mr-1" />New route
        </Button>
      </div>

      {error ? (
        <OmniCommsEmptyState variant="error" title="Failed to load routes" description={error}
          actionLabel="Retry" onAction={() => void load()} />
      ) : loading ? (
        <OmniCommsEmptyState variant="loading" title="Loading routes…" />
      ) : rows.length === 0 ? (
        <OmniCommsEmptyState
          title="No event routes yet"
          description="A route tells the hub which channels an event uses for this organisation. Create one to make an event deliverable."
          actionLabel={canConfigure ? "Create the first route" : undefined}
          onAction={canConfigure ? () => setEditor({ open: true, route: null }) : undefined}
        />
      ) : (
        <div className="rounded-md border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2">Event</th>
                <th className="text-left px-3 py-2">Channel</th>
                <th className="text-left px-3 py-2">Required</th>
                <th className="text-left px-3 py-2">Template family</th>
                <th className="text-left px-3 py-2">Sender</th>
                <th className="text-left px-3 py-2">Preference</th>
                <th className="text-left px-3 py-2">State</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t" data-testid={`oc-route-row-${r.id}`}>
                  <td className="px-3 py-2">
                    <div className="font-mono text-xs">{r.event_code}</div>
                    <div className="text-xs text-muted-foreground">{r.event_name}</div>
                  </td>
                  <td className="px-3 py-2">{r.channel}</td>
                  <td className="px-3 py-2">{r.is_required ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-xs">{r.template_family_code ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.sender_identity_code ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.preference_policy}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={LIFECYCLE_COLORS[r.lifecycle_state] ?? ""}>
                      {r.lifecycle_state}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                    {r.lifecycle_state !== "retired" && (
                      <Button size="sm" variant="outline" disabled={!canConfigure}
                        onClick={() => setEditor({ open: true, route: r })}>Edit</Button>
                    )}
                    {(r.lifecycle_state === "draft" || r.lifecycle_state === "suspended") && (
                      <Button size="sm" variant="outline" disabled={!canConfigure}
                        onClick={() => setLifecycleTarget({ route: r, state: "active" })}>Activate</Button>
                    )}
                    {r.lifecycle_state === "active" && (
                      <Button size="sm" variant="outline" disabled={!canConfigure}
                        onClick={() => setLifecycleTarget({ route: r, state: "suspended" })}>Suspend</Button>
                    )}
                    {r.lifecycle_state !== "retired" && (
                      <Button size="sm" variant="outline" disabled={!canConfigure}
                        onClick={() => setLifecycleTarget({ route: r, state: "retired" })}>Retire</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RouteEditorDialog
        state={editor}
        organizationId={organizationId}
        departmentId={departmentId ?? null}
        events={events}
        families={families}
        senders={senders}
        onCancel={() => setEditor({ open: false, route: null })}
        onSaved={() => { setEditor({ open: false, route: null }); void load(); }}
        friendly={friendly}
      />

      <RouteLifecycleDialog
        target={lifecycleTarget}
        onCancel={() => setLifecycleTarget(null)}
        onDone={() => { setLifecycleTarget(null); void load(); }}
        friendly={friendly}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────

const RouteEditorDialog: React.FC<{
  state: EditorState;
  organizationId: string;
  departmentId: string | null;
  events: EventDefinitionListItem[];
  families: TemplateFamilyListItem[];
  senders: SenderOption[];
  onCancel: () => void;
  onSaved: () => void;
  friendly: (e: unknown) => string;
}> = ({ state, organizationId, departmentId, events, families, senders, onCancel, onSaved, friendly }) => {
  const client = useOmniCommsRpcClient();
  const existing = state.route;
  const [eventId, setEventId] = React.useState("");
  const [channel, setChannel] = React.useState<OmniCommsChannel>("email");
  const [isRequired, setIsRequired] = React.useState(false);
  const [isEnabled, setIsEnabled] = React.useState(false);
  const [priority, setPriority] = React.useState(100);
  const [templateFamilyId, setTemplateFamilyId] = React.useState<string>(NONE);
  const [senderIdentityId, setSenderIdentityId] = React.useState<string>(NONE);
  const [senderPolicy, setSenderPolicy] = React.useState<SenderResolutionPolicy>("organisation_default");
  const [preferencePolicy, setPreferencePolicy] = React.useState<PreferencePolicy>("honour");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!state.open) return;
    setEventId(existing?.event_definition_id ?? "");
    setChannel(existing?.channel ?? "email");
    setIsRequired(existing?.is_required ?? false);
    setIsEnabled(existing?.is_enabled ?? false);
    setPriority(existing?.priority ?? 100);
    setTemplateFamilyId(existing?.template_family_id ?? NONE);
    setSenderIdentityId(existing?.sender_identity_id ?? NONE);
    setSenderPolicy(existing?.sender_resolution_policy ?? "organisation_default");
    setPreferencePolicy(existing?.preference_policy ?? "honour");
    setBusy(false);
  }, [state.open, existing]);

  const save = async () => {
    setBusy(true);
    try {
      await routeSvc.upsertEventRouteDraft(client, {
        id: existing?.id ?? null,
        expectedUpdatedAt: existing?.updated_at ?? null,
        organizationId,
        departmentId: existing ? existing.department_id : departmentId,
        eventDefinitionId: existing?.event_definition_id ?? eventId,
        channel,
        isRequired,
        isEnabled,
        priority,
        templateFamilyId: templateFamilyId === NONE ? null : templateFamilyId,
        senderIdentityId: senderIdentityId === NONE ? null : senderIdentityId,
        senderResolutionPolicy: senderPolicy,
        preferencePolicy,
      });
      toast.success(existing ? "Route updated" : "Route created");
      onSaved();
    } catch (e) {
      toast.error(friendly(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit event route" : "New event route"}</DialogTitle>
          <DialogDescription>
            Routes are created as drafts and take effect only once activated.
            Sender identity, template family and channel must belong to the same organisation.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Event</Label>
            <Select value={eventId} onValueChange={setEventId} disabled={!!existing}>
              <SelectTrigger data-testid="oc-route-event"><SelectValue placeholder="Select an event" /></SelectTrigger>
              <SelectContent>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as OmniCommsChannel)} disabled={!!existing}>
              <SelectTrigger data-testid="oc-route-channel"><SelectValue /></SelectTrigger>
              <SelectContent>
                {routeSvc.OMNI_COMMS_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="oc-route-priority">Priority</Label>
            <Input id="oc-route-priority" type="number" min={1} max={10000}
              value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
          </div>
          <div>
            <Label>Template family</Label>
            <Select value={templateFamilyId} onValueChange={setTemplateFamilyId}>
              <SelectTrigger data-testid="oc-route-family"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Resolve at send time</SelectItem>
                {families.map((f) => <SelectItem key={f.id} value={f.id}>{f.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sender identity</Label>
            <Select value={senderIdentityId} onValueChange={setSenderIdentityId}>
              <SelectTrigger data-testid="oc-route-sender"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Use resolution policy</SelectItem>
                {senders.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Sender resolution policy</Label>
            <Select value={senderPolicy} onValueChange={(v) => setSenderPolicy(v as SenderResolutionPolicy)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="explicit">explicit</SelectItem>
                <SelectItem value="event_default">event_default</SelectItem>
                <SelectItem value="organisation_default">organisation_default</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Preference policy</Label>
            <Select value={preferencePolicy} onValueChange={(v) => setPreferencePolicy(v as PreferencePolicy)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="honour">honour</SelectItem>
                <SelectItem value="bypass_for_required">bypass_for_required</SelectItem>
                <SelectItem value="ignore">ignore</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isRequired} onCheckedChange={(v) => setIsRequired(v === true)} />
              Channel is mandatory for this event
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={isEnabled} onCheckedChange={(v) => setIsEnabled(v === true)} />
              Enabled
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || (!existing && !eventId)} data-testid="oc-route-save">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const RouteLifecycleDialog: React.FC<{
  target: { route: EventRouteListItem; state: "active" | "suspended" | "retired" } | null;
  onCancel: () => void;
  onDone: () => void;
  friendly: (e: unknown) => string;
}> = ({ target, onCancel, onDone, friendly }) => {
  const client = useOmniCommsRpcClient();
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setReason(""); setBusy(false); }, [target]);

  const reasonRequired = target?.state === "suspended" || target?.state === "retired";
  const trimmed = reason.trim();
  const invalid = (reasonRequired && trimmed.length === 0) || trimmed.length > 2000;

  const run = async () => {
    if (!target) return;
    setBusy(true);
    try {
      await routeSvc.setEventRouteLifecycle(client, {
        id: target.route.id,
        expectedUpdatedAt: target.route.updated_at,
        targetState: target.state,
        reason: trimmed || null,
      });
      toast.success(`Route ${target.state}`);
      onDone();
    } catch (e) {
      toast.error(friendly(e));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {target ? `${target.state[0].toUpperCase()}${target.state.slice(1)} route` : ""}
          </DialogTitle>
          <DialogDescription>
            {reasonRequired
              ? "The server requires a reason. It is written to the audit log."
              : "You may optionally record a reason. It is written to the audit log."}
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="oc-route-reason">Reason</Label>
          <Textarea id="oc-route-reason" rows={4} value={reason}
            data-testid="oc-route-reason"
            onChange={(e) => setReason(e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{trimmed.length}/2000 characters</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={run} disabled={busy || invalid} data-testid="oc-route-lifecycle-confirm">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventRoutesTab;
