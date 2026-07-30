/**
 * Event Contract editor — create and edit draft contracts.
 *
 * JSON schema and sample payload are edited as text and parsed client-side
 * before submission; the server re-validates authoritatively (JSON Schema
 * 2020-12, non-local $ref rejection, size limits) and computes the checksum.
 */
import React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import * as svc from "@/platform/omni-comms/application/eventCatalogueService";
import type { OmniCommsRpcClient } from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventContractRow } from "@/platform/omni-comms/application/eventCatalogueTypes";

const DEFAULT_SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [],
  "properties": {}
}`;

const MAX_BYTES = 256 * 1024;
const byteLen = (s: string) => new TextEncoder().encode(s).length;

export interface EventContractEditorProps {
  open: boolean;
  client: OmniCommsRpcClient;
  eventDefinitionId: string;
  nextVersionNumber: number;
  existing: EventContractRow | null;
  onCancel: () => void;
  onSaved: () => void;
  onError: (e: unknown) => void;
}

export const EventContractEditorDialog: React.FC<EventContractEditorProps> = ({
  open, client, eventDefinitionId, nextVersionNumber, existing,
  onCancel, onSaved, onError,
}) => {
  const [versionNumber, setVersionNumber] = React.useState(nextVersionNumber);
  const [schemaText, setSchemaText] = React.useState(DEFAULT_SCHEMA);
  const [sampleText, setSampleText] = React.useState("{}");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setVersionNumber(existing?.version_number ?? nextVersionNumber);
    setSchemaText(existing ? JSON.stringify(existing.json_schema, null, 2) : DEFAULT_SCHEMA);
    setSampleText(
      existing?.sample_payload ? JSON.stringify(existing.sample_payload, null, 2) : "{}",
    );
    setBusy(false);
  }, [open, existing, nextVersionNumber]);

  const parse = (t: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } => {
    try {
      const v = JSON.parse(t);
      if (v === null || typeof v !== "object" || Array.isArray(v)) {
        return { ok: false, error: "Must be a JSON object." };
      }
      return { ok: true, value: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  };

  const schemaParsed = parse(schemaText);
  const sampleParsed = parse(sampleText);
  const tooBig = byteLen(schemaText) > MAX_BYTES || byteLen(sampleText) > MAX_BYTES;
  const redacted = existing?.sample_payload_redacted === true;

  const canSave =
    !busy && !tooBig && schemaParsed.ok && sampleParsed.ok &&
    versionNumber >= 1 && !redacted;

  const save = async () => {
    if (!schemaParsed.ok || !sampleParsed.ok) return;
    setBusy(true);
    try {
      if (existing) {
        await svc.updateEventContractDraft(client, {
          id: existing.id,
          expectedUpdatedAt: existing.updated_at,
          jsonSchema: schemaParsed.value,
          samplePayload: sampleParsed.value,
        });
      } else {
        await svc.createEventContract(client, {
          eventDefinitionId,
          versionNumber,
          jsonSchema: schemaParsed.value,
          samplePayload: sampleParsed.value,
        });
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
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {existing ? `Edit contract v${existing.version_number}` : "New contract draft"}
          </DialogTitle>
          <DialogDescription>
            The server validates the schema (JSON Schema 2020-12), rejects non-local
            <code> $ref</code>, validates the sample payload against the schema, and
            computes the SHA-256 checksum. Checksums cannot be supplied by the caller.
          </DialogDescription>
        </DialogHeader>

        {redacted && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              The sample payload is redacted for your capability level. Editing is
              disabled — a reviewer holding <code>omni_comms.view_sensitive_content</code>
              must make changes.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {!existing && (
            <div className="max-w-[200px]">
              <Label htmlFor="oc-contract-version">Version number</Label>
              <Input
                id="oc-contract-version"
                data-testid="oc-contract-version"
                type="number"
                min={1}
                value={versionNumber}
                onChange={(e) => setVersionNumber(Number(e.target.value))}
              />
            </div>
          )}
          <div>
            <Label htmlFor="oc-contract-schema">JSON schema</Label>
            <Textarea
              id="oc-contract-schema"
              data-testid="oc-contract-schema"
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              rows={14}
              className="font-mono text-xs"
              disabled={redacted}
            />
            {schemaParsed.ok ? null : (
              <p className="text-xs text-destructive mt-1">{schemaParsed.error}</p>
            )}
          </div>
          <div>
            <Label htmlFor="oc-contract-sample">Sample payload</Label>
            <Textarea
              id="oc-contract-sample"
              data-testid="oc-contract-sample"
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              disabled={redacted}
            />
            {sampleParsed.ok ? null : (
              <p className="text-xs text-destructive mt-1">{sampleParsed.error}</p>
            )}
          </div>
          {tooBig && (
            <p className="text-xs text-destructive">
              Schema or sample exceeds the 256 KB server limit.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={!canSave} data-testid="oc-contract-save">
            {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {existing ? "Save draft" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default EventContractEditorDialog;
