/**
 * Omni-Comms — Template version layout selection dialog.
 *
 * Persists the layout selection of ONE draft template version through the
 * authorised shared-assets RPC surface. React never queries
 * `core_template_layout`, `core_template_layout_version` or
 * `omni_comms_template_version` directly, never accepts a hand-typed layout
 * version identifier, and never bypasses optimistic concurrency.
 */
import React from 'react';
import { useOmniCommsRpcClient } from '../hooks/useOmniCommsRpcClient';
import * as sharedSvc from '@/platform/omni-comms/application/sharedAssetsService';
import * as svc from '@/platform/omni-comms/application/templateCatalogueService';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import {
  LAYOUT_MODE_EXPLANATION,
  describeLayoutSelection,
  isLayoutKindCompatible,
  mapLayoutErrorDetail,
} from '@/platform/omni-comms/application/templateLayoutSelection';
import type {
  TemplateVersionGetResult,
  TemplateLayoutSelectionMode,
} from '@/platform/omni-comms/application/templateCatalogueTypes';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface LayoutSelectionDialogProps {
  open: boolean;
  /** The exact draft template version being configured. */
  version: TemplateVersionGetResult | null;
  familyCode: string;
  canAuthor: boolean;
  onClose: () => void;
  /** Called after a successful persistence so callers can reload state. */
  onSaved: (versionId: string) => void | Promise<void>;
}

interface LayoutRow { id: string; code: string | null; name: string; layout_kind: string | null }

export function layoutSelectionErrorMessage(e: unknown): string {
  if (e instanceof OmniCommsRpcError) {
    const mapped = mapLayoutErrorDetail(e.detail);
    if (mapped) return mapped;
    if (e.code === 'OC403') return 'You do not have permission for this action.';
    if (e.code === 'OC413') {
      return 'This draft was updated by someone else. Reload the version and try again.';
    }
    if (e.code === 'OC412') return 'Layout selection can only be changed while the version is a draft.';
    return 'The layout selection could not be saved.';
  }
  return (e as Error)?.message ?? 'Unexpected error';
}

