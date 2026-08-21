/**
 * SimulationPanel — manual fact-driven runner for the BN Calculation Engine v2.
 *
 * Pick a product version → enter facts/manual inputs → run all active bindings →
 * see the full per-binding trace (input scope, rate lookups, expression steps).
 */
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Play, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { runProductCalculationV2, type ProductCalculationResult } from '@/services/bn/calc/runProductCalculationV2';
import { emptyContext } from '@/services/bn/calc/variableResolver';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

interface ProductVersionOpt {
  id: string;
  version_number: number;
  product_id: string;
  benefit_code: string;
  benefit_name: string;
}

interface FactRow { key: string; value: string }

export function SimulationPanel() {
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState<ProductVersionOpt[]>([]);
  const [productVersionId, setProductVersionId] = useState<string>('');
  const [facts, setFacts] = useState<FactRow[]>([
    { key: 'average_weekly_wage', value: '500' },
    { key: 'incapacity_weeks', value: '4' },
  ]);
  const [params, setParams] = useState<FactRow[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ProductCalculationResult | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from('bn_product_version')
        .select('id, version_number, product_id, bn_product:product_id(benefit_code, benefit_name)')
        .order('version_number', { ascending: false })
        .limit(200);
      if (!alive) return;
      if (error) {
        // Surface the failure — silently rendering an empty dropdown makes a
        // broken query indistinguishable from a product list with no entries.
        toast.error('Could not load product versions', { description: error.message });
        setVersions([]);
        setLoading(false);
        return;
      }
      const rows = (data ?? []).map((v: { id: string; version_number: number; product_id: string; bn_product?: { benefit_code?: string; benefit_name?: string } }) => ({
        id: v.id, version_number: v.version_number, product_id: v.product_id,
        benefit_code: v.bn_product?.benefit_code ?? '?', benefit_name: v.bn_product?.benefit_name ?? '?',
      })) as ProductVersionOpt[];
      setVersions(rows);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const selected = useMemo(() => versions.find((v) => v.id === productVersionId) ?? null, [versions, productVersionId]);

  function updateRow(setter: React.Dispatch<React.SetStateAction<FactRow[]>>, idx: number, patch: Partial<FactRow>) {
    setter((rs) => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function buildScope(rows: FactRow[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      if (!r.key.trim()) continue;
      const n = Number(r.value);
      out[r.key.trim()] = r.value !== '' && Number.isFinite(n) && String(n) === r.value.trim() ? n : r.value;
    }
    return out;
  }

  async function run() {
    if (!productVersionId) { toast.error('Pick a product version'); return; }
    setRunning(true);
    setResult(null);
    try {
      const ctx = emptyContext();
      ctx.facts = buildScope(facts);
      ctx.productParameters = buildScope(params);
      const res = await runProductCalculationV2({
        productVersionId,
        productId: selected?.product_id,
        runMode: 'SIMULATION',
        context: ctx,
        writeTrace: false,
      });
      setResult(res);
      const errs = res.bindings.filter((b) => b.status === 'ERROR');
      if (errs.length) toast.error(`${errs.length} step(s) errored`);
      else toast.success(`Final amount: ${res.finalAmount ?? '—'}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Simulation failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">Simulation Runner</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Product Version</Label>
                <Select value={productVersionId} onValueChange={setProductVersionId}>
                  <SelectTrigger><SelectValue placeholder="Select product version" /></SelectTrigger>
                  <SelectContent>
                    {versions.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.benefit_code} — {v.benefit_name} (v{v.version_number})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button onClick={run} disabled={running || !productVersionId} className="w-full">
                  {running ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Play className="h-4 w-4 mr-1" />}
                  Run simulation
                </Button>
              </div>
            </div>

            <KVEditor title="Facts" rows={facts} setRows={setFacts} onUpdate={(i, p) => updateRow(setFacts, i, p)} />
            <KVEditor title="Product parameters" rows={params} setRows={setParams} onUpdate={(i, p) => updateRow(setParams, i, p)} />

            {result && (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <Badge variant="default" className="text-base px-3 py-1">Final: {result.finalAmount ?? '—'}</Badge>
                  <Badge variant="secondary">{result.bindings.length} step(s)</Badge>
                </div>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead><TableHead>Stage</TableHead><TableHead>Formula</TableHead>
                    <TableHead>Output</TableHead><TableHead>Var</TableHead><TableHead>Status</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {result.bindings.map((b, i) => (
                      <TableRow key={b.binding_id}>
                        <TableCell>{i + 1}</TableCell>
                        <TableCell><Badge variant="outline">{b.calculation_stage}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{b.formula_code}@v{b.formula_version}</TableCell>
                        <TableCell className="font-mono">{b.rounded_output ?? String(b.raw_output ?? '—')}</TableCell>
                        <TableCell className="font-mono text-xs">{b.output_variable ?? '—'}</TableCell>
                        <TableCell>
                          {b.status === 'OK'
                            ? <Badge variant="default">OK</Badge>
                            : <Badge variant="destructive" title={b.error}>ERR</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {result.bindings.some((b) => b.status === 'ERROR') && (
                  <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-xs space-y-1">
                    {result.bindings.filter((b) => b.status === 'ERROR').map((b) => (
                      <div key={b.binding_id}><span className="font-mono">{b.formula_code}</span>: {b.error}</div>
                    ))}
                  </div>
                )}

                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Full trace JSON</summary>
                  <pre className="overflow-auto bg-muted/40 p-2 rounded mt-2 max-h-80">{JSON.stringify(result, null, 2)}</pre>
                </details>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function KVEditor({ title, rows, setRows, onUpdate }: {
  title: string;
  rows: FactRow[];
  setRows: React.Dispatch<React.SetStateAction<FactRow[]>>;
  onUpdate: (idx: number, patch: Partial<FactRow>) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <Label className="text-sm font-medium">{title}</Label>
        <Button size="sm" variant="outline" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
          <Plus className="h-3 w-3 mr-1" />Add
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <Input placeholder="key" value={r.key} onChange={(e) => onUpdate(i, { key: e.target.value })} className="flex-1" />
            <Input placeholder="value" value={r.value} onChange={(e) => onUpdate(i, { value: e.target.value })} className="flex-1" />
            <Button size="icon" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {!rows.length && <p className="text-xs text-muted-foreground">None</p>}
      </div>
    </div>
  );
}
