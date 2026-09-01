/**
 * Calculation v2 Panel — DB-driven product calculation configuration.
 *
 * Replaces the legacy hard-coded calculation tab. Everything here is fed
 * from the DB tables: bn_formula_template / bn_formula_version,
 * bn_product_formula_binding, bn_rate_table, bn_medical_tariff_table.
 *
 * Capabilities:
 *  - List bindings for the current product version, sorted by stage+sequence
 *  - Add / edit / delete a binding (formula template + version + stage + caps + rounding)
 *  - Inline simulation runner: enter manual inputs → run formula → see trace
 *  - Reference picker for available rate tables and medical tariff tables
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CheckCircle2, Loader2, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  runProductCalculationV2,
  loadProductBindings,
  loadFormulaVersion,
  loadMappings,
  type BindingRow,
} from '@/services/bn/calc/runProductCalculationV2';
import { runFormula, applyRounding } from '@/services/bn/calc/formulaRunner';
import { resolveVariables, emptyContext } from '@/services/bn/calc/variableResolver';
import { ProductFormulaStepMappings, type StepMappingJson } from '@/components/bn/config/ProductFormulaStepMappings';
import { BnBusyButton } from '@/components/bn/shared';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

const STAGES = ['PRIMARY', 'CAP', 'ARREARS', 'PRORATION', 'BENEFICIARY_SPLIT', 'FINAL'] as const;
const ROUNDING_RULES = ['NONE', 'ROUND_2', 'ROUND_0', 'CEIL_2', 'FLOOR_2'] as const;

interface FormulaTemplate { id: string; template_code: string; template_name: string; category: string | null }
interface FormulaVersion { id: string; formula_template_id: string; formula_code: string; version_no: number; expression_type: string; is_active: boolean; governance_status: string }
interface RateTable { id: string; table_code: string; table_name: string; table_type: string | null; status: string | null }
interface MedicalTariffTable { id: string; tariff_code: string; tariff_name: string; status: string | null }

interface Props {
  productId: string;
  productVersionId: string;
  isReadOnly?: boolean;
}

export function CalculationV2Panel({ productId, productVersionId, isReadOnly }: Props) {
  const [loading, setLoading] = useState(true);
  const [bindings, setBindings] = useState<BindingRow[]>([]);
  const [templates, setTemplates] = useState<FormulaTemplate[]>([]);
  const [versions, setVersions] = useState<FormulaVersion[]>([]);
  const [rateTables, setRateTables] = useState<RateTable[]>([]);
  const [tariffTables, setTariffTables] = useState<MedicalTariffTable[]>([]);
  const [editing, setEditing] = useState<Partial<BindingRow> & { notes?: string | null; step_mapping_json?: StepMappingJson | null } | null>(null);
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const [b, t, v, r, m] = await Promise.all([
        loadProductBindings(productVersionId),
        sb.from('bn_formula_template').select('id, template_code, template_name, category').eq('is_active', true).order('template_code'),
        // Only ACTIVE versions are eligible for binding — drafts and retired versions are filtered out.
        sb.from('bn_formula_version')
          .select('id, formula_template_id, formula_code, version_no, expression_type, is_active, governance_status')
          .eq('governance_status', 'ACTIVE')
          .order('version_no', { ascending: false }),
        sb.from('bn_rate_table').select('id, table_code, table_name, table_type, status').order('table_code'),
        sb.from('bn_medical_tariff_table').select('id, tariff_code, tariff_name, status').order('tariff_code'),
      ]);
      setBindings(b);
      const activeVersions: FormulaVersion[] = v.data ?? [];
      setVersions(activeVersions);
      // Only show templates that have at least one ACTIVE version (i.e. bindable).
      const activeTemplateIds = new Set(activeVersions.map((vv) => vv.formula_template_id));
      setTemplates((t.data ?? []).filter((tpl: FormulaTemplate) => activeTemplateIds.has(tpl.id)));
      setRateTables(r.data ?? []);
      setTariffTables(m.data ?? []);
    } catch (e) {
      toast.error('Failed to load calculation configuration', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productVersionId) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productVersionId]);

  const sortedBindings = useMemo(() => {
    return [...bindings].sort((a, b) => {
      const sa = STAGES.indexOf(a.calculation_stage as typeof STAGES[number]);
      const sb_ = STAGES.indexOf(b.calculation_stage as typeof STAGES[number]);
      return sa - sb_ || a.sequence_no - b.sequence_no;
    });
  }, [bindings]);

  const resolveBoundVersion = (): FormulaVersion | undefined => {
    if (editing?.formula_version_id) return versions.find((v) => v.id === editing.formula_version_id);
    if (editing?.formula_template_id)
      return versions
        .filter((v) => v.formula_template_id === editing.formula_template_id)
        .sort((a, b) => b.version_no - a.version_no)[0];
    return undefined;
  };

  const handleValidateBinding = () => {
    const issues: string[] = [];
    if (!editing?.formula_template_id) issues.push('Pick a formula template.');
    if (!editing?.calculation_stage) issues.push('Pick a calculation stage.');
    const ver = resolveBoundVersion();
    if (editing?.formula_template_id && !ver) issues.push('No ACTIVE version exists for this formula. Activate one in Formula Library first.');
    if (ver && ver.governance_status !== 'ACTIVE') issues.push(`Selected version is ${ver.governance_status}; only ACTIVE versions are bindable.`);
    if (!editing?.output_variable?.trim()) issues.push('Provide an output variable so downstream stages can read this result.');
    const sm = editing?.step_mapping_json as any;
    if (sm && Array.isArray(sm.steps)) {
      for (const s of sm.steps) {
        for (const inp of s.inputs ?? []) {
          if (!inp.source || (inp.source !== 'CONSTANT' && !inp.ref)) {
            issues.push(`Step "${s.step_key ?? s.kind}" input "${inp.key}" is unmapped.`);
          }
        }
      }
    }
    if (issues.length) toast.error('Binding has issues', { description: issues.slice(0, 4).join(' · ') });
    else toast.success('Binding looks good — ready to save.');
  };

  const handleSave = async () => {
    if (!editing?.formula_template_id || !editing?.calculation_stage) {
      toast.error('Formula template and stage are required');
      return;
    }
    const ver = resolveBoundVersion();
    if (!ver) {
      toast.error('No ACTIVE version available for this formula', {
        description: 'Activate a version in Formula Library before binding it.',
      });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        product_id: productId,
        product_version_id: productVersionId,
        formula_template_id: editing.formula_template_id,
        // Pin to the resolved ACTIVE version so a future re-activation does not silently swap bindings.
        formula_version_id: editing.formula_version_id ?? ver.id,
        calculation_stage: editing.calculation_stage,
        sequence_no: editing.sequence_no ?? 10,
        output_variable: editing.output_variable ?? null,
        rounding_rule: editing.rounding_rule ?? null,
        cap_min: editing.cap_min ?? null,
        cap_max: editing.cap_max ?? null,
        is_active: editing.is_active ?? true,
        notes: editing.notes ?? null,
        step_mapping_json: editing.step_mapping_json ?? null,
      };
      if (editing.id) {
        const { error } = await sb.from('bn_product_formula_binding').update(payload).eq('id', editing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from('bn_product_formula_binding').insert(payload);
        if (error) throw error;
      }
      toast.success('Binding saved');
      setEditing(null);
      await reload();
    } catch (e) {
      toast.error('Save failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this binding?')) return;
    const { error } = await sb.from('bn_product_formula_binding').delete().eq('id', id);
    if (error) return toast.error('Delete failed', { description: error.message });
    toast.success('Deleted');
    await reload();
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="bindings" className="w-full">
        <TabsList>
          <TabsTrigger value="bindings">Formula Bindings</TabsTrigger>
          <TabsTrigger value="references">Rate / Tariff Tables</TabsTrigger>
          <TabsTrigger value="simulate">Simulate</TabsTrigger>
        </TabsList>

        <TabsContent value="bindings" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Active formula bindings</CardTitle>
              {!isReadOnly && (
                <Button size="sm" onClick={() => setEditing({ calculation_stage: 'PRIMARY' as never, sequence_no: 10, is_active: true })}>
                  <Plus className="mr-2 h-4 w-4" /> Add binding
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
              ) : sortedBindings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No bindings configured. All calculations for this product will fail until at least one PRIMARY binding is added.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-left">
                      <tr>
                        <th className="px-3 py-2">Stage</th>
                        <th className="px-3 py-2">Seq</th>
                        <th className="px-3 py-2">Formula</th>
                        <th className="px-3 py-2">Output var</th>
                        <th className="px-3 py-2">Cap min</th>
                        <th className="px-3 py-2">Cap max</th>
                        <th className="px-3 py-2">Rounding</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedBindings.map((b) => {
                        const tpl = templates.find(t => t.id === b.formula_template_id);
                        return (
                          <tr key={b.id} className="border-t">
                            <td className="px-3 py-2"><Badge variant="outline">{b.calculation_stage}</Badge></td>
                            <td className="px-3 py-2">{b.sequence_no}</td>
                            <td className="px-3 py-2 font-mono text-xs">{tpl?.template_code ?? b.formula_template_id.slice(0, 8)}</td>
                            <td className="px-3 py-2 font-mono text-xs">{b.output_variable ?? '—'}</td>
                            <td className="px-3 py-2">{b.cap_min ?? '—'}</td>
                            <td className="px-3 py-2">{b.cap_max ?? '—'}</td>
                            <td className="px-3 py-2">{b.rounding_rule ?? '—'}</td>
                            <td className="px-3 py-2">{b.is_active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>}</td>
                            <td className="px-3 py-2 text-right">
                              {!isReadOnly && (
                                <div className="flex justify-end gap-1">
                                  <Button size="sm" variant="ghost" onClick={async () => {
                                    const { data } = await sb.from('bn_product_formula_binding').select('step_mapping_json').eq('id', b.id).single();
                                    setEditing({ ...b, step_mapping_json: (data?.step_mapping_json ?? null) as StepMappingJson | null });
                                  }}>Edit</Button>
                                  <Button size="sm" variant="ghost" onClick={() => handleDelete(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {editing && (
            <Card>
              <CardHeader><CardTitle className="text-base">{editing.id ? 'Edit binding' : 'New binding'}</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <Label>Formula template *</Label>
                  <Select value={editing.formula_template_id ?? ''} onValueChange={(v) => setEditing({ ...editing, formula_template_id: v, formula_version_id: null })}>
                    <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {templates.map(t => <SelectItem key={t.id} value={t.id}>{t.template_code} — {t.template_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Formula version (ACTIVE only — latest if blank)</Label>
                  <Select value={editing.formula_version_id ?? ''} onValueChange={(v) => setEditing({ ...editing, formula_version_id: v || null })}>
                    <SelectTrigger><SelectValue placeholder="Latest ACTIVE" /></SelectTrigger>
                    <SelectContent>
                      {versions.filter(v => v.formula_template_id === editing.formula_template_id).map(v => (
                        <SelectItem key={v.id} value={v.id}>v{v.version_no} · {v.expression_type} · ACTIVE</SelectItem>
                      ))}
                      {versions.filter(v => v.formula_template_id === editing.formula_template_id).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">No ACTIVE version yet — activate one in Formula Library first.</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Calculation stage *</Label>
                  <Select value={editing.calculation_stage ?? ''} onValueChange={(v) => setEditing({ ...editing, calculation_stage: v as never })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Sequence</Label>
                  <Input type="number" value={editing.sequence_no ?? 10} onChange={(e) => setEditing({ ...editing, sequence_no: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Output variable</Label>
                  <Input value={editing.output_variable ?? ''} onChange={(e) => setEditing({ ...editing, output_variable: e.target.value })} placeholder="e.g. monthly_pension" />
                </div>
                <div>
                  <Label>Rounding rule</Label>
                  <Select value={editing.rounding_rule ?? ''} onValueChange={(v) => setEditing({ ...editing, rounding_rule: v })}>
                    <SelectTrigger><SelectValue placeholder="Default" /></SelectTrigger>
                    <SelectContent>{ROUNDING_RULES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Cap min</Label>
                  <Input type="number" value={editing.cap_min ?? ''} onChange={(e) => setEditing({ ...editing, cap_min: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Cap max</Label>
                  <Input type="number" value={editing.cap_max ?? ''} onChange={(e) => setEditing({ ...editing, cap_max: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
                <div className="md:col-span-2">
                  <Label>Notes</Label>
                  <Textarea value={editing.notes ?? ''} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2} />
                </div>
                <div className="md:col-span-2 border-t pt-3">
                  <h4 className="text-sm font-semibold mb-2">Formula step mappings</h4>
                  <p className="text-xs text-muted-foreground mb-3">
                    Map each step input to a product parameter, fact, derived fact, prior formula result or constant. Rate-table dimensions are auto-resolved from the formula's LOOKUP steps. Medical tariff steps default to <span className="font-mono">bn_medical_reimbursement_limit</span>.
                  </p>
                  <ProductFormulaStepMappings
                    formulaVersionId={
                      editing.formula_version_id ??
                      (versions.find(v => v.formula_template_id === editing.formula_template_id && v.is_active)?.id ?? null)
                    }
                    value={editing.step_mapping_json ?? null}
                    onChange={(next) => setEditing({ ...editing, step_mapping_json: next })}
                    disabled={isReadOnly}
                  />
                </div>
                <div className="md:col-span-2 flex justify-end gap-2">
                  <BnBusyButton loading={saving} variant="ghost" onClick={() => setEditing(null)} disabled={saving}>Cancel</BnBusyButton>
                  <BnBusyButton loading={saving} variant="outline" onClick={handleValidateBinding} disabled={saving}>
                    <ShieldCheck className="mr-2 h-4 w-4" />Validate
                  </BnBusyButton>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Save
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="references" className="mt-4 space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Rate / matrix tables ({rateTables.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody>
                  {rateTables.map(r => (
                    <tr key={r.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{r.table_code}</td><td className="px-3 py-2">{r.table_name}</td><td className="px-3 py-2">{r.table_type ?? '—'}</td><td className="px-3 py-2">{r.status ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Medical tariff tables ({tariffTables.length})</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left"><tr><th className="px-3 py-2">Code</th><th className="px-3 py-2">Name</th><th className="px-3 py-2">Status</th></tr></thead>
                <tbody>
                  {tariffTables.map(t => (
                    <tr key={t.id} className="border-t"><td className="px-3 py-2 font-mono text-xs">{t.tariff_code}</td><td className="px-3 py-2">{t.tariff_name}</td><td className="px-3 py-2">{t.status ?? '—'}</td></tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulate" className="mt-4">
          <SimulatePanel productId={productId} productVersionId={productVersionId} bindings={sortedBindings} templates={templates} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface SimulateProps {
  productId: string;
  productVersionId: string;
  bindings: BindingRow[];
  templates: FormulaTemplate[];
}

function SimulatePanel({ productId, productVersionId, bindings, templates }: SimulateProps) {
  const [scopeJson, setScopeJson] = useState<string>('{\n  "average_insurable_wage": 1000,\n  "total_contributions": 1200\n}');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runProductCalculationV2>> | null>(null);
  const [singleBindingId, setSingleBindingId] = useState<string | null>(null);

  const runAll = async () => {
    setBusy(true);
    try {
      const manualInputs = JSON.parse(scopeJson || '{}');
      const ctx = { ...emptyContext(), manualInputs };
      const res = await runProductCalculationV2({
        productId, productVersionId,
        runMode: 'SIMULATION',
        context: ctx,
        writeTrace: false,
      });
      setResult(res);
    } catch (e) {
      toast.error('Simulation failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runOne = async () => {
    if (!singleBindingId) return;
    setBusy(true);
    try {
      const b = bindings.find(x => x.id === singleBindingId);
      if (!b) throw new Error('Binding not found');
      const manualInputs = JSON.parse(scopeJson || '{}');
      const ctx = { ...emptyContext(), manualInputs };
      const [formula, mappings] = await Promise.all([
        loadFormulaVersion(b.formula_version_id, b.formula_template_id),
        loadMappings(b.id),
      ]);
      const { scope, rateTableRefs, missing } = resolveVariables(mappings, ctx);
      if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
      const res = await runFormula(formula, scope, rateTableRefs);
      const rounded = applyRounding(res.output, b.rounding_rule ?? formula.rounding_rule);
      setResult({
        bindings: [{
          binding_id: b.id, formula_code: formula.formula_code, formula_version: formula.version_no,
          calculation_stage: b.calculation_stage, sequence_no: b.sequence_no,
          raw_output: res.output, rounded_output: rounded, output_variable: b.output_variable,
          lookup_trace: res.lookupTrace, expression_trace: res.expressionTrace, status: 'OK',
        }],
        finalScope: res.scope,
        finalAmount: rounded,
      });
    } catch (e) {
      toast.error('Run failed', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Simulation runner</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Manual inputs (JSON) — these populate <code>context.manualInputs</code></Label>
          <Textarea value={scopeJson} onChange={(e) => setScopeJson(e.target.value)} rows={8} className="font-mono text-xs" />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <BnBusyButton loading={busy} onClick={runAll} disabled={busy}><Play className="mr-2 h-4 w-4" />Run all bindings</BnBusyButton>
          <div className="flex items-end gap-2">
            <div>
              <Label>Or single binding</Label>
              <Select value={singleBindingId ?? ''} onValueChange={setSingleBindingId}>
                <SelectTrigger className="min-w-[260px]"><SelectValue placeholder="Pick binding…" /></SelectTrigger>
                <SelectContent>
                  {bindings.map(b => {
                    const tpl = templates.find(t => t.id === b.formula_template_id);
                    return <SelectItem key={b.id} value={b.id}>{b.calculation_stage}/{b.sequence_no} · {tpl?.template_code ?? b.formula_template_id.slice(0, 8)}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
            <BnBusyButton loading={busy} variant="secondary" onClick={runOne} disabled={busy || !singleBindingId}>Run one</BnBusyButton>
          </div>
        </div>

        {result && (
          <div className="space-y-3 rounded-md border p-3">
            <div className="text-sm"><strong>Final amount:</strong> {result.finalAmount ?? '—'}</div>
            {result.bindings.map((b, i) => (
              <div key={i} className="rounded border bg-muted/30 p-2 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Badge variant={b.status === 'OK' ? 'default' : 'destructive'}>{b.status}</Badge>
                  <span className="font-mono">{b.formula_code} v{b.formula_version}</span>
                  <span>· {b.calculation_stage}/{b.sequence_no}</span>
                  <span className="ml-auto">→ <strong>{b.rounded_output ?? String(b.raw_output)}</strong></span>
                </div>
                {b.error && <div className="text-destructive">{b.error}</div>}
                {b.lookup_trace?.length > 0 && (
                  <details><summary className="cursor-pointer">Lookup trace ({b.lookup_trace.length})</summary>
                    <pre className="overflow-x-auto">{JSON.stringify(b.lookup_trace, null, 2)}</pre>
                  </details>
                )}
                {b.expression_trace?.length > 0 && (
                  <details><summary className="cursor-pointer">Expression trace ({b.expression_trace.length})</summary>
                    <pre className="overflow-x-auto">{JSON.stringify(b.expression_trace, null, 2)}</pre>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