export const OmniCommsLayoutSelectionDialog: React.FC<LayoutSelectionDialogProps> = ({
  open, version, familyCode, canAuthor, onClose, onSaved,
}) => {
  const client = useOmniCommsRpcClient();
  const [mode, setMode] = React.useState<TemplateLayoutSelectionMode>('resolved_default');
  const [layoutId, setLayoutId] = React.useState<string>('');
  const [pinnedVersionId, setPinnedVersionId] = React.useState<string>('');
  const [layouts, setLayouts] = React.useState<LayoutRow[]>([]);
  const [layoutVersions, setLayoutVersions] = React.useState<sharedSvc.PublishedLayoutVersionRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);

  const isDraft = version?.status === 'draft';

  // Seed dialog state from the persisted selection.
  React.useEffect(() => {
    if (!open || !version) return;
    setMode(version.layout_selection_mode ?? 'resolved_default');
    setLayoutId(version.layout_id ?? '');
    setPinnedVersionId(version.pinned_layout_version_id ?? '');
  }, [open, version]);

  // Active layouts compatible with the template channel (authorised RPC).
  React.useEffect(() => {
    if (!open || !version) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const rows = await sharedSvc.listActiveLayouts(client, {});
        if (cancelled) return;
        setLayouts(
          (rows ?? []).filter((l) => isLayoutKindCompatible(l.layout_kind, version.channel)),
        );
      } catch (e) {
        if (!cancelled) { setLayouts([]); toast.error(layoutSelectionErrorMessage(e)); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, version, client]);

  // Published versions for the selected layout (authorised RPC, bounded).
  React.useEffect(() => {
    if (!open || mode !== 'pinned' || !layoutId) { setLayoutVersions([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const rows = await sharedSvc.listPublishedLayoutVersions(client, { layoutId, limit: 50 });
        if (!cancelled) setLayoutVersions(rows ?? []);
      } catch (e) {
        if (!cancelled) { setLayoutVersions([]); toast.error(layoutSelectionErrorMessage(e)); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, mode, layoutId, client]);

  // A pinned version must belong to the selected layout.
  React.useEffect(() => {
    if (mode !== 'pinned') { setPinnedVersionId(''); return; }
    setPinnedVersionId((cur) =>
      cur && layoutVersions.some((lv) => lv.id === cur) ? cur : '',
    );
  }, [mode, layoutVersions]);

  if (!version) return null;

  const persisted = describeLayoutSelection(version);
  const saveDisabled =
    !canAuthor || !isDraft || saving || !layoutId || (mode === 'pinned' && !pinnedVersionId);

  const save = async () => {
    if (saveDisabled) return;
    setSaving(true);
    try {
      await sharedSvc.setTemplateVersionLayoutSelection(client, {
        versionId: version.id,
        mode,
        layoutId,
        pinnedLayoutVersionId: mode === 'pinned' ? pinnedVersionId : null,
        expectedUpdatedAt: version.updated_at,
      });
      toast.success('Layout selection saved.');
      await onSaved(version.id);
      onClose();
    } catch (e) {
      toast.error(layoutSelectionErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="max-w-xl" data-testid="layout-selection-dialog">
        <DialogHeader>
          <DialogTitle>Configure layout</DialogTitle>
          <DialogDescription>
            The layout is persisted on this exact template version and is required
            before approval. Layout selection is editable while the version is a draft.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">Template family:</span> <span className="font-mono">{familyCode}</span></div>
          <div><span className="text-muted-foreground">Template version:</span> v{version.version_number}</div>
          <div><span className="text-muted-foreground">Channel:</span> {version.channel}</div>
          <div><span className="text-muted-foreground">Locale:</span> {version.locale}</div>
          <div className="col-span-2">
            <span className="text-muted-foreground">Persisted selection:</span>{' '}
            <Badge variant={persisted.kind === 'not_selected' || persisted.kind === 'invalid' ? 'destructive' : 'secondary'}>
              {persisted.label}
            </Badge>
          </div>
        </div>

        {!isDraft && (
          <Alert variant="destructive">
            <AlertDescription>
              Layout selection can only be changed while the version is a draft.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div>
            <Label>Selection mode</Label>
            <Select
              value={mode}
              onValueChange={(v) => setMode(v as TemplateLayoutSelectionMode)}
              disabled={!isDraft || !canAuthor}
            >
              <SelectTrigger data-testid="layout-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="resolved_default">Resolved default</SelectItem>
                <SelectItem value="pinned">Pinned</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{LAYOUT_MODE_EXPLANATION[mode]}</p>
          </div>

          <div>
            <Label>Layout</Label>
            <Select value={layoutId} onValueChange={setLayoutId} disabled={!isDraft || !canAuthor || loading}>
              <SelectTrigger data-testid="layout-id">
                <SelectValue placeholder={loading ? 'Loading…' : 'Select an active layout…'} />
              </SelectTrigger>
              <SelectContent>
                {layouts.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}{l.code ? ` · ${l.code}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loading && layouts.length === 0 && (
              <p className="mt-1 text-xs text-destructive">
                No active layout is available for the {version.channel} channel.
              </p>
            )}
          </div>

          {mode === 'pinned' && (
            <div>
              <Label>Pinned layout version</Label>
              <Select
                value={pinnedVersionId}
                onValueChange={setPinnedVersionId}
                disabled={!isDraft || !canAuthor || !layoutId}
              >
                <SelectTrigger data-testid="layout-version-id">
                  <SelectValue placeholder="Select a published layout version…" />
                </SelectTrigger>
                <SelectContent>
                  {layoutVersions.map((lv) => (
                    <SelectItem key={lv.id} value={lv.id}>
                      v{lv.version_number} · published
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {layoutId && layoutVersions.length === 0 && (
                <p className="mt-1 text-xs text-destructive">
                  This layout has no published version to pin.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saveDisabled} data-testid="layout-save">
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save layout selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/** Reload helper shared by the Versions and Assembly surfaces. */
export async function reloadTemplateVersion(
  client: Parameters<typeof svc.getTemplateVersion>[0],
  versionId: string,
): Promise<TemplateVersionGetResult> {
  return svc.getTemplateVersion(client, versionId);
}

export default OmniCommsLayoutSelectionDialog;
