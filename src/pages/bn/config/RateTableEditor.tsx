/**
 * RateTableEditor — drawer-style CRUD editor for bn_rate_table_row.
 *
 * Loads the table's dimensions, renders rows with one input per dimension
 * value (RANGE: min/max, EXACT/IN: single value) plus an output value field,
 * and saves changes back to the DB. Stamps entered_by/modified_by with the
 * authenticated user_code per BN audit standards.
 */
import { useEffect, useMemo, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useSupabaseAuth } from '@/contexts/SupabaseAuthContext';
import { requireUserCode } from '@/lib/bn/requireUserCode';
import { RateTableSimulator } from '@/components/bn/config/RateTableSimulator';
import { RateTableValidator } from '@/components/bn/config/RateTableValidator';
import { RateTableImportExport } from '@/components/bn/config/RateTableImportExport';
import { clearRateTableCache } from '@/services/bn/calc/rateTableLookup';
import { deleteRateTableRow, saveRateTableRow } from '@/services/bn/calc/governedCalcConfigService';


const db = supabase as any;

interface Dimension {
  id: string;
  dimension_key: string;
  dimension_label: string;
  dimension_type: string;
  match_type: 'RANGE' | 'EXACT' | 'IN';
  sequence_no: number;
}

interface Row {
  id?: string;
  row_order: number;
  dimension_values_json: Record<string, any>;
  output_value: number | null;
  output_type: string;
  effective_from?: string | null;
  effective_to?: string | null;
  notes?: string | null;
  _dirty?: boolean;
  _new?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  rateTable: { id: string; table_code: string; table_name: string; table_type: string } | null;
}

