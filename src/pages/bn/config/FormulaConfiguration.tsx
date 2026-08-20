/**
 * Formula Library — tabbed, with full lifecycle actions.
 *
 * Tabs: Active · Drafts · In Review · Retired · All
 *
 * Row actions:
 *   - Edit (drafts only; ACTIVE/RETIRED rows are read-only and offer
 *     "Create New Version" instead)
 *   - Clone (creates a new template + DRAFT v1)
 *   - New Version (creates DRAFT vN+1)
 *   - Submit for Review (DRAFT → IN_REVIEW)
 *   - Activate (IN_REVIEW → ACTIVE; retires the previously active version)
 *   - Retire (ACTIVE → RETIRED)
 *   - View Usage (shows binding count & version count)
 *   - Delete (safe — refused when bound or any ACTIVE version exists)
 *
 * Raw JSON / inline expression edits are kept behind the existing
 * FormulaBuilder; only DRAFT rows allow expression edits.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Copy, Edit, GitBranch, Send, CheckCircle2, Archive, Eye, Trash2, Sigma,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBnFormulaTemplates, useUpsertBnFormulaTemplate } from '@/hooks/bn/useBnConfig';
import { useUserCode } from '@/hooks/useUserCode';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PageHeader } from '@/components/common/PageHeader';
import { BnScreenRoleBanner } from '@/components/bn/shared';
import { CodeFieldWithAutoGenerate, FormulaBuilder, SmartSelect } from '@/components/bn/smart';
import { useBnConfigAudit } from '@/hooks/bn/useBnConfigAudit';
import { parseFormula } from '@/lib/bn/formulaParser';
import { useVariableResolver } from '@/hooks/bn/useVariableResolver';
import { classifyVariables } from '@/services/bn/variableResolverService';
import { FormulaTestPanel } from '@/components/bn/config/FormulaTestPanel';
import { FormulaVersionEditor } from '@/components/bn/config/FormulaVersionEditor';
import { AddFormulaWizard } from '@/components/bn/config/AddFormulaWizard';
import { LiveVersionGuardDialog } from '@/components/bn/config/LiveVersionGuardDialog';
import type { BnFormulaTemplate } from '@/types/bn';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import CountryFieldSelector from '@/components/bn/selectors/CountryFieldSelector';
import {
  cloneFormula, createNewVersion, getFormulaUsage,
  safeDeleteFormula, transitionVersion, listVersions,
  type FormulaStatus,
} from '@/services/bn/formulaLifecycleService';

type FormulaForm = {
  id?: string;
  template_code: string;
  template_name: string;
  description: string;
  formula_expression: string;
  output_type: string;
  country_code: string;
  is_active: boolean;
};

const emptyForm: FormulaForm = {
  template_code: '', template_name: '', description: '',
  formula_expression: '', output_type: 'NUMBER', country_code: '', is_active: true,
};

const OUTPUT_TYPES = [
  { value: 'NUMBER', label: 'Number' },
  { value: 'MONEY', label: 'Money' },
  { value: 'PERCENT', label: 'Percent' },
];

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline', IN_REVIEW: 'secondary', ACTIVE: 'default', RETIRED: 'destructive',
};

type TabKey = 'ACTIVE' | 'DRAFT' | 'IN_REVIEW' | 'RETIRED' | 'ALL';

/** Defensive normalizer — maps any legacy/lowercase value to one of the 4 canonical statuses. */
function normalizeStatus(raw: unknown): 'ACTIVE' | 'DRAFT' | 'IN_REVIEW' | 'RETIRED' {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'ACTIVE' || s === 'READY_FOR_PRODUCT_USE' || s === 'APPROVED' || s === 'LEGAL_CONFIRMED') return 'ACTIVE';
  if (s === 'IN_REVIEW' || s === 'REVIEW' || s === 'TECHNICAL_REVIEW' || s === 'LEGAL_REVIEW') return 'IN_REVIEW';
  if (s === 'RETIRED' || s === 'DEPRECATED' || s === 'ARCHIVED') return 'RETIRED';
  return 'DRAFT';
}

