import { useState } from 'react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Loader2, Info, Gavel, ArrowRight, ShieldAlert, Link2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useHasCapability } from '@/hooks/useHasCapability';
import { COMPLIANCE_CAPABILITIES } from '@/lib/compliance/capabilities';

interface Lead {
  id: string;
  lead_number: string;
  trade_name: string;
  business_address: string | null;
  discovered_date: string;
  source_type: string;
  status: string;
  instructed_at: string | null;
  register_by_date: string | null;
  management_escalation_due: string | null;
  matched_employer_id: string | null;
  registered_employer_id: string | null;
  legal_recommended: boolean;
  legal_recommended_by: string | null;
  legal_recommended_at: string | null;
  legal_approved_at: string | null;
  legal_approved_by: string | null;
  escalated_at: string | null;
}

const SOURCE_LABELS: Record<string, string> = { INSPECTION: 'Inspection', SCOUTING: 'Scouting' };

function statusVariant(s: string): any {
  switch (s) {
    case 'REGISTERED': return 'default';
    case 'ESCALATED': return 'destructive';
    case 'INSTRUCTED': return 'secondary';
    default: return 'outline';
  }
}

export default function UnregisteredEmployerLeads() {
  const canManageLead = useHasCapability(COMPLIANCE_CAPABILITIES.REGISTRATION_LEAD_MANAGE);
  const canApproveLegal = useHasCapability(COMPLIANCE_CAPABILITIES.LEGAL_RECOMMEND_APPROVE);
  const qc = useQueryClient();
  const [linkTarget, setLinkTarget] = useState<Lead | null>(null);
  const [matchedEmployerId, setMatchedEmployerId] = useState('');
  const [notesTarget, setNotesTarget] = useState<{ lead: Lead; action: string } | null>(null);
  const [notes, setNotes] = useState('');

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ['ce_unregistered_employer_leads'],
    queryFn: async (): Promise<Lead[]> => {
      const { data, error } = await supabase
        .from('ce_unregistered_employer_leads')
        .select('*')
        .order('discovered_date', { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as Lead[];
    },
  });

  const progress = useMutation({
    mutationFn: async (vars: { lead_id: string; action: string; notes?: string; registered_employer_id?: string }) => {
      const { error } = await supabase.rpc('ce_progress_registration_lead_v1', {
        p_lead_id: vars.lead_id,
        p_action: vars.action,
        p_notes: vars.notes,
        p_registered_employer_id: vars.registered_employer_id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ce_unregistered_employer_leads'] });
      toast.success('Lead updated');
      setLinkTarget(null); setMatchedEmployerId('');
      setNotesTarget(null); setNotes('');
    },
    onError: (e: any) => toast.error('Failed to update lead', { description: e.message }),
  });

  if (isLoading) return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Unregistered Employer Leads (DR-008)"
        subtitle="Work queue for suspected unregistered employers discovered via inspection or scouting"
        breadcrumbs={[{ label: 'Compliance', href: '/compliance/dashboard' }, { label: 'Settings', href: '/compliance/admin/settings' }, { label: 'Unregistered Employer Leads' }]}
      />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-4 flex gap-3 items-start">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">A Legal recommendation is not an approval.</p>
            <p>
              Any user with the registration-lead capability may <span className="font-medium text-foreground">recommend</span> a lead for
              Legal action, but it can only be <span className="font-medium text-foreground">approved</span> by a separate user holding the
              Legal recommend/approve capability. A user cannot self-approve their own recommendation.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Leads</CardTitle><CardDescription>Ordered by most recently discovered.</CardDescription></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>Trade Name / Address</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Discovered</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Register By</TableHead>
                <TableHead>Mgmt. Escalation Due</TableHead>
                <TableHead>Matched Employer</TableHead>
                <TableHead>Legal</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">{l.lead_number}</TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">{l.trade_name}</div>
                    <div className="text-xs text-muted-foreground">{l.business_address || '—'}</div>
                  </TableCell>
                  <TableCell><Badge variant="outline">{SOURCE_LABELS[l.source_type] || l.source_type}</Badge></TableCell>
                  <TableCell className="text-xs">{l.discovered_date}</TableCell>
                  <TableCell><Badge variant={statusVariant(l.status)}>{l.status}</Badge></TableCell>
                  <TableCell className="text-xs">{l.register_by_date || '—'}</TableCell>
                  <TableCell className="text-xs">
                    {l.management_escalation_due || '—'}
                    {l.escalated_at && <Badge variant="destructive" className="ml-1 text-[10px]">Escalated</Badge>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{l.registered_employer_id || l.matched_employer_id || '—'}</TableCell>
                  <TableCell>
                    {l.legal_approved_at ? (
                      <Badge className="gap-1 text-[10px]"><Gavel className="h-3 w-3" />Approved</Badge>
                    ) : l.legal_recommended ? (
                      <Badge variant="outline" className="gap-1 text-[10px]"><ShieldAlert className="h-3 w-3" />Recommended — pending approval</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {canManageLead && !l.instructed_at && (
                      <Button size="sm" variant="outline" onClick={() => progress.mutate({ lead_id: l.id, action: 'instruct' })}>Mark Instructed</Button>
                    )}
                    {canManageLead && !l.registered_employer_id && (
                      <Button size="sm" variant="outline" onClick={() => { setLinkTarget(l); setMatchedEmployerId(l.matched_employer_id || ''); }}>
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {canManageLead && !l.escalated_at && (
                      <Button size="sm" variant="outline" onClick={() => setNotesTarget({ lead: l, action: 'escalate' })}>Escalate</Button>
                    )}
                    {canManageLead && !l.legal_recommended && (
                      <Button size="sm" variant="outline" onClick={() => setNotesTarget({ lead: l, action: 'recommend_legal' })}>
                        <ArrowRight className="h-3.5 w-3.5 mr-1" />Recommend for Legal
                      </Button>
                    )}
                    {canApproveLegal && l.legal_recommended && !l.legal_approved_at && (
                      <Button size="sm" onClick={() => setNotesTarget({ lead: l, action: 'approve_legal' })}>
                        <Gavel className="h-3.5 w-3.5 mr-1" />Approve
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {leads.length === 0 && (
                <TableRow><TableCell colSpan={10} className="text-center text-muted-foreground py-8">No leads in the queue.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!linkTarget} onOpenChange={(open) => !open && setLinkTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Matched Registered Employer</DialogTitle>
            <DialogDescription>Enter the employer ID this lead has been matched/registered against.</DialogDescription>
          </DialogHeader>
          <div><Label>Registered Employer ID</Label><Input value={matchedEmployerId} onChange={e => setMatchedEmployerId(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkTarget(null)}>Cancel</Button>
            <Button
              disabled={!matchedEmployerId.trim() || progress.isPending}
              onClick={() => linkTarget && progress.mutate({ lead_id: linkTarget.id, action: 'link_employer', registered_employer_id: matchedEmployerId.trim() })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!notesTarget} onOpenChange={(open) => !open && setNotesTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {notesTarget?.action === 'escalate' && 'Escalate to Management'}
              {notesTarget?.action === 'recommend_legal' && 'Recommend for Legal'}
              {notesTarget?.action === 'approve_legal' && 'Approve Legal Recommendation'}
            </DialogTitle>
            <DialogDescription>
              {notesTarget?.action === 'recommend_legal' && 'This records a recommendation only — it still requires separate management/Legal approval before proceeding.'}
              {notesTarget?.action === 'approve_legal' && 'You are approving a recommendation made by another user. This action requires the Legal recommend/approve capability.'}
              {notesTarget?.action === 'escalate' && 'Notify management that this lead is at risk of missing its register-by date.'}
            </DialogDescription>
          </DialogHeader>
          <div><Label>Notes (optional)</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesTarget(null)}>Cancel</Button>
            <Button
              disabled={progress.isPending}
              onClick={() => notesTarget && progress.mutate({ lead_id: notesTarget.lead.id, action: notesTarget.action, notes: notes || undefined })}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
