import { useMemo, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PermissionWrapper } from '@/components/ui/permission-wrapper';
import { PermissionButton } from '@/components/ui/permission-button';
import { useUserCode } from '@/hooks/useUserCode';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  ensurePackItems,
  setPackItem,
  validatePack,
  resolveApprovalWorkflow,
  type LegalPackItem,
} from '@/services/legalHandoffService';
import {
  requestReferralApproval,
  PREPARATION_STATUSES,
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABEL,
} from '@/services/compliance/legalEscalationFlow';
import { CheckCircle2, AlertTriangle, FileCheck2, Send } from 'lucide-react';


const PERMISSION = 'manage_compliance';

export default function LegalPackPreparationPage() {
  return (
    <PermissionWrapper moduleName={PERMISSION}>
      <Inner />
    </PermissionWrapper>
  );
}

function Inner() {
  const [params] = useSearchParams();
  const referralIdFromQuery = params.get('referral');
  const { userCode } = useUserCode();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(referralIdFromQuery);

  const { data: referrals = [] } = useQuery({
    queryKey: ['legal-referrals-draft'],
    queryFn: async () => {
      const { data, error } = await (supabase.from('ce_legal_referrals' as any) as any)
        .select('id, referral_number, employer_name, employer_id, grand_total, status, return_reason, period_from, period_to')
        .in('status', PREPARATION_STATUSES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });

  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ['legal-pack-items', selected],
    queryFn: () => (selected ? ensurePackItems(selected) : Promise.resolve([] as LegalPackItem[])),
    enabled: !!selected,
  });

  const { data: workflowInfo } = useQuery({
    queryKey: ['legal-approval-wf', selected],
    queryFn: async () => {
      const ref = referrals.find((r: any) => r.id === selected);
      return resolveApprovalWorkflow(Number(ref?.grand_total || 0), null);
    },
    enabled: !!selected && referrals.length > 0,
  });

  const validation = useMemo(() => validatePack(items), [items]);

  const toggleMut = useMutation({
    mutationFn: ({ id, satisfied }: { id: string; satisfied: boolean }) =>
      setPackItem(id, satisfied, userCode || 'SYSTEM'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['legal-pack-items', selected] }),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No referral');
      if (!validation.complete) throw new Error('Pack incomplete');
      return requestReferralApproval(selected, userCode || null);
    },
    onSuccess: (res) => {
      toast.success(
        res.status === REFERRAL_STATUS.PENDING_APPROVAL
          ? `Sent for approval${res.workflowName ? ` — ${res.workflowName}` : ''}`
          : 'Approved automatically — no approval workflow is mapped',
        {
          description:
            res.status === REFERRAL_STATUS.PENDING_APPROVAL
              ? 'A different officer must approve it in the Legal Queue before it reaches Legal.'
              : 'Submit it to Legal from the Legal Queue. The auto-approval has been recorded in the audit trail.',
        },
      );
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['legal-referrals-draft'] });
      qc.invalidateQueries({ queryKey: ['legal-queue-referrals'] });
      qc.invalidateQueries({ queryKey: ['ce_case_legal_status'] });
    },
    onError: (e: any) => toast.error(e.message),
  });


  const ref = referrals.find((r: any) => r.id === selected);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileCheck2 className="h-6 w-6 text-primary" />
          Legal Pack Preparation
        </h1>
        <p className="text-sm text-muted-foreground">
          Stage 1 of the legal escalation. Complete every required pack item, then send the referral
          for approval — nothing reaches Legal until it is approved.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referral</CardTitle>
          <CardDescription>
            Draft referrals and referrals returned by Legal for rework appear here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={selected || ''} onValueChange={setSelected}>
            <SelectTrigger><SelectValue placeholder="Select a referral" /></SelectTrigger>
            <SelectContent>
              {referrals.map((r: any) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.referral_number} — {r.employer_name} (${Number(r.grand_total).toLocaleString()}) ·{' '}
                  {REFERRAL_STATUS_LABEL[r.status] ?? r.status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ref?.status === REFERRAL_STATUS.RETURNED_BY_LEGAL && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <span className="font-medium">Returned by Legal:</span> {ref.return_reason || 'No reason recorded'}
            </div>
          )}
        </CardContent>
      </Card>


      {selected && ref && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Handoff Checklist</CardTitle>
              <CardDescription>
                {validation.complete ? (
                  <span className="text-success flex items-center gap-1">
                    <CheckCircle2 className="h-4 w-4" /> Pack complete
                  </span>
                ) : (
                  <span className="text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" /> {validation.missing.length} required item(s) missing:{' '}
                    {validation.missing
                      .map((m: any) => (typeof m === 'string' ? m : m.item_label ?? m.item_code))
                      .join(', ')}
                  </span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {itemsLoading ? (
                <div className="text-muted-foreground py-8 text-center">Loading…</div>
              ) : (
                items.map((it) => (
                  <div key={it.id} className="flex items-start gap-3 p-3 border rounded-md">
                    <Checkbox
                      checked={it.is_satisfied}
                      onCheckedChange={(v) => toggleMut.mutate({ id: it.id, satisfied: !!v })}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{it.item_label}</span>
                        {it.is_required && <Badge variant="secondary" className="text-[10px]">Required</Badge>}
                        {it.is_satisfied && it.satisfied_by && (
                          <span className="text-xs text-muted-foreground">
                            by {it.satisfied_by} on {it.satisfied_at?.slice(0, 10)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Send For Approval</CardTitle>
              <CardDescription>
                {workflowInfo?.enabled
                  ? `Approval workflow: ${workflowInfo.workflowName}. A second officer must approve before the referral can be submitted to Legal.`
                  : 'No approval workflow is mapped for legal.escalation_approval — the referral will be auto-approved and that fact recorded in the audit trail.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                Referral <span className="font-mono">{ref.referral_number}</span> — total ${Number(ref.grand_total).toLocaleString()}
              </div>
              <PermissionButton
                moduleName={PERMISSION}
                actionName="manage"
                onClick={() => submitMut.mutate()}
                disabled={!validation.complete || submitMut.isPending}
                title={
                  validation.complete
                    ? 'Send this referral for approval'
                    : 'Complete every required pack item first'
                }
              >
                <Send className="h-4 w-4 mr-2" />
                Send For Approval
              </PermissionButton>
            </CardContent>
          </Card>

        </>
      )}
    </div>
  );
}
