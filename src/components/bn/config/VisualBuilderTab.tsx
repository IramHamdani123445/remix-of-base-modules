/**
 * VisualBuilderTab — drag-and-drop product version assembly workbench.
 * Layout: Section tabs · Palette | Canvas | Inspector + Validation/Preview below.
 * Read-only when the selected version is not DRAFT.
 */
import { useMemo, useState } from 'react';
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Loader2, Save, RefreshCw, Copy, Download, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  BlockPalette, ConfigBuilderCanvas, BlockInspector, ValidationPanel, PreviewPanel, FormulaExpression,
  useBuilderCanvas, newBlock, validateCanvas,
  type BuilderBlock, type BuilderSectionKey, type BuilderBlockKind,
} from '@/components/bn/config-builder';
import { BLOCK_REGISTRY } from '@/components/bn/config-builder/blockRegistry';
import { syncCanvasToNormalized, cloneVersionToDraft } from '@/services/bn/canvasSyncService';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

/**
 * Sections syncCanvasToNormalized() can actually persist. The remaining five
 * are drawn but never written — see BUG-005.
 */
const SYNC_SUPPORTED: BuilderSectionKey[] = [
  'eligibility', 'documents', 'communications',
  // Implemented after BUG-005.
  'calculation', 'workflow', 'screen',
];

/** Where the user should go instead, for each section Sync cannot apply. */
const SECTION_TAB_HINT: Partial<Record<BuilderSectionKey, string>> = {
  calculation: 'Calculation',
  screen: 'Screens',
  workflow: 'Workflow',
  payments: 'Application Channels',
  servicing: 'Interactions',
};

const SECTIONS: { key: BuilderSectionKey; label: string }[] = [
  { key: 'eligibility', label: 'Eligibility' },
  { key: 'calculation', label: 'Calculation' },
  { key: 'documents', label: 'Documents' },
  { key: 'screen', label: 'Form / Screen' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'communications', label: 'Communications' },
  { key: 'payments', label: 'Payments' },
  { key: 'servicing', label: 'Servicing' },
];

interface Props {
  versionId?: string;
  versionStatus?: string;
}

