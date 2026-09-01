import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Plus, Edit, Copy, Trash2, Power, Search, AlertTriangle, CheckCircle2, FlaskConical, Database, ListChecks, Activity, ShieldCheck, XCircle, PlayCircle, LayoutDashboard, BadgeCheck, GitBranch, Sigma, Lock } from 'lucide-react';
import { BNDataGrid, type BNColumnDef } from '@/components/bn/grid';
import { resolveFact } from '@/services/bn/eligibility/eligibilityFactResolver';
import { computeRuleCoverage, type CoverageRow } from '@/services/bn/eligibility/factCoverageService';
import { runProductEligibilityTest, type ProductTestResult } from '@/services/bn/eligibility/productEligibilityTest';
import { ensureContributionSnapshot } from '@/services/bn/eligibility/contributionSnapshotService';
import { toast } from 'sonner';
import {
  useRuleCatalogue, useRuleCatalogueUsage, useUpsertRuleCatalogue,
  useCloneRuleCatalogue, useDeleteRuleCatalogue, useToggleRuleCatalogueActive,
} from '@/hooks/bn/useRuleCatalogue';
import { useEligibilityFacts } from '@/hooks/bn/useEligibilityFacts';
import { useBnRuleGroups } from '@/hooks/bn/useBnConfig';
import { useRuleCatalogueGroupUsage } from '@/hooks/bn/useRuleCatalogueGroupUsage';
import {
  RULE_GROUP_TYPES, RULE_OPERATORS, FAIL_ACTIONS,
  validateRuleCatalogue,
  type RuleCatalogueItem, type RuleCatalogueInput, type FailAction,
} from '@/services/bn/ruleCatalogueService';
import { canonicalOperator } from '@/services/bn/governance/ruleGovernanceService';
import { statusBadgeVariant, sourceTypeBadgeVariant, describeFactSource, type EligibilityFact } from '@/services/bn/eligibilityFactService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { OverviewTab } from '@/components/bn/ruleCatalogue/OverviewTab';
import { CoverageTypesTab } from '@/components/bn/ruleCatalogue/CoverageTypesTab';
import { ValidationTab } from '@/components/bn/ruleCatalogue/ValidationTab';
import { ImpactTab } from '@/components/bn/ruleCatalogue/ImpactTab';
import { FactsTab } from '@/components/bn/ruleCatalogue/FactsTab';
import { DerivedFactsTab } from '@/pages/bn/config/DerivedFactRegistry';
import { RuntimeTestTab } from '@/components/bn/ruleCatalogue/RuntimeTestTab';
import { AuditTab } from '@/components/bn/ruleCatalogue/AuditTab';
import { validateAllRules } from '@/services/bn/ruleValidationService';
import { computeAllRuleReadiness } from '@/services/bn/readinessService';
import { Progress } from '@/components/ui/progress';
import { GovernanceStatusBadge } from '@/components/bn/governance/GovernanceStatusBadge';
import { GovernanceActionsMenu } from '@/components/bn/governance/GovernanceActionsMenu';
import { useQueryClient } from '@tanstack/react-query';

const emptyInput: RuleCatalogueInput = {
  rule_code: '', rule_name: '', description: '', group_type: 'CONTRIBUTION',
  category: 'CONTRIBUTION', parameter: null, fact_key: null,
  operator: 'GREATER_OR_EQUAL',
  value_from: '', value_to: '', values: null,
  default_fail_action: 'REJECT', failure_message_text: '',
  is_active: true, allow_product_override: true, tags: [],
  effective_from: null, effective_to: null,
  rule_group_id: null, rule_group_code: null, rule_group_name: null,
  default_group_sort_order: 0, default_rule_sort_order: 0,
};

/**
 * BUG-02 — these compared the stored operator against canonical words only.
 * Now that a rule keeps the spelling its fact declares, a rule saved with
 * "between" (53 facts store it lower-case) would have fallen through to
 * `value_from` and shown one bound of a range. Shape is judged canonically;
 * only display keeps the configured spelling.
 */
function fmtValue(r: RuleCatalogueItem): string {
  const op = canonicalOperator(r.operator);
  if (op === 'BETWEEN') return `${r.value_from ?? ''} – ${r.value_to ?? ''}`;
  if (op === 'IN' || op === 'NOT_IN') return Array.isArray(r.values) ? r.values.join(', ') : '';
  if (op === 'BOOLEAN' || op === 'EXISTS') return String(r.value_from ?? 'true');
  return r.value_from ?? '(per product)';
}

