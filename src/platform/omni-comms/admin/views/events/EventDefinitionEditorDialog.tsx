/**
 * Event Definition editor — create and edit draft definitions.
 *
 * Mutates only through the bound Omni-Comms RPC adapter. Editing is allowed
 * for `draft` definitions only; the server re-enforces that rule.
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import * as svc from "@/platform/omni-comms/application/eventCatalogueService";
import type {
  CommunicationClass,
  EventDefinitionRow,
  EventPriority,
} from "@/platform/omni-comms/application/eventCatalogueTypes";
import type { OmniCommsRpcClient } from "@/platform/omni-comms/application/eventCatalogueService";
import {
  listBusinessObjects,
  type BusinessObjectRow,
} from "@/platform/omni-comms/application/businessCatalogueAdminService";

const CLASSES: CommunicationClass[] = [
  "transactional", "service", "security", "legal_mandatory", "operational", "marketing",
];
const PRIORITIES: EventPriority[] = ["low", "normal", "high", "urgent"];

export interface EventDefinitionEditorProps {
  open: boolean;
  client: OmniCommsRpcClient;
  existing: EventDefinitionRow | null;
  onCancel: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}

export const EventDefinitionEditorDialog: React.FC<EventDefinitionEditorProps> = ({
  open, client, existing, onCancel, onSaved, onError,
}) => {
  const [code, setCode] = React.useState("");
  const [moduleCode, setModuleCode] = React.useState("");
  const [entityType, setEntityType] = React.useState("");
  const [displayOrder, setDisplayOrder] = React.useState("1000");
  const [businessObjects, setBusinessObjects] = React.useState<BusinessObjectRow[]>([]);
  const [customObject, setCustomObject] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [communicationClass, setCommunicationClass] = React.useState<CommunicationClass>("transactional");
  const [defaultPriority, setDefaultPriority] = React.useState<EventPriority>("normal");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCode(existing?.code ?? "");
    setModuleCode(existing?.module_code ?? "");
    setEntityType(existing?.entity_type ?? "");
    setName(existing?.name ?? "");
    setDescription(existing?.description ?? "");
    setCommunicationClass(existing?.communication_class ?? "transactional");
    setDefaultPriority(existing?.default_priority ?? "normal");
    setDisplayOrder(String(existing?.display_order ?? 1000));
    setCustomObject(false);
    setBusy(false);
  }, [open, existing]);

  // Governed business objects for the chosen module drive the classification.
  React.useEffect(() => {
    if (!open) return;
    const module = moduleCode.trim();
    if (!module) { setBusinessObjects([]); return; }
    let cancelled = false;
    listBusinessObjects(client, { moduleCode: module })
      .then((rows) => { if (!cancelled) setBusinessObjects(rows ?? []); })
      .catch(() => { if (!cancelled) setBusinessObjects([]); });
    return () => { cancelled = true; };
  }, [open, client, moduleCode]);

  const actionSegment = code.trim().split(".")[2] ?? "";
  // Keep the governed code aligned with MODULE.BUSINESS_OBJECT.ACTION.
  const syncCode = (module: string, object: string, action: string) =>
    setCode([module, object, action].filter(Boolean).join("."));

  const codeValid =
    /^[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+$/.test(code.trim()) &&
    code.trim().split(".")[0] === moduleCode.trim() &&
    code.trim().split(".")[1] === entityType.trim();
  const canSave =
    !busy && codeValid && moduleCode.trim().length > 0 &&
    entityType.trim().length > 0 && name.trim().length > 0;

  const save = async () => {
    setBusy(true);
    try {
      const base = {
        code: code.trim(),
        moduleCode: moduleCode.trim(),
        entityType: entityType.trim(),
        name: name.trim(),
        description: description.trim() || null,
        communicationClass,
        defaultPriority,
        businessObjectCode: entityType.trim(),
        displayOrder: Number.isFinite(Number(displayOrder)) ? Number(displayOrder) : 1000,
      };
      if (existing) {
        await svc.updateEventDefinitionDraft(client, {
          ...base, id: existing.id, expectedUpdatedAt: existing.updated_at,
        });
      } else {
        await svc.createEventDefinition(client, base);
      }
      onSaved();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.code}` : "New event definition"}</DialogTitle>
          <DialogDescription>
            Event codes follow <code>MODULE.BUSINESS_OBJECT.ACTION</code> in upper snake
            segments and must match the classification chosen below.
            New definitions are created as drafts and must be activated separately.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="oc-def-code">Event code</Label>
            <Input
              id="oc-def-code"
              data-testid="oc-def-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="BENEFITS.CLAIM.APPROVED"
              className="font-mono"
            />
            {!codeValid && code.length > 0 && (
              <p className="text-xs text-destructive mt-1">
                Must be three upper-case segments separated by dots.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="oc-def-module">Module code</Label>
            <Input id="oc-def-module" data-testid="oc-def-module" value={moduleCode}
              onChange={(e) => {
                const next = e.target.value.toUpperCase();
                setModuleCode(next);
                syncCode(next, entityType.trim(), actionSegment);
              }} placeholder="BENEFITS" />
          </div>
          <div>
            <Label htmlFor="oc-def-entity">Business object</Label>
            {businessObjects.length > 0 && !customObject ? (
              <Select
                value={entityType}
                onValueChange={(v) => {
                  if (v === "__custom__") { setCustomObject(true); return; }
                  setEntityType(v);
                  syncCode(moduleCode.trim(), v, actionSegment);
                }}
              >
                <SelectTrigger data-testid="oc-def-entity"><SelectValue placeholder="Select business object" /></SelectTrigger>
                <SelectContent>
                  {businessObjects.map((b) => (
                    <SelectItem key={b.id} value={b.code}>{b.name} ({b.code})</SelectItem>
                  ))}
                  <SelectItem value="__custom__">Other — enter code…</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <Input id="oc-def-entity" data-testid="oc-def-entity" value={entityType}
                onChange={(e) => {
                  const next = e.target.value.toUpperCase();
                  setEntityType(next);
                  syncCode(moduleCode.trim(), next, actionSegment);
                }} placeholder="CLAIM" />
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Groups this event in the business template catalogue.
            </p>
          </div>
          <div>
            <Label htmlFor="oc-def-order">Display order</Label>
            <Input id="oc-def-order" data-testid="oc-def-order" type="number" value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="oc-def-name">Name</Label>
            <Input id="oc-def-name" data-testid="oc-def-name" value={name}
              onChange={(e) => setName(e.target.value)} placeholder="Claim approved" />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="oc-def-desc">Description</Label>
            <Textarea id="oc-def-desc" value={description} rows={3}
              onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>Communication class</Label>
            <Select value={communicationClass} onValueChange={(v) => setCommunicationClass(v as CommunicationClass)}>
              <SelectTrigger data-testid="oc-def-class"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CLASSES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Default priority</Label>
            <Select value={defaultPriority} onValueChange={(v) => setDefaultPriority(v as EventPriority)}>
              <SelectTrigger data-testid="oc-def-priority"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!canSave} data-testid="oc-def-save">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save draft" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventDefinitionEditorDialog;