export function RateTableEditor({ open, onClose, rateTable }: Props) {
  const { profile } = useSupabaseAuth();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dims, setDims] = useState<Dimension[]>([]);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open || !rateTable) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [dRes, rRes] = await Promise.all([
        db.from('bn_rate_table_dimension').select('*').eq('rate_table_id', rateTable.id).order('sequence_no'),
        db.from('bn_rate_table_row').select('*').eq('rate_table_id', rateTable.id).order('row_order'),
      ]);
      if (!alive) return;
      setDims((dRes.data ?? []) as Dimension[]);
      setRows(((rRes.data ?? []) as any[]).map((r) => ({
        id: r.id,
        row_order: r.row_order,
        dimension_values_json: r.dimension_values_json ?? {},
        output_value: r.output_value != null ? Number(r.output_value) : null,
        output_type: r.output_type ?? 'AMOUNT',
        effective_from: r.effective_from,
        effective_to: r.effective_to,
        notes: r.notes,
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [open, rateTable]);

  const defaultOutputType = useMemo(() => {
    if (!rateTable) return 'AMOUNT';
    if (rateTable.table_type === 'MATRIX' || rateTable.table_type === 'TIER' || rateTable.table_type === 'SHARE_TABLE') return 'PERCENTAGE';
    return 'AMOUNT';
  }, [rateTable]);

  const addRow = () => {
    const seed: Record<string, any> = {};
    for (const d of dims) {
      seed[d.dimension_key] = d.match_type === 'RANGE' ? { min: null, max: null } : '';
    }
    setRows((rs) => [...rs, {
      row_order: (rs[rs.length - 1]?.row_order ?? 0) + 1,
      dimension_values_json: seed,
      output_value: null,
      output_type: defaultOutputType,
      _dirty: true,
      _new: true,
    }]);
  };

  const updateRow = (idx: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)));
  };

  const updateDimVal = (idx: number, key: string, value: any) => {
    setRows((rs) => rs.map((r, i) => i === idx
      ? { ...r, dimension_values_json: { ...r.dimension_values_json, [key]: value }, _dirty: true }
      : r));
  };

  const removeRow = async (idx: number) => {
    const row = rows[idx];
    if (row.id) {
      let userCode: string;
      try {
        userCode = requireUserCode(profile?.user_code, 'edit rate table');
      } catch (e: any) {
        toast.error(e.message);
        return;
      }
      try {
        await deleteRateTableRow(row.id, userCode);
      } catch (e: any) {
        toast.error(e.message ?? 'Delete failed');
        return;
      }
    }
    setRows((rs) => rs.filter((_, i) => i !== idx));
  };

  const save = async () => {
    if (!rateTable) return;
    let userCode: string;
    try {
      userCode = requireUserCode(profile?.user_code, 'edit rate table');
    } catch (e: any) {
      toast.error(e.message);
      return;
    }
    const dirty = rows.filter((r) => r._dirty);
    if (!dirty.length) { toast.message('No changes'); return; }
    setSaving(true);
    try {
      for (const r of dirty) {
        // Governed path only — direct table writes are refused by the
        // calculation immutability guard.
        await saveRateTableRow({
          rowId: r._new ? null : r.id ?? null,
          rateTableId: rateTable.id,
          rowOrder: r.row_order,
          dimensionValues: r.dimension_values_json,
          outputValue: r.output_value,
          outputType: r.output_type,
          effectiveFrom: r.effective_from || null,
          effectiveTo: r.effective_to || null,
          notes: r.notes || null,
          userCode,
        });
      }
      toast.success(`Saved ${dirty.length} row(s)`);
      // refresh
      const { data } = await db.from('bn_rate_table_row').select('*').eq('rate_table_id', rateTable.id).order('row_order');
      setRows(((data ?? []) as any[]).map((r) => ({
        id: r.id, row_order: r.row_order,
        dimension_values_json: r.dimension_values_json ?? {},
        output_value: r.output_value != null ? Number(r.output_value) : null,
        output_type: r.output_type, effective_from: r.effective_from, effective_to: r.effective_to, notes: r.notes,
      })));
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };


  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-5xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {rateTable?.table_name}
            {rateTable && <Badge variant="outline" className="font-mono text-xs">{rateTable.table_code}</Badge>}
          </SheetTitle>
          <SheetDescription>
            Manage rows for this {rateTable?.table_type?.toLowerCase()} table. Changes are
            saved to the database and stamped with your user code.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {loading || !rateTable ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {dims.length} dimension(s) · {rows.length} row(s)
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={addRow}><Plus className="h-4 w-4 mr-1" />Add row</Button>
                  <Button size="sm" onClick={save} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                    Save
                  </Button>
                </div>
              </div>

              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      {dims.map((d) => (
                        <TableHead key={d.id}>
                          {d.dimension_label}
                          <span className="text-xs text-muted-foreground ml-1">({d.match_type})</span>
                        </TableHead>
                      ))}
                      <TableHead>Output</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r, idx) => (
                      <TableRow key={r.id ?? `new-${idx}`} className={r._dirty ? 'bg-accent/30' : ''}>
                        <TableCell>
                          <Input
                            type="number"
                            value={r.row_order}
                            onChange={(e) => updateRow(idx, { row_order: Number(e.target.value) })}
                            className="w-16 h-8"
                          />
                        </TableCell>
                        {dims.map((d) => (
                          <TableCell key={d.id}>
                            {d.match_type === 'RANGE' ? (
                              <div className="flex gap-1">
                                <Input
                                  placeholder="min"
                                  className="h-8 w-20"
                                  value={r.dimension_values_json[d.dimension_key]?.min ?? ''}
                                  onChange={(e) => updateDimVal(idx, d.dimension_key, { ...(r.dimension_values_json[d.dimension_key] ?? {}), min: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                                <Input
                                  placeholder="max"
                                  className="h-8 w-20"
                                  value={r.dimension_values_json[d.dimension_key]?.max ?? ''}
                                  onChange={(e) => updateDimVal(idx, d.dimension_key, { ...(r.dimension_values_json[d.dimension_key] ?? {}), max: e.target.value === '' ? null : Number(e.target.value) })}
                                />
                              </div>
                            ) : (
                              <Input
                                className="h-8 w-32"
                                value={r.dimension_values_json[d.dimension_key] ?? ''}
                                onChange={(e) => updateDimVal(idx, d.dimension_key, e.target.value)}
                              />
                            )}
                          </TableCell>
                        ))}
                        <TableCell>
                          <Input
                            type="number"
                            step="0.000001"
                            className="h-8 w-28"
                            value={r.output_value ?? ''}
                            onChange={(e) => updateRow(idx, { output_value: e.target.value === '' ? null : Number(e.target.value) })}
                          />
                        </TableCell>
                        <TableCell>
                          <select
                            className="h-8 w-32 rounded border bg-background px-2 text-sm"
                            value={r.output_type}
                            onChange={(e) => updateRow(idx, { output_type: e.target.value })}
                          >
                            {['PERCENTAGE', 'AMOUNT', 'RATE', 'MULTIPLIER', 'FLAG', 'TEXT'].map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeRow(idx)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && (
                      <TableRow><TableCell colSpan={dims.length + 4} className="text-center text-muted-foreground py-6">
                        No rows yet — click "Add row" to start.
                      </TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>


              <div className="grid md:grid-cols-2 gap-3">
                <RateTableImportExport
                  tableCode={rateTable!.table_code}
                  dims={dims}
                  rows={rows}
                  onImport={(parsed) => setRows(parsed.map((p) => ({ ...p, _new: true, _dirty: true })))}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Validation</div>
                  <RateTableValidator dimensions={dims} rows={rows} />
                </div>
                <RateTableSimulator tableCode={rateTable!.table_code} dimensions={dims} />
              </div>

              <p className="text-xs text-muted-foreground">
                For RANGE dimensions, leave <code>max</code> empty to mean "no upper bound".
                Save validates each row against the table's dimensions and effective dates.
              </p>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
