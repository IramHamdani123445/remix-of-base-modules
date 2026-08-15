import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mail, FileText, Bell, Send, Clock, Eye } from 'lucide-react';
import { LetterPreviewDialog } from './LetterPreviewDialog';
import {
  useBnClaimCommunicationHistory,
  useBnUpdateLetterStatus,
  useBnClaimOmniCommsActivity,
  useBnTriggerOmniCommsCommunication,
} from '@/hooks/bn/useBnClaimCommunication';
import {
  businessEventStatusLabel,
  businessEventStatusTone,
} from '@/platform/omni-comms/application/businessEventActivityTypes';
import { useUserCode } from '@/hooks/useUserCode';
import { toast } from 'sonner';

import { formatAuditTimestamp } from '@/lib/culture/culture';
interface Props { claimId: string; productVersionId?: string; }

const formatTime = (iso?: string) => (iso ? formatAuditTimestamp(iso) : '—');

export const CommunicationTab: React.FC<Props> = ({ claimId, productVersionId }) => {
  const { userCode: userCodeRaw, userId: currentUserId, fullName: currentUserName } = useUserCode();
  const userCode = userCodeRaw || 'SYSTEM';
  const [currentUserEmail, setCurrentUserEmail] = React.useState<string | undefined>(undefined);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: { user } } = await supabase.auth.getUser();
      if (!cancelled) setCurrentUserEmail(user?.email || undefined);
    })();
    return () => { cancelled = true; };
  }, []);
  const { data, isLoading } = useBnClaimCommunicationHistory(claimId);
  const trigger = useBnTriggerOmniCommsCommunication();
  const omni = useBnClaimOmniCommsActivity(claimId);
  const updateLetter = useBnUpdateLetterStatus();
  const [subTab, setSubTab] = useState('omni');

  const omniRows = omni.data?.rows || [];
  const logs = data?.logs || [];
  const letters = data?.letters || [];

  const handleTrigger = async (eventCode: string) => {
    try {
      const r = await trigger.mutateAsync({
        eventCode,
        claimId,
        ctx: { userCode, productVersionId, currentUserId: currentUserId || undefined, currentUserEmail, currentUserName: currentUserName || undefined },
      });
      if (r.outcome === 'accepted' || r.outcome === 'replayed') toast.success(r.message);
      else toast.error(r.message);
    } catch (e: any) {
      toast.error(e?.message || 'Trigger failed');
    }
  };

  const handleLetterStatus = async (letterId: string, status: string) => {
    try {
      await updateLetter.mutateAsync({ letterId, newStatus: status, userCode });
      toast.success(`Letter → ${status}`);
    } catch (e: any) { toast.error(e?.message || 'Update failed'); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Claim Communications</CardTitle>
            <CardDescription>
              Raised through Omnichannel Communications. Templates, branding, channel and delivery are decided centrally by the Communication Hub.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => handleTrigger('bn.evidence.requested')}>
              <Mail className="h-3.5 w-3.5 mr-1.5" /> Request Evidence
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleTrigger('bn.claim.submitted')}>
              <Send className="h-3.5 w-3.5 mr-1.5" /> Send Acknowledgement
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleTrigger('bn.life_certificate.due')}>
              <Bell className="h-3.5 w-3.5 mr-1.5" /> Life Certificate Reminder
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="omni">Omni-Comms ({omniRows.length})</TabsTrigger>
          <TabsTrigger value="archive">Legacy archive ({logs.length})</TabsTrigger>
          <TabsTrigger value="letters">Legacy letters ({letters.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="omni" className="mt-4">
          <OmniCommsList rows={omniRows} loading={omni.isLoading} />
        </TabsContent>
        <TabsContent value="archive" className="mt-4">
          <LegacyArchive rows={logs} loading={isLoading} />
        </TabsContent>
        <TabsContent value="letters" className="mt-4">
          <LetterList rows={letters} onUpdate={handleLetterStatus} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const OmniCommsList: React.FC<{ rows: any[]; loading?: boolean }> = ({ rows, loading }) => {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (!rows.length)
    return (
      <p className="text-sm text-muted-foreground p-4">
        No Omnichannel communications raised for this claim yet.
      </p>
    );
  return (
    <div className="rounded-md border divide-y">
      {rows.map((r) => (
        <div key={r.id} className="p-3 flex flex-col md:flex-row md:items-center gap-3 text-sm">
          <div className="flex items-center gap-2 min-w-[150px]">
            <Mail className="h-3.5 w-3.5" />
            <Badge variant={businessEventStatusTone(r.status)}>{businessEventStatusLabel(r.status)}</Badge>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium truncate">{r.event_code}</p>
            <p className="text-xs text-muted-foreground">
              {r.channels?.length ? r.channels.join(', ') : 'Channel resolved centrally'} •{' '}
              {r.message_count} message{r.message_count === 1 ? '' : 's'} • {r.recipient_count} recipient
              {r.recipient_count === 1 ? '' : 's'}
            </p>
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap">{formatTime(r.occurred_at)}</div>
        </div>
      ))}
    </div>
  );
};

const LegacyArchive: React.FC<{ rows: any[]; loading?: boolean }> = ({ rows, loading }) => {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground p-4">No communications recorded.</p>;
  return (
    <div className="rounded-md border divide-y">
      {rows.map((r) => {
        const dm = r.delivery_method || r.channel;
        return (
        <div key={r.id} className="p-3 flex flex-col md:flex-row md:items-start gap-3 text-sm">
          <div className="flex items-center gap-2 min-w-[160px]">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-medium">{dm}</span>
            <Badge variant="outline">Historical {r.status}</Badge>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{r.event_code}</p>
            <p className="truncate"><span className="text-muted-foreground">To {r.recipient_type}:</span> {r.recipient_address || '—'}</p>
            {r.subject && <p className="text-xs text-muted-foreground truncate">{r.subject}</p>}
            {r.error_message && <p className="text-xs text-muted-foreground mt-0.5">{r.error_message}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span><Clock className="h-3 w-3 inline mr-1" />{formatTime(r.created_at)}</span>
            <span className="italic">Archived — not an active delivery job</span>
          </div>
        </div>
        );
      })}
    </div>
  );
};

const NEXT_STATUS: Record<string, { label: string; next: string }[]> = {
  DRAFT: [{ label: 'Generate', next: 'GENERATED' }, { label: 'Cancel', next: 'CANCELLED' }],
  GENERATED: [{ label: 'Send for Approval', next: 'PENDING_APPROVAL' }, { label: 'Approve to Print', next: 'APPROVED_TO_PRINT' }, { label: 'Cancel', next: 'CANCELLED' }],
  PENDING_APPROVAL: [{ label: 'Approve to Print', next: 'APPROVED_TO_PRINT' }, { label: 'Cancel', next: 'CANCELLED' }],
  APPROVED_TO_PRINT: [{ label: 'Mark Printed', next: 'PRINTED' }],
  PRINTED: [{ label: 'Mark Dispatched', next: 'DISPATCHED' }],
  DISPATCHED: [{ label: 'Mark Delivered', next: 'DELIVERED' }, { label: 'Mark Returned', next: 'RETURNED' }],
};

const LetterList: React.FC<{ rows: any[]; onUpdate: (id: string, next: string) => void }> = ({ rows, onUpdate }) => {
  const [previewId, setPreviewId] = useState<string | null>(null);
  if (!rows.length) return <p className="text-sm text-muted-foreground p-4">No letters generated yet.</p>;
  return (
    <>
      <div className="rounded-md border divide-y">
        {rows.map((l) => (
          <div key={l.id} className="p-3 flex flex-col md:flex-row md:items-center gap-3 text-sm">
            <div className="flex items-center gap-2 min-w-[180px]">
              <FileText className="h-4 w-4" />
              <Badge variant="outline" className={STATUS_TONE[l.status] || ''}>{l.status.replace(/_/g, ' ')}</Badge>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-xs text-muted-foreground">{l.event_code}</p>
              <p className="truncate"><span className="text-muted-foreground">{l.recipient_type}:</span> {l.recipient_name || '—'}</p>
              {l.subject && <p className="text-xs text-muted-foreground truncate">{l.subject}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span><Clock className="h-3 w-3 inline mr-1" />{formatTime(l.created_at)}</span>
              <Button size="sm" variant="outline" onClick={() => setPreviewId(l.id)}>
                <Eye className="h-3 w-3 mr-1" /> View
              </Button>
              {(NEXT_STATUS[l.status] || []).map(s => (
                <Button key={s.next} size="sm" variant="outline" onClick={() => onUpdate(l.id, s.next)}>
                  {s.next === 'PRINTED' ? <Printer className="h-3 w-3 mr-1" /> : s.next === 'CANCELLED' ? <XCircle className="h-3 w-3 mr-1" /> : <CheckCircle2 className="h-3 w-3 mr-1" />}
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <LetterPreviewDialog letterId={previewId} open={!!previewId} onOpenChange={(o) => !o && setPreviewId(null)} />
    </>
  );
};

export default CommunicationTab;
