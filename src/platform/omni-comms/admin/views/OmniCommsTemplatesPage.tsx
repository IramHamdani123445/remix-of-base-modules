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
import {
  OMNI_COMMS_TEMPLATE_TABS,
  useOmniCommsTabParam,
} from "../hooks/useOmniCommsTabParam";
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
import { OmniCommsScopeSelector } from "../components/OmniCommsScopeSelector";
import { useModulePermissions } from "@/hooks/useNavigationMenu";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { createCommunicationAction } from "@/platform/omni-comms/application/businessCatalogueAdminService";
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
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2, ShieldAlert, Plus, RefreshCw, Eye, Pencil, CheckCircle2, Archive,
  FolderOpen, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, LayoutTemplate, Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  PAGE_SIZE_OPTIONS, buildSamplePayload, paginate, sortRows, toggleSort,
  type SortState,
} from "./templateTableUtils";
import { OmniCommsAssemblyTab } from "./OmniCommsAssemblyTab";
import { getTemplateBusinessCatalogue } from "@/platform/omni-comms/application/businessTemplateCatalogueService";
import {
  filterCatalogue,
  moduleOptions,
  businessObjectOptions,
  CATALOGUE_CHANNEL_ORDER,
  CHANNEL_LABEL,
  type CatalogueAction,
  type CompletenessFilter,
  type TemplateBusinessCatalogue,
} from "@/platform/omni-comms/domain/templateBusinessCatalogue";
import TemplateBusinessCatalogueView from "./templates/TemplateBusinessCatalogue";
import TemplateChannelWorkspace from "./templates/TemplateChannelWorkspace";
import TemplateAuthoringWorkspace from "./templates/TemplateAuthoringWorkspace";
import TemplatePreviewPanel from "./templates/TemplatePreviewPanel";
import { OmniCommsPreviewShell } from "../components/OmniCommsPreviewShell";
import { createNextTemplateDraft } from "@/platform/omni-comms/application/templateDraftService";
import { editAffordanceFor } from "@/platform/omni-comms/domain/templateAuthoring";
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
          <DialogTitle>{isEdit ? "Edit template family" : "New communication action"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the name or description. Scope, code and ownership are immutable."
              : "A communication action is one business communication. It owns every channel template and keeps its identity across scope overrides."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Code</Label>
            <Input
              value={code}
              disabled={isEdit}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="CLAIM_APPROVAL_NOTICE"
              className="font-mono"
              data-testid="family-code"
            />
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
                  // Governed identity: the action owns its channel templates
                  // and survives department/organisation overrides.
                  await createCommunicationAction(client, {
                    organizationId,
                    code: code.trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
                    name: name.trim(),
                    description: description.trim() || null,
                    scopeType,
                    departmentId: scopeType === "department" ? departmentId : null,
                    eventDefinitionId: scopeType === "event" ? eventDefinitionId : null,
                  });
                  toast.success("Communication action created");
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

// ─── Add channel content dialog (no manual version numbers) ─────────────────
const VersionCreateDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Receives the draft allocated by the server so the editor can open it. */
  onCreated: (versionId: string) => void | Promise<void>;
  familyId: string;
  /** Preselected channel when opened from the channel workspace. */
  presetChannel?: TemplateChannel | null;
}> = ({ open, onClose, onCreated, familyId, presetChannel }) => {
  const client = useOmniCommsRpcClient();
  const [busy, setBusy] = React.useState(false);
  const [channel, setChannel] = React.useState<TemplateChannel>(presetChannel ?? "email");
  const [locale, setLocale] = React.useState("en-US");
  // The administrator already chose the channel by clicking it — never ask again.
  React.useEffect(() => {
    if (open && presetChannel) setChannel(presetChannel);
  }, [open, presetChannel]);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add channel content</DialogTitle>
          <DialogDescription>
            A draft is created for this channel and locale. The version number is
            allocated by the server — you never choose it.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy}
            data-testid="version-save"
            onClick={async () => {
              setBusy(true);
              try {
                const res = await createNextTemplateDraft(client, {
                  templateFamilyId: familyId, channel, locale,
                });
                toast.success(res.reused_existing_draft
                  ? `Opened existing draft v${res.version_number}`
                  : `Draft v${res.version_number} created`);
                await onCreated(res.id);
                onClose();
              } catch (e) { toastError(e); }
              finally { setBusy(false); }
            }}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Open editor
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

