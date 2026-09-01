import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import {
  FACT_SOURCE_TYPES, FACT_DATA_TYPES, FACT_IMPLEMENTATION_STATUSES,
  FACT_ALLOWED_OPERATORS, FACT_CATEGORIES, WINDOW_TYPES,
  validateEligibilityFact, isResolverRegistered,
  type EligibilityFactInput,
} from '@/services/bn/eligibilityFactService';
import { getRegisteredResolverNames } from '@/services/bn/eligibility/eligibilityFactResolver';
import { getRegisteredSnapshotBuilderNames } from '@/services/bn/eligibility/snapshotBuilderRegistry';
import { useDataSources, useDataFields } from '@/hooks/bn/useDataDictionary';
import {
  fieldsForTable, dateFieldsForTable,
  validateFactAgainstRegistry, type DataField,
} from '@/services/bn/dataDictionaryService';
import { FACT_TEMPLATES, applyFactTemplate, type FactTemplateId } from '@/services/bn/factSourceTemplates';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  value: EligibilityFactInput;
  isEdit: boolean;
  onSave: (v: EligibilityFactInput) => void;
  saving?: boolean;
}

const NONE = '__none__';

function MultiColumnPicker({
  label, table, columns, available, onChange, hint,
}: {
  label: string;
  table: string | null | undefined;
  columns: string[];
  available: DataField[];
  onChange: (next: string[]) => void;
  hint?: string;
}) {
  const set = new Set(columns);
  return (
    <div className="col-span-2">
      <Label>{label}</Label>
      {!table ? (
        <p className="text-xs text-muted-foreground italic">Pick a base table first.</p>
      ) : available.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No matching columns in dictionary.</p>
      ) : (
        <div className="flex flex-wrap gap-2 mt-1">
          {available.map(f => {
            const on = set.has(f.column_name);
            return (
              <Badge
                key={f.column_name}
                variant={on ? 'default' : 'outline'}
                className="cursor-pointer font-mono"
                onClick={() => {
                  const next = new Set(set);
                  if (on) next.delete(f.column_name); else next.add(f.column_name);
                  onChange(Array.from(next));
                }}
              >
                {f.column_name}
              </Badge>
            );
          })}
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

export function FactEditorDialog({ open, onOpenChange, value, isEdit, onSave, saving }: Props) {
  const [v, setV] = useState<EligibilityFactInput>(value);
  useEffect(() => { setV(value); }, [value, open]);

  const { data: sources = [] } = useDataSources();
  const { data: fields = [] } = useDataFields();

  const resolvers = useMemo(() => getRegisteredResolverNames().sort(), []);
  const snapshotBuilders = useMemo(() => getRegisteredSnapshotBuilderNames().sort(), []);
  const [resolverSearch, setResolverSearch] = useState('');
  const filteredResolvers = useMemo(() => {
    const q = resolverSearch.trim().toLowerCase();
    return q ? resolvers.filter(r => r.toLowerCase().includes(q)) : resolvers;
  }, [resolvers, resolverSearch]);

  const err = useMemo(() => validateEligibilityFact(v), [v]);
  const registryIssues = useMemo(() => validateFactAgainstRegistry(v, sources, fields), [v, sources, fields]);
  const registryFail = registryIssues.some(i => i.severity === 'FAIL');
  const resolverOk = !v.resolver_function || isResolverRegistered(v.resolver_function);

  const set = <K extends keyof EligibilityFactInput>(k: K, val: EligibilityFactInput[K]) =>
    setV(prev => ({ ...prev, [k]: val }));

  const toggleOperator = (op: string) => {
    const cur = new Set(v.allowed_operators);
    if (cur.has(op)) cur.delete(op); else cur.add(op);
    set('allowed_operators', Array.from(cur));
  };

  const onApplyTemplate = (id: FactTemplateId) => {
    setV(prev => applyFactTemplate(prev, id));
  };

  const isDerived = v.source_type === 'DERIVED_AGGREGATE';
  const usesSource = v.source_type === 'DIRECT_FIELD' || v.source_type === 'DOCUMENT_CHECK' || v.source_type === 'EXISTENCE_CHECK';

  const srcColumns = fieldsForTable(fields, v.source_table);
  const baseColumns = fieldsForTable(fields, v.base_table);
  const baseDateColumns = dateFieldsForTable(fields, v.base_table);
  const outColumns = fieldsForTable(fields, v.output_table);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Fact' : 'Add Fact'}</DialogTitle>
          <DialogDescription>
            Configure a computable fact that rules can reference. Tables, columns, resolvers and snapshot builders are
            constrained to the data dictionary &amp; code registry — business users configure metadata only.
          </DialogDescription>
        </DialogHeader>

        {/* Template picker */}
        <div className="rounded-md border p-3 bg-muted/30">
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <Sparkles className="h-4 w-4" /> Start from a template
          </div>
          <div className="flex flex-wrap gap-2">
            {FACT_TEMPLATES.map(t => (
              <Button key={t.id} type="button" size="sm" variant="outline"
                title={t.description}
                onClick={() => onApplyTemplate(t.id)}>
                {t.label}
              </Button>
            ))}
          </div>
          {isDerived && (
            <Alert className="mt-3">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                Derived facts are calculated by a resolver/snapshot builder. They are <strong>not</strong> direct database columns.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Fact Key *</Label>
            <Input value={v.fact_key} disabled={isEdit}
              onChange={e => set('fact_key', e.target.value.toLowerCase())}
              placeholder="contribution.weeks_last_13" className="font-mono" />
            <p className="text-xs text-muted-foreground mt-1">Lowercase dot notation. Immutable after creation.</p>
          </div>
          <div>
            <Label>Label *</Label>
            <Input value={v.label} onChange={e => set('label', e.target.value)} />
          </div>
          <div>
            <Label>Category *</Label>
            <Select value={v.category} onValueChange={x => set('category', x)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FACT_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Data Type *</Label>
            <Select value={v.data_type} onValueChange={x => set('data_type', x as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FACT_DATA_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Textarea value={v.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} />
          </div>

          <div>
            <Label>Source Type *</Label>
            <Select value={v.source_type} onValueChange={x => set('source_type', x as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FACT_SOURCE_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Implementation Status *</Label>
            <Select value={v.implementation_status} onValueChange={x => set('implementation_status', x as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{FACT_IMPLEMENTATION_STATUSES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>

          {usesSource && (
            <>
              <div>
                <Label>Source Table {v.source_type === 'DIRECT_FIELD' ? '*' : ''}</Label>
                <Select value={v.source_table ?? NONE}
                  onValueChange={x => { set('source_table', x === NONE ? null : x); set('source_column', null); }}>
                  <SelectTrigger><SelectValue placeholder="Pick from data dictionary" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(none)</SelectItem>
                    {sources.map(s => (
                      <SelectItem key={s.table_name} value={s.table_name} className="font-mono">
                        {s.table_name} <span className="text-muted-foreground">— {s.source_system}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Source Column {v.source_type === 'DIRECT_FIELD' ? '*' : ''}</Label>
                <Select value={v.source_column ?? NONE} onValueChange={x => set('source_column', x === NONE ? null : x)}>
                  <SelectTrigger><SelectValue placeholder={v.source_table ? 'Pick a column' : 'Pick a table first'} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>(none)</SelectItem>
                    {srcColumns.map(f => (
                      <SelectItem key={f.column_name} value={f.column_name} className="font-mono">
                        {f.column_name} <span className="text-muted-foreground">— {f.data_type}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="col-span-2">
            <Label>Resolver Function {(v.source_type === 'RESOLVER_ONLY' || v.source_type === 'DOCUMENT_CHECK' || v.source_type === 'EXISTENCE_CHECK') ? '*' : ''}</Label>
            <div className="flex gap-2 items-center">
              <Select value={v.resolver_function ?? NONE} onValueChange={x => set('resolver_function', x === NONE ? null : x)}>
                <SelectTrigger><SelectValue placeholder="Select registered resolver" /></SelectTrigger>
                <SelectContent className="max-h-80">
                  <div className="sticky top-0 z-10 bg-popover p-1 pb-2">
                    <Input
                      autoFocus
                      placeholder="Search resolvers…"
                      value={resolverSearch}
                      onChange={(e) => setResolverSearch(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="h-8"
                    />
                  </div>
                  <SelectItem value={NONE}>(none)</SelectItem>
                  {filteredResolvers.map(r => <SelectItem key={r} value={r} className="font-mono">{r}</SelectItem>)}
                </SelectContent>
              </Select>
              {v.resolver_function && (
                resolverOk
                  ? <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Registered</Badge>
                  : <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" /> Missing</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Only resolvers registered in code are selectable. To add a new one, a developer must register it.</p>
          </div>

          {isDerived && (
            <div className="col-span-2 border rounded-md p-3 bg-muted/30 space-y-3">
              <div className="font-medium text-sm">Derived Aggregate Metadata</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Base Table *</Label>
                  <Select value={v.base_table ?? NONE}
                    onValueChange={x => { set('base_table', x === NONE ? null : x); set('base_date_column', null); set('base_value_columns', []); set('base_code_columns', []); }}>
                    <SelectTrigger><SelectValue placeholder="Pick base table" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {sources.map(s => <SelectItem key={s.table_name} value={s.table_name} className="font-mono">{s.table_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Base Date Column *</Label>
                  <Select value={v.base_date_column ?? NONE} onValueChange={x => set('base_date_column', x === NONE ? null : x)}>
                    <SelectTrigger><SelectValue placeholder={v.base_table ? 'Pick a date/period column' : 'Pick a table first'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {baseDateColumns.map(f => <SelectItem key={f.column_name} value={f.column_name} className="font-mono">{f.column_name}</SelectItem>)}
                      {baseColumns.filter(f => !f.is_date).map(f => (
                        <SelectItem key={`raw-${f.column_name}`} value={f.column_name} className="font-mono text-muted-foreground">
                          {f.column_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <MultiColumnPicker label="Base Value Columns" table={v.base_table}
                  columns={v.base_value_columns ?? []} available={baseColumns}
                  onChange={x => set('base_value_columns', x)}
                  hint="Wages or amount columns aggregated by the snapshot builder." />

                <MultiColumnPicker label="Base Code Columns" table={v.base_table}
                  columns={v.base_code_columns ?? []} available={baseColumns}
                  onChange={x => set('base_code_columns', x)}
                  hint="Paid-code / status columns used to decide whether a row counts." />

                <div>
                  <Label>Window Type</Label>
                  <Select value={v.window_type ?? NONE} onValueChange={x => set('window_type', x === NONE ? null : x as any)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {WINDOW_TYPES.map(w => <SelectItem key={w} value={w}>{w}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Window Size</Label><Input type="number" value={v.window_size ?? ''} onChange={e => set('window_size', e.target.value ? Number(e.target.value) : null)} /></div>
                <div><Label>Window Anchor</Label><Input className="font-mono" value={v.window_anchor ?? ''} onChange={e => set('window_anchor', e.target.value || null)} placeholder="claim_date / death_date / event_date" /></div>
                <div><Label>Count Logic</Label><Input value={v.count_logic ?? ''} onChange={e => set('count_logic', e.target.value || null)} placeholder="count week if any wages_paid1..7 > 0" /></div>

                <div>
                  <Label>Output Table *</Label>
                  <Select value={v.output_table ?? NONE}
                    onValueChange={x => { set('output_table', x === NONE ? null : x); set('output_column', null); }}>
                    <SelectTrigger><SelectValue placeholder="Pick output table" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {sources.map(s => <SelectItem key={s.table_name} value={s.table_name} className="font-mono">{s.table_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Output Column *</Label>
                  <Select value={v.output_column ?? NONE} onValueChange={x => set('output_column', x === NONE ? null : x)}>
                    <SelectTrigger><SelectValue placeholder={v.output_table ? 'Pick a column' : 'Pick a table first'} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {outColumns.map(f => <SelectItem key={f.column_name} value={f.column_name} className="font-mono">{f.column_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Output JSON Key *</Label><Input className="font-mono" value={v.output_json_key ?? ''} onChange={e => set('output_json_key', e.target.value || null)} placeholder="window_13" /></div>
                <div>
                  <Label>Snapshot Builder *</Label>
                  <Select value={v.snapshot_builder ?? NONE} onValueChange={x => set('snapshot_builder', x === NONE ? null : x)}>
                    <SelectTrigger><SelectValue placeholder="Pick registered builder" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>(none)</SelectItem>
                      {snapshotBuilders.map(b => <SelectItem key={b} value={b} className="font-mono">{b}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}

          <div className="col-span-2">
            <Label>Allowed Operators *</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {FACT_ALLOWED_OPERATORS.map(op => {
                const on = v.allowed_operators.includes(op);
                return (
                  <Badge key={op} variant={on ? 'default' : 'outline'} className="cursor-pointer" onClick={() => toggleOperator(op)}>
                    {op}
                  </Badge>
                );
              })}
            </div>
          </div>

          <div className="col-span-2">
            <Label>Example Value</Label>
            <Input value={v.example_value ?? ''} onChange={e => set('example_value', e.target.value || null)} placeholder="13" />
          </div>

          <div className="col-span-2 grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between border rounded-md p-2">
              <Label className="cursor-pointer">Requires snapshot</Label>
              <Switch checked={v.requires_snapshot} onCheckedChange={x => set('requires_snapshot', x)} />
            </div>
            <div className="flex items-center justify-between border rounded-md p-2">
              <Label className="cursor-pointer">Requires claim context</Label>
              <Switch checked={v.requires_claim_context} onCheckedChange={x => set('requires_claim_context', x)} />
            </div>
            <div className="flex items-center justify-between border rounded-md p-2">
              <Label className="cursor-pointer">Requires SSN</Label>
              <Switch checked={v.requires_ssn} onCheckedChange={x => set('requires_ssn', x)} />
            </div>
            <div className="flex items-center justify-between border rounded-md p-2">
              <Label className="cursor-pointer">Requires deceased SSN</Label>
              <Switch checked={v.requires_deceased_ssn} onCheckedChange={x => set('requires_deceased_ssn', x)} />
            </div>
            <div className="flex items-center justify-between border rounded-md p-2 col-span-2">
              <Label className="cursor-pointer">Active</Label>
              <Switch checked={v.is_active} onCheckedChange={x => set('is_active', x)} />
            </div>
          </div>
        </div>

        {err && (
          <Alert variant="destructive" className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{err}</AlertDescription>
          </Alert>
        )}
        {registryIssues.length > 0 && (
          <Alert variant={registryFail ? 'destructive' : 'default'} className="mt-3">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="font-semibold mb-1">Data dictionary checks</div>
              <ul className="text-xs space-y-0.5">
                {registryIssues.map((i, idx) => (
                  <li key={idx} className={i.severity === 'FAIL' ? 'text-destructive' : 'text-amber-700'}>
                    • [{i.severity}] {i.code}: {i.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!!err || registryFail || !!saving} onClick={() => onSave(v)}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Fact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
