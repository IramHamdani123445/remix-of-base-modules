import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Calculator, Table as TableIcon, Variable, Layers, Beaker, ShieldCheck, Settings2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RateTableEditor } from './RateTableEditor';
import { RateTableHeaderForm } from '@/components/bn/config/RateTableHeaderForm';
import { BindingEditor, type BindingRow } from './BindingEditor';
import { SimulationPanel } from './SimulationPanel';
import { ValidationPanel } from './ValidationPanel';
import { Plus, Pencil } from 'lucide-react';
import { useVariableResolver } from '@/hooks/bn/useVariableResolver';

type Formula = { id: string; template_code: string; template_name: string; category: string | null; governance_status: string };
type RateTable = { id: string; table_code: string; table_name: string; table_type: string; lookup_mode: string; status: string; country_code: string; version_no: number };
type Binding = BindingRow;
type Variable = { id: string; variable_code: string; display_name: string; category: string | null; data_type: string | null; unit: string | null; is_active: boolean };

/** Plain wording for where a variable comes from. */
const SOURCE_LABELS: Record<string, string> = {
  FACT: 'Fact',
  DERIVED_FACT: 'Derived fact',
  PRODUCT_PARAMETER: 'Product parameter',
  PRIOR_RESULT: 'Earlier formula result',
  REGISTRY: 'Registry only',
};

const TAB_KEYS = ['formulas','variables','rate-tables','matrix','parameters','bindings','simulation','validation'] as const;
type TabKey = typeof TAB_KEYS[number];