// ─── Shared table primitives (icon actions, sorting, paging) ─────────────────
const IconAction: React.FC<{
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: "ghost" | "outline" | "default";
  testId?: string;
  tone?: "default" | "destructive";
}> = ({ label, icon, onClick, disabled, variant = "ghost", testId, tone = "default" }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex">
        <Button
          size="icon"
          variant={variant}
          className={`h-8 w-8 ${tone === "destructive" ? "text-destructive hover:text-destructive" : ""}`}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          data-testid={testId}
        >
          {icon}
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{label}</TooltipContent>
  </Tooltip>
);

function SortHead<K extends string>({
  label, sortKey, sort, onSort, className,
}: {
  label: string; sortKey: K; sort: SortState<K>;
  onSort: (key: K) => void; className?: string;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 hover:text-foreground"
        aria-label={`Sort by ${label}`}
        data-testid={`sort-${sortKey}`}
      >
        {label}
        <Icon className={`h-3.5 w-3.5 ${active ? "text-foreground" : "text-muted-foreground"}`} />
      </button>
    </TableHead>
  );
}

const TablePager: React.FC<{
  page: number; pageCount: number; from: number; to: number; total: number;
  pageSize: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
  testId?: string;
}> = ({ page, pageCount, from, to, total, pageSize, onPage, onPageSize, testId }) => (
  <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-t" data-testid={testId}>
    <div className="text-xs text-muted-foreground">
      {total === 0 ? "No rows" : `Showing ${from}–${to} of ${total}`}
    </div>
    <div className="flex items-center gap-2">
      <Select value={String(pageSize)} onValueChange={(v) => { onPageSize(Number(v)); onPage(1); }}>
        <SelectTrigger className="h-8 w-[110px]" aria-label="Rows per page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((s) => (
            <SelectItem key={s} value={String(s)}>{s} / page</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-xs text-muted-foreground">Page {page} of {pageCount}</span>
      <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} aria-label="First page" onClick={() => onPage(1)}>
        <ChevronsLeft className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="outline" className="h-8 w-8" disabled={page <= 1} aria-label="Previous page" onClick={() => onPage(page - 1)}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= pageCount} aria-label="Next page" onClick={() => onPage(page + 1)}>
        <ChevronRight className="h-4 w-4" />
      </Button>
      <Button size="icon" variant="outline" className="h-8 w-8" disabled={page >= pageCount} aria-label="Last page" onClick={() => onPage(pageCount)}>
        <ChevronsRight className="h-4 w-4" />
      </Button>
    </div>
  </div>
);

