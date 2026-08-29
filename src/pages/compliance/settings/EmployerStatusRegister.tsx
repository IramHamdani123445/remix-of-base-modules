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
import { Loader2, Search, Info, ShieldAlert, History } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface EmployerLite {
  regno: string;
  name: string | null;
}

interface StatusState {
  employer_id: string;
  status: string;
  effective_date: string;
  evidence_type: string;
  evidence_reference: string | null;
  clearance_certificate_reference: string | null;
  reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

const STATUSES = ['Active', 'Inactive', 'Closed', 'Ceased'];
const EVIDENCE_TYPES = [
  'Inspector visit',
  'Employer form',
  'Registry notice',
  'Court order',
  'Other documented',
];

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'Active': return 'default';
    case 'Inactive': return 'secondary';
    case 'Closed': return 'outline';
    case 'Ceased': return 'destructive';
    default: return 'outline';
  }
}

export default function EmployerStatusRegister() {
  const canChange = useHasCapability(COMPLIANCE_CAPABILITIES.EMPLOYER_STATUS_CHANGE);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedEmployer, setSelectedEmployer] = useState<EmployerLite | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    status: 'Active',
    evidence_type: '',
    evidence_reference: '',
    clearance_certificate_reference: '',
    reason: '',
    effective_date: new Date().toISOString().slice(0, 10),
  });

  const { data: employers = [], isLoading: loadingEmployers } = useQuery({
    queryKey: ['employer_status_register_search', search],
    queryFn: async (): Promise<EmployerLite[]> => {
      let q = supabase.from('er_master').select('regno, name').order('name', { ascending: true }).limit(50);
      if (search.trim()) {
        q = q.or(`regno.ilike.%${search}%,name.ilike.%${search}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as EmployerLite[];
    },
  });

  const { data: currentState, isLoading: loadingState } = useQuery({
    queryKey: ['ce_employer_status_current', selectedEmployer?.regno],
    enabled: !!selectedEmployer,
    queryFn: async (): Promise<StatusState | null> => {
      const { data, error } = await supabase
        .from('ce_employer_status_states')
        .select('*')
        .eq('employer_id', selectedEmployer!.regno)
        .order('changed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as StatusState) || null;
    },
  });

  const { data: history = [], isLoading: loadingHistory } = useQuery({
    queryKey: ['ce_employer_status_history', selectedEmployer?.regno],
    enabled: !!selectedEmployer,
    queryFn: async (): Promise<StatusState[]> => {
      const { data, error } = await supabase
        .from('ce_employer_status_states')
        .select('*')
        .eq('employer_id', selectedEmployer!.regno)
        .order('changed_at', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as StatusState[];
    },
  });

  const changeStatusMutation = useMutation({
    mutationFn: async () => {
      if (!selectedEmployer) throw new Error('No employer selected');
      if (!form.evidence_type) throw new Error('Evidence type is required');
      if (!form.evidence_reference.trim()) throw new Error('Evidence reference is required');
      if (!form.reason.trim()) throw new Error('Reason is required');
      const { error } = await supabase.rpc('ce_set_employer_status_v1', {
        p_employer_id: selectedEmployer.regno,
        p_status: form.status,
        p_evidence_type: form.evidence_type,
        p_evidence_reference: form.evidence_reference,
        p_reason: form.reason,
        p_effective_date: form.effective_date,
        p_clearance_reference: form.clearance_certificate_reference || undefined,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_employer_status_current', selectedEmployer?.regno] });
      qc.invalidateQueries({ queryKey: ['ce_employer_status_history', selectedEmployer?.regno] });
      toast.success('Employer status updated');
      setDialogOpen(false);
    },
    onError: (e: any) => toast.error('Failed to update status', { description: e.message }),
  });

  const openChangeDialog = () => {
    setForm({
      status: currentState?.status || 'Active',
      evidence_type: '',
      evidence_reference: '',
      clearance_certificate_reference: '',
      reason: '',
      effective_date: new Date().toISOString().slice(0, 10),
    });
    setDialogOpen(true);
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Employer Status Register (DR-011 / DR-012)"
        subtitle="Authoritative employer status — Active, Inactive, Closed, Ceased"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Employer Status Register' }]}
      />

      <Card className="border-warning/40 bg-warning/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-warning shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground">This is the authoritative employer status used by runtime detection.</p>
            <p>Marking an employer Inactive or Closed never erases historical obligations or violations — all prior records remain intact and visible. Runtime detection rules read this status directly; no UI-only or locally-cached status value overrides it.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Find Employer</CardTitle>
            <CardDescription>Search by registration number or name</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search employers..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="max-h-[420px] overflow-y-auto space-y-1">
              {loadingEmployers && <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
              {!loadingEmployers && employers.map(e => (
                <button
                  key={e.regno}
                  onClick={() => setSelectedEmployer(e)}
                  className={`w-full text-left px-3 py-2 rounded-md text-sm hover:bg-muted transition-colors ${selectedEmployer?.regno === e.regno ? 'bg-muted border border-border' : ''}`}
                >
                  <div className="font-medium text-foreground truncate">{e.name || 'Unnamed'}</div>
                  <div className="text-xs text-muted-foreground font-mono">{e.regno}</div>
                </button>
              ))}
              {!loadingEmployers && employers.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No employers found.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{selectedEmployer ? selectedEmployer.name || selectedEmployer.regno : 'Select an employer'}</CardTitle>
              {selectedEmployer && <CardDescription className="font-mono">{selectedEmployer.regno}</CardDescription>}
            </div>
            {selectedEmployer && canChange && (
              <Button className="gap-2" onClick={openChangeDialog}><ShieldAlert className="h-4 w-4" />Change Status</Button>
            )}
          </CardHeader>
          <CardContent className="space-y-6">
            {!selectedEmployer && (
              <p className="text-sm text-muted-foreground py-10 text-center">Select an employer from the list to view and change their authoritative status.</p>
            )}
            {selectedEmployer && (loadingState ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Current status:</span>
                {currentState ? (
                  <Badge variant={statusVariant(currentState.status)}>{currentState.status}</Badge>
                ) : (
                  <Badge variant="outline">No status recorded</Badge>
                )}
                {currentState?.effective_date && (
                  <span className="text-xs text-muted-foreground">effective {currentState.effective_date}</span>
                )}
              </div>
            ))}

            {selectedEmployer && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-foreground">Status change history</h3>
                </div>
                {loadingHistory ? (
                  <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Evidence Type</TableHead>
                        <TableHead>Evidence Ref</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Changed By</TableHead>
                        <TableHead>Changed At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell><Badge variant={statusVariant(h.status)}>{h.status}</Badge></TableCell>
                          <TableCell>{h.effective_date}</TableCell>
                          <TableCell>{h.evidence_type}</TableCell>
                          <TableCell className="text-xs">{h.evidence_reference || '—'}</TableCell>
                          <TableCell className="text-xs max-w-[220px] truncate" title={h.reason || ''}>{h.reason || '—'}</TableCell>
                          <TableCell className="text-xs">{h.changed_by || '—'}</TableCell>
                          <TableCell className="text-xs">{new Date(h.changed_at).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                      {history.length === 0 && (
                        <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No status changes recorded yet.</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Employer Status</DialogTitle>
            <DialogDescription>
              Evidence type, reference and reason are all mandatory. This never removes historical obligations or violations.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>New Status</Label>
              <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Effective Date</Label>
              <Input type="date" value={form.effective_date} onChange={e => setForm({ ...form, effective_date: e.target.value })} />
            </div>
            <div>
              <Label>Evidence Type</Label>
              <Select value={form.evidence_type} onValueChange={v => setForm({ ...form, evidence_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select evidence type" /></SelectTrigger>
                <SelectContent>
                  {EVIDENCE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Evidence Reference</Label>
              <Input value={form.evidence_reference} onChange={e => setForm({ ...form, evidence_reference: e.target.value })} placeholder="e.g. Visit report #, form ID, gazette notice" />
            </div>
            {(form.status === 'Closed' || form.status === 'Ceased') && (
              <div>
                <Label>Clearance Certificate Reference (optional)</Label>
                <Input value={form.clearance_certificate_reference} onChange={e => setForm({ ...form, clearance_certificate_reference: e.target.value })} />
              </div>
            )}
            <div>
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => changeStatusMutation.mutate()} disabled={changeStatusMutation.isPending}>
              {changeStatusMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Status Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
