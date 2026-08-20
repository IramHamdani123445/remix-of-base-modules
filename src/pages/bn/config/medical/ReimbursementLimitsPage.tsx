import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Edit, Trash2, Coins, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
  useReimbursementLimits, useUpsertReimbursementLimit, useDeleteReimbursementLimit,
  useMedicalProcedures, useExpenseTypes,
} from '@/hooks/bn/useBnMedical';
import type {
  BnMedicalReimbursementLimit, MedicalLocationCode, MedicalReimbursementMethod,
} from '@/types/bnMedical';
import { calculateReimbursement } from '@/lib/bn/medicalCalculator';
import { useUserCode } from '@/hooks/useUserCode';
import LegalReferenceSelector from '@/components/bn/selectors/LegalReferenceSelector';
import { BnCountryProvider, useBnCountry } from '@/contexts/BnCountryContext';

const CAP_TYPES = ['PER_CLAIM', 'PER_PROCEDURE', 'PER_EXPENSE', 'ANNUAL', 'LIFETIME'] as const;
const JURISDICTIONS = ['LOCAL', 'REGIONAL', 'INTERNATIONAL', 'ANY'] as const;
const LOCATIONS: MedicalLocationCode[] = ['LOCAL_ST_KITTS', 'NEVIS', 'CARIBBEAN', 'INTERNATIONAL', 'ANY'];
const METHODS: MedicalReimbursementMethod[] = [
  'FIXED_AMOUNT', 'PERCENTAGE_UP_TO_CEILING', 'ACTUAL_UP_TO_CEILING', 'FULL_REIMBURSEMENT', 'NOT_COVERED',
];
const PROVIDER_TYPES = ['PUBLIC_HOSPITAL', 'PRIVATE_HOSPITAL', 'CLINIC', 'PHARMACY', 'SPECIALIST', 'ANY'];
const BENEFICIARY_TYPES = ['INSURED', 'SPOUSE', 'DEPENDANT', 'ANY'];