// ─── Quick preview dialog (see the letter without leaving the Library) ───────
const QuickPreviewDialog: React.FC<{
  family: TemplateFamilyListItem | null;
  onClose: () => void;
}> = ({ family, onClose }) => {
  const client = useOmniCommsRpcClient();
  const [loading, setLoading] = React.useState(false);
  const [versionRows, setVersionRows] = React.useState<TemplateVersionListItem[]>([]);
  const [current, setCurrent] = React.useState<TemplateVersionGetResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadVersion = React.useCallback(async (id: string) => {
    setLoading(true); setError(null);
    try { setCurrent(await svc.getTemplateVersion(client, id)); }
    catch (e) { setError(friendly(e)); setCurrent(null); }
    finally { setLoading(false); }
  }, [client]);

  React.useEffect(() => {
    if (!family) { setVersionRows([]); setCurrent(null); setError(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const r = await svc.listTemplateVersions(client, { templateFamilyId: family.id, limit: 200 });
        if (cancelled) return;
        setVersionRows(r.items);
        const rank = (s: TemplateVersionStatus) =>
          s === "published" ? 0 : s === "approved" ? 1 : s === "draft" ? 2 : 3;
        const best = [...r.items].sort(
          (a, b) => rank(a.status) - rank(b.status) || b.version_number - a.version_number,
        )[0];
        if (best) await loadVersion(best.id);
        else { setCurrent(null); setError("This family has no versions yet."); }
      } catch (e) {
        if (!cancelled) setError(friendly(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [family, client, loadVersion]);

  const rendered = React.useMemo(() => {
    if (!current) return null;
    try {
      const out = renderTemplate(current.channel, current.content, buildSamplePayload(current.content));
      return { ok: true as const, fields: out.fields };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [current]);

  const htmlKeys = current ? TEMPLATE_CHANNEL_KEYS[current.channel].html : [];

  return (
    <OmniCommsPreviewShell
      open={family !== null}
      onOpenChange={(o) => !o && onClose()}
      title={<span className="font-mono text-base">{family?.code}</span>}
      description={`${family?.name ?? ""} — rendered with placeholder values. Nothing is sent or saved.`}
      testId="quick-preview-dialog"
    >
      <div className="min-w-0 space-y-3">

        {versionRows.length > 1 && (
          <Select
            value={current?.id ?? ""}
            onValueChange={(v) => { void loadVersion(v); }}
          >
            <SelectTrigger className="w-72" aria-label="Version">
              <SelectValue placeholder="Select a version" />
            </SelectTrigger>
            <SelectContent>
              {versionRows.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  v{v.version_number} · {v.channel} · {v.locale} · {v.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {loading && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin inline mr-2" />Loading template…
          </div>
        )}
        {!loading && error && (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        )}
        {!loading && rendered?.ok === false && (
          <Alert variant="destructive">
            <AlertTitle>Template could not be rendered</AlertTitle>
            <AlertDescription>{rendered.error}</AlertDescription>
          </Alert>
        )}
        {!loading && rendered?.ok && Object.entries(rendered.fields).map(([field, value]) => (
          <div key={field} className="space-y-1">
            <div className="text-xs font-semibold uppercase text-muted-foreground">{field}</div>
            {htmlKeys.includes(field) ? (
              <OmniCommsSandboxedPreview html={value} title={`${field} preview`} testId={`quick-preview-${field}`} />
            ) : (
              <pre className="text-xs whitespace-pre-wrap break-words bg-muted p-2 rounded">{value}</pre>
            )}
          </div>
        ))}
      </div>
    </OmniCommsPreviewShell>
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

  // URL-controlled: /admin/omnichannel-communications/templates?tab=catalogue|flat
  const [tab, setTab] = useOmniCommsTabParam(OMNI_COMMS_TEMPLATE_TABS, "catalogue");
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
  const [editingVersion, setEditingVersion] = React.useState<TemplateVersionGetResult | null>(null);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [publishState, setPublishState] = React.useState<PublishDialogState>({ open: false, version: null, hasExistingPublished: false });
  const [reasonDialog, setReasonDialog] = React.useState<ReasonDialogState>(CLOSED_REASON);
  const [layoutDialogVersion, setLayoutDialogVersion] =
    React.useState<TemplateVersionGetResult | null>(null);
  const [quickPreviewFamily, setQuickPreviewFamily] =
    React.useState<TemplateFamilyListItem | null>(null);

  // Table presentation state — sorting and paging for both tables.
  type FamilySortKey = "code" | "name" | "scope_type" | "status" | "updated_at";
  const [familySort, setFamilySort] =
    React.useState<SortState<FamilySortKey>>({ key: "updated_at", direction: "desc" });
  const [familyPage, setFamilyPage] = React.useState(1);
  const [familyPageSize, setFamilyPageSize] = React.useState(25);

  type VersionSortKey = "version_number" | "channel" | "locale" | "status" | "updated_at";
  const [versionSort, setVersionSort] =
    React.useState<SortState<VersionSortKey>>({ key: "version_number", direction: "desc" });
  const [versionPage, setVersionPage] = React.useState(1);
  const [versionPageSize, setVersionPageSize] = React.useState(25);

  // ── Business catalogue (module → object → event → action → channels) ──
  const [catalogue, setCatalogue] = React.useState<TemplateBusinessCatalogue>({
    modules: [], shared: [],
  });
  const [catalogueLoading, setCatalogueLoading] = React.useState(false);
  const [moduleFilter, setModuleFilter] = React.useState<string>("all");
  const [objectFilter, setObjectFilter] = React.useState<string>("all");
  const [channelFilter, setChannelFilter] = React.useState<string>("all");
  const [completeness, setCompleteness] = React.useState<CompletenessFilter>("all");
  const [workspaceAction, setWorkspaceAction] = React.useState<CatalogueAction | null>(null);
  const [workspaceEventName, setWorkspaceEventName] = React.useState<string | null>(null);
  const [workspaceChannel, setWorkspaceChannel] = React.useState<TemplateChannel>("email");
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [finalPreviewOpen, setFinalPreviewOpen] = React.useState(false);



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
        limit: 500,
      });
      setFamilies(r.items);
    } catch (e) { toastError(e); }
    finally { setFamiliesLoading(false); }
  }, [client, search, statusFilter, scopeFilter, canView]);

  React.useEffect(() => { void reloadFamilies(); }, [reloadFamilies]);

  // ── Load the governed business catalogue ──
  const reloadCatalogue = React.useCallback(async () => {
    if (!canView) return;
    setCatalogueLoading(true);
    try {
      const c = await getTemplateBusinessCatalogue(client, organizationId || null);
      setCatalogue({ modules: c.modules ?? [], shared: c.shared ?? [] });
    } catch (e) { toastError(e); }
    finally { setCatalogueLoading(false); }
  }, [client, canView, organizationId]);

  React.useEffect(() => { void reloadCatalogue(); }, [reloadCatalogue]);


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

  /** Open one version for authoring, honouring its lifecycle. */
  const openVersionForEditing = React.useCallback(async (
    versionId: string,
    status: TemplateVersionStatus,
    channel: TemplateChannel,
    locale: string,
  ) => {
    try {
      const affordance = editAffordanceFor(status);
      let targetId = versionId;
      if (affordance.kind === "new_draft_from_published" && selectedFamilyId) {
        const draft = await createNextTemplateDraft(client, {
          templateFamilyId: selectedFamilyId, channel, locale,
        });
        targetId = draft.id;
        toast.success(draft.reused_existing_draft
          ? `Opened existing draft v${draft.version_number}`
          : `Draft v${draft.version_number} created from v${draft.source_version_id ? "published" : "scratch"}`);
        await reloadVersions(selectedFamilyId);
      }
      setEditingVersion(await svc.getTemplateVersion(client, targetId));
    } catch (e) { toastError(e); }
  }, [client, selectedFamilyId, reloadVersions]);

  /** Primary "Edit <channel>" action — the server allocates or reuses the draft. */
  const startChannelEditing = React.useCallback(async (
    channel: TemplateChannel, locale: string,
  ) => {
    if (!selectedFamilyId) return;
    try {
      const draft = await createNextTemplateDraft(client, {
        templateFamilyId: selectedFamilyId, channel, locale,
      });
      setEditingVersion(await svc.getTemplateVersion(client, draft.id));
      await reloadVersions(selectedFamilyId);
      await reloadCatalogue();
    } catch (e) { toastError(e); }
  }, [client, selectedFamilyId, reloadVersions, reloadCatalogue]);

  const saveEditingDraft = React.useCallback(async (content: Record<string, string>) => {
    if (!editingVersion) return;
    setSavingDraft(true);
    try {
      await svc.updateTemplateVersion(client, {
        id: editingVersion.id,
        content,
        expectedUpdatedAt: editingVersion.updated_at,
      });
      setEditingVersion(await svc.getTemplateVersion(client, editingVersion.id));
      await reloadVersions(selectedFamilyId);
      toast.success("Draft saved");
    } catch (e) { toastError(e); }
    finally { setSavingDraft(false); }
  }, [client, editingVersion, reloadVersions, selectedFamilyId]);

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


  // Sorting + paging are applied to the loaded, filtered result set.
  const familyPageSlice = paginate(
    sortRows(families, familySort, (row, key) =>
      key === "updated_at" ? Date.parse(row.updated_at) : (row[key] as string)),
    familyPage,
    familyPageSize,
  );
  const versionPageSlice = paginate(
    sortRows(versions, versionSort, (row, key) =>
      key === "updated_at" ? Date.parse(row.updated_at)
        : key === "version_number" ? row.version_number
        : (row[key] as string)),
    versionPage,
    versionPageSize,
  );

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
    <TooltipProvider delayDuration={200}>
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
          <OmniCommsScopeSelector />
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
          <TabsTrigger value="catalogue" data-testid="tab-catalogue">
            Business catalogue
          </TabsTrigger>
          <TabsTrigger value="flat" data-testid="tab-flat">
            Technical (flat) view
          </TabsTrigger>
        </TabsList>

        {/* ── Business catalogue: module → object → event → action → channels ── */}
        <TabsContent value="catalogue" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search events, actions or codes…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-xs"
              data-testid="catalogue-search"
            />
            <Select value={moduleFilter} onValueChange={(v) => { setModuleFilter(v); setObjectFilter("all"); }}>
              <SelectTrigger className="w-44" data-testid="catalogue-module-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All modules</SelectItem>
                {moduleOptions(catalogue).map((m) => (
                  <SelectItem key={m.code} value={m.code}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={objectFilter} onValueChange={setObjectFilter}>
              <SelectTrigger className="w-48" data-testid="catalogue-object-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All business objects</SelectItem>
                {businessObjectOptions(catalogue, moduleFilter === "all" ? null : moduleFilter).map((b) => (
                  <SelectItem key={b.code} value={b.code}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="w-36" data-testid="catalogue-channel-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                {CATALOGUE_CHANNEL_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>{CHANNEL_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={completeness} onValueChange={(v) => setCompleteness(v as CompletenessFilter)}>
              <SelectTrigger className="w-40" data-testid="catalogue-completeness-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any completeness</SelectItem>
                <SelectItem value="configured">Configured</SelectItem>
                <SelectItem value="missing">Missing</SelectItem>
              </SelectContent>
            </Select>
            <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as typeof scopeFilter)}>
              <SelectTrigger className="w-40" data-testid="catalogue-scope-filter"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All scopes</SelectItem>
                <SelectItem value="organization">Organisation</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="event">Event</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => reloadCatalogue()} data-testid="reload-catalogue">
              <RefreshCw className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
            <Button
              disabled={!canConfigure}
              onClick={() => setFamilyEditor({ open: true, mode: "create" })}
              data-testid="new-family-catalogue"
            >
              <Plus className="mr-1 h-4 w-4" />New communication action
            </Button>
          </div>

          {workspaceAction && editingVersion && (
            <TemplateAuthoringWorkspace
              contextTrail={[workspaceEventName ?? "", workspaceAction.name]}
              version={editingVersion}
              canAuthor={canAuthor}
              saving={savingDraft}
              onSave={saveEditingDraft}
              onClose={() => setEditingVersion(null)}
              onConfigureLayout={() => void openLayoutDialog(editingVersion.id)}
            />
          )}

          {workspaceAction && !editingVersion && (
            <TemplateChannelWorkspace
              action={workspaceAction}
              eventName={workspaceEventName}
              versions={versions}
              loading={versionsLoading}
              channel={workspaceChannel}
              onSelectChannel={setWorkspaceChannel}
              onClose={() => { setWorkspaceAction(null); setSelectedFamilyId(null); }}
              canAuthor={canAuthor}
              canApprove={canApprove}
              onStartEditing={(c, l) => { setWorkspaceChannel(c); void startChannelEditing(c, l); }}
              onEditVersion={(v) => { void openVersionForEditing(v.id, v.status, v.channel, v.locale); }}
              onPreviewVersion={async (id) => {
                try {
                  const full = await svc.getTemplateVersion(client, id);
                  setSelectedVersion(full); setPreviewOpen(true);
                } catch (e) { toastError(e); }
              }}
              onConfigureLayout={(id) => void openLayoutDialog(id)}
              onApproveVersion={(id) => startApproval(id)}
              onPublishVersion={(id) => void openPublishDialog(id)}
              onRetireVersion={(id) => setReasonDialog({
                open: true, required: true,
                title: "Retire version",
                description: "Retirement is permanent; reason required.",
                submitLabel: "Retire",
                onSubmit: async (reason) => {
                  await svc.retireTemplateVersion(client, { id, reason });
                  toast.success("Retired");
                  await reloadVersions(selectedFamilyId);
                  await reloadCatalogue();
                },
              })}
              onPreviewFinal={() => setFinalPreviewOpen(true)}
            />
          )}

          <TemplateBusinessCatalogueView
            catalogue={filterCatalogue(catalogue, {
              search,
              moduleCode: moduleFilter === "all" ? null : moduleFilter,
              businessObjectCode: objectFilter === "all" ? null : objectFilter,
              channel: channelFilter === "all" ? null : (channelFilter as TemplateChannel),
              scopeType: scopeFilter === "all" ? null : scopeFilter,
              status: statusFilter === "all" ? null : statusFilter,
              completeness,
            })}
            loading={catalogueLoading}
            onOpenChannel={(action, channel) => {
              setWorkspaceAction(action);
              setWorkspaceChannel(channel);
              setWorkspaceEventName(
                catalogue.modules
                  .flatMap((m) => m.business_objects)
                  .flatMap((b) => b.events)
                  .find((ev) => ev.actions.some((a) => a.id === action.id))?.name ?? null,
              );
              setSelectedFamilyId(action.id);
            }}
          />
        </TabsContent>

        {/* ── Technical / flat view (engineering & support) ── */}
        <TabsContent value="flat" className="space-y-3">
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
                  <SortHead label="Code" sortKey="code" sort={familySort} onSort={(k) => { setFamilySort((s) => toggleSort(s, k)); setFamilyPage(1); }} />
                  <SortHead label="Name" sortKey="name" sort={familySort} onSort={(k) => { setFamilySort((s) => toggleSort(s, k)); setFamilyPage(1); }} />
                  <SortHead label="Scope" sortKey="scope_type" sort={familySort} onSort={(k) => { setFamilySort((s) => toggleSort(s, k)); setFamilyPage(1); }} />
                  <SortHead label="Status" sortKey="status" sort={familySort} onSort={(k) => { setFamilySort((s) => toggleSort(s, k)); setFamilyPage(1); }} />
                  <SortHead label="Updated" sortKey="updated_at" sort={familySort} onSort={(k) => { setFamilySort((s) => toggleSort(s, k)); setFamilyPage(1); }} />
                  <TableHead className="text-right">Actions</TableHead>
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
                {familyPageSlice.rows.map((f) => (
                  <TableRow key={f.id} data-testid={`family-row-${f.code}`}>
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell>{f.name}</TableCell>
                    <TableCell><Badge variant="outline">{f.scope_type}</Badge></TableCell>
                    <TableCell><FamilyStatusBadge s={f.status} /></TableCell>
                    <TableCell className="text-xs">{new Date(f.updated_at).toLocaleString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconAction
                          label="Preview template"
                          testId={`family-preview-${f.code}`}
                          icon={<Eye className="h-4 w-4" />}
                          onClick={() => setQuickPreviewFamily(f)}
                        />
                        <IconAction
                          label="Open versions"
                          testId={`family-open-${f.code}`}
                          icon={<FolderOpen className="h-4 w-4" />}
                          onClick={() => { setSelectedFamilyId(f.id); setTab("versions"); }}
                        />
                        <IconAction
                          label="Edit family"
                          testId={`family-edit-${f.code}`}
                          icon={<Pencil className="h-4 w-4" />}
                          disabled={!canConfigure}
                          onClick={async () => {
                            try {
                              const full = await svc.getTemplateFamily(client, f.id);
                              setFamilyEditor({ open: true, mode: "edit", initial: full });
                            } catch (e) { toastError(e); }
                          }}
                        />
                        {f.status === "draft" && (
                          <IconAction
                            label="Activate family"
                            testId={`family-activate-${f.code}`}
                            icon={<CheckCircle2 className="h-4 w-4" />}
                            disabled={!canConfigure}
                            onClick={() => setReasonDialog({
                              open: true, required: false,
                              title: "Activate family", description: "Reason is optional.",
                              submitLabel: "Activate",
                              onSubmit: async (reason) => {
                                await svc.activateTemplateFamily(client, { id: f.id, reason: reason || null });
                                toast.success("Activated"); await reloadFamilies();
                              },
                            })}
                          />
                        )}
                        {f.status !== "retired" && (
                          <IconAction
                            label="Retire family"
                            testId={`family-retire-${f.code}`}
                            tone="destructive"
                            icon={<Archive className="h-4 w-4" />}
                            disabled={!canConfigure}
                            onClick={() => setReasonDialog({
                              open: true, required: true,
                              title: "Retire family", description: "Retirement is permanent; reason required.",
                              submitLabel: "Retire",
                              onSubmit: async (reason) => {
                                await svc.retireTemplateFamily(client, { id: f.id, reason });
                                toast.success("Retired"); await reloadFamilies();
                              },
                            })}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <TablePager
              testId="family-pager"
              page={familyPageSlice.page}
              pageCount={familyPageSlice.pageCount}
              from={familyPageSlice.from}
              to={familyPageSlice.to}
              total={familyPageSlice.total}
              pageSize={familyPageSize}
              onPage={setFamilyPage}
              onPageSize={setFamilyPageSize}
            />
          </Card>
          <ScopeResolutionCard organizationId={organizationId} departments={departments} events={events} />

          {/* Channel-agnostic version table — engineering/support only. */}
          <div className="space-y-3">
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
                  <SortHead label="#" sortKey="version_number" sort={versionSort} onSort={(k) => { setVersionSort((s) => toggleSort(s, k)); setVersionPage(1); }} />
                  <SortHead label="Channel" sortKey="channel" sort={versionSort} onSort={(k) => { setVersionSort((s) => toggleSort(s, k)); setVersionPage(1); }} />
                  <SortHead label="Locale" sortKey="locale" sort={versionSort} onSort={(k) => { setVersionSort((s) => toggleSort(s, k)); setVersionPage(1); }} />
                  <SortHead label="Status" sortKey="status" sort={versionSort} onSort={(k) => { setVersionSort((s) => toggleSort(s, k)); setVersionPage(1); }} />
                  <TableHead>Layout</TableHead>
                  <SortHead label="Updated" sortKey="updated_at" sort={versionSort} onSort={(k) => { setVersionSort((s) => toggleSort(s, k)); setVersionPage(1); }} />
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
                {versionPageSlice.rows.map((v) => {
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
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <IconAction
                          label="Preview rendered output"
                          testId={`version-preview-${v.id}`}
                          icon={<Eye className="h-4 w-4" />}
                          onClick={async () => {
                            try {
                              const full = await svc.getTemplateVersion(client, v.id);
                              setSelectedVersion(full); setTab("preview");
                            } catch (e) { toastError(e); }
                          }}
                        />
                        {v.status === "draft" && (
                          <IconAction
                            label="Configure layout"
                            variant="outline"
                            testId={`configure-layout-btn-${v.id}`}
                            icon={<LayoutTemplate className="h-4 w-4" />}
                            disabled={!canAuthor}
                            onClick={() => openLayoutDialog(v.id)}
                          />
                        )}
                        {v.status === "draft" && (
                          <IconAction
                            label={layoutReady ? "Approve version" : LAYOUT_REQUIRED_MESSAGE}
                            testId={`approve-btn-${v.id}`}
                            icon={<CheckCircle2 className="h-4 w-4" />}
                            disabled={!canApprove || !layoutReady}
                            onClick={() => startApproval(v.id)}
                          />
                        )}
                        {v.status === "approved" && (
                          <IconAction
                            label="Publish version"
                            variant="default"
                            testId={`publish-btn-${v.id}`}
                            icon={<Upload className="h-4 w-4" />}
                            disabled={!canApprove}
                            onClick={() => openPublishDialog(v.id)}
                          />
                        )}
                        {(v.status === "approved" || v.status === "published") && (
                          <IconAction
                            label="Retire version"
                            tone="destructive"
                            testId={`retire-version-btn-${v.id}`}
                            icon={<Archive className="h-4 w-4" />}
                            disabled={!canApprove}
                            onClick={() => setReasonDialog({
                              open: true, required: true,
                              title: "Retire version",
                              description: "Retirement is permanent; reason required.",
                              submitLabel: "Retire",
                              onSubmit: async (reason) => {
                                await svc.retireTemplateVersion(client, { id: v.id, reason });
                                toast.success("Retired"); await reloadVersions(selectedFamilyId);
                              },
                            })}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <TablePager
              testId="version-pager"
              page={versionPageSlice.page}
              pageCount={versionPageSlice.pageCount}
              from={versionPageSlice.from}
              to={versionPageSlice.to}
              total={versionPageSlice.total}
              pageSize={versionPageSize}
              onPage={setVersionPage}
              onPageSize={setVersionPageSize}
            />
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
          </div>
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
          onCreated={async (versionId) => {
            await reloadVersions(selectedFamilyId);
            await reloadCatalogue();
            try { setEditingVersion(await svc.getTemplateVersion(client, versionId)); }
            catch (e) { toastError(e); }
          }}
          familyId={selectedFamilyId}
          presetChannel={workspaceAction ? workspaceChannel : null}
        />
      )}
      <PublishDialog
        state={publishState}
        onClose={() => setPublishState({ open: false, version: null, hasExistingPublished: false })}
        onPublished={() => { void reloadVersions(selectedFamilyId); void reloadCatalogue(); }}
      />
      <ReasonDialog
        state={reasonDialog}
        onOpenChange={(o) => setReasonDialog((s) => ({ ...s, open: o }))}
      />
      <OmniCommsLayoutSelectionDialog
        open={layoutDialogVersion !== null}
        version={layoutDialogVersion}
        familyCode={selectedFamily?.code ?? ""}
        canAuthor={canAuthor}
        onClose={() => setLayoutDialogVersion(null)}
        onSaved={async () => { await reloadVersions(selectedFamilyId); }}
      />
      <QuickPreviewDialog
        family={quickPreviewFamily}
        onClose={() => setQuickPreviewFamily(null)}
      />

      {/* Preview belongs to the channel being authored, not a global tab. */}
      <OmniCommsPreviewShell
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Preview"
        description="Rendered with a synthetic payload — no live recipient data."
        testId="template-preview-shell"
      >
        {selectedVersion ? (
          <TemplatePreviewPanel
            channel={selectedVersion.channel}
            content={selectedVersion.content}
            caption={`${selectedVersion.channel} · ${selectedVersion.locale} · v${selectedVersion.version_number}`}
            testId="version-preview-panel"
          />
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Select a version to preview it.
          </p>
        )}
      </OmniCommsPreviewShell>

      {/* Assembly is internal: administrators only see its result. */}
      <Dialog open={finalPreviewOpen} onOpenChange={setFinalPreviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Preview final communication</DialogTitle>
            <DialogDescription>
              Template, resolved presentation and shared assets combined exactly
              as the recipient would receive them.
            </DialogDescription>
          </DialogHeader>
          <OmniCommsAssemblyTab
            organizationId={organizationId}
            departments={departments}
            families={families}
          />
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
};

export default OmniCommsTemplatesPage;
