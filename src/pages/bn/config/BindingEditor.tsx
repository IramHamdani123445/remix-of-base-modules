/**
 * BindingEditor — create/edit a single product↔formula binding and its variable mappings.
 *
 * Bindings live in `bn_product_formula_binding`; per-binding variable mappings live in
 * `bn_product_formula_variable_mapping`. All audit fields are stamped with the active
 * user's `user_code`.
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { toast } from 'sonner';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';

const STAGES = ['PRIMARY','CAP','ARREARS','PRORATION','BENEFICIARY_SPLIT','FINAL'] as const;
const SOURCE_TYPES = ['FACT','DERIVED_FACT','PRODUCT_PARAMETER','RATE_TABLE','MATRIX_TABLE','PRIOR_FORMULA_RESULT','CLAIM_FIELD','MANUAL_INPUT','CONSTANT'] as const;
const ROUNDING = ['ROUND_HALF_UP','ROUND_DOWN','ROUND_UP','TRUNCATE','NEAREST_DOLLAR'] as const;

export interface BindingRow {
  id: string;
  product_id: string | null;
  product_version_id: string | null;
  formula_template_id: string;
  formula_version_id: string | null;
  calculation_stage: string;
  sequence_no: number;
  output_variable: string | null;
  rounding_rule: string | null;
  cap_min: number | null;
  cap_max: number | null;
  is_active: boolean;
  notes: string | null;
}

interface MappingRow {
  id?: string;
  binding_id?: string;
  variable_name: string;
  source_type: string;
  source_key: string | null;
  rate_table_code: string | null;
  required: boolean;
  default_value: string | null;
  _dirty?: boolean;
  _new?: boolean;
}

interface FormulaOpt { id: string; template_code: string; template_name: string; required_parameters: string[] | null }
interface ProductOpt { id: string; benefit_code: string; benefit_name: string }
interface RateTableOpt { table_code: string; table_name: string }

interface Props {
  open: boolean;
  binding: BindingRow | null;
  onClose: () => void;
  onSaved?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export function BindingEditor({ open, binding, onClose, onSaved }: Props) {
  const { profile } = useSupabaseAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<BindingRow | null>(null);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [formulas, setFormulas] = useState<FormulaOpt[]>([]);
  const [products, setProducts] = useState<ProductOpt[]>([]);
  const [rateTables, setRateTables] = useState<RateTableOpt[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [fT, pT, rT] = await Promise.all([
        sb.from('bn_formula_template').select('id, template_code, template_name, required_parameters').order('template_code'),
        sb.from('bn_product').select('id, benefit_code, benefit_name').order('benefit_code'),
        sb.from('bn_rate_table').select('table_code, table_name').eq('status','ACTIVE').order('table_code'),
      ]);
      if (!alive) return;
      setFormulas((fT.data ?? []) as FormulaOpt[]);
      setProducts((pT.data ?? []) as ProductOpt[]);
      setRateTables((rT.data ?? []) as RateTableOpt[]);
      setForm(binding ?? {
        id: '', product_id: null, product_version_id: null, formula_template_id: '',
        formula_version_id: null, calculation_stage: 'PRIMARY', sequence_no: 1,
        output_variable: null, rounding_rule: 'ROUND_HALF_UP', cap_min: null, cap_max: null,
        is_active: true, notes: null,
      });
      if (binding?.id) {
        const { data } = await sb.from('bn_product_formula_variable_mapping')
          .select('*').eq('binding_id', binding.id).order('variable_name');
        if (!alive) return;
        setMappings((data ?? []) as MappingRow[]);
      } else {
        setMappings([]);
      }
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, binding]);

  const selectedFormula = useMemo(
    () => formulas.find((f) => f.id === form?.formula_template_id) ?? null,
    [formulas, form?.formula_template_id],
  );

  const requiredVars = selectedFormula?.required_parameters ?? [];
  const mappedVarSet = new Set(mappings.map((m) => m.variable_name));
  const missingVars = requiredVars.filter((v) => !mappedVarSet.has(v));

  function setField<K extends keyof BindingRow>(k: K, v: BindingRow[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function addMapping(name = '') {
    setMappings((rows) => [...rows, {
      variable_name: name, source_type: 'FACT', source_key: name || null,
      rate_table_code: null, required: true, default_value: null, _new: true, _dirty: true,
    }]);
  }

  function updateMapping(idx: number, patch: Partial<MappingRow>) {
    setMappings((rows) => rows.map((r, i) => i === idx ? { ...r, ...patch, _dirty: true } : r));
  }

  function removeMapping(idx: number) {
    setMappings((rows) => rows.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!form) return;
    if (!form.formula_template_id) { toast.error('Pick a formula'); return; }
    if (!form.product_id) { toast.error('Pick a product'); return; }
    setSaving(true);
    try {
      const userCode = requireUserCode(profile?.user_code, 'edit formula binding');
      let bindingId = form.id;
      const payload = {
        product_id: form.product_id,
        product_version_id: form.product_version_id,
        formula_template_id: form.formula_template_id,
        formula_version_id: form.formula_version_id,
        calculation_stage: form.calculation_stage,
        sequence_no: form.sequence_no,
        output_variable: form.output_variable || null,
        rounding_rule: form.rounding_rule,
        cap_min: form.cap_min,
        cap_max: form.cap_max,
        is_active: form.is_active,
        notes: form.notes,
        modified_by: userCode,
      };
      if (bindingId) {
        const { error } = await sb.from('bn_product_formula_binding').update(payload).eq('id', bindingId);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from('bn_product_formula_binding')
          .insert({ ...payload, entered_by: userCode })
          .select('id').single();
        if (error) throw error;
        bindingId = data.id;
      }

      // Reconcile mappings: simple strategy → delete existing then re-insert all current.
      const { error: dErr } = await sb.from('bn_product_formula_variable_mapping')
        .delete().eq('binding_id', bindingId);
      if (dErr) throw dErr;

      if (mappings.length) {
        const insertRows = mappings
          .filter((m) => m.variable_name.trim())
          .map((m) => ({
            binding_id: bindingId,
            variable_name: m.variable_name.trim(),
            source_type: m.source_type,
            source_key: m.source_key?.trim() || null,
            rate_table_code: m.source_type === 'RATE_TABLE' || m.source_type === 'MATRIX_TABLE' ? (m.rate_table_code || null) : null,
            required: m.required,
            default_value: m.default_value || null,
          }));
        if (insertRows.length) {
          const { error: iErr } = await sb.from('bn_product_formula_variable_mapping').insert(insertRows);
          if (iErr) throw iErr;
        }
      }

      toast.success(form.id ? 'Binding updated' : 'Binding created');
      onSaved?.();
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{binding?.id ? 'Edit binding' : 'New product → formula binding'}</SheetTitle>
          <SheetDescription>
            Link a product to a formula at a calculation stage and map the formula's variables
            to data sources. All values resolve at runtime — nothing is hardcoded.
          </SheetDescription>
        </SheetHeader>

        {loading || !form ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-6 mt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label>Product</Label>
                <Select value={form.product_id ?? ''} onValueChange={(v) => setField('product_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => <SelectItem key={p.id} value={p.id}>{p.benefit_code} — {p.benefit_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label>Formula</Label>
                <Select value={form.formula_template_id ?? ''} onValueChange={(v) => setField('formula_template_id', v)}>
                  <SelectTrigger><SelectValue placeholder="Select formula" /></SelectTrigger>
                  <SelectContent>
                    {formulas.map((f) => <SelectItem key={f.id} value={f.id}>{f.template_code} — {f.template_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Stage</Label>
                <Select value={form.calculation_stage} onValueChange={(v) => setField('calculation_stage', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sequence</Label>
                <Input type="number" value={form.sequence_no} onChange={(e) => setField('sequence_no', Number(e.target.value) || 1)} />
              </div>
              <div>
                <Label>Output variable</Label>
                <Input value={form.output_variable ?? ''} onChange={(e) => setField('output_variable', e.target.value)} placeholder="e.g. weekly_amount" />
              </div>
              <div>
                <Label>Rounding</Label>
                <Select value={form.rounding_rule ?? 'ROUND_HALF_UP'} onValueChange={(v) => setField('rounding_rule', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{ROUNDING.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Cap min</Label>
                <Input type="number" value={form.cap_min ?? ''} onChange={(e) => setField('cap_min', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <Label>Cap max</Label>
                <Input type="number" value={form.cap_max ?? ''} onChange={(e) => setField('cap_max', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Input value={form.notes ?? ''} onChange={(e) => setField('notes', e.target.value)} />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-sm font-semibold">Variable mappings</h3>
                  <p className="text-xs text-muted-foreground">
                    {selectedFormula
                      ? `Formula requires ${requiredVars.length} variable(s). ${missingVars.length ? `${missingVars.length} missing.` : 'All mapped.'}`
                      : 'Pick a formula to see required variables.'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {missingVars.length > 0 && (
                    <Button size="sm" variant="outline" onClick={() => missingVars.forEach((v) => addMapping(v))}>
                      <Plus className="h-4 w-4 mr-1" /> Add missing ({missingVars.length})
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => addMapping()}><Plus className="h-4 w-4 mr-1" />Row</Button>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Variable</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Key / Table</TableHead>
                    <TableHead>Default</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mappings.map((m, idx) => {
                    const isTable = m.source_type === 'RATE_TABLE' || m.source_type === 'MATRIX_TABLE';
                    return (
                      <TableRow key={idx}>
                        <TableCell>
                          <Input value={m.variable_name} onChange={(e) => updateMapping(idx, { variable_name: e.target.value })} placeholder="variable_name" />
                        </TableCell>
                        <TableCell>
                          <Select value={m.source_type} onValueChange={(v) => updateMapping(idx, { source_type: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{SOURCE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          {isTable ? (
                            <Select value={m.rate_table_code ?? ''} onValueChange={(v) => updateMapping(idx, { rate_table_code: v })}>
                              <SelectTrigger><SelectValue placeholder="Select table" /></SelectTrigger>
                              <SelectContent>{rateTables.map((r) => <SelectItem key={r.table_code} value={r.table_code}>{r.table_code}</SelectItem>)}</SelectContent>
                            </Select>
                          ) : (
                            <Input value={m.source_key ?? ''} onChange={(e) => updateMapping(idx, { source_key: e.target.value })} placeholder="fact_code or param_key" />
                          )}
                        </TableCell>
                        <TableCell>
                          <Input value={m.default_value ?? ''} onChange={(e) => updateMapping(idx, { default_value: e.target.value })} placeholder="optional" />
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" onClick={() => removeMapping(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!mappings.length && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No mappings yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>

              {missingVars.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {missingVars.map((v) => <Badge key={v} variant="destructive" className="text-[10px]">missing: {v}</Badge>)}
                </div>
              )}
            </div>
          </div>
        )}

        <SheetFooter className="mt-6">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save binding
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
