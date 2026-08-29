import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Plus, Edit, Info, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface Exemption {
  id: string;
  person_ssn: string;
  person_name: string | null;
  employer_id: string;
  fund_code: string;
  effective_from: string;
  effective_to: string | null;
  status: string;
  authority_reference: string | null;
  granting_authority: string;
  evidence_reference: string | null;
  notes: string | null;
  recorded_by: string | null;
}

interface AuditEntry {
  id: string;
  action: string;
  entity_id: string;
  user_name: string | null;
  timestamp: string;
  payload_json: Record<string, unknown> | null;
}


const FUNDS = [
  { code: 'LV', label: 'Levy' },
  { code: 'SV', label: 'Severance' },
  { code: 'SS', label: 'Social Security' },
];

const STATUSES = ['ACTIVE', 'REVOKED', 'EXPIRED', 'PENDING_VERIFICATION'];
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Active', REVOKED: 'Revoked', EXPIRED: 'Expired', PENDING_VERIFICATION: 'Pending verification',
};

const emptyForm = {
  person_ssn: '', person_name: '', employer_id: '', fund_code: 'LV',
  effective_from: '', effective_to: '', status: 'PENDING_VERIFICATION',
  authority_reference: '', granting_authority: '', evidence_reference: '', notes: '',
};

function statusVariant(s: string): any {
  switch (s) {
    case 'ACTIVE': return 'default';
    case 'REVOKED': return 'destructive';
    case 'EXPIRED': return 'secondary';
    default: return 'outline';
  }
}

