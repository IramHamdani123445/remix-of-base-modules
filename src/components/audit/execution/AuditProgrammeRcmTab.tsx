import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Loader2, Network, Plus, X, ChevronRight, ChevronDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useUserCode } from '@/hooks/useUserCode';
import { AuditEmptyState } from '@/components/audit/workspace/AuditEmptyState';

const CONTROL_TYPES = ['Preventive', 'Detective', 'Corrective', 'Directive'];
const FREQUENCIES = ['Continuous', 'Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annually', 'Ad Hoc'];

interface AuditProgrammeRcmTabProps {
  auditId: string;
  departmentId?: string | null;
  functionId?: string | null;
}

/**
 * Programme / Risk & Control Matrix for the audit.
 *
 * The RCM is scoping reference data (processes → risks → controls) that the
 * fieldwork programme and control tests are built from. Lifecycle transitions
 * (test conclusions, findings) remain governed elsewhere.
 */
export function AuditProgrammeRcmTab({ auditId, departmentId, functionId }: AuditProgrammeRcmTabProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { userCode } = useUserCode();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addTo, setAddTo] = useState<{ kind: 'process' | 'risk' | 'control'; parentId?: string } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const invalidate = () => {
    ['ia_rcm_processes', 'ia_rcm_risks', 'ia_rcm_controls'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const { data: processes = [], isLoading } = useQuery({
    queryKey: ['ia_rcm_processes', departmentId, functionId],
    queryFn: async () => {
      let q = (supabase as any).from('ia_rcm_processes').select('*').eq('is_active', true);
      if (departmentId) q = q.eq('department_id', departmentId);
      const { data, error } = await q.order('process_name');
      if (error) throw error;
      const rows = (data ?? []) as any[];
      return functionId ? rows.filter((r) => !r.function_id || r.function_id === functionId) : rows;
    },
  });

  const processIds = useMemo(() => processes.map((p: any) => p.id), [processes]);

  const { data: risks = [] } = useQuery({
    queryKey: ['ia_rcm_risks', processIds],
    enabled: processIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_rcm_risks').select('*').in('process_id', processIds).eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const riskIds = useMemo(() => risks.map((r: any) => r.id), [risks]);

  const { data: controls = [] } = useQuery({
    queryKey: ['ia_rcm_controls', riskIds],
    enabled: riskIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_rcm_controls').select('*').in('risk_id', riskIds).eq('is_active', true);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const { data: tests = [] } = useQuery({
    queryKey: ['eng_control_tests', auditId],
    enabled: !!auditId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ia_control_tests').select('id, rcm_control_id, result, status').eq('engagement_id', auditId);
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!addTo) return;
      if (addTo.kind === 'process') {
        const { error } = await (supabase as any).from('ia_rcm_processes').insert({
          process_name: form.process_name, sub_process_name: form.sub_process_name || null,
          owner: form.owner || null, description: form.description || null,
          department_id: departmentId || null, function_id: functionId || null,
          is_active: true, created_by: userCode || null,
        });
        if (error) throw error;
      } else if (addTo.kind === 'risk') {
        const { error } = await (supabase as any).from('ia_rcm_risks').insert({
          process_id: addTo.parentId, description: form.description,
          category: form.category || null, risk_owner: form.risk_owner || null,
          likelihood: form.likelihood ? Number(form.likelihood) : null,
          impact: form.impact ? Number(form.impact) : null,
          is_active: true, created_by: userCode || null,
        });
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from('ia_rcm_controls').insert({
          risk_id: addTo.parentId, control_name: form.control_name,
          control_type: form.control_type || null, frequency: form.frequency || null,
          owner: form.owner || null, description: form.description || null,
          evidence_required: form.evidence_required || null,
          is_active: true, created_by: userCode || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { invalidate(); setAddTo(null); setForm({}); toast({ title: 'Saved' }); },
    onError: (e: any) => toast({ title: 'Could not save', description: e.message, variant: 'destructive' }),
  });

  const testedControlIds = new Set(tests.map((t: any) => t.rcm_control_id).filter(Boolean));

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  const renderForm = () => {
    if (!addTo) return null;
    return (
      <Card className="border-primary/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold">
              {addTo.kind === 'process' ? 'Add process' : addTo.kind === 'risk' ? 'Add risk' : 'Add control'}
            </p>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setAddTo(null)}><X className="h-4 w-4" /></Button>
          </div>

          {addTo.kind === 'process' && (
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Process name *</Label><Input value={form.process_name || ''} onChange={(e) => setForm(f => ({ ...f, process_name: e.target.value }))} /></div>
              <div><Label>Sub-process</Label><Input value={form.sub_process_name || ''} onChange={(e) => setForm(f => ({ ...f, sub_process_name: e.target.value }))} /></div>
              <div><Label>Process owner</Label><Input value={form.owner || ''} onChange={(e) => setForm(f => ({ ...f, owner: e.target.value }))} /></div>
            </div>
          )}

          {addTo.kind === 'risk' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Risk description *</Label><Textarea rows={2} value={form.description || ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} /></div>
              <div><Label>Category</Label><Input value={form.category || ''} onChange={(e) => setForm(f => ({ ...f, category: e.target.value }))} /></div>
              <div><Label>Risk owner</Label><Input value={form.risk_owner || ''} onChange={(e) => setForm(f => ({ ...f, risk_owner: e.target.value }))} /></div>
              <div><Label>Likelihood (1–5)</Label><Input type="number" min={1} max={5} value={form.likelihood || ''} onChange={(e) => setForm(f => ({ ...f, likelihood: e.target.value }))} /></div>
              <div><Label>Impact (1–5)</Label><Input type="number" min={1} max={5} value={form.impact || ''} onChange={(e) => setForm(f => ({ ...f, impact: e.target.value }))} /></div>
            </div>
          )}

          {addTo.kind === 'control' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Control name *</Label><Input value={form.control_name || ''} onChange={(e) => setForm(f => ({ ...f, control_name: e.target.value }))} /></div>
              <div><Label>Control type</Label>
                <Select value={form.control_type || ''} onValueChange={(v) => setForm(f => ({ ...f, control_type: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{CONTROL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Frequency</Label>
                <Select value={form.frequency || ''} onValueChange={(v) => setForm(f => ({ ...f, frequency: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{FREQUENCIES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div><Label>Control owner</Label><Input value={form.owner || ''} onChange={(e) => setForm(f => ({ ...f, owner: e.target.value }))} /></div>
              <div><Label>Evidence required</Label><Input value={form.evidence_required || ''} onChange={(e) => setForm(f => ({ ...f, evidence_required: e.target.value }))} /></div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending
                || (addTo.kind === 'process' && !form.process_name)
                || (addTo.kind === 'risk' && !form.description)
                || (addTo.kind === 'control' && !form.control_name)}
            >
              {save.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
            </Button>
            <Button variant="outline" onClick={() => setAddTo(null)}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {processes.length} process(es) · {risks.length} risk(s) · {controls.length} control(s) · {tests.length} test(s) in this audit
        </p>
        <Button size="sm" onClick={() => { setAddTo({ kind: 'process' }); setForm({}); }}>
          <Plus className="h-4 w-4 mr-1" />Add process
        </Button>
      </div>

      {renderForm()}

      {processes.length === 0 ? (
        <AuditEmptyState
          icon={Network}
          title="No risk & control matrix for this scope"
          description="Build the process → risk → control matrix so the fieldwork programme and control tests can be derived from it."
          actionLabel="Add process"
          onAction={() => { setAddTo({ kind: 'process' }); setForm({}); }}
        />
      ) : (
        <Card><CardContent className="p-0 divide-y">
          {processes.map((p: any) => {
            const pRisks = risks.filter((r: any) => r.process_id === p.id);
            const open = expanded[p.id] !== false;
            return (
              <div key={p.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <button className="flex items-start gap-2 text-left" onClick={() => setExpanded(s => ({ ...s, [p.id]: !open }))}>
                    {open ? <ChevronDown className="h-4 w-4 mt-0.5" /> : <ChevronRight className="h-4 w-4 mt-0.5" />}
                    <span>
                      <span className="text-sm font-semibold">{p.process_name}</span>
                      {p.sub_process_name && <span className="text-xs text-muted-foreground"> › {p.sub_process_name}</span>}
                      <span className="block text-xs text-muted-foreground">{pRisks.length} risk(s) · owner {p.owner || '—'}</span>
                    </span>
                  </button>
                  <Button size="sm" variant="outline" onClick={() => { setAddTo({ kind: 'risk', parentId: p.id }); setForm({}); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" />Risk
                  </Button>
                </div>

                {open && pRisks.length > 0 && (
                  <div className="mt-3 space-y-3 pl-6">
                    {pRisks.map((r: any) => {
                      const rControls = controls.filter((c: any) => c.risk_id === r.id);
                      return (
                        <div key={r.id} className="rounded-md border p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-medium">{r.description}</p>
                              <p className="text-xs text-muted-foreground">
                                {r.category || 'Uncategorised'} · owner {r.risk_owner || '—'}
                                {r.risk_level ? ` · ${r.risk_level}` : ''}
                                {r.risk_score != null ? ` · score ${r.risk_score}` : ''}
                              </p>
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => { setAddTo({ kind: 'control', parentId: r.id }); setForm({}); }}>
                              <Plus className="h-3.5 w-3.5 mr-1" />Control
                            </Button>
                          </div>
                          {rControls.length > 0 && (
                            <div className="mt-2 space-y-1.5">
                              {rControls.map((c: any) => (
                                <div key={c.id} className="flex items-center justify-between gap-2 rounded bg-muted/40 px-2.5 py-1.5">
                                  <span className="text-xs">
                                    <span className="font-medium">{c.control_name}</span>
                                    <span className="text-muted-foreground"> · {c.control_type || '—'} · {c.frequency || '—'}</span>
                                  </span>
                                  <Badge variant={testedControlIds.has(c.id) ? 'default' : 'outline'} className="text-[10px]">
                                    {testedControlIds.has(c.id) ? 'Tested in this audit' : 'Not tested'}
                                  </Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent></Card>
      )}
    </div>
  );
}