export default function FormulaConfiguration() {
  const [tab, setTab] = useState<TabKey>('ACTIVE');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormulaForm>(emptyForm);
  const [readOnly, setReadOnly] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState<BnFormulaTemplate | null>(null);
  const [cloneCode, setCloneCode] = useState('');
  const [cloneName, setCloneName] = useState('');
  const [confirm, setConfirm] = useState<{
    title: string; description: string; action: () => Promise<void>;
  } | null>(null);
  const [usageOpen, setUsageOpen] = useState<{ row: BnFormulaTemplate; usage: any; versions: any[] } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [versionEditorId, setVersionEditorId] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [guardRow, setGuardRow] = useState<BnFormulaTemplate | null>(null);

  const { data: formulas = [], isLoading } = useBnFormulaTemplates();
  const upsert = useUpsertBnFormulaTemplate();
  const { userCode } = useUserCode();
  const audit = useBnConfigAudit();
  const { data: resolver } = useVariableResolver();
  const qc = useQueryClient();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['bn', 'formula-templates'] });
    // The grid's statuses come from the versions now, so they must be
    // refetched too or the screen shows the pre-transition state.
    qc.invalidateQueries({ queryKey: ['bn', 'formula-versions', 'all'] });
  };

  /**
   * BUG-20 — the status was held twice and drifted apart.
   *
   * A formula's status lived on the version (which the Submit/Activate rules
   * read) and was also copied onto the template (which the grid, tabs and row
   * actions read). Submit changed the version through an RPC, then wrote the
   * template in a second, separate request. When the second write did not
   * happen the two disagreed permanently: the version said IN_REVIEW, the
   * template still said DRAFT, so the grid filed the formula under Drafts, the
   * editor locked it as under review, and Activate never appeared because that
   * action was keyed off the template. The formula could be neither edited nor
   * advanced. Four formulas are in that state right now.
   *
   * The versions are the real record, so everything here is derived from them
   * and the template's copy is no longer read. That removes the possibility of
   * drift rather than trying to keep two copies in step, and it un-strands the
   * existing formulas without a data migration.
   */
  const { data: allVersions = [] } = useQuery({
    queryKey: ['bn', 'formula-versions', 'all'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('bn_formula_version')
        .select('formula_template_id, version_no, governance_status')
        .order('version_no', { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ formula_template_id: string; version_no: number; governance_status: string }>;
    },
  });

  /**
   * What each template's versions actually say. The effective status is not
   * simply the newest version's: a template with a live ACTIVE version and a
   * DRAFT in progress is Active — the draft is work in hand, not a demotion.
   * The action flags are per-version-state rather than per-template, because a
   * template can legitimately offer Submit (it has a draft) and Retire (it has
   * a live version) at the same time.
   */
  const versionFacts = useMemo(() => {
    const m = new Map<string, {
      hasDraft: boolean; hasInReview: boolean; hasActive: boolean; hasRetired: boolean;
      effective: 'ACTIVE' | 'IN_REVIEW' | 'DRAFT' | 'RETIRED';
    }>();
    for (const v of allVersions) {
      const f = m.get(v.formula_template_id) ??
        { hasDraft: false, hasInReview: false, hasActive: false, hasRetired: false, effective: 'DRAFT' as const };
      const s = String(v.governance_status ?? '').toUpperCase();
      if (s === 'DRAFT') f.hasDraft = true;
      else if (s === 'IN_REVIEW') f.hasInReview = true;
      else if (s === 'ACTIVE') f.hasActive = true;
      else if (s === 'RETIRED') f.hasRetired = true;
      m.set(v.formula_template_id, f);
    }
    for (const f of m.values()) {
      f.effective = f.hasActive ? 'ACTIVE'
        : f.hasInReview ? 'IN_REVIEW'
        : f.hasDraft ? 'DRAFT'
        : 'RETIRED';
    }
    return m;
  }, [allVersions]);

  /** A template with no versions at all falls back to its own column. */
  const statusOf = (f: BnFormulaTemplate) =>
    versionFacts.get(f.id)?.effective ?? normalizeStatus(f.governance_status);
  const factsOf = (f: BnFormulaTemplate) => versionFacts.get(f.id);

  const filtered = useMemo(() => {
    const rows = formulas as BnFormulaTemplate[];
    if (tab === 'ALL') return rows;
    return rows.filter((f) => statusOf(f) === tab);
  }, [formulas, tab, versionFacts]);

  const counts = useMemo(() => {
    const c = { ACTIVE: 0, DRAFT: 0, IN_REVIEW: 0, RETIRED: 0 } as Record<string, number>;
    (formulas as BnFormulaTemplate[]).forEach((f) => { c[statusOf(f)] += 1; });
    return c;
  }, [formulas, versionFacts]);


  const otherCodes = formulas
    .filter((f: BnFormulaTemplate) => f.id !== form.id)
    .map((f: BnFormulaTemplate) => f.template_code);

  const openAdd = () => { setWizardOpen(true); };
  const openRow = (f: BnFormulaTemplate) => {
    const status = f.governance_status ?? 'DRAFT';
    setForm({
      id: f.id,
      template_code: f.template_code,
      template_name: f.template_name,
      description: f.description ?? '',
      formula_expression: f.formula_expression ?? '',
      output_type: f.output_type ?? 'NUMBER',
      country_code: f.country_code ?? '',
      is_active: f.is_active ?? true,
    });
    setReadOnly(status !== 'DRAFT');
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (readOnly) { setDialogOpen(false); return; }
    if (!form.template_code.trim() || !form.template_name.trim() || !form.formula_expression.trim()) {
      toast.error('Please check the form for valid information!', {
        description: 'Code, Name and Expression are required.',
      });
      return;
    }
    if (otherCodes.map((c) => c.toUpperCase()).includes(form.template_code.trim().toUpperCase())) {
      toast.error('Duplicate code', { description: 'Another formula already uses this code.' });
      return;
    }
    const parsed = parseFormula(form.formula_expression, resolver ?? null);
    if (!parsed.valid) {
      const missing = parsed.unresolved.map((u) => u.variable).join(', ');
      toast.error('Formula has unregistered variables', {
        description: missing
          ? `Missing source for: ${missing}.`
          : parsed.errors.join('; '),
      });
      return;
    }
    const variableBindings = resolver
      ? Object.fromEntries(
          classifyVariables(parsed.variablesUsed, resolver).resolved.map((r) => [
            r.code,
            { source: r.source, ref: r.code, refId: r.refId, displayName: r.displayName },
          ]),
        )
      : {};
    try {
      const before = form.id ? formulas.find((f: BnFormulaTemplate) => f.id === form.id) ?? null : null;
      const saved = await upsert.mutateAsync({
        ...(form.id ? { id: form.id } : {}),
        template_code: form.template_code.trim(),
        template_name: form.template_name.trim(),
        description: form.description.trim() || null,
        formula_expression: form.formula_expression,
        output_type: form.output_type,
        country_code: form.country_code.trim() || null,
        is_active: form.is_active,
        entered_by: userCode ?? null,
        variable_bindings: variableBindings,
        validation_status: 'VALID',
        last_validation_at: new Date().toISOString(),
        validation_errors: [],
        ...(form.id ? {} : { governance_status: 'DRAFT' }),
      } as Partial<BnFormulaTemplate>);
      audit.log({
        entityType: 'bn_formula_template',
        entityId: (saved as any)?.id ?? form.id ?? 'new',
        action: form.id ? 'UPDATE' : 'CREATE',
        before,
        after: { ...form, variables_used: parsed.variablesUsed },
      });
      toast.success(form.id ? 'Formula updated' : 'Formula created');
      setDialogOpen(false);
    } catch (e: any) {
      toast.error('Save failed', { description: e?.message ?? 'Unable to save formula.' });
    }
  };

  // ─── Lifecycle handlers ────────────────────────────────────────────
  const requireUser = (): string | null => {
    if (!userCode) { toast.error('Sign-in required'); return null; }
    return userCode;
  };

  const handleClone = (row: BnFormulaTemplate) => {
    setCloneSource(row);
    setCloneCode(`${row.template_code}-COPY`);
    setCloneName(`${row.template_name} (copy)`);
    setCloneOpen(true);
  };

  const doClone = async () => {
    const u = requireUser(); if (!u || !cloneSource) return;
    if (!cloneCode.trim() || !cloneName.trim()) {
      toast.error('Code and name are required'); return;
    }
    try {
      setBusyId(cloneSource.id);
      await cloneFormula({
        templateId: cloneSource.id,
        newCode: cloneCode.trim().toUpperCase(),
        newName: cloneName.trim(),
        userCode: u,
      });
      audit.log({ entityType: 'bn_formula_template', entityId: cloneSource.id, action: 'CREATE' as any, after: { newCode: cloneCode } });
      toast.success('Formula cloned as DRAFT');
      setCloneOpen(false); refresh();
    } catch (e: any) {
      toast.error('Clone failed', { description: e?.message });
    } finally { setBusyId(null); }
  };

  const handleNewVersion = (row: BnFormulaTemplate) => {
    const u = requireUser(); if (!u) return;
    setConfirm({
      title: `Create new version of ${row.template_code}?`,
      description: 'A new DRAFT version will be created. The current ACTIVE version stays in use until you activate the new one. The new DRAFT will open for editing.',
      action: async () => {
        setBusyId(row.id);
        try {
          const newVersionId = await createNewVersion(row.id, u);
          audit.log({ entityType: 'bn_formula_template', entityId: row.id, action: 'CREATE' as any });
          toast.success('New DRAFT version created — opening editor');
          refresh();
          if (newVersionId) setVersionEditorId(newVersionId);
        } catch (e: any) { toast.error('Failed', { description: e?.message }); }
        finally { setBusyId(null); }
      },
    });
  };

  const handleEditFormulaSteps = async (row: BnFormulaTemplate) => {
    setBusyId(row.id);
    try {
      const versions = await listVersions(row.id);
      const draft = versions.find((v: any) => v.governance_status === 'DRAFT');
      const target = draft ?? versions[0];
      if (!target) { toast.error('No version found for this formula'); return; }
      if (!draft) toast.info(`Opening ${target.governance_status} version in read-only mode`);
      setVersionEditorId(target.id);
    } catch (e: any) {
      toast.error('Failed to load versions', { description: e?.message });
    } finally { setBusyId(null); }
  };

  const handleTransition = (row: BnFormulaTemplate, next: FormulaStatus, label: string) => {
    const u = requireUser(); if (!u) return;
    // Use the latest version of this template — RPC will reject illegal transitions.
    setConfirm({
      title: `${label} ${row.template_code}?`,
      description: next === 'ACTIVE'
        ? 'Activating this formula version will retire any previously active version of the same template.'
        : next === 'RETIRED'
          ? 'Retired formulas remain visible for audit but cannot be bound to new products.'
          : 'Submit this DRAFT for review. Editing will be locked.',
      action: async () => {
        setBusyId(row.id);
        try {
          const versions = await listVersions(row.id);
          if (!versions.length) throw new Error('No version found for this template');
          // Pick the version whose current status is the legal predecessor.
          const predecessor = next === 'IN_REVIEW' ? 'DRAFT'
            : next === 'ACTIVE' ? 'IN_REVIEW'
            : next === 'RETIRED' ? 'ACTIVE' : null;
          // No arbitrary fallback. Falling back to versions[0] asked the
          // database for an illegal transition and surfaced it as
          // "Illegal transition IN_REVIEW → IN_REVIEW", which explains nothing.
          const candidate = versions.find((v: any) => v.governance_status === predecessor);
          if (!candidate) {
            const have = versions.map((v: any) => `v${v.version_no} ${v.governance_status}`).join(', ');
            throw new Error(
              `No ${predecessor} version to ${label.toLowerCase()}. This formula has: ${have}.`,
            );
          }
          await transitionVersion({ versionId: candidate.id, newStatus: next, userCode: u });
          // The template's own governance_status is deliberately no longer
          // written here. It was a second, non-transactional copy of the
          // version's status and the sole cause of the drift in BUG-20; the
          // grid, tabs and actions now derive everything from the versions.
          // is_active on the template is a template-level flag, not a status
          // mirror, so it is still maintained on retirement.
          if (next === 'RETIRED') {
            await upsert.mutateAsync({
              id: row.id, is_active: false, modified_by: u,
            } as Partial<BnFormulaTemplate>);
          }
          audit.log({ entityType: 'bn_formula_template', entityId: row.id, action: (next === 'ACTIVE' ? 'APPROVE' : next === 'RETIRED' ? 'RETIRE' : 'UPDATE') as any });
          toast.success(`${row.template_code} → ${next}`);
          refresh();
        } catch (e: any) { toast.error('Transition failed', { description: e?.message }); }
        finally { setBusyId(null); }
      },
    });
  };

  const handleViewUsage = async (row: BnFormulaTemplate) => {
    setBusyId(row.id);
    try {
      const [usage, versions] = await Promise.all([getFormulaUsage(row.id), listVersions(row.id)]);
      setUsageOpen({ row, usage, versions });
    } catch (e: any) { toast.error('Failed to load usage', { description: e?.message }); }
    finally { setBusyId(null); }
  };

  const handleDelete = (row: BnFormulaTemplate) => {
    const u = requireUser(); if (!u) return;
    setConfirm({
      title: `Delete ${row.template_code}?`,
      description: 'Safe-delete: the formula is removed only if it is not bound to any product and has no ACTIVE versions. Otherwise retire it instead.',
      action: async () => {
        setBusyId(row.id);
        try {
          await safeDeleteFormula(row.id, u);
          audit.log({ entityType: 'bn_formula_template', entityId: row.id, action: 'DELETE' });
          toast.success('Formula deleted');
          refresh();
        } catch (e: any) { toast.error('Delete blocked', { description: e?.message }); }
        finally { setBusyId(null); }
      },
    });
  };

  // ─── Row actions (status-aware via `hidden` predicates) ───────────
  const rowActions: Array<{
    key: string; label: string; icon: any;
    onClick: (row: BnFormulaTemplate) => void;
    hidden?: (row: BnFormulaTemplate) => boolean;
    variant?: 'default' | 'destructive';
  }> = [
    { key: 'edit-formula', label: 'Edit formula (steps / expression)', icon: <Sigma className="h-3.5 w-3.5" />,
      onClick: (r) => handleEditFormulaSteps(r) },
    { key: 'edit', label: 'Edit header (draft)', icon: <Edit className="h-3.5 w-3.5" />,
      onClick: (r) => openRow(r),
      // Each action is offered when a version exists in the state it acts on,
      // not when the template's copy happens to say so.
      hidden: (r) => !factsOf(r)?.hasDraft },
    { key: 'view', label: 'View header', icon: <Eye className="h-3.5 w-3.5" />,
      onClick: (r) => openRow(r),
      hidden: (r) => !!factsOf(r)?.hasDraft },
    { key: 'submit', label: 'Submit for review', icon: <Send className="h-3.5 w-3.5" />,
      onClick: (r) => handleTransition(r, 'IN_REVIEW', 'Submit for review'),
      hidden: (r) => !factsOf(r)?.hasDraft },
    { key: 'activate', label: 'Activate', icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      onClick: (r) => handleTransition(r, 'ACTIVE', 'Activate'),
      hidden: (r) => !factsOf(r)?.hasInReview },
    { key: 'retire', label: 'Retire', icon: <Archive className="h-3.5 w-3.5" />,
      onClick: (r) => handleTransition(r, 'RETIRED', 'Retire'),
      hidden: (r) => !factsOf(r)?.hasActive },
    { key: 'version', label: 'New version', icon: <GitBranch className="h-3.5 w-3.5" />,
      onClick: (r) => handleNewVersion(r),
      hidden: (r) => { const f = factsOf(r); return !(f?.hasActive || f?.hasRetired); } },
    { key: 'clone', label: 'Clone', icon: <Copy className="h-3.5 w-3.5" />,
      onClick: (r) => handleClone(r) },
    { key: 'usage', label: 'View usage', icon: <Eye className="h-3.5 w-3.5" />,
      onClick: (r) => handleViewUsage(r) },
    { key: 'delete', label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />,
      onClick: (r) => handleDelete(r), variant: 'destructive' },
  ];


  const columns: BNColumnDef<BnFormulaTemplate>[] = [
    { accessorKey: 'template_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 160 },
      cell: ({ getValue }) => <span className="font-mono text-sm">{String(getValue() ?? '')}</span> },
    { accessorKey: 'template_name', header: 'Name', meta: { label: 'Name', width: 260 },
      cell: ({ getValue }) => <span className="font-medium text-sm">{String(getValue() ?? '')}</span> },
    { accessorKey: 'governance_status', header: 'Status', meta: { label: 'Status', width: 150 },
      cell: ({ row }) => {
        // Derived from the versions, so this can never contradict the tab the
        // row is filed under or the actions offered on it.
        const s = statusOf(row.original);
        const f = factsOf(row.original);
        return (
          <div className="flex items-center gap-1.5">
            <Badge variant={STATUS_VARIANTS[s] ?? 'outline'}>{s}</Badge>
            {/* A live formula with a draft in progress is worth seeing at a glance. */}
            {s === 'ACTIVE' && f?.hasDraft && (
              <span className="text-xs text-muted-foreground">+ draft</span>
            )}
          </div>
        );
      } },
    { accessorKey: 'output_type', header: 'Output', meta: { label: 'Output', width: 110 },
      cell: ({ getValue }) => <Badge variant="outline">{String(getValue() ?? '—')}</Badge> },
    { accessorKey: 'country_code', header: 'Country', meta: { label: 'Country', width: 100 },
      cell: ({ getValue }) => <Badge variant="outline">{String(getValue() || 'Global')}</Badge> },
    { accessorKey: 'is_active', header: 'Active', meta: { label: 'Active', width: 90 },
      cell: ({ getValue }) => getValue() ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge> },
  ];

  return (
    <PermissionWrapper moduleName="bn_configuration">
      <div className="space-y-6 p-6">
        <PageHeader
          title="Formula Library"
          subtitle="Reusable calculation formula library with versioning and lifecycle controls"
          breadcrumbs={[
            { label: 'Benefit Management', href: '/bn/claims' },
            { label: 'Configuration' },
            { label: 'Formula Library' },
          ]}
        />

        <BnScreenRoleBanner
          role="library"
          productAssemblyHint
          description="Reusable calculation building blocks. Product Catalog can only bind ACTIVE versions. Edit is allowed only on DRAFT rows; for ACTIVE rows use ‘New Version’."
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
          <TabsList>
            <TabsTrigger value="ACTIVE">Active ({counts.ACTIVE})</TabsTrigger>
            <TabsTrigger value="DRAFT">Drafts ({counts.DRAFT})</TabsTrigger>
            <TabsTrigger value="IN_REVIEW">In Review ({counts.IN_REVIEW})</TabsTrigger>
            <TabsTrigger value="RETIRED">Retired ({counts.RETIRED})</TabsTrigger>
            <TabsTrigger value="ALL">All ({formulas.length})</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="mt-4">
            <BNDataGrid
              id={`bn.formula-library.${tab}`}
              columns={columns}
              data={filtered}
              isLoading={isLoading || busyId !== null}
              searchPlaceholder="Search formulas..."
              defaultSort={[{ id: 'template_code', desc: false }]}
              onCreate={openAdd}
              onRowClick={(f) => {
                const status = normalizeStatus(f.governance_status);
                if (status === 'DRAFT') openRow(f);
                else setGuardRow(f);
              }}
              rowActions={rowActions as any}
              exportFilename={`bn_formula_library_${tab.toLowerCase()}`}
              emptyMessage={tab === 'ACTIVE'
                ? 'No active formulas. Activate a draft from the Drafts tab.'
                : 'No formulas in this status.'}
            />
          </TabsContent>
        </Tabs>

        {/* Add / Edit / View dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {readOnly ? 'View Formula' : form.id ? 'Edit Draft Formula' : 'Add Formula'}
              </DialogTitle>
              <DialogDescription>
                {readOnly
                  ? 'This formula is not in DRAFT — fields are read-only. Use “New Version” to create an editable DRAFT.'
                  : 'Every variable must resolve to a Fact, Derived Fact, Product Parameter or Prior Formula Result.'}
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={readOnly} className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3">
                <CodeFieldWithAutoGenerate
                  label="Code" required prefix="FRM"
                  value={form.template_code}
                  onChange={(v) => setForm({ ...form, template_code: v })}
                  existingCodes={otherCodes}
                  disabled={!!form.id}
                  helpText="Unique formula code. Cannot be changed after creation."
                />
                <div className="space-y-1.5">
                  <Label htmlFor="fm_country">Country</Label>
                  <CountryFieldSelector
                    value={form.country_code || null}
                    onChange={(code) => setForm({ ...form, country_code: code ?? '' })}
                    placeholder="Leave blank for global"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm_name">Name *</Label>
                <Input id="fm_name" value={form.template_name} maxLength={120}
                  onChange={(e) => setForm({ ...form, template_name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fm_desc">Description</Label>
                <Textarea id="fm_desc" value={form.description} maxLength={500} rows={2}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <FormulaBuilder
                value={form.formula_expression}
                onChange={(v) => setForm({ ...form, formula_expression: v })}
              />
              <FormulaTestPanel expression={form.formula_expression} outputType={form.output_type} />
              <div className="flex items-end justify-between gap-4">
                <div className="w-48">
                  <SmartSelect
                    label="Output type" options={OUTPUT_TYPES}
                    value={form.output_type}
                    onValueChange={(v) => setForm({ ...form, output_type: v })}
                  />
                </div>
                <div className="flex items-center gap-2 pb-2">
                  <Switch id="fm_active" checked={form.is_active}
                    onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                  <Label htmlFor="fm_active">Active flag</Label>
                </div>
              </div>
            </fieldset>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                {readOnly ? 'Close' : 'Cancel'}
              </Button>
              {!readOnly && (
                <Button onClick={handleSave} disabled={upsert.isPending}>
                  {upsert.isPending ? 'Saving…' : (form.id ? 'Save draft' : 'Create draft')}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Clone dialog */}
        <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Clone formula</DialogTitle>
              <DialogDescription>
                Creates a new template (DRAFT v1) seeded from {cloneSource?.template_code}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="clone_code">New code *</Label>
                <Input id="clone_code" value={cloneCode}
                  onChange={(e) => setCloneCode(e.target.value.toUpperCase())} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="clone_name">New name *</Label>
                <Input id="clone_name" value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCloneOpen(false)}>Cancel</Button>
              <Button onClick={doClone} disabled={busyId === cloneSource?.id}>Clone</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Usage dialog */}
        <Dialog open={!!usageOpen} onOpenChange={(o) => !o && setUsageOpen(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Usage — {usageOpen?.row.template_code}</DialogTitle>
              <DialogDescription>Where this formula is used and its version history.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Product bindings</div>
                  <div className="text-2xl font-semibold">{usageOpen?.usage.binding_count ?? 0}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Active versions</div>
                  <div className="text-2xl font-semibold">{usageOpen?.usage.active_version_count ?? 0}</div>
                </div>
                <div className="rounded-md border p-3">
                  <div className="text-xs text-muted-foreground">Total versions</div>
                  <div className="text-2xl font-semibold">{usageOpen?.usage.total_versions ?? 0}</div>
                </div>
              </div>
              <div className="rounded-md border">
                <div className="px-3 py-2 text-xs font-medium bg-muted/40">Versions</div>
                <div className="divide-y max-h-64 overflow-y-auto">
                  {(usageOpen?.versions ?? []).map((v: any) => (
                    <div key={v.id} className="flex items-center justify-between px-3 py-2">
                      <div className="font-mono">v{v.version_no}</div>
                      <Badge variant={STATUS_VARIANTS[v.governance_status] ?? 'outline'}>
                        {v.governance_status}
                      </Badge>
                      <div className="text-xs text-muted-foreground">
                        {v.effective_from ?? '—'} → {v.effective_to ?? '—'}
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => { setVersionEditorId(v.id); }}>
                        {v.governance_status === 'DRAFT' ? 'Edit' : 'View'}
                      </Button>
                    </div>
                  ))}
                  {!(usageOpen?.versions ?? []).length && (
                    <div className="px-3 py-4 text-xs text-muted-foreground">No versions yet.</div>
                  )}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUsageOpen(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm dialog */}
        <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
              <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                const fn = confirm?.action; setConfirm(null);
                if (fn) await fn();
              }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AddFormulaWizard
          open={wizardOpen}
          onClose={() => setWizardOpen(false)}
          existingCodes={(formulas as BnFormulaTemplate[]).map((f) => f.template_code)}
          onCreated={(_tplId, versionId) => {
            refresh();
            setVersionEditorId(versionId);
          }}
        />

        <FormulaVersionEditor
          open={!!versionEditorId}
          versionId={versionEditorId}
          onClose={() => setVersionEditorId(null)}
          onSaved={async () => {
            if (usageOpen) {
              const versions = await listVersions(usageOpen.row.id);
              setUsageOpen({ ...usageOpen, versions });
            }
          }}
        />

        <LiveVersionGuardDialog
          open={!!guardRow}
          onOpenChange={(o) => !o && setGuardRow(null)}
          intent="EDIT"
          status={normalizeStatus(guardRow?.governance_status)}
          versionLabel={guardRow ? `${guardRow.template_code} (${normalizeStatus(guardRow.governance_status)})` : ''}
          busy={busyId === guardRow?.id}
          onCreateDraft={() => {
            if (!guardRow) return;
            const row = guardRow;
            setGuardRow(null);
            handleNewVersion(row);
            // handleNewVersion shows a confirm dialog; user confirms then editor opens.
          }}
          onViewCurrent={() => {
            if (guardRow) openRow(guardRow);
            setGuardRow(null);
          }}
        />
      </div>
    </PermissionWrapper>
  );
}
