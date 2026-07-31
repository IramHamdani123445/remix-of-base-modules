/**
 * Epic 3 — Story 3: Template Catalogue admin UI.
 *
 * Consumes the Story 2 SECURITY DEFINER RPC adapter exclusively through the
 * bound `useOmniCommsRpcClient()` hook. Never imports the browser Supabase
 * client directly. Never writes to any table via `.from(...)`. Never queries
 * `core_department` directly — departments come from
 * `organizationService.listActiveDepartmentsForOrganization`.
 *
 * Capability model (denied by default):
 *   omni_comms.view              → open and browse Templates
 *   omni_comms.configure         → create/edit/activate/retire families
 *   omni_comms.author_templates  → create/edit version drafts
 *   omni_comms.approve_templates → approve/publish/replace/retire versions
 *
 * Preview safety: synthetic payloads stay in component memory only. HTML
 * preview is rendered inside <OmniCommsSandboxedPreview /> with sandbox=""
 * and a restrictive meta-CSP. An escaped-source view is always available.
 */
import React from "react";
import { useOmniCommsRpcClient } from "../hooks/useOmniCommsRpcClient";
import * as svc from "@/platform/omni-comms/application/templateCatalogueService";
import {
  TEMPLATE_CHANNELS,
  TEMPLATE_CHANNEL_KEYS,
  type TemplateChannel,
  type TemplateFamilyListItem,
  type TemplateFamilyGetResult,
  type TemplateVersionListItem,
  type TemplateVersionGetResult,
  type TemplateScopeType,
  type TemplateFamilyStatus,
  type TemplateVersionStatus,
} from "@/platform/omni-comms/application/templateCatalogueTypes";
import { OmniCommsRpcError } from "@/platform/omni-comms/application/omniCommsRpcErrors";
import * as ecSvc from "@/platform/omni-comms/application/eventCatalogueService";
import type { EventDefinitionListItem } from "@/platform/omni-comms/application/eventCatalogueTypes";
import { renderTemplate } from "@/platform/omni-comms/rendering";
import { OmniCommsSandboxedPreview } from "../components/OmniCommsSandboxedPreview";
import {
  listActiveDepartmentsForOrganization,
  type ActiveDepartmentOption,
} from "@/platform/organization/organizationService";
import { useOmniCommsTenant } from "@/platform/omni-comms/context/OmniCommsTenantContext";
import { OmniCommsTenantSelector } from "../components/OmniCommsTenantSelector";
import { useModulePermissions } from "@/hooks/useNavigationMenu";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Loader2, ShieldAlert, Plus, RefreshCw, Eye } from "lucide-react";
import { toast } from "sonner";
import { OmniCommsAssemblyTab } from "./OmniCommsAssemblyTab";
import { OmniCommsLayoutSelectionDialog } from "../components/OmniCommsLayoutSelectionDialog";
import {
  describeLayoutSelection,
  isLayoutSelectionApprovable,
  LAYOUT_REQUIRED_BADGE,
  LAYOUT_REQUIRED_MESSAGE,
  mapLayoutErrorDetail,
} from "@/platform/omni-comms/application/templateLayoutSelection";

const REASON_MAX = 2000;