export default function ContributionExemptions() {
  const canManage = useHasCapability(COMPLIANCE_CAPABILITIES.EXEMPTION_MANAGE);
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Exemption | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [revoking, setRevoking] = useState<Exemption | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const { data: exemptions = [], isLoading } = useQuery({
    queryKey: ['ce_contribution_exemptions'],
    queryFn: async (): Promise<Exemption[]> => {
      const { data, error } = await supabase
        .from('ce_contribution_exemptions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Exemption[];
    },
  });

  // Grant / amend / revoke actions are written to the canonical compliance
  // audit trail by the governed commands; this is the read-only history view.
  const { data: history = [] } = useQuery({
    queryKey: ['ce_contribution_exemption_history'],
    queryFn: async (): Promise<AuditEntry[]> => {
      const { data, error } = await supabase
        .from('system_audit_trail')
        .select('id, action, entity_id, user_name, timestamp, payload_json')
        .eq('entity_type', 'ce_contribution_exemptions')
        .order('timestamp', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as unknown as AuditEntry[];
    },
  });


  // Granting, amending and revoking an exemption is a governed business action:
  // the server command verifies `compliance.exemption.manage`, validates the
  // authority evidence and writes the audit trail. Direct table writes are
  // blocked by the database guard.
  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('ce_upsert_contribution_exemption_v1' as never, {
        p_id: editing?.id ?? null,
        p_person_ssn: form.person_ssn,
        p_person_name: form.person_name || null,
        p_employer_id: form.employer_id,
        p_fund_code: form.fund_code,
        p_effective_from: form.effective_from,
        p_effective_to: form.effective_to || null,
        p_status: form.status,
        p_granting_authority: form.granting_authority,
        p_authority_reference: form.authority_reference || null,
        p_evidence_reference: form.evidence_reference || null,
        p_notes: form.notes || null,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_contribution_exemptions'] });
      toast.success(editing ? 'Exemption updated' : 'Exemption created');
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error('Failed to save exemption', { description: e.message }),
  });

  const revokeMutation = useMutation({
    mutationFn: async () => {
      if (!revoking) return;
      const { error } = await supabase.rpc('ce_revoke_contribution_exemption_v1' as never, {
        p_id: revoking.id,
        p_reason: revokeReason,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_contribution_exemptions'] });
      qc.invalidateQueries({ queryKey: ['ce_contribution_exemption_history'] });
      toast.success('Exemption revoked');
      setRevoking(null);
      setRevokeReason('');
    },
    onError: (e: any) => toast.error('Failed to revoke exemption', { description: e.message }),
  });

  const openAdd = () => { setEditing(null); setForm(emptyForm); setDialogOpen(true); };
  const openEdit = (e: Exemption) => {
    setEditing(e);
    setForm({
      person_ssn: e.person_ssn, person_name: e.person_name || '', employer_id: e.employer_id,
      fund_code: e.fund_code, effective_from: e.effective_from, effective_to: e.effective_to || '',
      status: e.status, authority_reference: e.authority_reference || '', granting_authority: e.granting_authority,
      evidence_reference: e.evidence_reference || '', notes: e.notes || '',
    });
    setDialogOpen(true);
  };


  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Contribution Exemptions (DR-007)"
        subtitle="Manage recognized statutory exemptions from contribution detection"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Contribution Exemptions' }]}
        actions={canManage ? <Button className="gap-2" onClick={openAdd}><Plus className="h-4 w-4" />Add Exemption</Button> : undefined}
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">
              An exemption is scoped to a specific person + employer + fund + effective period.
            </p>
            <p>
              An exemption granted at one employer never suppresses detection at another employer for the same person — each
              employer relationship must have its own exemption record.
            </p>
            <p className="flex items-center gap-1">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Only exemptions with status <span className="font-medium text-foreground">Active</span> suppress detection. Revoked, expired, or
              pending-verification exemptions do not.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Exemptions</CardTitle><CardDescription>All recorded contribution exemptions, most recent first.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person SSN</TableHead>
                <TableHead>Employer</TableHead>
                <TableHead>Fund</TableHead>
                <TableHead>Effective</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Authority Ref.</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exemptions.map(ex => (
                <TableRow key={ex.id}>
                  <TableCell>
                    <div className="font-mono text-xs">{ex.person_ssn}</div>
                    {ex.person_name && <div className="text-xs text-muted-foreground">{ex.person_name}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{ex.employer_id}</TableCell>
                  <TableCell>{FUNDS.find(f => f.code === ex.fund_code)?.label || ex.fund_code}</TableCell>
                  <TableCell className="text-xs">{ex.effective_from} → {ex.effective_to ?? 'open'}</TableCell>
                  <TableCell><Badge variant={statusVariant(ex.status)}>{STATUS_LABELS[ex.status] || ex.status}</Badge></TableCell>
                  <TableCell className="text-xs">{ex.authority_reference || '—'}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label="Edit exemption" disabled={!canManage} onClick={() => openEdit(ex)}><Edit className="h-4 w-4" /></Button>
                    {ex.status !== 'REVOKED' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={!canManage}
                        onClick={() => { setRevoking(ex); setRevokeReason(''); }}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {exemptions.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No exemptions recorded yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Grant / Revoke History</CardTitle>
          <CardDescription>Audit trail of exemption grants, amendments and revocations — actor, time and reason.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Exemption</TableHead>
                <TableHead>Reason / Authority</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map(h => {
                const p = (h.payload_json ?? {}) as Record<string, any>;
                return (
                  <TableRow key={h.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(h.timestamp).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{h.action}</TableCell>
                    <TableCell className="text-xs">{h.user_name || '—'}</TableCell>
                    <TableCell className="font-mono text-[11px]">{h.entity_id}</TableCell>
                    <TableCell className="text-xs">{p.reason || p.granting_authority || p.authority_reference || '—'}</TableCell>
                  </TableRow>
                );
              })}
              {history.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No exemption history recorded yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!revoking} onOpenChange={o => { if (!o) setRevoking(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke Exemption</DialogTitle>
            <DialogDescription>
              Revoking stops this exemption from suppressing detection from now on. A reason is mandatory and is recorded in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="ex-revoke-reason">Revocation Reason</Label>
            <Textarea id="ex-revoke-reason" value={revokeReason} onChange={e => setRevokeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => revokeMutation.mutate()}
              disabled={revokeMutation.isPending || revokeReason.trim() === ''}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Exemption' : 'Add Exemption'}</DialogTitle>
            <DialogDescription>Exemptions are scoped to person + employer + fund + effective period.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div><Label htmlFor="ex-ssn">Person SSN</Label><Input id="ex-ssn" value={form.person_ssn} onChange={e => setForm({ ...form, person_ssn: e.target.value })} /></div>
            <div><Label htmlFor="ex-name">Person Name (optional)</Label><Input id="ex-name" value={form.person_name} onChange={e => setForm({ ...form, person_name: e.target.value })} /></div>
            <div><Label htmlFor="ex-employer">Employer ID</Label><Input id="ex-employer" value={form.employer_id} onChange={e => setForm({ ...form, employer_id: e.target.value })} placeholder="Employer this exemption applies to" /></div>
            <div>
              <Label>Fund</Label>
              <Select value={form.fund_code} onValueChange={v => setForm({ ...form, fund_code: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FUNDS.map(f => <SelectItem key={f.code} value={f.code}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="ex-from">Effective From</Label><Input id="ex-from" type="date" value={form.effective_from} onChange={e => setForm({ ...form, effective_from: e.target.value })} /></div>
            <div><Label htmlFor="ex-to">Effective To (optional)</Label><Input id="ex-to" type="date" value={form.effective_to} onChange={e => setForm({ ...form, effective_to: e.target.value })} /></div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label htmlFor="ex-authref">Authority Reference</Label><Input id="ex-authref" value={form.authority_reference} onChange={e => setForm({ ...form, authority_reference: e.target.value })} /></div>
            <div><Label htmlFor="ex-authority">Granting Authority</Label><Input id="ex-authority" value={form.granting_authority} onChange={e => setForm({ ...form, granting_authority: e.target.value })} /></div>
            <div><Label htmlFor="ex-evidence">Evidence Reference</Label><Input id="ex-evidence" value={form.evidence_reference} onChange={e => setForm({ ...form, evidence_reference: e.target.value })} /></div>
            <div className="col-span-2"><Label htmlFor="ex-notes">Notes</Label><Textarea id="ex-notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