export default function CalculationSetup() {
  const [params, setParams] = useSearchParams();
  const initial = (params.get('tab') as TabKey) || 'formulas';
  const [tab, setTab] = useState<TabKey>(TAB_KEYS.includes(initial) ? initial : 'formulas');
  const [loading, setLoading] = useState(true);
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [rateTables, setRateTables] = useState<RateTable[]>([]);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);
  const [editingTable, setEditingTable] = useState<RateTable | null>(null);
  const [editingBinding, setEditingBinding] = useState<BindingRow | null>(null);
  const [bindingOpen, setBindingOpen] = useState(false);
  const [headerFormOpen, setHeaderFormOpen] = useState(false);
  // Which tab opened the shared table dialog, so its title matches.
  const [headerFormKind, setHeaderFormKind] = useState<'RATE' | 'MATRIX'>('RATE');
  const [editingHeaderId, setEditingHeaderId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const nav = useNavigate();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = supabase as any;
      const [fT, rT, bT, vT] = await Promise.all([
        sb.from('bn_formula_template').select('id, template_code, template_name, category, governance_status').order('template_code'),
        sb.from('bn_rate_table').select('id, table_code, table_name, table_type, lookup_mode, status, country_code, version_no').order('table_code'),
        sb.from('bn_product_formula_binding').select('id, product_id, product_version_id, formula_template_id, formula_version_id, calculation_stage, sequence_no, output_variable, rounding_rule, cap_min, cap_max, is_active, notes').order('calculation_stage').order('sequence_no'),
        sb.from('bn_formula_variable_registry').select('id, variable_code, display_name, category, data_type, unit, is_active').eq('is_active', true).order('category').order('variable_code'),
      ]);
      if (!alive) return;
      setFormulas((fT.data ?? []) as Formula[]);
      setRateTables((rT.data ?? []) as RateTable[]);
      setBindings((bT.data ?? []) as Binding[]);
      setVariables((vT.data ?? []) as Variable[]);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  /**
   * The Variables tab listed only bn_formula_variable_registry, so a derived
   * fact — or a fact, or a product parameter — never appeared here even though
   * formulas can use it. Users added a derived fact and had no way to see it on
   * the screen that claims to list variables.
   *
   * It now shows everything the formula validator accepts, from the same
   * resolver, with the source named. What is offered and what is accepted stay
   * in step (see BUG-19).
   */
  const { data: resolver } = useVariableResolver();

  const allVariables = useMemo(() => {
    type Row = {
      key: string; variable_code: string; display_name: string;
      source: string; category: string | null; data_type: string | null; unit: string | null;
    };
    const byCode = new Map<string, Row>();

    // Resolver first: it carries the authoritative source and sample metadata.
    for (const [code, v] of resolver?.entries() ?? []) {
      byCode.set(code, {
        key: `resolver:${code}`,
        variable_code: code,
        display_name: v.displayName ?? code,
        source: v.source,
        category: null,
        data_type: v.dataType ?? null,
        unit: v.unit ?? null,
      });
    }
    // Registry rows fill in category, and cover any registry-only entries.
    for (const v of variables) {
      const existing = byCode.get(v.variable_code);
      if (existing) {
        existing.category = existing.category ?? v.category;
        existing.data_type = existing.data_type ?? v.data_type;
        existing.unit = existing.unit ?? v.unit;
        continue;
      }
      byCode.set(v.variable_code, {
        key: `registry:${v.id}`,
        variable_code: v.variable_code,
        display_name: v.display_name,
        source: 'REGISTRY',
        category: v.category,
        data_type: v.data_type,
        unit: v.unit,
      });
    }
    return [...byCode.values()].sort((a, b) => a.variable_code.localeCompare(b.variable_code));
  }, [resolver, variables]);

  const switchTab = (t: TabKey) => {
    setTab(t);
    setParams((p) => { p.set('tab', t); return p; }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Calculator className="h-6 w-6 text-primary" />
            Calculation Setup
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Configure formulas, rate / tier / matrix tables, variable registry, product
            parameters, and product formula bindings used by the Benefit Calculation Engine.
            Every rate, share, cap and threshold lives in the database — nothing is hardcoded.
          </p>
        </div>
        <Button variant="outline" onClick={() => nav('/bn/config/formulas')}>Legacy Formula Editor</Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => switchTab(v as TabKey)}>
        <TabsList className="grid grid-cols-4 lg:grid-cols-8">
          <TabsTrigger value="formulas"><Calculator className="h-4 w-4 mr-1" />Formulas</TabsTrigger>
          <TabsTrigger value="variables"><Variable className="h-4 w-4 mr-1" />Variables</TabsTrigger>
          <TabsTrigger value="rate-tables"><TableIcon className="h-4 w-4 mr-1" />Rate / Tier</TabsTrigger>
          <TabsTrigger value="matrix"><Layers className="h-4 w-4 mr-1" />Matrix</TabsTrigger>
          <TabsTrigger value="parameters"><Settings2 className="h-4 w-4 mr-1" />Parameters</TabsTrigger>
          <TabsTrigger value="bindings">Bindings</TabsTrigger>
          <TabsTrigger value="simulation"><Beaker className="h-4 w-4 mr-1" />Simulation</TabsTrigger>
          <TabsTrigger value="validation"><ShieldCheck className="h-4 w-4 mr-1" />Validation</TabsTrigger>
        </TabsList>

        {loading ? (
          <Card className="mt-4"><CardContent className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></CardContent></Card>
        ) : (
          <>
            <TabsContent value="formulas">
              <ListCard title="Formula Library" count={formulas.length}>
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {formulas.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono text-xs">{f.template_code}</TableCell>
                        <TableCell>{f.template_name}</TableCell>
                        <TableCell><Badge variant="outline">{f.category ?? '—'}</Badge></TableCell>
                        <TableCell><Badge variant={f.governance_status === 'ACTIVE' ? 'default' : 'secondary'}>{f.governance_status}</Badge></TableCell>
                      </TableRow>
                    ))}
                    {!formulas.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No formulas yet</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </ListCard>
            </TabsContent>

            <TabsContent value="variables">
              <ListCard title="Variables available to formulas" count={allVariables.length}>
                <p className="px-1 pb-3 text-sm text-muted-foreground">
                  Everything a formula may refer to, from every source — registry entries, facts,
                  derived facts, product parameters and earlier formula results. This is the same
                  list the formula validator accepts, so anything shown here can be used in a
                  formula, and anything missing cannot.
                </p>
                <Table>
                  <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Source</TableHead><TableHead>Category</TableHead><TableHead>Type</TableHead><TableHead>Unit</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {allVariables.map((v) => (
                      <TableRow key={v.key}>
                        <TableCell className="font-mono text-xs">{v.variable_code}</TableCell>
                        <TableCell>{v.display_name}</TableCell>
                        <TableCell>
                          <Badge variant={v.source === 'DERIVED_FACT' ? 'default' : 'secondary'}>
                            {SOURCE_LABELS[v.source] ?? v.source}
                          </Badge>
                        </TableCell>
                        <TableCell><Badge variant="outline">{v.category ?? '—'}</Badge></TableCell>
                        <TableCell>{v.data_type ?? '—'}</TableCell>
                        <TableCell>{v.unit ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                    {!allVariables.length && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No variables available</TableCell></TableRow>}
                  </TableBody>
                </Table>
              </ListCard>
            </TabsContent>

            <TabsContent value="rate-tables">
              <ListCard
                title="Rate / Tier Tables"
                count={rateTables.filter((r) => ['TIER','RATE_TABLE','LOOKUP','CAP_TABLE','CONDITION_TABLE'].includes(r.table_type)).length}
                action={<Button size="sm" onClick={() => { setEditingHeaderId(null); setHeaderFormKind('RATE'); setHeaderFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />New table</Button>}
              >
                <RateTablesList
                  rows={rateTables.filter((r) => ['TIER','RATE_TABLE','LOOKUP','CAP_TABLE','CONDITION_TABLE'].includes(r.table_type))}
                  onEdit={setEditingTable}
                  onEditHeader={(t) => { setEditingHeaderId(t.id); setHeaderFormOpen(true); }}
                />
              </ListCard>
            </TabsContent>

            <TabsContent value="matrix">
              <ListCard
                title="Matrix / Share Tables"
                count={rateTables.filter((r) => ['MATRIX','SHARE_TABLE'].includes(r.table_type)).length}
                action={<Button size="sm" onClick={() => { setEditingHeaderId(null); setHeaderFormKind('MATRIX'); setHeaderFormOpen(true); }}><Plus className="h-4 w-4 mr-1" />New matrix</Button>}
              >
                <RateTablesList
                  rows={rateTables.filter((r) => ['MATRIX','SHARE_TABLE'].includes(r.table_type))}
                  onEdit={setEditingTable}
                  onEditHeader={(t) => { setEditingHeaderId(t.id); setHeaderFormOpen(true); }}
                />
              </ListCard>
            </TabsContent>

            <TabsContent value="parameters">
              <PlaceholderCard
                title="Product Parameters"
                hint="Manage per-product configurable values (replacement rates, grant amounts, unit sizes, flat weekly rates)."
                link={() => nav('/bn/config/product-parameters')}
              />
            </TabsContent>

            <TabsContent value="bindings">
              <Card className="mt-4">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">Product Formula Bindings</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{bindings.length}</Badge>
                    <Button size="sm" onClick={() => { setEditingBinding(null); setBindingOpen(true); }}>
                      <Plus className="h-4 w-4 mr-1" /> New binding
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Formula</TableHead><TableHead>Stage</TableHead><TableHead>Seq</TableHead><TableHead>Output</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
                    <TableBody>
                      {bindings.map((b) => {
                        const f = formulas.find((x) => x.id === b.formula_template_id);
                        return (
                          <TableRow key={b.id} className="cursor-pointer hover:bg-accent/30" onClick={() => { setEditingBinding(b); setBindingOpen(true); }}>
                            <TableCell className="font-mono text-xs">{b.product_id?.slice(0, 8) ?? '—'}</TableCell>
                            <TableCell className="font-mono text-xs">{f?.template_code ?? b.formula_template_id.slice(0, 8)}</TableCell>
                            <TableCell><Badge variant="outline">{b.calculation_stage}</Badge></TableCell>
                            <TableCell>{b.sequence_no}</TableCell>
                            <TableCell>{b.output_variable ?? '—'}</TableCell>
                            <TableCell>{b.is_active ? <Badge variant="default">Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                            <TableCell><Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); setEditingBinding(b); setBindingOpen(true); }}>Edit</Button></TableCell>
                          </TableRow>
                        );
                      })}
                      {!bindings.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No bindings yet — click "New binding"</TableCell></TableRow>}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>


            <TabsContent value="simulation">
              <SimulationPanel />
            </TabsContent>

            <TabsContent value="validation">
              <ValidationPanel />
            </TabsContent>
          </>
        )}
      </Tabs>

      <RateTableEditor
        open={!!editingTable}
        rateTable={editingTable}
        onClose={() => setEditingTable(null)}
      />

      <RateTableHeaderForm
        open={headerFormOpen}
        kind={headerFormKind}
        rateTableId={editingHeaderId}
        onClose={() => { setHeaderFormOpen(false); setEditingHeaderId(null); }}
        onSaved={() => setReloadKey((k) => k + 1)}
      />

      <BindingEditor
        open={bindingOpen}
        binding={editingBinding}
        onClose={() => { setBindingOpen(false); setEditingBinding(null); }}
        onSaved={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}

function ListCard({ title, count, action, children }: { title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex items-center gap-2"><Badge variant="secondary">{count}</Badge>{action}</div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function PlaceholderCard({ title, hint, link }: { title: string; hint: string; link?: () => void }) {
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{hint}</p>
        {link && <Button variant="outline" onClick={link}>Open</Button>}
      </CardContent>
    </Card>
  );
}

function RateTablesList({ rows, onEdit, onEditHeader }: { rows: RateTable[]; onEdit?: (t: RateTable) => void; onEditHeader?: (t: RateTable) => void }) {
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Mode</TableHead><TableHead>Country</TableHead><TableHead>v</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className={onEdit ? 'cursor-pointer hover:bg-accent/30' : ''} onClick={() => onEdit?.(r)}>
            <TableCell className="font-mono text-xs">{r.table_code}</TableCell>
            <TableCell>{r.table_name}</TableCell>
            <TableCell><Badge variant="outline">{r.table_type}</Badge></TableCell>
            <TableCell>{r.lookup_mode}</TableCell>
            <TableCell>{r.country_code}</TableCell>
            <TableCell>{r.version_no}</TableCell>
            <TableCell><Badge variant={r.status === 'ACTIVE' ? 'default' : 'secondary'}>{r.status}</Badge></TableCell>
            <TableCell className="flex gap-1">
              {onEditHeader && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onEditHeader(r); }}><Pencil className="h-3.5 w-3.5" /></Button>}
              {onEdit && <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>Rows</Button>}
            </TableCell>
          </TableRow>
        ))}
        {!rows.length && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No tables yet</TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}
