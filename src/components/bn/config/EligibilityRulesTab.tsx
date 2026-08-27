import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, Edit, GripVertical, FlaskConical, CheckCircle2, XCircle, Sparkles, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useBnEligibilityRules, useUpsertBnEligibilityRule, useDeleteBnEligibilityRule } from '@/hooks/bn/useBnProduct';
import { useBnRuleGroups } from '@/hooks/bn/useBnConfig';
import { BN_FAIL_ACTIONS } from '@/types/bn';
import type { BnEligibilityRule } from '@/types/bn';
import {
  ELIGIBILITY_FIELD_REGISTRY,
  ELIGIBILITY_OPERATOR_LABELS,
  ELIGIBILITY_WINDOW_OPTIONS,
  getFieldDef,
  type EligibilityOperator,
} from '@/services/bn/eligibility/fieldRegistry';
import { resolveField, type ResolvedValue } from '@/services/bn/eligibility/fieldResolver';
import { evaluateOperator } from '@/services/bn/eligibility/operatorEvaluator';
import {
  RULE_GROUPS,
  defaultGroupForFact,
  ELIGIBILITY_FACTS,
} from '@/services/bn/eligibility/eligibilityFactRegistry';
import { lookupField, type KnownField } from '@/services/bn/eligibility/ruleFieldMapping';
import { RULE_TEMPLATES, type RuleTemplate } from '@/services/bn/eligibility/ruleTemplates';
import { RuleWizardDialog } from './RuleWizardDialog';
import { CataloguePickerDialog } from './CataloguePickerDialog';
import { AddRuleGroupFromCatalogueDialog } from './AddRuleGroupFromCatalogueDialog';
import { AddRulesByCategoryDialog } from './AddRulesByCategoryDialog';
import { EligibilityConflictPanel } from './EligibilityConflictPanel';
import { Wand2, Library, FolderPlus, LayoutGrid } from 'lucide-react';

import { ReadOnlyVersionBanner } from './ReadOnlyVersionBanner';

interface Props { versionId: string | undefined; isReadOnly?: boolean; versionStatus?: string | null; productCode?: string | null; }

const emptyRule: Partial<BnEligibilityRule> = {
  rule_code: '', rule_name: '', rule_type: 'CONTRIBUTION', rule_group: 'GENERAL',
  rule_definition: { field_key: '', operator: '>=', value: 0, window_type: 'LIFETIME' },
  data_source: '', fail_message: '', fail_action: 'REJECT', sort_order: 0, is_active: true,
  group_code: 'CORE_IDENTITY', severity: 'BLOCK', overrideable: false, override_policy_code: null, fact_key: null,
};

