/**
 * Build 4A — Producer Integrations administration tab.
 *
 * Replaces the placeholder Events "Simulator" tab. Shows which registered
 * business caller module is authorised to produce which event, in which
 * modes, and lets an authorised administrator draft, activate, suspend and
 * retire those bindings through the authorised RPC surface only.
 *
 * Read-only with respect to delivery: nothing here sends, enqueues or
 * contacts a provider.
 */
import React from "react";
import { Loader2, Plus, RefreshCw, PlugZap } from "lucide-react";
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
import { OmniCommsEmptyState } from "../../components/OmniCommsEmptyState";
import * as svc from "@/platform/omni-comms/application/producerIntegrationsService";
import {
  PRODUCER_BINDING_MODES,
  type ProducerBindingMode,
  type ProducerEventBinding,
} from "@/platform/omni-comms/application/producerIntegrationsTypes";
import * as ecSvc from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventDefinitionListItem } from "@/platform/omni-comms/application/eventCatalogueTypes";

/** Registered caller modules. Mirrors omni_comms_caller_module_registry. */
const BUSINESS_CALLER_MODULES = [
  "EMPLOYER_REGISTRATION",
  "BENEFITS",
  "COMPLIANCE",
  "FINANCE",
  "INSURED_PERSON",
  "LEGAL",
] as const;

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground",
  active: "bg-primary/10 text-primary",
  suspended: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  retired: "bg-destructive/10 text-destructive",
};

export interface ProducerIntegrationsTabProps {
  canConfigure: boolean;
  friendly: (e: unknown) => string;
}

interface EditorState {
  open: boolean;
  binding: ProducerEventBinding | null;
}

