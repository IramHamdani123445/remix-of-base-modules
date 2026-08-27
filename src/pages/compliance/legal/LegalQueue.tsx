import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Scale, ArrowRight, Building2, DollarSign, Clock, Loader2, Inbox } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import {
  LEGAL_QUEUE_STATUSES,
  REFERRAL_STATUS,
  REFERRAL_STATUS_LABEL,
  referralStatusVariant,
  approveReferral,
  rejectReferral,
} from '@/services/compliance/legalEscalationFlow';
import { submitReferralToLegal } from '@/services/legal/complianceForwardingService';

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'XCD', minimumFractionDigits: 0 }).format(n || 0);

const LegalQueue = () => {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { userCode } = useUserCode();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<any | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['legal-queue-referrals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('ce_legal_referrals')
        .select(
          'id, referral_number, employer_id, employer_name, employer_zone, grand_total, status, period_from, period_to, created_at, submitted_date, approval_requested_by, approval_requested_at, approved_by, lg_intake_no, source_case_id',
        )
        .in('status', LEGAL_QUEUE_STATUSES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const stageCounts = LEGAL_QUEUE_STATUSES.map((s) => ({
    stage: s,
    count: items.filter((i: any) => i.status === s).length,
  }));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['legal-queue-referrals'] });
    qc.invalidateQueries({ queryKey: ['legal-referrals-draft'] });
    qc.invalidateQueries({ queryKey: ['ce_case_legal_status'] });
  };

  const runAction = async (id: string, fn: () => Promise<unknown>, okMessage: string, description?: string) => {
    setBusyId(id);
    try {
      await fn();
      toast.success(okMessage, description ? { description } : undefined);
      refresh();
    } catch (e: any) {
      toast.error('Action failed', { description: e?.message });
    } finally {
      setBusyId(null);
    }
  };

  const doApprove = (item: any) =>
    runAction(
      item.id,
      () => approveReferral(item.id, userCode || null),
      `Referral ${item.referral_number} approved`,
      'It can now be submitted to Legal from this queue.',
    );

  const doSubmit = (item: any) =>
    runAction(
      item.id,
      async () => {
        const r = await submitReferralToLegal(item.id, userCode || null);
        toast.message(`Legal intake ${r.lg_intake_no} created`);
      },
      `Referral ${item.referral_number} submitted to Legal`,
      'The compliance case is now escalated and Legal owns the intake.',
    );

  const doReject = async () => {
    if (!rejectTarget) return;
    await runAction(
      rejectTarget.id,
      () => rejectReferral(rejectTarget.id, rejectReason, userCode || null),
      `Referral ${rejectTarget.referral_number} rejected`,
    );
    setRejectTarget(null);
    setRejectReason('');
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <Scale className="h-6 w-6 text-primary" />
          <h1 className="text-3xl font-semibold text-foreground">Referral Approval &amp; Handover (Compliance)</h1>
        </div>
        <p className="text-muted-foreground">
          Stage 2 of the legal escalation, owned by Compliance — a supervisor approves the prepared
          referral and an authorised officer hands the approved referral over to Legal. Legal accepts
          or returns it afterwards from Legal Intake.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {stageCounts.map(({ stage, count }) => (
          <Badge key={stage} variant={count > 0 ? 'default' : 'outline'} className="text-xs py-1 px-3">
            {REFERRAL_STATUS_LABEL[stage]} ({count})
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <Card><CardContent className="py-16 text-center text-muted-foreground">
          <Inbox className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No referrals awaiting approval or submission</p>
          <p className="text-sm mt-1">
            Referrals appear here once a compliance officer completes the legal pack and sends them for approval.
          </p>
        </CardContent></Card>
      ) : (
        <div className="space-y-3">
          {items.map((item: any) => {
            const busy = busyId === item.id;
            const isSameOfficer = !!userCode && item.approval_requested_by === userCode;
            return (
              <Card key={item.id} className="hover:shadow-md transition-shadow">
                <CardContent className="py-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-medium text-foreground">{item.referral_number}</span>
                        <Badge variant={referralStatusVariant(item.status)} className="text-[10px]">
                          {REFERRAL_STATUS_LABEL[item.status] ?? item.status}
                        </Badge>
                        {item.lg_intake_no && (
                          <Badge variant="outline" className="font-mono text-[10px]">{item.lg_intake_no}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 flex-wrap">
                        <span className="font-medium text-foreground flex items-center gap-1"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{item.employer_name}</span>
                        <Badge variant="outline" className="font-mono text-[10px]">{item.employer_id}</Badge>
                        <span className="font-medium text-foreground flex items-center gap-1"><DollarSign className="h-3.5 w-3.5 text-muted-foreground" />{fmtCurrency(Number(item.grand_total || 0))}</span>
                        {item.employer_zone && <span className="text-xs text-muted-foreground">{item.employer_zone}</span>}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        {item.period_from && item.period_to && (
                          <span className="flex items-center gap-1">
                            <ArrowRight className="h-3.5 w-3.5 text-primary" />
                            <span className="font-medium text-foreground">Periods:</span> {item.period_from} → {item.period_to}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Created: {new Date(item.created_at).toLocaleDateString()}
                        </span>
                        {item.approval_requested_by && <span>Requested by {item.approval_requested_by}</span>}
                        {item.approved_by && <span>Approved by {item.approved_by}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 ml-4 shrink-0">
                      {item.source_case_id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`/compliance/cases/${item.source_case_id}`)}
                        >
                          Open Case
                        </Button>
                      )}
                      {item.status === REFERRAL_STATUS.PENDING_APPROVAL && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setRejectTarget(item)}
                          >
                            Reject
                          </Button>
                          <Button
                            size="sm"
                            disabled={busy || isSameOfficer}
                            title={
                              isSameOfficer
                                ? 'Maker-checker: you requested this approval, so another officer must approve it'
                                : 'Approve this referral for submission to Legal'
                            }
                            onClick={() => doApprove(item)}
                          >
                            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                            Approve
                          </Button>
                        </>
                      )}
                      {item.status === REFERRAL_STATUS.APPROVED_FOR_SUBMISSION && (
                        <Button size="sm" disabled={busy} onClick={() => doSubmit(item)}>
                          {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                          Submit To Legal
                        </Button>
                      )}
                      {item.status === REFERRAL_STATUS.SUBMITTED_TO_LEGAL && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate('/compliance/legal/approved-escalations')}
                        >
                          Track
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!rejectTarget} onOpenChange={(o) => !o && setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Legal Referral</DialogTitle>
            <DialogDescription>
              {rejectTarget?.referral_number} will be rejected and the compliance case stays with Compliance.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this referral being rejected?"
            maxLength={2000}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectReason.trim()} onClick={doReject}>
              Reject Referral
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LegalQueue;