export function EligibilityRulesTab({ versionId, isReadOnly, versionStatus, productCode }: Props) {
  const { toast } = useToast();
  const { data: rules = [], isLoading } = useBnEligibilityRules(versionId);
  const { data: ruleGroups = [] } = useBnRuleGroups();
  const upsertMutation = useUpsertBnEligibilityRule();
  const deleteMutation = useDeleteBnEligibilityRule();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [wizardInitial, setWizardInitial] = useState<Partial<BnEligibilityRule> | null>(null);
  const [editing, setEditing] = useState<Partial<BnEligibilityRule>>(emptyRule);

  // Preview state
  const [previewSsn, setPreviewSsn] = useState('');
  const [previewDate, setPreviewDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewResult, setPreviewResult] = useState<{
    resolved: ResolvedValue;
    passed: boolean;
    reason: string;
  } | null>(null);

  if (!versionId) return <Card><CardContent className="py-8 text-center text-muted-foreground">Select or create a product version first.</CardContent></Card>;

  const def = (editing.rule_definition || {}) as Record<string, any>;

  /**
   * One descriptor for a field from either catalogue, so every control below
   * works the same whether the key came from the field registry or the fact
   * registry.
   */
  const fieldDef = useMemo(() => {
    const key: string | undefined = def.field_key || (editing.fact_key ?? undefined);
    if (!key) return undefined;
    const fromFields = getFieldDef(key);
    if (fromFields) {
      return {
        key,
        label: fromFields.label,
        valueType: fromFields.valueType,
        helpText: fromFields.helpText,
        dataSource: fromFields.dataSource,
        operators: fromFields.operators as EligibilityOperator[],
        supportsWindow: !!fromFields.supportsWindow,
        supportsDocumentType: !!fromFields.supportsDocumentType,
        registry: 'field' as const,
      };
    }
    const known = lookupField(key);
    if (!known) return undefined;
    const fact = ELIGIBILITY_FACTS.find((f) => f.fact_key === key);
    return {
      key,
      label: known.label,
      valueType: known.valueType,
      helpText: fact?.description ?? 'Resolved from the eligibility fact registry.',
      dataSource: fact ? `${fact.source_table}.${fact.source_column}` : 'bn_claim_document.verification_status',
      operators: (['>=', '>', '<=', '<', '==', '!=', 'IN', 'BETWEEN'] as EligibilityOperator[]),
      supportsWindow: false,
      supportsDocumentType: false,
      registry: 'fact' as const,
    };
  }, [def.field_key, editing.fact_key]);

  const openNew = () => {
    setEditing({ ...emptyRule, product_version_id: versionId });
    setPreviewResult(null);
    setDialogOpen(true);
  };
  const openEdit = (rule: BnEligibilityRule) => {
    setEditing({ ...rule });
    setPreviewResult(null);
    setDialogOpen(true);
  };

  const updateEditing = (field: string, value: unknown) => setEditing(prev => ({ ...prev, [field]: value }));
  const updateDefinition = (field: string, value: unknown) =>
    setEditing(prev => ({ ...prev, rule_definition: { ...(prev.rule_definition as Record<string, unknown>), [field]: value } }));

  const onFieldKeyChange = (key: string) => {
    const fd = getFieldDef(key);
    const known = lookupField(key);
    const valueType = fd?.valueType ?? known?.valueType;
    setEditing(prev => ({
      ...prev,
      rule_definition: {
        ...(prev.rule_definition as Record<string, unknown>),
        field_key: key,
        operator: fd?.operators[0] ?? '==',
        // Reset value when valueType changes
        value: valueType === 'boolean' ? true : '',
      },
      // Leave data_source empty for a fact — the registry documents its own
      // source, and a stale free-text value is the BUG-31 mismatch defect.
      data_source: fd?.dataSource ?? '',
      rule_type: fd ? mapCategoryToRuleType(fd.category) : prev.rule_type,
      fact_key: key,
      group_code: prev.group_code || safeDefaultGroup(key),
    }));
  };

  const applyTemplate = (tpl: RuleTemplate) => {
    setEditing(prev => ({
      ...prev,
      rule_code: prev.rule_code || tpl.template_code,
      rule_name: prev.rule_name || tpl.label,
      fail_message: prev.fail_message || tpl.description,
      group_code: tpl.group_code,
      severity: tpl.severity ?? 'BLOCK',
      overrideable: tpl.overrideable ?? false,
      fact_key: tpl.fact_key,
      rule_definition: {
        ...(prev.rule_definition as Record<string, unknown>),
        field_key: tpl.fact_key,
        operator: tpl.operator,
        value: tpl.default_value,
      },
    }));
    toast({ title: 'Template applied', description: `${tpl.label} pre-filled. Adjust the expected value before saving.` });
  };

  const handleSave = async () => {
    if (!editing.rule_code || !editing.rule_name) {
      toast({ title: 'Validation', description: 'Code and Name are required.', variant: 'destructive' }); return;
    }
    if (!def.field_key) {
      toast({ title: 'Validation', description: 'Please choose a field from the catalogue.', variant: 'destructive' }); return;
    }
    // BUG-31/32 — refuse to save a rule the engine could never evaluate. This
    // is the same check the publish gate applies, brought forward to the point
    // the rule is written.
    if (!lookupField(def.field_key)) {
      toast({
        title: 'Field not in either catalogue',
        description: `"${def.field_key}" is in neither the field registry nor the fact registry, so this rule could never be evaluated and would block every claim. Choose a field from the list.`,
        variant: 'destructive',
      });
      return;
    }
    try {
      await upsertMutation.mutateAsync(editing);
      toast({ title: 'Saved', description: 'Eligibility rule saved.' });
      setDialogOpen(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try { await deleteMutation.mutateAsync(id); toast({ title: 'Deleted' }); } catch (err: any) { toast({ title: 'Error', description: err?.message, variant: 'destructive' }); }
  };

  const runPreview = async () => {
    if (!fieldDef) return;
    if (!previewSsn.trim()) {
      toast({ title: 'SSN required', description: 'Enter a sample SSN to test.', variant: 'destructive' }); return;
    }
    setPreviewBusy(true);
    setPreviewResult(null);
    try {
      let resolved: ResolvedValue;
      if (fieldDef.registry === 'field') {
        resolved = await resolveField(def.field_key, {
          ssn: previewSsn.trim(),
          claimDate: previewDate,
        }, {
          windowType: def.window_type,
          windowFrom: def.window_from,
          windowTo: def.window_to,
          documentTypeCode: def.document_type_code,
        });
      } else {
        const { resolveFact } = await import('@/services/bn/eligibility/eligibilityFactResolver');
        const r = await resolveFact(def.field_key, {
          ssn: previewSsn.trim(),
          claimDate: previewDate,
        });
        resolved = {
          fieldKey: r.fact_key,
          resolver: r.fact_key,
          value: r.value,
          sourceLabel: `${r.source_table}.${r.source_column}`,
          notes: r.reason,
        };
      }
      const ev = evaluateOperator(resolved.value, def.operator, def.value, fieldDef.valueType, {
        rangeFrom: def.range_from,
        rangeTo: def.range_to,
      });
      setPreviewResult({ resolved, passed: ev.passed, reason: ev.reason });
    } catch (err: any) {
      toast({ title: 'Preview failed', description: err?.message, variant: 'destructive' });
    } finally {
      setPreviewBusy(false);
    }
  };

  /**
   * BUG-32 — the field list must cover BOTH catalogues.
   *
   * This dropdown offered only the 13 keys in the field registry, so rules on
   * facts such as `person.gender` or `spouse.contribution.total_weeks` could
   * not be created here at all — which is why the maternity gender rule had to
   * be written outside the application, or not at all.
   */
  const groupedFields = useMemo(() => {
    const map = new Map<string, { key: string; label: string; helpText: string }[]>();
    const push = (category: string, entry: { key: string; label: string; helpText: string }) => {
      const arr = map.get(category) || [];
      if (!arr.some((e) => e.key === entry.key)) arr.push(entry);
      map.set(category, arr);
    };
    for (const f of ELIGIBILITY_FIELD_REGISTRY) {
      push(f.category, { key: f.key, label: f.label, helpText: f.helpText });
    }
    for (const f of ELIGIBILITY_FACTS) {
      push(f.category, { key: f.fact_key, label: f.label, helpText: f.description });
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, []);

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>Eligibility Rules</CardTitle><CardDescription>Define checks that must pass before a claim is eligible</CardDescription></div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="default" onClick={() => setCategoryPickerOpen(true)} className="gap-2" disabled={isReadOnly || !versionId}><LayoutGrid className="h-4 w-4" /> Add by Category</Button>
            <Button variant="outline" onClick={() => setGroupPickerOpen(true)} className="gap-2" disabled={isReadOnly || !versionId}><FolderPlus className="h-4 w-4" /> Add from Rule Group</Button>
            <Button variant="outline" onClick={() => setPickerOpen(true)} className="gap-2" disabled={isReadOnly || !versionId}><Library className="h-4 w-4" /> Catalogue Picker</Button>
            <Button variant="outline" onClick={() => { setWizardInitial(null); setWizardOpen(true); }} className="gap-2" disabled={isReadOnly}><Wand2 className="h-4 w-4" /> New (Wizard)</Button>
            <Button onClick={openNew} className="gap-2" disabled={isReadOnly}><Plus className="h-4 w-4" /> Add Custom Rule</Button>
          </div>
        </CardHeader>
        <CardContent>
          <ReadOnlyVersionBanner show={!!isReadOnly} status={versionStatus} />
          <div className="mb-4"><EligibilityConflictPanel rules={rules} /></div>
          {isLoading ? <p className="text-muted-foreground py-4">Loading...</p> : rules.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">No eligibility rules configured. Click "Add Rule" to get started.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead className="w-8">#</TableHead><TableHead>Code</TableHead><TableHead>Name</TableHead>
                <TableHead>Field</TableHead><TableHead>Check</TableHead>
                <TableHead>Fail Action</TableHead><TableHead>Active</TableHead><TableHead className="w-20">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rules.map((rule: BnEligibilityRule) => {
                  const rd = (rule.rule_definition || {}) as any;
                  const fd = getFieldDef(rd.field_key);
                  return (
                    <TableRow key={rule.id}>
                      <TableCell><GripVertical className="h-4 w-4 text-muted-foreground" /></TableCell>
                      <TableCell className="font-mono text-sm">{rule.rule_code}</TableCell>
                      <TableCell className="font-medium">{rule.rule_name}</TableCell>
                      <TableCell>
                        {fd ? (
                          <div className="text-sm">
                            <div>{fd.label}</div>
                            <div className="text-xs text-muted-foreground">{fd.category}</div>
                          </div>
                        ) : (
                          <Badge variant="outline">Legacy</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm font-mono">
                        {rd.field_key ? `${rd.operator ?? ''} ${formatValue(rd.value)}` : '—'}
                      </TableCell>
                      <TableCell><Badge variant={rule.fail_action === 'REJECT' ? 'destructive' : 'secondary'}>{rule.fail_action}</Badge></TableCell>
                      <TableCell>{rule.is_active ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" disabled={isReadOnly} title="Edit (Wizard)" onClick={() => { setWizardInitial(rule); setWizardOpen(true); }}><Wand2 className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" disabled={isReadOnly} title="Edit (Legacy)" onClick={() => openEdit(rule)}><Edit className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" disabled={isReadOnly} onClick={() => handleDelete(rule.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing.id ? 'Edit' : 'Add'} Eligibility Rule</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {/* Quick Templates */}
            <div className="col-span-2 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <Label className="text-sm font-semibold">Quick Templates</Label>
                <span className="text-xs text-muted-foreground">Click to pre-fill from a common eligibility pattern</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {RULE_TEMPLATES.map(t => (
                  <Button key={t.template_code} type="button" size="sm" variant="outline"
                    className="h-7 text-xs" title={t.description} onClick={() => applyTemplate(t)}>
                    + {t.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2"><Label>Rule Code *</Label><Input value={editing.rule_code || ''} onChange={e => updateEditing('rule_code', e.target.value.toUpperCase())} maxLength={30} /></div>
            <div className="space-y-2"><Label>Rule Name *</Label><Input value={editing.rule_name || ''} onChange={e => updateEditing('rule_name', e.target.value)} /></div>

            <div className="space-y-2">
              <Label>Eligibility Group *</Label>
              <Select value={editing.group_code || 'CORE_IDENTITY'} onValueChange={v => updateEditing('group_code', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_GROUPS.map(g => (
                    <SelectItem key={g.code} value={g.code}>
                      <div>
                        <div className="font-medium">{g.label}</div>
                        <div className="text-xs text-muted-foreground">{g.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Custom Rule Group (optional)</Label>
              <Select value={editing.rule_group_id || '__none__'} onValueChange={v => updateEditing('rule_group_id', v === '__none__' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Select group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">None</SelectItem>
                  {ruleGroups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.group_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Severity</Label>
              <Select value={editing.severity || 'BLOCK'} onValueChange={v => updateEditing('severity', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="BLOCK"><div className="flex items-center gap-2"><ShieldAlert className="h-3 w-3 text-destructive" /> Block (hard fail)</div></SelectItem>
                  <SelectItem value="WARN"><div className="flex items-center gap-2"><ShieldCheck className="h-3 w-3 text-amber-600" /> Warn (soft warning)</div></SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Fail Action</Label>
              <Select value={editing.fail_action || 'REJECT'} onValueChange={v => updateEditing('fail_action', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BN_FAIL_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="col-span-2 flex items-center gap-6 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Switch checked={editing.overrideable ?? false} onCheckedChange={v => updateEditing('overrideable', v)} />
                <Label>Allow supervisor override</Label>
              </div>
              {editing.overrideable && (
                <div className="flex items-center gap-2 flex-1">
                  <Label className="text-xs whitespace-nowrap">Override policy code</Label>
                  <Input value={editing.override_policy_code || ''} onChange={e => updateEditing('override_policy_code', e.target.value || null)} placeholder="e.g. SUPERVISOR_L2" />
                </div>
              )}
            </div>

            <div className="col-span-2 space-y-3 rounded-lg border p-4">
              <Label className="text-sm font-semibold">Rule Definition (business-safe field catalogue)</Label>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs">Field *</Label>
                  <Select value={def.field_key || ''} onValueChange={onFieldKeyChange}>
                    <SelectTrigger><SelectValue placeholder="Choose a business field..." /></SelectTrigger>
                    <SelectContent className="max-h-72">
                      {groupedFields.map(([cat, fields]) => (
                        <div key={cat}>
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">{cat}</div>
                          {fields.map(f => (
                            <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldDef && (
                    <p className="text-xs text-muted-foreground">{fieldDef.helpText} — <span className="font-mono">{fieldDef.dataSource}</span></p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Operator</Label>
                  <Select value={def.operator || '>='} onValueChange={v => updateDefinition('operator', v)} disabled={!fieldDef}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(fieldDef?.operators ?? []).map(op => (
                        <SelectItem key={op} value={op}>{ELIGIBILITY_OPERATOR_LABELS[op as EligibilityOperator]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {fieldDef && def.operator !== 'BETWEEN' && (
                <div className="space-y-1">
                  <Label className="text-xs">Expected Value</Label>
                  {fieldDef.valueType === 'boolean' ? (
                    <Select value={String(def.value ?? 'true')} onValueChange={v => updateDefinition('value', v === 'true')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={fieldDef.valueType === 'number' ? 'number' : fieldDef.valueType === 'date' ? 'date' : 'text'}
                      value={def.value ?? ''}
                      onChange={e => updateDefinition('value', fieldDef.valueType === 'number' ? Number(e.target.value) : e.target.value)}
                      placeholder={def.operator === 'IN' ? 'comma,separated,values' : ''}
                    />
                  )}
                </div>
              )}

              {fieldDef && def.operator === 'BETWEEN' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">From</Label>
                    <Input type={fieldDef.valueType === 'date' ? 'date' : 'number'} value={def.range_from ?? ''} onChange={e => updateDefinition('range_from', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To</Label>
                    <Input type={fieldDef.valueType === 'date' ? 'date' : 'number'} value={def.range_to ?? ''} onChange={e => updateDefinition('range_to', e.target.value)} />
                  </div>
                </div>
              )}

              {fieldDef?.supportsWindow && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Window</Label>
                    <Select value={def.window_type || 'LIFETIME'} onValueChange={v => updateDefinition('window_type', v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ELIGIBILITY_WINDOW_OPTIONS.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {def.window_type === 'CUSTOM_DATE_RANGE' && (
                    <>
                      <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={def.window_from ?? ''} onChange={e => updateDefinition('window_from', e.target.value)} /></div>
                      <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={def.window_to ?? ''} onChange={e => updateDefinition('window_to', e.target.value)} /></div>
                    </>
                  )}
                </div>
              )}

              {fieldDef?.supportsDocumentType && (
                <div className="space-y-1">
                  <Label className="text-xs">Document Type Code</Label>
                  <Input value={def.document_type_code ?? ''} onChange={e => updateDefinition('document_type_code', e.target.value)} placeholder="e.g. MEDICAL_CERT" />
                </div>
              )}
            </div>

            {/* Business-readable rule preview */}
            {fieldDef && def.field_key && (
              <div className="col-span-2 rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-1">
                <Label className="text-xs font-semibold uppercase text-primary">Rule Preview</Label>
                <p className="text-sm">
                  <strong>{fieldDef.label}</strong>{' '}
                  <span className="text-muted-foreground">{ELIGIBILITY_OPERATOR_LABELS[def.operator as EligibilityOperator] ?? def.operator}</span>{' '}
                  <span className="font-mono">{def.operator === 'BETWEEN' ? `${def.range_from} … ${def.range_to}` : formatValue(def.value)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Group: <Badge variant="outline" className="ml-1">{editing.group_code}</Badge>{' '}
                  Severity: <Badge variant={editing.severity === 'WARN' ? 'secondary' : 'destructive'} className="ml-1">{editing.severity}</Badge>{' '}
                  Source: <span className="font-mono">{fieldDef.dataSource}</span>
                  {editing.overrideable && <> · Overrideable{editing.override_policy_code ? ` (${editing.override_policy_code})` : ''}</>}
                </p>
              </div>
            )}


            <div className="col-span-2 space-y-2"><Label>Fail Message</Label><Textarea value={editing.fail_message || ''} onChange={e => updateEditing('fail_message', e.target.value)} rows={2} placeholder="Message shown when rule fails" /></div>

            {/* BUG-32 — alternative routes to one statutory requirement. */}
            <div className="col-span-2 space-y-1">
              <Label>Alternative group (optional)</Label>
              <Input
                value={def.alternative_group ?? ''}
                onChange={e => updateDefinition('alternative_group', e.target.value.trim() || undefined)}
                placeholder="e.g. MATG_CONTRIB_BASIS"
              />
              <p className="text-xs text-muted-foreground">
                Use when a requirement can be met in more than one way. Rules sharing a
                group are satisfied when <strong>any one</strong> of them passes, instead of
                all of them. Example: the Maternity Grant qualifies on the claimant&rsquo;s own
                contributions <em>or</em> on those of her insured husband — give both rules the
                same group. Leave blank for a rule that must pass on its own.
              </p>
              {def.alternative_group && (
                <p className="text-xs text-amber-600">
                  {rules.filter(r => ((r.rule_definition || {}) as any).alternative_group === def.alternative_group && r.id !== editing.id).length}
                  {' '}other rule(s) already share this group.
                </p>
              )}
            </div>
            <div className="space-y-2"><Label>Sort Order</Label><Input type="number" value={editing.sort_order ?? 0} onChange={e => updateEditing('sort_order', parseInt(e.target.value) || 0)} /></div>
            <div className="flex items-center gap-2 pt-6"><Switch checked={editing.is_active ?? true} onCheckedChange={v => updateEditing('is_active', v)} /><Label>Active</Label></div>

            {/* Preview / Test */}
            <div className="col-span-2 space-y-3 rounded-lg border border-dashed p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold flex items-center gap-2"><FlaskConical className="h-4 w-4" /> Preview / Test</Label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1"><Label className="text-xs">Sample SSN</Label><Input value={previewSsn} onChange={e => setPreviewSsn(e.target.value)} placeholder="e.g. 123456" /></div>
                <div className="space-y-1"><Label className="text-xs">Claim Date</Label><Input type="date" value={previewDate} onChange={e => setPreviewDate(e.target.value)} /></div>
                <div className="flex items-end"><Button type="button" variant="outline" onClick={runPreview} disabled={!fieldDef || previewBusy} className="w-full">{previewBusy ? 'Running…' : 'Run Test'}</Button></div>
              </div>
              {previewResult && (
                <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    {previewResult.passed ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-destructive" />}
                    {previewResult.passed ? 'PASS' : 'FAIL'} — {previewResult.reason}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    <div>Actual value: <span className="font-mono">{formatValue(previewResult.resolved.value)}</span></div>
                    <div>Source: <span className="font-mono">{previewResult.resolved.sourceLabel}</span></div>
                    {previewResult.resolved.windowResolved && (
                      <div>Window: {previewResult.resolved.windowResolved.type} ({previewResult.resolved.windowResolved.from} → {previewResult.resolved.windowResolved.to})</div>
                    )}
                    {previewResult.resolved.notes && <div>{previewResult.resolved.notes}</div>}
                  </div>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={upsertMutation.isPending}>{upsertMutation.isPending ? 'Saving...' : 'Save Rule'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {versionId && (
        <RuleWizardDialog
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          productVersionId={versionId}
          productCode={productCode ?? null}
          initial={wizardInitial}
        />
      )}

      {versionId && (
        <>
          <CataloguePickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            versionId={versionId}
          />
          <AddRuleGroupFromCatalogueDialog
            open={groupPickerOpen}
            onOpenChange={setGroupPickerOpen}
            versionId={versionId}
            productCode={productCode ?? null}
          />
          <AddRulesByCategoryDialog
            open={categoryPickerOpen}
            onOpenChange={setCategoryPickerOpen}
            versionId={versionId}
          />
        </>
      )}
    </>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

function safeDefaultGroup(factKey: string): string {
  try { return defaultGroupForFact(factKey); } catch { return 'SPECIAL'; }
}

function mapCategoryToRuleType(cat: string): string {
  switch (cat) {
    case 'CONTRIBUTION': return 'CONTRIBUTION';
    case 'PERSON': return 'AGE';
    case 'EMPLOYER': return 'EMPLOYMENT';
    case 'EVIDENCE': return 'MEDICAL';
    case 'CLAIM': return 'CUSTOM';
    default: return 'CUSTOM';
  }
}