export const ProducerIntegrationsTab: React.FC<ProducerIntegrationsTabProps> = ({
  canConfigure,
  friendly,
}) => {
  const client = useOmniCommsRpcClient();
  const { organizationId, departmentId } = useOmniCommsTenant();

  const [rows, setRows] = React.useState<ProducerEventBinding[]>([]);
  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const [editor, setEditor] = React.useState<EditorState>({ open: false, binding: null });
  const [formModule, setFormModule] = React.useState<string>(BUSINESS_CALLER_MODULES[0]);
  const [formEventId, setFormEventId] = React.useState<string>("");
  const [formModes, setFormModes] = React.useState<ProducerBindingMode[]>(["dry_run"]);
  const [formReference, setFormReference] = React.useState<string>("");

  const [lifecycleTarget, setLifecycleTarget] = React.useState<{
    binding: ProducerEventBinding;
    state: "active" | "suspended" | "retired";
  } | null>(null);
  const [lifecycleReason, setLifecycleReason] = React.useState("");

  const load = React.useCallback(async () => {
    if (!organizationId) { setRows([]); return; }
    setLoading(true); setError(null);
    try {
      const [list, defs] = await Promise.all([
        svc.listProducerEventBindings(client, {
          organizationId,
          departmentId: departmentId ?? null,
        }),
        ecSvc.listEventDefinitions(client, { status: "active", limit: 200 }).catch(() => []),
      ]);
      setRows(list);
      setEvents(Array.isArray(defs) ? (defs as EventDefinitionListItem[]) : []);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setLoading(false);
    }
  }, [client, organizationId, departmentId, friendly]);

  React.useEffect(() => { void load(); }, [load]);

  const openEditor = (binding: ProducerEventBinding | null) => {
    setEditor({ open: true, binding });
    setFormModule(binding?.caller_module_code ?? BUSINESS_CALLER_MODULES[0]);
    setFormEventId(binding?.event_definition_id ?? "");
    setFormModes(
      (binding?.allowed_modes?.filter((m): m is ProducerBindingMode =>
        (PRODUCER_BINDING_MODES as readonly string[]).includes(m),
      ) ?? ["dry_run"]) as ProducerBindingMode[],
    );
    setFormReference(binding?.integration_reference ?? "");
  };

  const toggleMode = (mode: ProducerBindingMode, checked: boolean) => {
    setFormModes((prev) =>
      checked ? Array.from(new Set([...prev, mode])) : prev.filter((m) => m !== mode),
    );
  };

  const save = async () => {
    if (!organizationId) return;
    if (!formEventId) { toast.error("Select an event."); return; }
    if (formModes.length === 0) { toast.error("Select at least one mode."); return; }
    setSaving(true);
    try {
      await svc.upsertProducerEventBindingDraft(client, {
        id: editor.binding?.id ?? null,
        organizationId,
        departmentId: departmentId ?? null,
        callerModuleCode: formModule,
        eventDefinitionId: formEventId,
        allowedModes: formModes,
        integrationReference: formReference.trim() || null,
      });
      toast.success("Producer integration draft saved.");
      setEditor({ open: false, binding: null });
      await load();
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setSaving(false);
    }
  };

  const applyLifecycle = async () => {
    if (!lifecycleTarget) return;
    setSaving(true);
    try {
      await svc.setProducerEventBindingStatus(client, {
        id: lifecycleTarget.binding.id,
        targetStatus: lifecycleTarget.state,
        reason: lifecycleReason.trim() || null,
      });
      toast.success(`Integration ${lifecycleTarget.state}.`);
      setLifecycleTarget(null);
      setLifecycleReason("");
      await load();
    } catch (e) {
      toast.error(friendly(e));
    } finally {
      setSaving(false);
    }
  };

  if (!organizationId) {
    return (
      <OmniCommsEmptyState
        title="Select an organisation"
        description="Producer integrations are scoped to one organisation."
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="oc-producer-integrations">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Explicit authorisation for a business module to produce an Omni-Comms event.
          Without an active integration, the runtime refuses the emission. No provider is
          contacted from this screen.
        </p>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          {canConfigure && (
            <Button size="sm" onClick={() => openEditor(null)}>
              <Plus className="mr-1 h-4 w-4" /> New integration
            </Button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && rows.length === 0 && (
        <OmniCommsEmptyState
          icon={PlugZap}
          title="No producer integrations"
          description="No business module is authorised to produce an event for this organisation yet."
        />
      )}

      <div className="space-y-3">
        {rows.map((b) => (
          <Card key={b.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-[16rem] space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{b.caller_module_code}</span>
                  <Badge className={STATUS_COLORS[b.status] ?? ""}>{b.status}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">{b.event_code}</p>
                {b.integration_reference && (
                  <p className="text-xs text-muted-foreground">Ref: {b.integration_reference}</p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {b.allowed_modes.map((m) => (
                  <Badge key={m} variant="outline">{m}</Badge>
                ))}
              </div>
              {canConfigure && (
                <div className="flex flex-wrap items-center gap-2">
                  {b.status === "draft" && (
                    <Button size="sm" variant="outline" onClick={() => openEditor(b)}>Edit</Button>
                  )}
                  {(b.status === "draft" || b.status === "suspended") && (
                    <Button
                      size="sm"
                      onClick={() => { setLifecycleTarget({ binding: b, state: "active" }); setLifecycleReason(""); }}
                    >
                      Activate
                    </Button>
                  )}
                  {b.status === "active" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setLifecycleTarget({ binding: b, state: "suspended" }); setLifecycleReason(""); }}
                    >
                      Suspend
                    </Button>
                  )}
                  {b.status !== "retired" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => { setLifecycleTarget({ binding: b, state: "retired" }); setLifecycleReason(""); }}
                    >
                      Retire
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={editor.open} onOpenChange={(o) => setEditor({ open: o, binding: o ? editor.binding : null })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editor.binding ? "Edit integration draft" : "New producer integration"}</DialogTitle>
            <DialogDescription>
              Authorises one registered business module to produce one event. Live delivery
              modes are not available in this build.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Business module</Label>
              <Select value={formModule} onValueChange={setFormModule}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BUSINESS_CALLER_MODULES.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Event</Label>
              <Select value={formEventId} onValueChange={setFormEventId}>
                <SelectTrigger><SelectValue placeholder="Select an active event" /></SelectTrigger>
                <SelectContent>
                  {events.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Allowed modes</Label>
              <div className="flex items-center gap-4">
                {PRODUCER_BINDING_MODES.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={formModes.includes(m)}
                      onCheckedChange={(c) => toggleMode(m, c === true)}
                    />
                    {m}
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-1">
              <Label>Integration reference (optional)</Label>
              <Input
                value={formReference}
                maxLength={200}
                onChange={(e) => setFormReference(e.target.value)}
                placeholder="e.g. useEmployerRegistrationSubmit"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditor({ open: false, binding: null })}>Cancel</Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!lifecycleTarget} onOpenChange={(o) => { if (!o) setLifecycleTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm {lifecycleTarget?.state}</DialogTitle>
            <DialogDescription>
              {lifecycleTarget?.binding.caller_module_code} → {lifecycleTarget?.binding.event_code}
            </DialogDescription>
          </DialogHeader>
          {lifecycleTarget?.state !== "active" && (
            <div className="space-y-1">
              <Label>Reason (required)</Label>
              <Textarea
                value={lifecycleReason}
                maxLength={500}
                onChange={(e) => setLifecycleReason(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLifecycleTarget(null)}>Cancel</Button>
            <Button onClick={() => void applyLifecycle()} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ProducerIntegrationsTab;