function ReimbursementLimitsContent() {
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const { activeCountryCode } = useBnCountry();
  const { data: limits = [] } = useReimbursementLimits();
  const { data: procedures = [] } = useMedicalProcedures();
  const { data: expenseTypes = [] } = useExpenseTypes();
  const upsert = useUpsertReimbursementLimit();
  const del = useDeleteReimbursementLimit();

  const procName = useMemo(() => new Map(procedures.map((p: any) => [p.id, `${p.procedure_code} — ${p.procedure_name}`])), [procedures]);
  const expName = useMemo(() => new Map(expenseTypes.map((e: any) => [e.id, `${e.expense_code} — ${e.expense_name}`])), [expenseTypes]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<BnMedicalReimbursementLimit>>({});
  const [locationFilter, setLocationFilter] = useState<string>('ALL');

  const openNew = () => {
    setEditing({
      country_code: 'SKN', jurisdiction_level: 'LOCAL', cap_type: 'PER_EXPENSE',
      cap_amount: 0, reimbursement_percent: 100, currency_code: 'XCD',
      effective_from: new Date().toISOString().slice(0, 10), is_active: true,
      location_code: 'LOCAL_ST_KITTS', reimbursement_method: 'PERCENTAGE_UP_TO_CEILING',
      provider_type_code: 'ANY', beneficiary_type: 'ANY',
      referral_required: false, pre_authorization_required: false, emergency_allowed: true,
    });
    setOpen(true);
  };
  const upd = (f: keyof BnMedicalReimbursementLimit, v: unknown) =>
    setEditing((p) => ({ ...p, [f]: v }));

  const save = async () => {
    try {
      await upsert.mutateAsync({
        ...editing,
        modified_by: userCode,
        ...(editing.id ? {} : { created_by: userCode }),
      } as any);
      toast({ title: 'Saved' });
      setOpen(false);
    } catch (e: any) {
      toast({ title: 'Validation', description: e?.message, variant: 'destructive' });
    }
  };

  const filteredLimits = useMemo(() => {
    if (locationFilter === 'ALL') return limits;
    return (limits as any[]).filter((l) => (l.location_code ?? 'ANY') === locationFilter);
  }, [limits, locationFilter]);

  // Simulation state
  const [simExpense, setSimExpense] = useState({
    procedure_id: '', expense_type_id: '', jurisdiction_level: 'LOCAL',
    claimed_amount: 1000, approved_amount: 1000, currency_code: 'XCD',
  });
  const [simResult, setSimResult] = useState<any>(null);

  const runSim = () => {
    const expDefaults = new Map(expenseTypes.map((e: any) => [e.id, e.default_cap ?? null]));
    const result = calculateReimbursement(
      [{ claim_id: 'sim', ...simExpense } as any],
      limits as any,
      expDefaults,
      { countryCode: 'SKN', baseCurrency: 'XCD' }
    );
    setSimResult(result);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Coins className="h-8 w-8 text-primary" />
        <div>
          <h1 className="t-page-title">Medical Reimbursement Policy</h1>
          <p className="t-page-subtitle mt-1">
            Single Medical Policy Library. Caps, percentages, location regions
            (St Kitts / Nevis / Caribbean / International), referral and pre-authorisation rules.
          </p>
        </div>
      </div>

      <Tabs defaultValue="rules">
        <TabsList>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="simulate" className="gap-2"><FlaskConical className="h-4 w-4" /> Simulate</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Active Policy Rows</CardTitle>
                <CardDescription>Overlapping active rules for the same scope are blocked by the database.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Location</Label>
                <Select value={locationFilter} onValueChange={setLocationFilter}>
                  <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">All locations</SelectItem>
                    {LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button onClick={openNew} className="gap-2"><Plus className="h-4 w-4" /> Add Rule</Button>
              </div>
            </CardHeader>
            <CardContent>
              {filteredLimits.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center">No reimbursement rules for this filter.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Procedure</TableHead>
                        <TableHead>Expense</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Provider</TableHead>
                        <TableHead>Beneficiary</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead className="text-right">%</TableHead>
                        <TableHead className="text-right">Ceiling</TableHead>
                        <TableHead className="text-right">Fixed</TableHead>
                        <TableHead>Referral</TableHead>
                        <TableHead>Pre-Auth</TableHead>
                        <TableHead>Legal Ref</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Active</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLimits.map((l: any) => (
                        <TableRow key={l.id}>
                          <TableCell className="text-sm">{l.procedure_id ? procName.get(l.procedure_id) : (l.procedure_code ?? '—')}</TableCell>
                          <TableCell className="text-sm">{l.expense_type_id ? expName.get(l.expense_type_id) : '—'}</TableCell>
                          <TableCell><Badge variant="outline">{l.location_code ?? l.jurisdiction_level}</Badge></TableCell>
                          <TableCell className="text-xs">{l.provider_type_code ?? '—'}</TableCell>
                          <TableCell className="text-xs">{l.beneficiary_type ?? '—'}</TableCell>
                          <TableCell><Badge variant="secondary" className="text-[10px]">{l.reimbursement_method ?? l.cap_type}</Badge></TableCell>
                          <TableCell className="text-right font-mono text-xs">{l.reimbursement_percent ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{l.ceiling_amount ?? l.cap_amount ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{l.fixed_amount ?? '—'}</TableCell>
                          <TableCell className="text-xs">{l.referral_required ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-xs">{l.pre_authorization_required ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-xs max-w-[140px] truncate" title={l.legal_reference ?? ''}>{l.legal_reference ?? '—'}</TableCell>
                          <TableCell className="text-xs">{l.effective_from}{l.effective_to ? ` → ${l.effective_to}` : ''}</TableCell>
                          <TableCell>{l.is_active ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" onClick={() => { setEditing({ ...l }); setOpen(true); }}><Edit className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" onClick={async () => { await del.mutateAsync(l.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulate" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Reimbursement Simulator</CardTitle><CardDescription>Test reimbursement against current active rules without changing any data.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Procedure</Label>
                  <Select value={simExpense.procedure_id || ''} onValueChange={(v) => setSimExpense((p) => ({ ...p, procedure_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>{procedures.map((p: any) => <SelectItem key={p.id} value={p.id}>{procName.get(p.id)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Expense Type</Label>
                  <Select value={simExpense.expense_type_id || ''} onValueChange={(v) => setSimExpense((p) => ({ ...p, expense_type_id: v }))}>
                    <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                    <SelectContent>{expenseTypes.map((e: any) => <SelectItem key={e.id} value={e.id}>{expName.get(e.id)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Jurisdiction</Label>
                  <Select value={simExpense.jurisdiction_level} onValueChange={(v) => setSimExpense((p) => ({ ...p, jurisdiction_level: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['LOCAL','REGIONAL','INTERNATIONAL'].map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Claimed</Label><Input type="number" value={simExpense.claimed_amount} onChange={(e) => setSimExpense((p) => ({ ...p, claimed_amount: Number(e.target.value) }))} /></div>
                <div className="space-y-2"><Label>Approved</Label><Input type="number" value={simExpense.approved_amount} onChange={(e) => setSimExpense((p) => ({ ...p, approved_amount: Number(e.target.value) }))} /></div>
                <div className="space-y-2"><Label>Currency</Label><Input value={simExpense.currency_code} onChange={(e) => setSimExpense((p) => ({ ...p, currency_code: e.target.value.toUpperCase() }))} /></div>
              </div>
              <div className="flex justify-end"><Button onClick={runSim}>Run Simulation</Button></div>

              {simResult && (
                <div className="space-y-3 rounded-md border bg-muted/30 p-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div><div className="text-muted-foreground">Total Claimed</div><div className="text-lg font-semibold">{simResult.total_claimed}</div></div>
                    <div><div className="text-muted-foreground">Total Approved</div><div className="text-lg font-semibold">{simResult.total_approved}</div></div>
                    <div><div className="text-muted-foreground">Total Payable</div><div className="text-lg font-semibold text-primary">{simResult.total_payable}</div></div>
                  </div>
                  {simResult.cap_applied && <Badge>Cap applied: {simResult.cap_applied}</Badge>}
                  <div>
                    <div className="text-sm font-medium mb-1">Calculation Trace</div>
                    <pre className="max-h-64 overflow-auto rounded bg-background p-3 text-xs">{JSON.stringify(simResult.trace, null, 2)}</pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing.id ? 'Edit' : 'Add'} Medical Policy Rule</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {/* Scope */}
            <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground border-b pb-1">Scope</div>
            <div className="space-y-2">
              <Label>Procedure</Label>
              <Select value={editing.procedure_id || '__none__'} onValueChange={(v) => upd('procedure_id', v === '__none__' ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— any procedure —</SelectItem>
                  {procedures.map((p: any) => <SelectItem key={p.id} value={p.id}>{procName.get(p.id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expense Type</Label>
              <Select value={editing.expense_type_id || '__none__'} onValueChange={(v) => upd('expense_type_id', v === '__none__' ? null : v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— any expense —</SelectItem>
                  {expenseTypes.map((e: any) => <SelectItem key={e.id} value={e.id}>{expName.get(e.id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Location Region *</Label>
              <Select value={editing.location_code ?? 'ANY'} onValueChange={(v) => upd('location_code', v as MedicalLocationCode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LOCATIONS.map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider Type</Label>
              <Select value={editing.provider_type_code ?? 'ANY'} onValueChange={(v) => upd('provider_type_code', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PROVIDER_TYPES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Beneficiary Type</Label>
              <Select value={editing.beneficiary_type ?? 'ANY'} onValueChange={(v) => upd('beneficiary_type', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BENEFICIARY_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Jurisdiction (legacy) *</Label>
              <Select value={editing.jurisdiction_level} onValueChange={(v) => upd('jurisdiction_level', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{JURISDICTIONS.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            {/* Reimbursement */}
            <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground border-b pb-1 pt-2">Reimbursement</div>
            <div className="space-y-2">
              <Label>Method *</Label>
              <Select value={editing.reimbursement_method ?? 'PERCENTAGE_UP_TO_CEILING'} onValueChange={(v) => upd('reimbursement_method', v as MedicalReimbursementMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Cap Type *</Label>
              <Select value={editing.cap_type} onValueChange={(v) => upd('cap_type', v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CAP_TYPES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Reimbursement %</Label><Input type="number" step="0.01" value={editing.reimbursement_percent ?? 100} onChange={(e) => upd('reimbursement_percent', Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Ceiling Amount</Label><Input type="number" step="0.01" value={editing.ceiling_amount ?? ''} onChange={(e) => upd('ceiling_amount', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Fixed Amount</Label><Input type="number" step="0.01" value={editing.fixed_amount ?? ''} onChange={(e) => upd('fixed_amount', e.target.value === '' ? null : Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Cap Amount *</Label><Input type="number" step="0.01" value={editing.cap_amount ?? 0} onChange={(e) => upd('cap_amount', Number(e.target.value))} /></div>
            <div className="space-y-2"><Label>Currency *</Label><Input value={editing.currency_code || ''} onChange={(e) => upd('currency_code', e.target.value.toUpperCase())} /></div>
            <div className="space-y-2"><Label>Country *</Label><Input value={editing.country_code || ''} onChange={(e) => upd('country_code', e.target.value.toUpperCase())} /></div>

            {/* Authorisation */}
            <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground border-b pb-1 pt-2">Authorisation</div>
            <div className="flex items-center gap-2"><Switch checked={!!editing.referral_required} onCheckedChange={(v) => upd('referral_required', v)} /><Label>Referral required</Label></div>
            <div className="flex items-center gap-2"><Switch checked={!!editing.pre_authorization_required} onCheckedChange={(v) => upd('pre_authorization_required', v)} /><Label>Pre-authorisation required</Label></div>
            <div className="flex items-center gap-2"><Switch checked={editing.emergency_allowed ?? true} onCheckedChange={(v) => upd('emergency_allowed', v)} /><Label>Emergency override allowed</Label></div>
            <div className="space-y-2">
              <Label>Approval Level</Label>
              <Input value={editing.approval_level ?? ''} placeholder="e.g. MEDICAL_BOARD" onChange={(e) => upd('approval_level', e.target.value || null)} />
            </div>

            {/* Effective + Legal */}
            <div className="col-span-2 text-xs font-semibold uppercase text-muted-foreground border-b pb-1 pt-2">Effective & Legal</div>
            <div className="space-y-2"><Label>Effective From *</Label><Input type="date" value={editing.effective_from || ''} onChange={(e) => upd('effective_from', e.target.value)} /></div>
            <div className="space-y-2"><Label>Effective To</Label><Input type="date" value={editing.effective_to || ''} onChange={(e) => upd('effective_to', e.target.value || null)} /></div>
            <div className="space-y-2 col-span-2">
              <Label>Legal Reference</Label>
              <LegalReferenceSelector
                value={(editing as any).legal_reference_id ?? null}
                countryCode={activeCountryCode}
                onChange={(id, row) => {
                  upd('legal_reference_id' as any, id);
                  upd('legal_reference', row ? (row.full_reference_text || row.short_title) : null);
                }}
              />
              {editing.legal_reference && (
                <p className="text-[11px] text-muted-foreground truncate">Cited as: {editing.legal_reference}</p>
              )}
            </div>
            <div className="flex items-center gap-2 col-span-2"><Switch checked={editing.is_active ?? true} onCheckedChange={(v) => upd('is_active', v)} /><Label>Active</Label></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={upsert.isPending}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The page reads the active country through `useBnCountry`, which throws by
 * design when no provider is present. The Country Pack pages each supply the
 * provider themselves; this page did not, so it crashed on load. Wrapping it
 * the same way keeps the pattern consistent across both areas.
 */
export default function ReimbursementLimitsPage() {
  return (
    <BnCountryProvider>
      <ReimbursementLimitsContent />
    </BnCountryProvider>
  );
}
