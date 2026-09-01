import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Plus, Trash2, Edit, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import {
  useCoverageTypes, useCoverageTypeRules, useUpsertCoverageType,
  useDeleteCoverageType, useAssignRule, useUnassignRule,
} from '@/hooks/bn/useCoverageTypes';
import { validateCoverageType, type CoverageType, type CoverageTypeInput } from '@/services/bn/coverageTypeService';
import { computeAllRuleReadiness, computeCoverageTypeReadiness } from '@/services/bn/readinessService';
import type { RuleCatalogueItem } from '@/services/bn/ruleCatalogueService';
import type { EligibilityFact } from '@/services/bn/eligibilityFactService';
import { getCurrentUserCode } from '@/services/bn/audit/getCurrentUserCode';
import { BnBusyButton } from '@/components/bn/shared';

const empty: CoverageTypeInput = { coverage_code: '', coverage_name: '', description: '', active_flag: true };

export function CoverageTypesTab({ rules, facts }: { rules: RuleCatalogueItem[]; facts: EligibilityFact[] }) {
  const { data: cts = [] } = useCoverageTypes();
  const { data: assignments = [] } = useCoverageTypeRules();
  const upsert = useUpsertCoverageType();
  const remove = useDeleteCoverageType();
  const assign = useAssignRule();
  const unassign = useUnassignRule();

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CoverageTypeInput>(empty);
  const [assignOpen, setAssignOpen] = useState<CoverageType | null>(null);
  const [pickRule, setPickRule] = useState('');
  const [pickPriority, setPickPriority] = useState('100');

  const ruleReadiness = useMemo(() => computeAllRuleReadiness(rules, facts), [rules, facts]);
  const ctReadiness = useMemo(
    () => computeCoverageTypeReadiness(cts, assignments, ruleReadiness),
    [cts, assignments, ruleReadiness],
  );
  const readinessByCtId = new Map(ctReadiness.map(r => [r.coverage_type_id, r]));
  const ruleByCode = new Map(rules.map(r => [r.rule_code, r]));

  const onSave = async () => {
    const err = validateCoverageType(editing);
    if (err) { toast.error(err); return; }
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    await upsert.mutateAsync({ input: editing, userCode });
    setEditorOpen(false);
  };

  const onAssign = async () => {
    if (!assignOpen || !pickRule) return;
    const userCode = await getCurrentUserCode();
    if (!userCode) { toast.error('Authenticated user_code required'); return; }
    await assign.mutateAsync({
      coverage_type_id: assignOpen.id, rule_code: pickRule,
      priority: Number(pickPriority) || 100, effective_date: null, end_date: null, userCode,
    });
    setPickRule('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Coverage Types</CardTitle>
          <Button onClick={() => { setEditing(empty); setEditorOpen(true); }} className="gap-2"><Plus className="h-4 w-4" /> New Coverage Type</Button>
        </div>
        <p className="text-sm text-muted-foreground">Group reusable rules with a priority and effective window. Rule logic stays in the Rule Catalogue.</p>
      </CardHeader>
      <CardContent>
        {cts.length === 0 ? (
          <p className="py-8 text-center text-muted-foreground">No coverage types defined yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Assigned Rules</TableHead>
                <TableHead className="w-64">Readiness</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cts.map(ct => {
                const r = readinessByCtId.get(ct.id);
                const assigned = assignments.filter(a => a.coverage_type_id === ct.id);
                return (
                  <TableRow key={ct.id}>
                    <TableCell className="font-mono text-xs">{ct.coverage_code}</TableCell>
                    <TableCell className="font-medium">{ct.coverage_name}</TableCell>
                    <TableCell>{assigned.length}</TableCell>
                    <TableCell>
                      {r && r.assigned > 0 ? (
                        <div className="flex items-center gap-2">
                          <Progress value={r.percent} className="h-2" />
                          <Badge variant={r.band === 'READY' ? 'default' : r.band === 'WARNING' ? 'secondary' : 'destructive'}>{r.percent}%</Badge>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">no rules</span>}
                    </TableCell>
                    <TableCell>{ct.active_flag ? <Badge>Yes</Badge> : <Badge variant="secondary">No</Badge>}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="outline" className="gap-1" onClick={() => { setAssignOpen(ct); }}><ShieldCheck className="h-3 w-3" /> Assign Rules</Button>
                        <Button size="icon" variant="ghost" onClick={() => { setEditing({ id: ct.id, coverage_code: ct.coverage_code, coverage_name: ct.coverage_name, description: ct.description, active_flag: ct.active_flag }); setEditorOpen(true); }}><Edit className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" onClick={() => { if (window.confirm(`Delete ${ct.coverage_code}?`)) remove.mutate(ct.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Editor */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing.id ? 'Edit' : 'New'} Coverage Type</DialogTitle>
            <DialogDescription>Master coverage entity; rule logic is defined in Rule Catalogue.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2"><Label>Code *</Label><Input value={editing.coverage_code} onChange={e => setEditing({ ...editing, coverage_code: e.target.value.toUpperCase() })} disabled={!!editing.id} /></div>
            <div className="space-y-2"><Label>Name *</Label><Input value={editing.coverage_name} onChange={e => setEditing({ ...editing, coverage_name: e.target.value })} /></div>
            <div className="space-y-2 col-span-2"><Label>Description</Label><Textarea rows={2} value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
            <div className="flex items-center gap-2"><Switch checked={editing.active_flag} onCheckedChange={v => setEditing({ ...editing, active_flag: v })} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <BnBusyButton loading={upsert.isPending} onClick={onSave} disabled={upsert.isPending}>>{upsert.isPending ? 'Saving…' : 'Save'}</BnBusyButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign */}
      <Dialog open={!!assignOpen} onOpenChange={(o) => { if (!o) setAssignOpen(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assign Rules — {assignOpen?.coverage_code}</DialogTitle>
            <DialogDescription>Pick from the master Rule Catalogue. The same rule may be reused across coverage types.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-[1fr_120px_auto] gap-2 items-end">
              <div className="space-y-2">
                <Label>Rule</Label>
                <Select value={pickRule} onValueChange={setPickRule}>
                  <SelectTrigger><SelectValue placeholder="Pick a rule" /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {rules.map(r => <SelectItem key={r.rule_code} value={r.rule_code}>{r.rule_code} — {r.rule_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2"><Label>Priority</Label><Input type="number" value={pickPriority} onChange={e => setPickPriority(e.target.value)} /></div>
              <BnBusyButton loading={assign.isPending} onClick={onAssign} disabled={!pickRule || assign.isPending}>>Assign</BnBusyButton>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rule</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Readiness</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignOpen && assignments.filter(a => a.coverage_type_id === assignOpen.id).map(a => {
                  const r = ruleByCode.get(a.rule_code);
                  const rr = ruleReadiness.find(x => x.rule_code === a.rule_code);
                  return (
                    <TableRow key={a.id}>
                      <TableCell><div className="font-mono text-xs">{a.rule_code}</div><div className="text-xs text-muted-foreground">{r?.rule_name ?? '—'}</div></TableCell>
                      <TableCell>{a.priority}</TableCell>
                      <TableCell>
                        {rr ? <Badge variant={rr.band === 'READY' ? 'default' : rr.band === 'WARNING' ? 'secondary' : 'destructive'}>{rr.percent}%</Badge> : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => unassign.mutate({ coverage_type_id: a.coverage_type_id, rule_code: a.rule_code })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setAssignOpen(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
