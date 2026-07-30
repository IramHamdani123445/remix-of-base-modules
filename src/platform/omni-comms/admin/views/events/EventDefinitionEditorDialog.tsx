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
    setBusy(false);
  }, [open, existing]);

  const codeValid = /^[A-Z0-9_]+\.[A-Z0-9_]+\.[A-Z0-9_]+$/.test(code.trim());
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
            Event codes follow <code>MODULE.ENTITY.ACTION</code> in upper snake segments.
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
              onChange={(e) => setModuleCode(e.target.value.toUpperCase())} placeholder="BENEFITS" />
          </div>
          <div>
            <Label htmlFor="oc-def-entity">Entity type</Label>
            <Input id="oc-def-entity" data-testid="oc-def-entity" value={entityType}
              onChange={(e) => setEntityType(e.target.value.toUpperCase())} placeholder="CLAIM" />
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
