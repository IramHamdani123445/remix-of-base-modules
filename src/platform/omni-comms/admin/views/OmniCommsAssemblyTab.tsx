/**
 * Accelerated Build 1 — Assembly tab.
 *
 * Adds shared-asset layout selection, organisation/department preview
 * context, resolved layout metadata, asset-slot resolution table with
 * inheritance-source badges, department override reset, unresolved-slot
 * display, assembled HTML preview (sandboxed), plain-text preview, and
 * rendered checksum. React does not query any shared or Legacy asset table
 * directly — the 12 authorised RPCs are used exclusively.
 */
import React from 'react';
import { useOmniCommsRpcClient } from '../hooks/useOmniCommsRpcClient';
import * as sharedSvc from '@/platform/omni-comms/application/sharedAssetsService';
import * as svc from '@/platform/omni-comms/application/templateCatalogueService';
import { renderTemplate } from '@/platform/omni-comms/rendering';
import { composeAssembledEmail } from '@/platform/omni-comms/rendering/manifestComposer';
import { OmniCommsSandboxedPreview } from '../components/OmniCommsSandboxedPreview';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import type {
  RenderManifest,
  ResolvedAsset,
} from '@/platform/omni-comms/application/sharedAssetsTypes';
import type { ActiveDepartmentOption } from '@/platform/organization/organizationService';
import type { TemplateFamilyListItem, TemplateVersionListItem, TemplateVersionGetResult } from '@/platform/omni-comms/application/templateCatalogueTypes';
import { OmniCommsLayoutSelectionDialog } from '../components/OmniCommsLayoutSelectionDialog';
import {
  describeLayoutSelection,
  isLayoutSelectionApprovable,
  LAYOUT_REQUIRED_MESSAGE,
} from '@/platform/omni-comms/application/templateLayoutSelection';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  organizationId: string;
  departments: ActiveDepartmentOption[];
  families: TemplateFamilyListItem[];
}

interface AssemblyState {
  loading: boolean;
  manifest: RenderManifest | null;
  assembled: Awaited<ReturnType<typeof composeAssembledEmail>> | null;
}

function friendly(e: unknown): string {
  if (e instanceof OmniCommsRpcError) return `${e.code} ${e.detail ?? ''}`.trim();
  return (e as Error)?.message ?? 'Unexpected error';
}

function InheritanceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return <Badge variant="secondary">—</Badge>;
  const v = source === 'department' ? 'default' : source === 'organization' ? 'outline' : source === 'unresolved' ? 'destructive' : 'secondary';
  return <Badge variant={v as never}>{source}</Badge>;
}

const ORG_ONLY_DEPARTMENT = '__organisation_only__';