export default function RuleCatalogue() {
  const { data: rules = [], isLoading } = useRuleCatalogue();
  const { data: usage = {} } = useRuleCatalogueUsage();
  const { data: groupUsage = {} } = useRuleCatalogueGroupUsage();
  const { data: facts = [], isLoading: factsLoading } = useEligibilityFacts();
  const { data: ruleGroups = [] } = useBnRuleGroups();
  const upsert = useUpsertRuleCatalogue();
  const clone = useCloneRuleCatalogue();
  const remove = useDeleteRuleCatalogue();
  const toggle = useToggleRuleCatalogueActive();
  const qc = useQueryClient();

  const factByKey = useMemo(() => {
    const m = new Map<string, EligibilityFact>();
    for (const f of facts) m.set(f.fact_key, f);
    return m;
  }, [facts]);

  const [tab, setTab] = useState('rules');
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('ALL');
  const [ruleGroupFilter, setRuleGroupFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RuleCatalogueInput>(emptyInput);
  const [valuesText, setValuesText] = useState('');
  // A rule already approved and in real use must not be editable in place —
  // nothing here checked this before, so an approved rule's fact/operator/
  // value could be silently changed with no version bump and no
  // re-approval, while its governance status kept reading unchanged.
  const [editingGovernanceStatus, setEditingGovernanceStatus] = useState<string | null>(null);
  const [editingSourceRow, setEditingSourceRow] = useState<RuleCatalogueItem | null>(null);
  const LOCKED_GOVERNANCE_STATUSES = ['READY_FOR_PRODUCT_USE', 'ACTIVE', 'RETIRED'];
  const isEditingLocked = !!editingGovernanceStatus && LOCKED_GOVERNANCE_STATUSES.includes(editingGovernanceStatus);

  const filtered = useMemo(() => rules.filter(r => {
    if (groupFilter !== 'ALL' && r.group_type !== groupFilter) return false;
    if (ruleGroupFilter !== 'ALL') {
      if (ruleGroupFilter === '__none__') {
        if (r.rule_group_id) return false;
      } else if (r.rule_group_id !== ruleGroupFilter) return false;
    }
    if (statusFilter === 'ACTIVE' && !r.is_active) return false;
    if (statusFilter === 'INACTIVE' && r.is_active) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!r.rule_code.toLowerCase().includes(s) &&
          !r.rule_name.toLowerCase().includes(s) &&
          !(r.description ?? '').toLowerCase().includes(s) &&
          !(r.fact_key ?? '').toLowerCase().includes(s)) return false;
    }
    return true;
  }), [rules, search, groupFilter, ruleGroupFilter, statusFilter]);

  const summary = useMemo(() => {
    const used = new Set(Object.keys(usage));
    const implCount = rules.filter(r => {
      const f = r.fact_key ? factByKey.get(r.fact_key) : null;
      return f?.implementation_status === 'IMPLEMENTED';
    }).length;
    return {
      total: rules.length,
      active: rules.filter(r => r.is_active).length,
      used: rules.filter(r => used.has(r.rule_code)).length,
      implemented: implCount,
    };
  }, [rules, usage, factByKey]);

  const openNew = () => { setEditing({ ...emptyInput }); setValuesText(''); setEditingGovernanceStatus(null); setDialogOpen(true); };
  const openEdit = (r: RuleCatalogueItem) => {
    setEditing({
      id: r.id, rule_code: r.rule_code, rule_name: r.rule_name, description: r.description,
      group_type: r.group_type, category: r.category, parameter: r.parameter, fact_key: r.fact_key,
      operator: r.operator,
      value_from: r.value_from, value_to: r.value_to, values: r.values,
      default_fail_action: r.default_fail_action, failure_message_text: r.failure_message_text,
      is_active: r.is_active, allow_product_override: r.allow_product_override,
      tags: r.tags ?? [], effective_from: r.effective_from, effective_to: r.effective_to,
      rule_group_id: r.rule_group_id ?? null, rule_group_code: r.rule_group_code ?? null,
      rule_group_name: r.rule_group_name ?? null,
      default_group_sort_order: r.default_group_sort_order ?? 0,
      default_rule_sort_order: r.default_rule_sort_order ?? 0,
    });
    setValuesText(Array.isArray(r.values) ? r.values.join(', ') : '');
    setEditingGovernanceStatus((r as any).governance_status ?? null);
    setEditingSourceRow(r);
    setDialogOpen(true);
  };

  const onCloneAsNewVersion = async () => {
    if (!editingSourceRow) return;
    setDialogOpen(false);
    await onClone(editingSourceRow);
  };

  const selectedFact = editing.fact_key ? factByKey.get(editing.fact_key) : null;

  /**
   * BUG-43 — rule_code is NOT NULL UNIQUE, but nothing checked it. The only
   * check was the database constraint, whose message ("duplicate key value
   * violates unique constraint bn_rule_catalogue_rule_code_key") reached the
   * user unchanged, after they had completed the whole form. It also names the
   * constraint rather than the field, so a user who had changed the name but
   * not the code could not tell what was wrong.
   *
   * The rule list is already loaded, so this costs nothing. An existing rule
   * must not be compared against itself, or saving it unchanged would report it
   * as its own duplicate.
   */
  const duplicateCode = useMemo(() => {
    const code = (editing.rule_code ?? '').trim().toUpperCase();
    if (!code) return null;
    return (rules as RuleCatalogueItem[]).find(
      r => r.rule_code?.toUpperCase() === code && r.id !== editing.id,
    ) ?? null;
  }, [editing.rule_code, editing.id, rules]);

  /** Next free numeric suffix, so the user is offered a way forward. */
  const suggestedCode = useMemo(() => {
    if (!duplicateCode) return null;
    const code = (editing.rule_code ?? '').trim().toUpperCase();
    const taken = new Set((rules as RuleCatalogueItem[]).map(r => r.rule_code?.toUpperCase()));
    const base = code.replace(/_(\d+)$/, '');
    for (let n = 2; n <= 99; n++) {
      const candidate = `${base}_${String(n).padStart(2, '0')}`;
      if (!taken.has(candidate)) return candidate;
    }
    return null;
  }, [duplicateCode, editing.rule_code, rules]);

  const onSave = async () => {
    if (isEditingLocked) {
      toast.error('Rule is locked', {
        description: `This rule is ${editingGovernanceStatus} — already approved and in real use. Retire it and create a new one instead of editing it in place.`,
      });
      return;
    }
    const payload = { ...editing };
    const payloadOp = canonicalOperator(payload.operator);
    if (payloadOp === 'IN' || payloadOp === 'NOT_IN') {
      payload.values = valuesText.split(',').map(s => s.trim()).filter(Boolean);
    } else { payload.values = null; }
    if (!payload.fact_key) { toast.error('Fact is required', { description: 'Pick a fact from the Facts registry.' }); return; }
    const fact = factByKey.get(payload.fact_key);
    if (!fact) { toast.error('Selected fact does not exist'); return; }
    if (payload.is_active && fact.implementation_status === 'NOT_IMPLEMENTED') {
      toast.error('Cannot activate', { description: 'The selected fact is not yet implemented.' }); return;
    }
    // BUG-02 — compared as raw strings, this refused a rule whose operator was
    // written in the other valid spelling: a fact listing ">=" rejected
    // "GREATER_OR_EQUAL" and vice versa. The fact still decides WHICH operators
    // are permitted; only the spelling is reconciled.
    if (fact.allowed_operators?.length) {
      const wanted = canonicalOperator(payload.operator);
      const permitted = fact.allowed_operators
        .map((o: unknown) => canonicalOperator(String(o ?? '')))
        .filter((o): o is string => !!o);
      if (!wanted || (permitted.length > 0 && !permitted.includes(wanted))) {
        toast.error('Operator not allowed for this fact', {
          description: `Allowed: ${fact.allowed_operators.join(', ')}`,
        });
        return;
      }
    }
    if (duplicateCode) {
      toast.error('This rule code is already in use', {
        description: `${duplicateCode.rule_code} belongs to “${duplicateCode.rule_name}”.`
          + (suggestedCode ? ` Try ${suggestedCode}.` : ''),
      });
      return;
    }
    const err = validateRuleCatalogue(payload);
    if (err) { toast.error(err); return; }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    try {
      await upsert.mutateAsync({ input: payload, userCode });
    } catch (e: any) {
      // Safety net: two people can submit the same code within the same second,
      // so the constraint remains the final arbiter — but its wording must never
      // reach the user.
      const msg = String(e?.message ?? '');
      if (/bn_rule_catalogue_rule_code_key|duplicate key/i.test(msg)) {
        toast.error('This rule code is already in use', {
          description: 'Another rule with this code was created just now. Choose a different code.',
        });
        return;
      }
      toast.error('Could not save the rule', { description: msg || 'Unknown error' });
      return;
    }
    setDialogOpen(false);
  };

  const onClone = async (r: RuleCatalogueItem) => {
    const newCode = window.prompt('New rule code', `${r.rule_code}_COPY`);
    if (!newCode) return;
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    await clone.mutateAsync({ source: r, newCode: newCode.toUpperCase(), userCode });
  };
  const onDelete = async (r: RuleCatalogueItem) => {
    if (!window.confirm(`Delete rule ${r.rule_code}? This cannot be undone.`)) return;
    await remove.mutateAsync({ id: r.id, code: r.rule_code });
  };
  const onToggle = async (r: RuleCatalogueItem) => {
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    await toggle.mutateAsync({ id: r.id, isActive: !r.is_active, userCode });
  };

  /**
   * The operators this fact permits, in the spelling the fact itself declares.
   *
   * BUG-02 (second attempt) — the first fix canonicalised these for display.
   * `bn_eligibility_fact.allowed_operators` holds symbols on 53 facts, words on
   * 2, and an empty list on 20; the fix mapped every one of them onto the
   * canonical word list, so a fact configured with ">=" offered
   * "GREATER_OR_EQUAL" instead. That is a different thing from what the
   * administrator configured, and it is not this screen's business to restate
   * it. Worse, the save-time check below compares against
   * `allowed_operators` as raw strings, so the normalised value it wrote was
   * then rejected as "Operator not allowed for this fact".
   *
   * The fact's configuration is the source of truth for BOTH which operators
   * are permitted and how they are written. Acceptance is where the two
   * spellings are reconciled — see `canonicalOperator` in the technical-review
   * gate and in `operatorEvaluator` — never display.
   *
   * A fact that lists no operators permits all of them, in canonical spelling,
   * because there is no configured spelling to preserve.
   */
  const operatorOptions = useMemo<string[]>(() => {
    const allowed = selectedFact?.allowed_operators;
    if (!Array.isArray(allowed)) return [...RULE_OPERATORS];
    const configured = allowed
      .map(o => String(o ?? '').trim())
      .filter(o => o !== '' && canonicalOperator(o) !== null);
    // An empty list, or a list of values in neither vocabulary, must not leave
    // the dropdown with nothing selectable.
    return configured.length > 0 ? configured : [...RULE_OPERATORS];
  }, [selectedFact]);

  // Which inputs the form needs is a question about the operator's meaning, not
  // its spelling. A fact configuring "between" must still get two bounds.
  const editingOp = canonicalOperator(editing.operator);
  const isBetween = editingOp === 'BETWEEN';
  const isList = editingOp === 'IN' || editingOp === 'NOT_IN';
  const isBool = editingOp === 'BOOLEAN' || editingOp === 'EXISTS';

  return (
    <div className="container mx-auto py-6">
      <PageHeader
        title="Rule Catalogue"
        subtitle="Reusable eligibility rules, facts, usage and live testing — one place"
        breadcrumbs={[
          { label: 'Benefit Management', href: '/bn/dashboard' },
          { label: 'Configuration' },
          { label: 'Rule Catalogue' },
        ]}
        actions={<Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Rule</Button>}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Rules</div><div className="text-2xl font-bold">{summary.total}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Active</div><div className="text-2xl font-bold text-emerald-600">{summary.active}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Used in Products</div><div className="text-2xl font-bold">{summary.used}</div></CardContent></Card>
        <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Fact Implemented</div><div className="text-2xl font-bold text-primary">{summary.implemented}/{summary.total}</div></CardContent></Card>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview" className="gap-2"><LayoutDashboard className="h-4 w-4" /> Overview</TabsTrigger>
          <TabsTrigger value="facts" className="gap-2"><Database className="h-4 w-4" /> Facts</TabsTrigger>
          <TabsTrigger value="derived-facts" className="gap-2"><Sigma className="h-4 w-4" /> Derived Facts</TabsTrigger>
          <TabsTrigger value="rules" className="gap-2"><ListChecks className="h-4 w-4" /> Rules</TabsTrigger>
          <TabsTrigger value="coverage-types" className="gap-2"><GitBranch className="h-4 w-4" /> Coverage Types</TabsTrigger>
          <TabsTrigger value="coverage" className="gap-2"><ShieldCheck className="h-4 w-4" /> Implementation Coverage</TabsTrigger>
          <TabsTrigger value="validation" className="gap-2"><BadgeCheck className="h-4 w-4" /> Validation</TabsTrigger>
          <TabsTrigger value="audit" className="gap-2"><ShieldCheck className="h-4 w-4" /> Audit</TabsTrigger>
          <TabsTrigger value="test" className="gap-2"><FlaskConical className="h-4 w-4" /> Test</TabsTrigger>
          <TabsTrigger value="impact" className="gap-2"><Activity className="h-4 w-4" /> Impact</TabsTrigger>
          <TabsTrigger value="usage" className="gap-2"><Activity className="h-4 w-4" /> Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <OverviewTab rules={rules} facts={facts} />
        </TabsContent>

        <TabsContent value="coverage-types">
          <CoverageTypesTab rules={rules} facts={facts} />
        </TabsContent>

        <TabsContent value="validation">
          <ValidationTab rules={rules} facts={facts} />
        </TabsContent>

        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>

        <TabsContent value="impact">
          <ImpactTab rules={rules} facts={facts} />
        </TabsContent>


        {/* RULES TAB */}
        <TabsContent value="rules">
          <BNDataGrid
            id="bn.rule-catalogue"
            data={filtered}
            isLoading={isLoading}
            searchPlaceholder="Search code, name, fact"
            onCreate={openNew}
            defaultSort={[{ id: 'rule_code', desc: false }]}
            exportFilename="bn_rule_catalogue"
            emptyMessage="No rules match."
            toolbarFilters={[
              {
                key: 'category',
                label: 'Category',
                value: groupFilter,
                onChange: setGroupFilter,
                options: [{ value: 'ALL', label: 'All Categories' }, ...RULE_GROUP_TYPES.map(g => ({ value: g, label: g }))],
              },
              {
                key: 'rule_group',
                label: 'Rule Group',
                value: ruleGroupFilter,
                onChange: setRuleGroupFilter,
                options: [
                  { value: 'ALL', label: 'All Rule Groups' },
                  { value: '__none__', label: '— Unassigned —' },
                  ...ruleGroups.filter((g: any) => g.is_active).map((g: any) => ({ value: g.id, label: `${g.group_code} — ${g.group_name}` })),
                ],
              },
              {
                key: 'status',
                label: 'Status',
                value: statusFilter,
                onChange: setStatusFilter,
                options: [
                  { value: 'ALL', label: 'All Status' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ],
              },
            ]}
            columns={[
              { accessorKey: 'rule_code', header: 'Code', meta: { label: 'Code', pinLeft: true, width: 200 }, cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '')}</span> },
              { accessorKey: 'rule_name', header: 'Name', meta: { label: 'Name', width: 240 }, cell: ({ getValue }) => <span className="font-medium">{String(getValue() ?? '')}</span> },
              { accessorKey: 'category', header: 'Category', meta: { label: 'Category', width: 140 }, cell: ({ row }) => <Badge variant="outline">{row.original.category ?? row.original.group_type}</Badge> },
              { id: 'used_in_groups', header: 'Used in Groups', meta: { label: 'Used in Groups', width: 130 }, cell: ({ row }) => {
                const u = groupUsage[row.original.id];
                if (!u || u.group_count === 0) return <span className="text-muted-foreground">—</span>;
                return <Badge variant="secondary" title={(u.group_codes ?? []).join(', ')}>{u.group_count}</Badge>;
              } },
              { accessorKey: 'fact_key', header: 'Fact Key', meta: { label: 'Fact Key', width: 200 }, cell: ({ getValue }) => getValue() ? <span className="font-mono text-xs">{String(getValue())}</span> : <span className="text-destructive text-xs">— missing —</span> },
              { accessorKey: 'operator', header: 'Operator', meta: { label: 'Operator', width: 130 }, cell: ({ getValue }) => <span className="text-xs">{String(getValue() ?? '')}</span> },
              { id: 'default_value', header: 'Default Value', meta: { label: 'Default Value', width: 160 }, cell: ({ row }) => <span className="text-xs">{fmtValue(row.original)}</span> },
              { accessorKey: 'default_fail_action', header: 'Fail', meta: { label: 'Fail', width: 100 }, cell: ({ getValue }) => {
                const v = String(getValue() ?? '');
                return <Badge variant={v === 'REJECT' ? 'destructive' : v === 'BLOCK' ? 'secondary' : 'default'}>{v}</Badge>;
              } },
              { accessorKey: 'is_active', header: 'Active', meta: { label: 'Active', width: 90 }, cell: ({ getValue }) => getValue() ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge> },
              { id: 'fact_status', header: 'Fact', meta: { label: 'Fact', width: 140 }, cell: ({ row }) => {
                const f = row.original.fact_key ? factByKey.get(row.original.fact_key) : null;
                return f
                  ? <Badge variant={statusBadgeVariant(f.implementation_status)}>{f.implementation_status}</Badge>
                  : <Badge variant="destructive">UNLINKED</Badge>;
              } },
              { id: 'used', header: 'Used', meta: { label: 'Used', width: 70 }, cell: ({ row }) => <span className="text-xs">{usage[row.original.rule_code] ?? 0}</span> },
              { accessorKey: 'version', header: 'Ver', meta: { label: 'Ver', width: 70 }, cell: ({ getValue }) => <span className="text-xs">v{String(getValue() ?? '')}</span> },
              { id: 'governance', header: 'Governance', meta: { label: 'Governance', width: 200 }, cell: ({ row }) => {
                const r = row.original;
                return (
                  <div className="flex flex-col items-start gap-1">
                    <GovernanceStatusBadge status={(r as any).governance_status} />
                    <GovernanceActionsMenu
                      ruleId={r.id}
                      ruleCode={r.rule_code}
                      status={((r as any).governance_status ?? 'DRAFT') as any}
                      defaults={{
                        legal_reference: (r as any).legal_reference,
                        legal_notes: (r as any).legal_notes,
                        jurisdiction_country: (r as any).jurisdiction_country,
                        effective_date: (r as any).effective_date,
                      }}
                      onChanged={() => qc.invalidateQueries({ queryKey: ['bn', 'rule-catalogue'] })}
                    />
                  </div>
                );
              } },
            ] as BNColumnDef<RuleCatalogueItem>[]}
            rowActions={[
              { key: 'edit', label: 'Edit', icon: <Edit className="h-3.5 w-3.5" />, onClick: openEdit },
              { key: 'clone', label: 'Clone', icon: <Copy className="h-3.5 w-3.5" />, onClick: onClone },
              { key: 'toggle', label: 'Toggle Active', icon: <Power className="h-3.5 w-3.5" />, onClick: onToggle },
              { key: 'delete', label: 'Delete', icon: <Trash2 className="h-3.5 w-3.5" />, variant: 'destructive', onClick: onDelete, disabled: (r) => (usage[r.rule_code] ?? 0) > 0 },
            ]}
          />
        </TabsContent>


        {/* FACTS TAB */}
        <TabsContent value="facts">
          <FactsTab />
        </TabsContent>

        {/* DERIVED FACTS TAB — same registry as /bn/config/derived-facts, which
            had no route into it from anywhere in the application. */}
        <TabsContent value="derived-facts">
          <DerivedFactsTab />
        </TabsContent>

        {/* USAGE TAB */}
        <TabsContent value="usage">
          <BNDataGrid
            id="bn.rule-catalogue-usage"
            data={rules}
            searchPlaceholder="Search rules..."
            exportFilename="bn_rule_catalogue_usage"
            emptyMessage="No rules"
            defaultSort={[{ id: 'used_count', desc: true }]}
            columns={[
              { accessorKey: 'rule_code', header: 'Rule Code', meta: { label: 'Rule Code', pinLeft: true, width: 220 }, cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '')}</span> },
              { accessorKey: 'fact_key', header: 'Fact', meta: { label: 'Fact', width: 220 }, cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue() ?? '—')}</span> },
              { accessorKey: 'operator', header: 'Operator', meta: { label: 'Operator', width: 140 }, cell: ({ getValue }) => <span className="text-xs">{String(getValue() ?? '')}</span> },
              { accessorKey: 'default_fail_action', header: 'Default Fail', meta: { label: 'Default Fail', width: 130 }, cell: ({ getValue }) => <Badge variant="outline">{String(getValue() ?? '')}</Badge> },
              { id: 'used_count', header: '# Product Versions Using', meta: { label: '# Product Versions Using', width: 200, align: 'right' }, accessorFn: (r: any) => usage[r.rule_code] ?? 0, cell: ({ getValue }) => <span className="text-sm font-semibold">{Number(getValue() ?? 0)}</span> },
            ] as BNColumnDef<RuleCatalogueItem>[]}
          />
        </TabsContent>


        {/* TEST TAB */}
        <TabsContent value="coverage">
          <CoverageTab rules={rules} />
        </TabsContent>

        <TabsContent value="test">
          <RuntimeTestTab rules={rules} factByKey={factByKey} facts={facts} />
        </TabsContent>
      </Tabs>

      {/* RULE EDITOR DIALOG */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing.id ? 'Edit' : 'Add'} Catalogue Rule</DialogTitle>
            <DialogDescription>Reusable rule referenced by product versions</DialogDescription>
          </DialogHeader>
          {isEditingLocked && (
            <Alert variant="destructive">
              <Lock className="h-4 w-4" />
              <AlertDescription className="space-y-2">
                <p>
                  This rule is <strong>{editingGovernanceStatus}</strong> — already approved and in real use.
                  Editing is locked; changes here would silently apply everywhere this rule is used without a
                  new approval.
                </p>
                <Button size="sm" variant="outline" onClick={onCloneAsNewVersion}>
                  <Copy className="h-3.5 w-3.5 mr-1" /> Clone as New Version
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rule Code *</Label>
              <Input value={editing.rule_code}
                onChange={e => setEditing({ ...editing, rule_code: e.target.value.toUpperCase() })}
                disabled={!!editing.id} placeholder="MIN_TOTAL_CONTRIBUTIONS"
                aria-invalid={!!duplicateCode}
                className={duplicateCode ? 'border-destructive' : undefined} />
              {/* BUG-43 — the code must be unique, and nothing said so until the
                  database refused the finished form with a constraint name. */}
              {duplicateCode && (
                <p className="text-xs text-destructive">
                  A rule with code <span className="font-mono">{duplicateCode.rule_code}</span> already
                  exists{duplicateCode.rule_name ? ` — “${duplicateCode.rule_name}”` : ''}.
                  {suggestedCode && <> Try <span className="font-mono">{suggestedCode}</span>.</>}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Rule Name *</Label>
              <Input value={editing.rule_name} onChange={e => setEditing({ ...editing, rule_name: e.target.value })} />
            </div>
            <div className="space-y-2 col-span-2">
              <Label>Description</Label>
              <Textarea rows={2} value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </div>

            <div className="space-y-2 col-span-2">
              <Label>Fact *</Label>
              <Select
                value={editing.fact_key ?? ''}
                onValueChange={v => {
                  const f = factByKey.get(v);
                  setEditing(prev => ({
                    ...prev,
                    fact_key: v,
                    category: f?.category ?? prev.category,
                    // Keep the current operator when the new fact still permits
                    // it, and keep it in the spelling the fact declares.
                    // Permission is judged canonically — ">=" and
                    // "GREATER_OR_EQUAL" are the same requirement — but what is
                    // stored is the configured spelling, not a rewritten one
                    // (BUG-02).
                    operator: (() => {
                      const configured = (f?.allowed_operators ?? [])
                        .map(o => String(o ?? '').trim())
                        .filter(o => o !== '' && canonicalOperator(o) !== null);
                      // No configured list: the fact constrains nothing, so
                      // leave the operator exactly as the author left it.
                      if (configured.length === 0) return prev.operator;
                      const current = canonicalOperator(prev.operator);
                      const match = current
                        ? configured.find(o => canonicalOperator(o) === current)
                        : undefined;
                      return match ?? configured[0];
                    })(),
                  }));
                }}>
                <SelectTrigger><SelectValue placeholder="Pick a fact from the Facts registry" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {facts.map(f => (
                    <SelectItem key={f.fact_key} value={f.fact_key}>
                      <span className="font-mono text-xs">{f.fact_key}</span> — {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedFact && (
                <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                  <Badge variant={statusBadgeVariant(selectedFact.implementation_status)}>{selectedFact.implementation_status}</Badge>
                  <span>source: <span className="font-mono">{selectedFact.source_table}.{selectedFact.source_column}</span></span>
                  <span>resolver: <span className="font-mono">{selectedFact.resolver_function}</span></span>
                  <span>type: {selectedFact.data_type}</span>
                  {selectedFact.requires_snapshot && <Badge variant="outline">Snapshot Required</Badge>}
                </div>
              )}
              {selectedFact?.implementation_status === 'NOT_IMPLEMENTED' && (
                <Alert variant="destructive" className="py-2">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription className="text-xs">This fact is not implemented. The rule cannot be activated until the resolver is in place.</AlertDescription>
                </Alert>
              )}
            </div>

            <div className="space-y-2">
              <Label>Rule Category *</Label>
              <Select value={editing.group_type} onValueChange={v => setEditing({ ...editing, group_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_GROUP_TYPES.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Broad classification (AGE, CONTRIBUTION, …). Distinct from the reusable Rule Group below.</p>
            </div>
            <div className="space-y-2 col-span-2">
              <p className="text-xs text-muted-foreground">
                Rule Groups are now managed as optional templates from the <strong>Rule Groups</strong> screen.
                Use it to add this rule to one or more groups.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Operator *</Label>
              <Select value={editing.operator} onValueChange={v => setEditing({ ...editing, operator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {operatorOptions.map(o =>
                    <SelectItem key={o} value={o}>{o}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default Fail Action *</Label>
              <Select value={editing.default_fail_action} onValueChange={v => setEditing({ ...editing, default_fail_action: v as FailAction })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FAIL_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {!isList && !isBool && (
              <>
                <div className="space-y-2">
                  <Label>Value{isBetween ? ' From' : ''}{!isBetween && ' (default, optional)'}</Label>
                  <Input value={editing.value_from ?? ''} onChange={e => setEditing({ ...editing, value_from: e.target.value })} placeholder="configurable per product" />
                </div>
                {isBetween && (
                  <div className="space-y-2">
                    <Label>Value To *</Label>
                    <Input value={editing.value_to ?? ''} onChange={e => setEditing({ ...editing, value_to: e.target.value })} />
                  </div>
                )}
              </>
            )}
            {isBool && (
              <div className="space-y-2">
                <Label>Expected *</Label>
                <Select value={String(editing.value_from ?? 'true')} onValueChange={v => setEditing({ ...editing, value_from: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">true</SelectItem>
                    <SelectItem value="false">false</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {isList && (
              <div className="space-y-2 col-span-2">
                <Label>Values * (comma separated)</Label>
                <Input value={valuesText} onChange={e => setValuesText(e.target.value)} placeholder="ACTIVE, SUSPENDED, …" />
              </div>
            )}

            <div className="space-y-2 col-span-2">
              <Label>Failure Message</Label>
              <Textarea rows={2} value={editing.failure_message_text ?? ''} onChange={e => setEditing({ ...editing, failure_message_text: e.target.value })} />
            </div>

            <div className="space-y-2">
              <Label>Tags (comma separated)</Label>
              <Input value={(editing.tags ?? []).join(', ')} onChange={e => setEditing({ ...editing, tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
            </div>
            <div className="flex items-end gap-6">
              <div className="flex items-center gap-2">
                <Switch checked={editing.is_active} onCheckedChange={v => setEditing({ ...editing, is_active: v })} />
                <Label>Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={editing.allow_product_override} onCheckedChange={v => setEditing({ ...editing, allow_product_override: v })} />
                <Label>Allow product override</Label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Effective From</Label>
              <Input type="date" value={editing.effective_from ?? ''} onChange={e => setEditing({ ...editing, effective_from: e.target.value || null })} />
            </div>
            <div className="space-y-2">
              <Label>Effective To</Label>
              <Input type="date" value={editing.effective_to ?? ''} onChange={e => setEditing({ ...editing, effective_to: e.target.value || null })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={onSave} disabled={upsert.isPending || !!duplicateCode || isEditingLocked}>
              {upsert.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


/* -------- Coverage Tab -------- */
function CoverageTab({ rules }: { rules: RuleCatalogueItem[] }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CoverageRow[]>([]);

  const run = async () => {
    setLoading(true);
    try {
      const s = await computeRuleCoverage(rules);
      setRows(s.rows);
    } finally { setLoading(false); }
  };

  // auto-run when rules load/change
  useEffect(() => { if (rules.length) run(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [rules.length]);

  const ok = rows.filter(r => r.blocking_reasons.length === 0).length;
  const blocked = rows.filter(r => r.blocking_reasons.length > 0).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle className="flex-1">Fact Coverage Checker</CardTitle>
          <Button variant="outline" onClick={run} disabled={loading} className="gap-2"><ShieldCheck className="h-4 w-4" />{loading ? 'Checking…' : 'Re-check'}</Button>
        </div>
        <p className="text-sm text-muted-foreground">
          For every catalogue rule we verify the fact exists, has a resolver, has a known source table/column, the operator is allowed, and the implementation status. Rules with blocking issues cannot be safely published.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Wireable</div><div className="text-2xl font-bold text-emerald-600">{ok}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Blocked</div><div className="text-2xl font-bold text-destructive">{blocked}</div></CardContent></Card>
          <Card><CardContent className="pt-6"><div className="text-xs text-muted-foreground">Total Checked</div><div className="text-2xl font-bold">{rows.length}</div></CardContent></Card>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rule</TableHead>
              <TableHead>Fact</TableHead>
              <TableHead className="text-center">Fact</TableHead>
              <TableHead className="text-center">Resolver</TableHead>
              <TableHead className="text-center">Table</TableHead>
              <TableHead className="text-center">Column</TableHead>
              <TableHead className="text-center">Operator</TableHead>
              <TableHead className="text-center">Testable</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Blocking reasons</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.rule_id}>
                <TableCell><div className="font-mono text-xs">{r.rule_code}</div><div className="text-xs text-muted-foreground">{r.rule_name}</div></TableCell>
                <TableCell className="font-mono text-xs">{r.fact_key ?? '—'}</TableCell>
                <TableCell className="text-center">{r.fact_exists ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-destructive" />}</TableCell>
                <TableCell className="text-center">{r.resolver_exists ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-destructive" />}</TableCell>
                <TableCell className="text-center">{r.source_table_known ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-destructive" />}</TableCell>
                <TableCell className="text-center">{r.source_column_known ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-muted-foreground" />}</TableCell>
                <TableCell className="text-center">{r.operator_allowed ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-destructive" />}</TableCell>
                <TableCell className="text-center">{r.testable ? <CheckCircle2 className="h-4 w-4 inline text-emerald-600" /> : <XCircle className="h-4 w-4 inline text-destructive" />}</TableCell>
                <TableCell><Badge variant={r.implementation_status === 'IMPLEMENTED' ? 'default' : r.implementation_status === 'PARTIAL' ? 'secondary' : 'destructive'}>{r.implementation_status}</Badge></TableCell>
                <TableCell className="text-xs text-destructive">{r.blocking_reasons.join('; ') || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