export function VisualBuilderTab({ versionId, versionStatus }: Props) {
  const { canvas, setCanvas, save, reimport, loading, saving, hydratedFromTables } = useBuilderCanvas(versionId);
  const { profile } = useSupabaseAuth();
  const userCode = profile?.user_code ?? 'system';
  const [section, setSection] = useState<BuilderSectionKey>('eligibility');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [syncing, setSyncing] = useState(false);
  const [cloning, setCloning] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const readOnly = !!versionStatus && versionStatus.toUpperCase() !== 'DRAFT';
  const blocks = canvas.sections[section] ?? [];
  const selectedBlock = useMemo(() => blocks.find((b) => b.id === selectedId), [blocks, selectedId]);
  const issues = useMemo(() => validateCanvas(canvas), [canvas]);

  const onSync = async () => {
    if (!versionId) return;
    setSyncing(true);
    try {
      const r = await syncCanvasToNormalized(versionId, canvas, userCode);
      // Only report what was actually produced — a list of zeroes tells the
      // user nothing about what happened.
      const parts = [
        r.eligibilityRules && `Eligibility: ${r.eligibilityRules}`,
        r.calculationRules && `Calculation: ${r.calculationRules}`,
        r.documentRequirements && `Documents: ${r.documentRequirements}`,
        r.screenTemplates && `Screen template: ${r.screenTemplates}`,
        r.workflowTemplates && `Workflow template: ${r.workflowTemplates}`,
        r.commMappings && `Comms: ${r.commMappings}`,
      ].filter(Boolean);
      const msg = parts.length ? parts.join(', ') : 'Nothing was applied';
      // BUG-005 — a partial sync must not report unqualified success. Sections
      // the user has built but this sync cannot apply are named, with where to
      // configure them instead.
      const skipped = r.notApplied ?? [];
      if (skipped.length) {
        // Each entry already carries its own reason, so it is quoted as-is
        // rather than wrapped in a single blanket explanation.
        toast.warning('Synced in part', {
          description:
            `${msg}. Not applied — ${skipped.join(' · ')}` +
            (r.warnings.length ? ` · ${r.warnings.join('; ')}` : ''),
          duration: 12_000,
        });
      } else if (r.warnings.length) {
        toast.warning('Sync completed with warnings', { description: `${msg} · ${r.warnings.join('; ')}` });
      } else {
        toast.success('Synced to normalized tables', { description: msg });
      }
    } catch (e: any) {
      toast.error('Sync failed', { description: e?.message });
    } finally { setSyncing(false); }
  };

  const onClone = async () => {
    if (!versionId) return;
    setCloning(true);
    try {
      const newId = await cloneVersionToDraft(versionId, userCode);
      toast.success('Cloned to DRAFT', { description: `New version id: ${newId.slice(0, 8)}…` });
    } catch (e: any) {
      toast.error('Clone failed', { description: e?.message });
    } finally { setCloning(false); }
  };

  const updateSectionBlocks = (next: BuilderBlock[]) => {
    setCanvas({ ...canvas, sections: { ...canvas.sections, [section]: next } });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = e;
    if (!over) return;
    const fromPalette = String(active.id).startsWith('palette:');
    const overSection = (over.data?.current?.section as BuilderSectionKey | undefined) ?? section;
    if (fromPalette) {
      const kind = (active.data?.current?.kind as BuilderBlockKind | undefined);
      if (!kind) return;
      const def = BLOCK_REGISTRY[kind];
      if (def.section !== overSection) {
        toast.error(`"${def.label}" belongs in the ${def.section} section`);
        return;
      }
      const blk = newBlock(kind);
      updateSectionBlocks([...(canvas.sections[overSection] ?? []), blk]);
      setSelectedId(blk.id);
      return;
    }
    // Reorder within section
    if (active.id !== over.id && !String(over.id).startsWith('canvas:')) {
      const oldIdx = blocks.findIndex((b) => b.id === active.id);
      const newIdx = blocks.findIndex((b) => b.id === over.id);
      if (oldIdx >= 0 && newIdx >= 0) updateSectionBlocks(arrayMove(blocks, oldIdx, newIdx));
    }
  };

  const onSave = async () => {
    try {
      await save(canvas);
      toast.success('Canvas saved');
    } catch (e: any) {
      toast.error('Save failed', { description: e?.message });
    }
  };

  if (!versionId) {
    return <p className="text-sm text-muted-foreground p-4">Select a product version to use the Visual Builder.</p>;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2">
            Visual Builder
            {hydratedFromTables && (
              <Badge variant="secondary" className="text-[10px]">Imported from tables</Badge>
            )}
          </CardTitle>
          <CardDescription>
            {hydratedFromTables
              ? 'Showing live rows from this version\'s eligibility, calculation, document and communication tables. Save Canvas to take ownership in the builder.'
              : 'Drag reusable blocks into each section to assemble this product version.'}
            {readOnly && ' Version is read-only — clone to a DRAFT to edit.'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={reimport} disabled={loading} size="sm" variant="ghost" title="Re-import current rows from normalized tables">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Import from Tables
          </Button>
          {readOnly && (
            <Button onClick={onClone} disabled={cloning} size="sm" variant="outline">
              {cloning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
              Clone to DRAFT
            </Button>
          )}
          <Button onClick={onSync} disabled={syncing || readOnly} size="sm" variant="outline">
            {syncing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Sync to Tables
          </Button>
          <Button onClick={onSave} disabled={saving || readOnly} size="sm">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save Canvas
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            <Tabs value={section} onValueChange={(v) => { setSection(v as BuilderSectionKey); setSelectedId(undefined); }}>
              <TabsList className="flex-wrap h-auto">
                {SECTIONS.map((s) => (
                  <TabsTrigger key={s.key} value={s.key} className="text-xs">
                    {s.label}
                    <span className="ml-1 text-[10px] text-muted-foreground">({(canvas.sections[s.key] ?? []).length})</span>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            {/* BUG-005 — told before the work, not after it. Sync only writes
                eligibility, documents and communications; the other five
                sections produce nothing, and users had no way to know until
                they checked the destination tab and found it empty. */}
            {!SYNC_SUPPORTED.includes(section) && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">Nothing can be built in this section yet</p>
                  <p className="text-muted-foreground">
                    This section has no blocks available, and Sync does not write anything for it.
                    Use the{' '}
                    <span className="font-medium">{SECTION_TAB_HINT[section] ?? 'dedicated'}</span>{' '}
                    tab instead.
                  </p>
                </div>
              </div>
            )}

            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                <div className="lg:col-span-3"><BlockPalette section={section} disabled={readOnly} /></div>
                <div className="lg:col-span-6 space-y-2">
                  {section === 'calculation' && <FormulaExpression canvas={canvas} compact />}
                  <ConfigBuilderCanvas
                    section={section}
                    blocks={blocks}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onRemove={(id) => updateSectionBlocks(blocks.filter((b) => b.id !== id))}
                    disabled={readOnly}
                  />
                </div>
                <div className="lg:col-span-3">
                  <BlockInspector
                    block={selectedBlock}
                    onChange={(next) => updateSectionBlocks(blocks.map((b) => (b.id === next.id ? next : b)))}
                    disabled={readOnly}
                  />
                </div>
              </div>
            </DndContext>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <ValidationPanel issues={issues} />
              <PreviewPanel canvas={canvas} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