// ─── error → toast helper ────────────────────────────────────────────────────
function friendly(e: unknown): string {
  if (e instanceof OmniCommsRpcError) {
    const map: Record<string, string> = {
      OC401: "You must sign in.",
      OC403: "You do not have permission for this action.",
      OC404: "Not found.",
      OC409: e.detail === "replacement_confirmation_required"
        ? "This channel/locale already has a published version. Confirm replacement to continue."
        : "Conflict.",
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

function toastError(e: unknown) { toast.error(friendly(e)); }

// ─── shared capability guard message ─────────────────────────────────────────
function CapabilityDeniedInline({ capability }: { capability: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <ShieldAlert className="h-3 w-3" /> requires {capability}
    </span>
  );
}

// ─── Reason dialog ───────────────────────────────────────────────────────────
interface ReasonDialogState {
  open: boolean;
  title: string;
  description: string;
  submitLabel: string;
  required: boolean;
  onSubmit: (reason: string) => Promise<void> | void;
}
const CLOSED_REASON: ReasonDialogState = {
  open: false, title: "", description: "", submitLabel: "", required: true,
  onSubmit: () => {},
};

const ReasonDialog: React.FC<{
  state: ReasonDialogState;
  onOpenChange: (open: boolean) => void;
}> = ({ state, onOpenChange }) => {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (state.open) setReason(""); }, [state.open]);
  const remaining = REASON_MAX - reason.length;
  const disabled = busy || (state.required && reason.trim().length === 0) || reason.length > REASON_MAX;
  return (
    <Dialog open={state.open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state.title}</DialogTitle>
          <DialogDescription>{state.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="reason">Reason{state.required ? " (required)" : " (optional)"}</Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={REASON_MAX + 1}
            rows={4}
            data-testid="reason-textarea"
          />
          <div className="text-xs text-muted-foreground">{remaining} characters remaining</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={disabled}
            onClick={async () => {
              setBusy(true);
              try { await state.onSubmit(reason.trim()); onOpenChange(false); }
              catch (e) { toastError(e); }
              finally { setBusy(false); }
            }}
            data-testid="reason-submit"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {state.submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Status badges ───────────────────────────────────────────────────────────
function FamilyStatusBadge({ s }: { s: TemplateFamilyStatus }) {
  const v = s === "active" ? "default" : s === "retired" ? "destructive" : "secondary";
  return <Badge variant={v as never}>{s}</Badge>;
}
function VersionStatusBadge({ s }: { s: TemplateVersionStatus }) {
  const v = s === "published" ? "default"
    : s === "approved" ? "outline"
    : s === "retired" ? "destructive" : "secondary";
  return <Badge variant={v as never}>{s}</Badge>;
}

// ─── Family create/edit dialog ───────────────────────────────────────────────
interface FamilyEditorState {
  open: boolean;
  mode: "create" | "edit";
  initial?: TemplateFamilyGetResult | null;
}

const FamilyEditor: React.FC<{
  state: FamilyEditorState;
  onClose: () => void;
  onSaved: () => void;
  events: EventDefinitionListItem[];
  organizationId: string;
  departments: ActiveDepartmentOption[];
}> = ({ state, onClose, onSaved, events, organizationId, departments }) => {
  const client = useOmniCommsRpcClient();
  const [busy, setBusy] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [scopeType, setScopeType] = React.useState<TemplateScopeType>("organization");
  const [departmentId, setDepartmentId] = React.useState<string | null>(null);
  const [eventDefinitionId, setEventDefinitionId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!state.open) return;
    if (state.mode === "edit" && state.initial) {
      setCode(state.initial.code);
      setName(state.initial.name);
      setDescription(state.initial.description ?? "");
      setScopeType(state.initial.scope_type);
      setDepartmentId(state.initial.department_id);
      setEventDefinitionId(state.initial.event_definition_id);
    } else {
      setCode(""); setName(""); setDescription("");
      setScopeType("organization"); setDepartmentId(null); setEventDefinitionId(null);
    }
  }, [state.open, state.mode, state.initial]);

  const isEdit = state.mode === "edit";
  const canSubmit = !busy && name.trim().length > 0 && (isEdit || code.trim().length > 0);

  return (
    <Dialog open={state.open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit template family" : "New template family"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the name or description. Scope, code and ownership are immutable."
              : "Families are created in draft. Activate them once ready."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Code</Label>
            <Input value={code} disabled={isEdit} onChange={(e) => setCode(e.target.value)} placeholder="benefits.approval_notice" data-testid="family-code" />
          </div>
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="family-name" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          {!isEdit && (
            <>
              <div>
                <Label>Scope</Label>
                <Select value={scopeType} onValueChange={(v) => setScopeType(v as TemplateScopeType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="organization">Organization</SelectItem>
                    <SelectItem value="department">Department</SelectItem>
                    <SelectItem value="event">Event</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scopeType === "department" && (
                <div>
                  <Label>Department</Label>
                  <Select
                    value={departmentId ?? ""}
                    onValueChange={(v) => setDepartmentId(v || null)}
                  >
                    <SelectTrigger data-testid="family-department"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {scopeType === "event" && (
                <div>
                  <Label>Event definition</Label>
                  <Select
                    value={eventDefinitionId ?? ""}
                    onValueChange={(v) => setEventDefinitionId(v || null)}
                  >
                    <SelectTrigger data-testid="family-event"><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>{e.code}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={!canSubmit}
            data-testid="family-save"
            onClick={async () => {
              setBusy(true);
              try {
                if (isEdit && state.initial) {
                  await svc.updateTemplateFamily(client, {
                    id: state.initial.id, name, description: description || null,
                    expectedUpdatedAt: state.initial.updated_at,
                  });
                  toast.success("Family updated");
                } else {
                  await svc.createTemplateFamily(client, {
                    code: code.trim(), name: name.trim(),
                    description: description.trim() || null,
                    scopeType, organizationId,
                    departmentId: scopeType === "department" ? departmentId : null,
                    eventDefinitionId: scopeType === "event" ? eventDefinitionId : null,
                  });
                  toast.success("Family created");
                }
                onSaved();
                onClose();
              } catch (e) { toastError(e); }
              finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Version create dialog ───────────────────────────────────────────────────
const VersionCreateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  familyId: string;
  nextVersionNumber: number;
}> = ({ open, onClose, onSaved, familyId, nextVersionNumber }) => {
  const client = useOmniCommsRpcClient();
  const [busy, setBusy] = React.useState(false);
  const [channel, setChannel] = React.useState<TemplateChannel>("email");
  const [locale, setLocale] = React.useState("en-US");
  const [versionNumber, setVersionNumber] = React.useState(nextVersionNumber);
  const [contentText, setContentText] = React.useState('{\n  "subject": "Hello {{name}}",\n  "text": "Welcome!"\n}');
  React.useEffect(() => { if (open) setVersionNumber(nextVersionNumber); }, [open, nextVersionNumber]);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New template version</DialogTitle>
          <DialogDescription>Draft content per the channel's allowed keys.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as TemplateChannel)}>
                <SelectTrigger data-testid="version-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TEMPLATE_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Locale</Label>
              <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="en-US" data-testid="version-locale" />
            </div>
            <div>
              <Label>Version #</Label>
              <Input type="number" min={1} value={versionNumber}
                onChange={(e) => setVersionNumber(parseInt(e.target.value || "1", 10))} data-testid="version-number" />
            </div>
          </div>
          <div>
            <Label>Content (JSON)</Label>
            <Textarea value={contentText} onChange={(e) => setContentText(e.target.value)} rows={10} className="font-mono text-xs" data-testid="version-content" />
            <p className="text-xs text-muted-foreground mt-1">
              Allowed keys for {channel}: {TEMPLATE_CHANNEL_KEYS[channel].allowed.join(", ")}. Required: {TEMPLATE_CHANNEL_KEYS[channel].required.join(", ") || "—"}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            data-testid="version-save"
            onClick={async () => {
              setBusy(true);
              try {
                const parsed = JSON.parse(contentText);
                if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                  throw new Error("Content must be a JSON object");
                }
                await svc.createTemplateVersion(client, {
                  templateFamilyId: familyId, channel, locale,
                  versionNumber, content: parsed as Record<string, string>,
                });
                toast.success("Version drafted");
                onSaved(); onClose();
              } catch (e) { toastError(e); }
              finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Publish dialog with atomic replacement UI ───────────────────────────────
interface PublishDialogState {
  open: boolean;
  version: TemplateVersionGetResult | null;
  hasExistingPublished: boolean;
}
const PublishDialog: React.FC<{
  state: PublishDialogState;
  onClose: () => void;
  onPublished: (result: { id: string; replaced_version_id: string | null }) => void;
}> = ({ state, onClose, onPublished }) => {
  const client = useOmniCommsRpcClient();
  const [busy, setBusy] = React.useState(false);
  const [confirmReplacement, setConfirmReplacement] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [conflict, setConflict] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (state.open) { setConfirmReplacement(false); setReason(""); setConflict(null); }
  }, [state.open]);

  if (!state.version) return null;
  const v = state.version;
  const initial = !state.hasExistingPublished;
  const requireReason = confirmReplacement;
  const disabled = busy
    || (state.hasExistingPublished && !confirmReplacement)
    || (requireReason && reason.trim().length === 0)
    || reason.length > REASON_MAX;

  return (
    <Dialog open={state.open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish version {v.version_number}</DialogTitle>
          <DialogDescription>
            {initial
              ? "This is the first published version for this channel/locale."
              : "A version is already published for this channel/locale."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-sm">
            <b>Channel:</b> {v.channel} <b className="ml-3">Locale:</b> {v.locale}
          </div>
          {state.hasExistingPublished && (
            <>
              <div className="flex items-start gap-2">
                <Checkbox
                  id="confirm-replacement"
                  checked={confirmReplacement}
                  onCheckedChange={(c) => setConfirmReplacement(c === true)}
                  data-testid="confirm-replacement"
                />
                <Label htmlFor="confirm-replacement" className="cursor-pointer text-sm">
                  I confirm this will retire the currently published version and publish this one atomically.
                </Label>
              </div>
              <div>
                <Label>Replacement reason (required)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)}
                  rows={3} maxLength={REASON_MAX + 1} data-testid="replacement-reason" />
                <div className="text-xs text-muted-foreground">{REASON_MAX - reason.length} characters remaining</div>
              </div>
            </>
          )}
          {conflict && (
            <Alert variant="destructive" data-testid="publish-conflict">
              <AlertTitle>Replacement confirmation required</AlertTitle>
              <AlertDescription>{conflict}</AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={disabled}
            data-testid="publish-submit"
            onClick={async () => {
              setBusy(true); setConflict(null);
              try {
                const res = await svc.publishTemplateVersion(client, {
                  id: v.id,
                  expectedUpdatedAt: v.updated_at,
                  confirmReplacement,
                  replacementReason: confirmReplacement ? reason.trim() : undefined,
                });
                toast.success(res.replaced_version_id
                  ? `Published. Retired ${res.replaced_version_id.slice(0, 8)}…`
                  : "Published");
                onPublished({ id: res.id, replaced_version_id: res.replaced_version_id });
                onClose();
              } catch (e) {
                if (e instanceof OmniCommsRpcError && e.code === "OC409"
                    && e.detail === "replacement_confirmation_required") {
                  // Controlled conflict — refresh list, do NOT mutate either version.
                  setConflict("Another published version exists. Refresh the list, tick the confirmation box and provide a replacement reason.");
                  onPublished({ id: v.id, replaced_version_id: null });
                } else {
                  toastError(e);
                }
              }
              finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {confirmReplacement ? "Replace and publish" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// ─── Escaped HTML source view helper ─────────────────────────────────────────
function escapeHtmlForDisplay(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}

// ─── Preview tab ─────────────────────────────────────────────────────────────
const PreviewTab: React.FC<{
  version: TemplateVersionGetResult | null;
  canViewSensitive: boolean;
}> = ({ version, canViewSensitive }) => {
  // Synthetic payload lives ONLY in component state — never persisted,
  // never sent to telemetry, never placed in a query cache.
  const [payloadText, setPayloadText] = React.useState('{\n  "name": "Alex"\n}');
  const [showSource, setShowSource] = React.useState(false);
  const [rendered, setRendered] = React.useState<{ ok: true; fields: Record<string, string> } | { ok: false; error: string } | null>(null);

  React.useEffect(() => {
    if (!version) { setRendered(null); return; }
    try {
      const payload = JSON.parse(payloadText);
      const out = renderTemplate(version.channel, version.content, payload);
      setRendered({ ok: true, fields: out.fields });
    } catch (e) {
      setRendered({ ok: false, error: (e as Error).message });
    }
  }, [payloadText, version]);

  if (!version) {
    return (
      <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
        Select a version from the Versions tab to preview it.
      </CardContent></Card>
    );
  }

  const htmlKeys = TEMPLATE_CHANNEL_KEYS[version.channel].html;

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Synthetic payload</CardTitle>
          <CardDescription className="text-xs">
            Never persisted. Held only in this browser tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            rows={16}
            className="font-mono text-xs"
            data-testid="preview-payload"
          />
          <div className="flex items-center gap-2">
            <Checkbox
              id="show-source"
              checked={showSource}
              onCheckedChange={(c) => setShowSource(c === true)}
            />
            <Label htmlFor="show-source" className="text-xs cursor-pointer">
              Show escaped HTML source
            </Label>
          </div>
          {!canViewSensitive && (
            <p className="text-xs text-muted-foreground">
              Payload is local-only. Rendered output may include synthetic values.
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Rendered output</CardTitle>
          <CardDescription className="text-xs">
            {version.channel} · {version.locale} · v{version.version_number}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rendered?.ok === false && (
            <Alert variant="destructive"><AlertDescription>{rendered.error}</AlertDescription></Alert>
          )}
          {rendered?.ok && Object.entries(rendered.fields).map(([field, value]) => {
            const isHtml = htmlKeys.includes(field);
            return (
              <div key={field}>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">{field}</div>
                {isHtml && !showSource ? (
                  <OmniCommsSandboxedPreview html={value} title={`${field} preview`} testId={`preview-iframe-${field}`} />
                ) : (
                  <pre className="text-xs whitespace-pre-wrap break-all bg-muted p-2 rounded" data-testid={`preview-source-${field}`}>
                    {isHtml && showSource ? escapeHtmlForDisplay(value) : value}
                  </pre>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
};

// ─── Scope resolution card ───────────────────────────────────────────────────
const ScopeResolutionCard: React.FC<{
  organizationId: string;
  departments: ActiveDepartmentOption[];
  events: EventDefinitionListItem[];
}> = ({ organizationId, departments, events }) => {
  const client = useOmniCommsRpcClient();
  const [channel, setChannel] = React.useState<TemplateChannel>("email");
  const [locale, setLocale] = React.useState("en-US");
  const [departmentId, setDepartmentId] = React.useState<string | null>(null);
  const [eventId, setEventId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ ok: true; family_code: string; scope_type: string; version_number: number } | { ok: false; error: string } | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Scope resolution preview</CardTitle>
        <CardDescription className="text-xs">
          Simulates omni_comms_template_resolve_published (event → department → organization precedence).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          <Select value={channel} onValueChange={(v) => setChannel(v as TemplateChannel)}>
            <SelectTrigger data-testid="scope-channel"><SelectValue /></SelectTrigger>
            <SelectContent>{TEMPLATE_CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={locale} onChange={(e) => setLocale(e.target.value)} placeholder="Locale" />
          <Select value={departmentId ?? "__none__"} onValueChange={(v) => setDepartmentId(v === "__none__" ? null : v)}>
            <SelectTrigger data-testid="scope-department"><SelectValue placeholder="Department (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(none)</SelectItem>
              {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={eventId ?? "__none__"} onValueChange={(v) => setEventId(v === "__none__" ? null : v)}>
            <SelectTrigger data-testid="scope-event"><SelectValue placeholder="Event (optional)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">(none)</SelectItem>
              {events.map((e) => <SelectItem key={e.id} value={e.id}>{e.code}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button
          size="sm"
          disabled={busy || !organizationId}
          onClick={async () => {
            setBusy(true); setResult(null);
            try {
              const r = await svc.resolvePublishedTemplate(client, {
                organizationId, channel, locale, departmentId, eventDefinitionId: eventId,
              });
              setResult({
                ok: true, family_code: r.family_code, scope_type: r.scope_type,
                version_number: r.version_number,
              });
            } catch (e) {
              setResult({ ok: false, error: friendly(e) });
            }
            finally { setBusy(false); }
          }}
          data-testid="scope-resolve"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Resolve
        </Button>
        {result?.ok && (
          <Alert>
            <AlertTitle>Resolved</AlertTitle>
            <AlertDescription>
              {result.family_code} · scope={result.scope_type} · v{result.version_number}
            </AlertDescription>
          </Alert>
        )}
        {result && result.ok === false && (
          <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert>
        )}
      </CardContent>
    </Card>
  );
};

// ─── Main page ───────────────────────────────────────────────────────────────
export const OmniCommsTemplatesPage: React.FC = () => {
  const client = useOmniCommsRpcClient();
  const perms = useModulePermissions("omni_comms");

  // Denied by default: never allow an action while permissions are loading.
  const can = (a: string) => !perms.isLoading && perms.hasPermission(a);
  const canView = can("view");
  const canConfigure = can("configure");
  const canAuthor = can("author_templates");
  const canApprove = can("approve_templates");
  const canViewSensitive = can("view_sensitive_content");

  const [tab, setTab] = React.useState("library");
  const [families, setFamilies] = React.useState<TemplateFamilyListItem[]>([]);
  const [familiesLoading, setFamiliesLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<TemplateFamilyStatus | "all">("all");
  const [scopeFilter, setScopeFilter] = React.useState<TemplateScopeType | "all">("all");
  const [selectedFamilyId, setSelectedFamilyId] = React.useState<string | null>(null);
  const [selectedFamily, setSelectedFamily] = React.useState<TemplateFamilyGetResult | null>(null);
  const [versions, setVersions] = React.useState<TemplateVersionListItem[]>([]);
  const [versionsLoading, setVersionsLoading] = React.useState(false);
  const [selectedVersion, setSelectedVersion] = React.useState<TemplateVersionGetResult | null>(null);

  // Organisation now comes from the shared Omni-Comms tenant context.
  const { organizationId: tenantOrganizationId } = useOmniCommsTenant();
  const organizationId = tenantOrganizationId ?? "";
  const [departments, setDepartments] = React.useState<ActiveDepartmentOption[]>([]);
  const [events, setEvents] = React.useState<EventDefinitionListItem[]>([]);

  const [familyEditor, setFamilyEditor] = React.useState<FamilyEditorState>({ open: false, mode: "create" });
  const [versionCreate, setVersionCreate] = React.useState(false);
  const [publishState, setPublishState] = React.useState<PublishDialogState>({ open: false, version: null, hasExistingPublished: false });
  const [reasonDialog, setReasonDialog] = React.useState<ReasonDialogState>(CLOSED_REASON);
  const [layoutDialogVersion, setLayoutDialogVersion] =
    React.useState<TemplateVersionGetResult | null>(null);

  // ── Load the event catalogue once ──
  React.useEffect(() => {
    if (!canView) return;
    (async () => {
      try {
        const evs = await ecSvc.listAllEventDefinitionsForPicker(client, { maxItems: 1000 });
        setEvents(evs);
      } catch (pickerErr) {
        // Treat picker load as failed rather than silently presenting an
        // incomplete event catalogue. One friendly toast, no raw SQLSTATE.
        setEvents([]);
        toastError(new Error("Could not load the event catalogue. Try again."));

        console.warn("[omni-comms] event picker load failed", pickerErr);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView]);

  // ── Load departments for the tenant-selected organisation ──
  React.useEffect(() => {
    if (!canView || !organizationId) { setDepartments([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const deps = await listActiveDepartmentsForOrganization(organizationId);
        if (!cancelled) setDepartments(deps.filter((d) => d.isActive));
      } catch (e) {
        if (!cancelled) { setDepartments([]); toastError(e); }
      }
    })();
    return () => { cancelled = true; };
  }, [canView, organizationId]);

  // ── Load families ──
  const reloadFamilies = React.useCallback(async () => {
    if (!canView) return;
    setFamiliesLoading(true);
    try {
      const r = await svc.listTemplateFamilies(client, {
        search: search || null,
        status: statusFilter === "all" ? null : statusFilter,
        scopeType: scopeFilter === "all" ? null : scopeFilter,
        limit: 100,
      });
      setFamilies(r.items);
    } catch (e) { toastError(e); }
    finally { setFamiliesLoading(false); }
  }, [client, search, statusFilter, scopeFilter, canView]);

  React.useEffect(() => { void reloadFamilies(); }, [reloadFamilies]);

  const reloadSelectedFamily = React.useCallback(async (id: string | null) => {
    if (!id) { setSelectedFamily(null); return; }
    try {
      const f = await svc.getTemplateFamily(client, id);
      setSelectedFamily(f);
    } catch (e) { toastError(e); }
  }, [client]);

  const reloadVersions = React.useCallback(async (familyId: string | null) => {
    if (!familyId) { setVersions([]); return; }
    setVersionsLoading(true);
    try {
      const r = await svc.listTemplateVersions(client, { templateFamilyId: familyId, limit: 200 });
      setVersions(r.items);
    } catch (e) { toastError(e); }
    finally { setVersionsLoading(false); }
  }, [client]);

  React.useEffect(() => {
    void reloadSelectedFamily(selectedFamilyId);
    void reloadVersions(selectedFamilyId);
    setSelectedVersion(null);
  }, [selectedFamilyId, reloadSelectedFamily, reloadVersions]);

  if (!canView) {
    return (
      <Card>
        <CardContent className="py-16 flex flex-col items-center gap-2">
          <ShieldAlert className="h-8 w-8 text-muted-foreground" />
          <div className="font-semibold">Templates are not available</div>
          <div className="text-sm text-muted-foreground">Requires the omni_comms.view capability.</div>
        </CardContent>
      </Card>
    );
  }

  const nextVersionNumber = versions.reduce((m, v) => Math.max(m, v.version_number), 0) + 1;

  const openPublishDialog = async (versionId: string) => {
    try {
      const v = await svc.getTemplateVersion(client, versionId);
      const hasExisting = versions.some(
        (x) => x.channel === v.channel && x.locale === v.locale && x.status === "published" && x.id !== v.id,
      );
      setPublishState({ open: true, version: v, hasExistingPublished: hasExisting });
    } catch (e) { toastError(e); }
  };

  /** Open the layout configuration dialog for one draft version. */
  const openLayoutDialog = async (versionId: string) => {
    try {
      const v = await svc.getTemplateVersion(client, versionId);
      setLayoutDialogVersion(v);
    } catch (e) { toastError(e); }
  };

  /**
   * Approval is gated in the UI by the persisted layout selection so the
   * administrator is never sent into an unavoidable server rejection. The
   * database remains the final authority.
   */
  const startApproval = (versionId: string) => {
    const row = versions.find((v) => v.id === versionId);
    if (row && !isLayoutSelectionApprovable(row)) {
      toast.error(LAYOUT_REQUIRED_MESSAGE);
      return;
    }
    setReasonDialog({
      open: true, required: false,
      title: "Approve version",
      description: "Approval is recorded with your identity. A note is optional.",
      submitLabel: "Approve",
      onSubmit: async (note) => {
        try {
          await svc.approveTemplateVersion(client, { id: versionId, approvalNote: note || null });
          toast.success("Approved");
          await reloadVersions(selectedFamilyId);
        } catch (e) {
          const mapped = e instanceof OmniCommsRpcError ? mapLayoutErrorDetail(e.detail) : null;
          if (mapped) { toast.error(mapped); await reloadVersions(selectedFamilyId); return; }
          throw e;
        }
      },
    });
  };


  return (
    <div className="space-y-4" data-testid="omni-comms-templates-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-muted-foreground">Omnichannel Communications — Story 3 Template Catalogue.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {!canConfigure && <CapabilityDeniedInline capability="omni_comms.configure" />}
          {!canAuthor && <CapabilityDeniedInline capability="omni_comms.author_templates" />}
          {!canApprove && <CapabilityDeniedInline capability="omni_comms.approve_templates" />}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4">
          <OmniCommsTenantSelector />
          {!organizationId && (
            <p className="mt-2 text-xs text-muted-foreground">
              Select an organisation to enable scope resolution, assembly and
              department-scoped template creation.
            </p>
          )}
        </CardContent>
      </Card>



      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="library" data-testid="tab-library">Library</TabsTrigger>
          <TabsTrigger value="versions" data-testid="tab-versions" disabled={!selectedFamilyId}>
            Versions{selectedFamily ? ` · ${selectedFamily.code}` : ""}
          </TabsTrigger>
          <TabsTrigger value="preview" data-testid="tab-preview" disabled={!selectedVersion}>Preview</TabsTrigger>
          <TabsTrigger value="assembly" data-testid="tab-assembly">Assembly</TabsTrigger>
        </TabsList>

        {/* ── Library ── */}
        <TabsContent value="library" className="space-y-3">
          <div className="flex items-center gap-2">
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as typeof scopeFilter)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="organization">Organization</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => reloadFamilies()} data-testid="reload-families">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
            <Button
              disabled={!canConfigure}
              onClick={() => setFamilyEditor({ open: true, mode: "create" })}
              data-testid="new-family"
            >
              <Plus className="h-4 w-4 mr-1" />New family
            </Button>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead><TableHead>Name</TableHead>
                  <TableHead>Scope</TableHead><TableHead>Status</TableHead>
                  <TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {familiesLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                  </TableCell></TableRow>
                )}
                {!familiesLoading && families.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-6 text-sm text-muted-foreground">
                    No families found.
                  </TableCell></TableRow>
                )}
                {families.map((f) => (
                  <TableRow key={f.id} data-testid={`family-row-${f.code}`}>
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell>{f.name}</TableCell>
                    <TableCell><Badge variant="outline">{f.scope_type}</Badge></TableCell>
                    <TableCell><FamilyStatusBadge s={f.status} /></TableCell>
                    <TableCell className="text-xs">{new Date(f.updated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost" onClick={() => { setSelectedFamilyId(f.id); setTab("versions"); }}>
                        Open
                      </Button>
                      <Button size="sm" variant="ghost" disabled={!canConfigure}
                        onClick={async () => {
                          try {
                            const full = await svc.getTemplateFamily(client, f.id);
                            setFamilyEditor({ open: true, mode: "edit", initial: full });
                          } catch (e) { toastError(e); }
                        }}>Edit</Button>
                      {f.status === "draft" && (
                        <Button size="sm" variant="ghost" disabled={!canConfigure}
                          onClick={() => setReasonDialog({
                            open: true, required: false,
                            title: "Activate family", description: "Reason is optional.",
                            submitLabel: "Activate",
                            onSubmit: async (reason) => {
                              await svc.activateTemplateFamily(client, { id: f.id, reason: reason || null });
                              toast.success("Activated"); await reloadFamilies();
                            },
                          })}>Activate</Button>
                      )}
                      {f.status !== "retired" && (
                        <Button size="sm" variant="ghost" disabled={!canConfigure}
                          onClick={() => setReasonDialog({
                            open: true, required: true,
                            title: "Retire family", description: "Retirement is permanent; reason required.",
                            submitLabel: "Retire",
                            onSubmit: async (reason) => {
                              await svc.retireTemplateFamily(client, { id: f.id, reason });
                              toast.success("Retired"); await reloadFamilies();
                            },
                          })}>Retire</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <ScopeResolutionCard organizationId={organizationId} departments={departments} events={events} />
        </TabsContent>

        {/* ── Versions ── */}
        <TabsContent value="versions" className="space-y-3">
          {selectedFamily && (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">Family</div>
                <div className="font-mono">{selectedFamily.code}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => reloadVersions(selectedFamilyId)}>
                  <RefreshCw className="h-4 w-4 mr-1" />Reload
                </Button>
                <Button
                  disabled={!canAuthor || selectedFamily.status === "retired"}
                  onClick={() => setVersionCreate(true)}
                  data-testid="new-version"
                >
                  <Plus className="h-4 w-4 mr-1" />New draft
                </Button>
              </div>
            </div>
          )}
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead><TableHead>Channel</TableHead><TableHead>Locale</TableHead>
                  <TableHead>Status</TableHead><TableHead>Layout</TableHead><TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {versionsLoading && (
                  <TableRow><TableCell colSpan={7} className="text-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading…
                  </TableCell></TableRow>
                )}
                {!versionsLoading && versions.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center py-6 text-sm text-muted-foreground">
                    No versions yet.
                  </TableCell></TableRow>
                )}
                {versions.map((v) => {
                  const layout = describeLayoutSelection(v);
                  const layoutReady = isLayoutSelectionApprovable(v);
                  return (
                  <TableRow key={v.id} data-testid={`version-row-${v.id}`}>
                    <TableCell>v{v.version_number}</TableCell>
                    <TableCell>{v.channel}</TableCell>
                    <TableCell>{v.locale}</TableCell>
                    <TableCell><VersionStatusBadge s={v.status} /></TableCell>
                    <TableCell data-testid={`version-layout-${v.id}`}>
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-xs">{layout.label}</span>
                        {v.status === "draft" && !layoutReady && (
                          <Badge variant="destructive" data-testid={`layout-required-${v.id}`}>
                            {LAYOUT_REQUIRED_BADGE}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{new Date(v.updated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button size="sm" variant="ghost"
                        onClick={async () => {
                          try {
                            const full = await svc.getTemplateVersion(client, v.id);
                            setSelectedVersion(full); setTab("preview");
                          } catch (e) { toastError(e); }
                        }}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      {v.status === "draft" && (
                        <Button size="sm" variant="outline" disabled={!canAuthor}
                          data-testid={`configure-layout-btn-${v.id}`}
                          onClick={() => openLayoutDialog(v.id)}>
                          Configure Layout
                        </Button>
                      )}
                      {v.status === "approved" && (
                        <Button size="sm" disabled={!canApprove}
                          data-testid={`publish-btn-${v.id}`}
                          onClick={() => openPublishDialog(v.id)}>Publish</Button>
                      )}
                      {v.status === "draft" && (
                        <Button size="sm" variant="ghost"
                          disabled={!canApprove || !layoutReady}
                          data-testid={`approve-btn-${v.id}`}
                          title={layoutReady ? undefined : LAYOUT_REQUIRED_MESSAGE}
                          onClick={() => startApproval(v.id)}>Approve</Button>
                      )}
                      {(v.status === "approved" || v.status === "published") && (
                        <Button size="sm" variant="ghost" disabled={!canApprove}
                          onClick={() => setReasonDialog({
                            open: true, required: true,
                            title: "Retire version",
                            description: "Retirement is permanent; reason required.",
                            submitLabel: "Retire",
                            onSubmit: async (reason) => {
                              await svc.retireTemplateVersion(client, { id: v.id, reason });
                              toast.success("Retired"); await reloadVersions(selectedFamilyId);
                            },
                          })}>Retire</Button>
                      )}
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
          {versions.some((v) => v.status === "draft" && !isLayoutSelectionApprovable(v)) && (
            <Alert variant="destructive" data-testid="layout-required-alert">
              <AlertTitle>Layout selection required</AlertTitle>
              <AlertDescription>
                {LAYOUT_REQUIRED_MESSAGE} Use <strong>Configure Layout</strong> on the
                draft version, save the selection, then approve.
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        {/* ── Preview ── */}
        <TabsContent value="preview">
          <PreviewTab version={selectedVersion} canViewSensitive={canViewSensitive} />
        </TabsContent>

        {/* ── Assembly (Build 1 shared assets) ── */}
        <TabsContent value="assembly">
          <OmniCommsAssemblyTab organizationId={organizationId} departments={departments} families={families} />
        </TabsContent>
      </Tabs>

      <FamilyEditor
        state={familyEditor}
        onClose={() => setFamilyEditor({ open: false, mode: "create" })}
        onSaved={() => reloadFamilies()}
        events={events}
        organizationId={organizationId}
        departments={departments}
      />
      {selectedFamilyId && (
        <VersionCreateDialog
          open={versionCreate}
          onClose={() => setVersionCreate(false)}
          onSaved={() => reloadVersions(selectedFamilyId)}
          familyId={selectedFamilyId}
          nextVersionNumber={nextVersionNumber}
        />
      )}
      <PublishDialog
        state={publishState}
        onClose={() => setPublishState({ open: false, version: null, hasExistingPublished: false })}
        onPublished={() => { void reloadVersions(selectedFamilyId); }}
      />
      <ReasonDialog
        state={reasonDialog}
        onOpenChange={(o) => setReasonDialog((s) => ({ ...s, open: o }))}
      />
    </div>
  );
};

export default OmniCommsTemplatesPage;