export const OmniCommsAssemblyTab: React.FC<Props> = ({ organizationId, departments, families }) => {
  const client = useOmniCommsRpcClient();
  const [familyId, setFamilyId] = React.useState<string>('');
  const [versions, setVersions] = React.useState<TemplateVersionListItem[]>([]);
  const [versionId, setVersionId] = React.useState<string>('');
  const [departmentId, setDepartmentId] = React.useState<string>('');
  const [state, setState] = React.useState<AssemblyState>({ loading: false, manifest: null, assembled: null });
  const [resetting, setResetting] = React.useState(false);
  const [layoutDialogVersion, setLayoutDialogVersion] =
    React.useState<TemplateVersionGetResult | null>(null);

  const selectedVersionRow = React.useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versions, versionId],
  );
  const layoutDisplay = selectedVersionRow ? describeLayoutSelection(selectedVersionRow) : null;

  const reloadVersions = React.useCallback(async () => {
    if (!familyId) return;
    const r = await svc.listTemplateVersions(client, { templateFamilyId: familyId });
    setVersions(r.items ?? []);
  }, [familyId, client]);

  /** Open the persisted layout configuration dialog for the selected draft. */
  const openLayoutDialog = async () => {
    if (!versionId) return;
    try {
      const full = await svc.getTemplateVersion(client, versionId);
      setLayoutDialogVersion(full);
    } catch (e) { toast.error(friendly(e)); }
  };

  // Load versions for family
  React.useEffect(() => {
    if (!familyId) { setVersions([]); return; }
    (async () => {
      try {
        const r = await svc.listTemplateVersions(client, { templateFamilyId: familyId });
        setVersions(r.items ?? []);
      } catch (e) { toast.error(friendly(e)); }
    })();
  }, [familyId, client]);

  const runAssembly = React.useCallback(async () => {
    if (!versionId) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      const manifest = await sharedSvc.resolveRenderManifest(client, {
        templateVersionId: versionId,
        organizationId,
        departmentId: departmentId || null,
      });
      const template = renderTemplate(
        manifest.template_channel as 'email',
        manifest.template_content,
        { organization: { name: 'Preview' }, recipient: { name: 'Preview Recipient' } },
      );
      const assembled = await composeAssembledEmail({
        manifest,
        templateRendered: {
          subject: template.fields.subject,
          html: template.fields.html,
          text: template.fields.text,
          unresolved_tokens: [],
        },
      });
      setState({ loading: false, manifest, assembled });
    } catch (e) {
      toast.error(friendly(e));
      setState((s) => ({ ...s, loading: false }));
    }
  }, [versionId, organizationId, departmentId, client]);

  const resetSignatureOverride = async () => {
    if (!departmentId) { toast.error('Select a department first'); return; }
    setResetting(true);
    try {
      await sharedSvc.resetDepartmentOverrideAssignment(client, {
        organizationId,
        departmentId,
        outputChannel: 'email',
        assignmentKind: 'asset_slot',
        slotCode: 'email_signature',
      });
      toast.success('Department signature override reset. Re-running assembly.');
      await runAssembly();
    } catch (e) {
      toast.error(friendly(e));
    } finally { setResetting(false); }
  };

  const emailFamilies = families;
  const emailVersions = versions.filter((v) => v.channel === 'email');

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Email assembly (Build 1 shared assets)</CardTitle>
          <CardDescription>
            Assemble an email preview by combining a published template with shared
            layout and asset assignments resolved through the organisation/department
            inheritance chain. Uses the authorised RPC surface exclusively.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium">Template family</label>
              <Select value={familyId} onValueChange={setFamilyId}>
                <SelectTrigger data-testid="assembly-family"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {emailFamilies.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Template version</label>
              <Select value={versionId} onValueChange={setVersionId} disabled={!familyId}>
                <SelectTrigger data-testid="assembly-version"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {emailVersions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>v{v.version_number} · {v.locale} · {v.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Department context</label>
              <Select
                value={departmentId || ORG_ONLY_DEPARTMENT}
                onValueChange={(v) => setDepartmentId(v === ORG_ONLY_DEPARTMENT ? '' : v)}
              >
                <SelectTrigger data-testid="assembly-department"><SelectValue placeholder="Organisation only" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ORG_ONLY_DEPARTMENT}>— Organisation only —</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={runAssembly} disabled={!versionId || state.loading} data-testid="assembly-run">
                {state.loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Assemble preview
              </Button>
              <Button variant="outline" onClick={resetSignatureOverride} disabled={!departmentId || resetting} data-testid="assembly-reset-signature">
                {resetting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                <RotateCcw className="h-4 w-4 mr-1" /> Reset signature override
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Layout configuration (persisted) — separate from preview ── */}
      {selectedVersionRow && (
        <Card data-testid="assembly-layout-configuration">
          <CardHeader>
            <CardTitle>Layout configuration</CardTitle>
            <CardDescription>
              This is the layout selection persisted on the template version. It is
              required before approval and is editable while the version is a draft.
              The assembled preview below is a diagnostic view and never changes
              stored configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            <Badge
              variant={
                layoutDisplay && (layoutDisplay.kind === 'not_selected' || layoutDisplay.kind === 'invalid')
                  ? 'destructive'
                  : 'secondary'
              }
              data-testid="assembly-layout-state"
            >
              {layoutDisplay?.label ?? 'Not selected'}
            </Badge>
            <span className="text-muted-foreground">
              Version status: {selectedVersionRow.status}
            </span>
            {selectedVersionRow.status === 'draft' && (
              <Button
                size="sm"
                variant="outline"
                data-testid="assembly-configure-layout"
                onClick={() => void openLayoutDialog()}
              >
                Configure Layout
              </Button>
            )}
            {selectedVersionRow.status === 'draft' &&
              layoutDisplay && !isLayoutSelectionApprovable(selectedVersionRow) && (
                <span className="text-xs text-destructive">{LAYOUT_REQUIRED_MESSAGE}</span>
              )}
          </CardContent>
        </Card>
      )}

      {state.manifest && state.assembled && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Resolved layout</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-2 text-sm">
              <div><span className="text-muted-foreground">Layout ID:</span> {state.manifest.layout_id ?? '—'}</div>
              <div><span className="text-muted-foreground">Layout version:</span> {state.manifest.layout_version_id ?? '—'}</div>
              <div><span className="text-muted-foreground">Source:</span> <InheritanceBadge source={state.manifest.layout_inheritance_source} /></div>
              <div><span className="text-muted-foreground">Checksum:</span> <code className="text-xs">{state.assembled.rendered_checksum.slice(0,16)}…</code></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Asset-slot resolution</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Slot</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Asset ID</TableHead>
                    <TableHead>Version ID</TableHead>
                    <TableHead>Inheritance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.manifest.resolved_assets.map((r: ResolvedAsset) => (
                    <TableRow key={r.slot}>
                      <TableCell className="font-mono text-xs">{r.slot}</TableCell>
                      <TableCell>{r.asset_type ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.asset_id ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{r.asset_version_id ?? '—'}</TableCell>
                      <TableCell><InheritanceBadge source={r.inheritance_source} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {state.assembled.unresolved_required_slots.length > 0 && (
                <Alert variant="destructive" className="mt-3">
                  <AlertTitle>Unresolved required slots</AlertTitle>
                  <AlertDescription>{state.assembled.unresolved_required_slots.join(', ')}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assembled preview</CardTitle>
              <CardDescription>Rendered in a sandboxed iframe with a restrictive CSP.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Subject</div>
                <div className="text-sm font-medium" data-testid="assembly-subject">{state.assembled.rendered_subject}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">HTML</div>
                <OmniCommsSandboxedPreview html={state.assembled.rendered_html} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Plain text</div>
                <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded" data-testid="assembly-text">{state.assembled.rendered_text}</pre>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Rendered checksum</div>
                <code className="text-xs" data-testid="assembly-checksum">{state.assembled.rendered_checksum}</code>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <OmniCommsLayoutSelectionDialog
        open={layoutDialogVersion !== null}
        version={layoutDialogVersion}
        familyCode={families.find((f) => f.id === familyId)?.code ?? ''}
        canAuthor
        onClose={() => setLayoutDialogVersion(null)}
        onSaved={async () => { await reloadVersions(); }}
      />
    </div>
  );
};
