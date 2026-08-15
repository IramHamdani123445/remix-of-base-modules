import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Mail, MessageSquare, FileText, Bell, AlertTriangle, RefreshCw, Printer, Send, CheckCircle2, XCircle, Clock, Ban, FileSignature, MailCheck, Eye } from 'lucide-react';
import { LetterPreviewDialog } from './LetterPreviewDialog';
import {
  useBnClaimCommunicationHistory,
  useBnTriggerCommunication,
  useBnUpdateLetterStatus,
  useBnRetryCommunication,
  useBnGenerateLetterFromBlocked,
  useBnMarkManuallyDispatched,
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

const STATUS_TONE: Record<string, string> = {
  SENT: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  QUEUED: 'bg-blue-500/15 text-blue-700 border-blue-300',
  RETRYING: 'bg-amber-500/15 text-amber-700 border-amber-300',
  DELIVERED: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  FAILED: 'bg-destructive/15 text-destructive border-destructive/40',
  BLOCKED: 'bg-orange-500/15 text-orange-700 border-orange-400',
  SKIPPED: 'bg-muted text-muted-foreground border-border',
  DRAFT: 'bg-muted text-muted-foreground border-border',
  GENERATED: 'bg-blue-500/15 text-blue-700 border-blue-300',
  PRINT_PENDING: 'bg-amber-500/15 text-amber-700 border-amber-300',
  PENDING_APPROVAL: 'bg-amber-500/15 text-amber-700 border-amber-300',
  APPROVED_TO_PRINT: 'bg-indigo-500/15 text-indigo-700 border-indigo-300',
  PRINTED: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  DISPATCHED: 'bg-emerald-500/15 text-emerald-700 border-emerald-300',
  RETURNED: 'bg-destructive/15 text-destructive border-destructive/40',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
};

const channelIcon = (ch: string) => {
  if (ch === 'EMAIL' || ch === 'INTERNAL_EMAIL') return <Mail className="h-3.5 w-3.5" />;
  if (ch === 'SMS') return <MessageSquare className="h-3.5 w-3.5" />;
  if (ch === 'LETTER') return <FileText className="h-3.5 w-3.5" />;
  return <Bell className="h-3.5 w-3.5" />;
};

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
  const retry = useBnRetryCommunication();
  const genLetter = useBnGenerateLetterFromBlocked();
  const markDispatched = useBnMarkManuallyDispatched();
  const [subTab, setSubTab] = useState('omni');

  const omniRows = omni.data?.rows || [];
  const logs = data?.logs || [];
  const letters = data?.letters || [];

  const split = useMemo(() => {
    const dm = (l: any) => l.delivery_method || l.channel;
    const emails = logs.filter((l: any) => dm(l) === 'EMAIL' || dm(l) === 'INTERNAL_EMAIL');
    const sms = logs.filter((l: any) => dm(l) === 'SMS');
    const inapp = logs.filter((l: any) => dm(l) === 'IN_APP');
    const failed = logs.filter((l: any) => l.status === 'FAILED' || l.status === 'BLOCKED' || l.status === 'SKIPPED');
    return { emails, sms, inapp, failed };
  }, [logs]);

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

  const handleRetry = async (logId: string) => {
    try {
      await retry.mutateAsync({ logId, userCode });
      toast.success('Retry queued');
    } catch (e: any) { toast.error(e?.message || 'Retry failed'); }
  };

  const handleGenerateLetter = async (logId: string) => {
    try {
      await genLetter.mutateAsync({ logId, userCode });
      toast.success('Letter generated');
    } catch (e: any) { toast.error(e?.message || 'Generate failed'); }
  };

  const handleMarkDispatched = async (logId: string) => {
    try {
      await markDispatched.mutateAsync({ logId, userCode });
      toast.success('Marked dispatched');
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
          <TabsTrigger value="timeline">History (legacy) ({logs.length})</TabsTrigger>
          <TabsTrigger value="letters">Letters ({letters.length})</TabsTrigger>
          <TabsTrigger value="emails">Emails ({split.emails.length})</TabsTrigger>
          <TabsTrigger value="sms">SMS ({split.sms.length})</TabsTrigger>
          <TabsTrigger value="inapp">In-App ({split.inapp.length})</TabsTrigger>
          <TabsTrigger value="failed" className="text-destructive">Failed ({split.failed.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="omni" className="mt-4">
          <OmniCommsList rows={omniRows} loading={omni.isLoading} />
        </TabsContent>
        <TabsContent value="timeline" className="mt-4">
          <LogList rows={logs} loading={isLoading} onRetry={handleRetry} onGenerateLetter={handleGenerateLetter} onMarkDispatched={handleMarkDispatched} />
        </TabsContent>
        <TabsContent value="letters" className="mt-4">
          <LetterList rows={letters} onUpdate={handleLetterStatus} />
        </TabsContent>
        <TabsContent value="emails" className="mt-4">
          <LogList rows={split.emails} loading={isLoading} onRetry={handleRetry} onGenerateLetter={handleGenerateLetter} onMarkDispatched={handleMarkDispatched} />
        </TabsContent>
        <TabsContent value="sms" className="mt-4">
          <LogList rows={split.sms} loading={isLoading} onRetry={handleRetry} onGenerateLetter={handleGenerateLetter} onMarkDispatched={handleMarkDispatched} />
        </TabsContent>
        <TabsContent value="inapp" className="mt-4">
          <LogList rows={split.inapp} loading={isLoading} onRetry={handleRetry} onGenerateLetter={handleGenerateLetter} onMarkDispatched={handleMarkDispatched} />
        </TabsContent>
        <TabsContent value="failed" className="mt-4">
          <LogList rows={split.failed} loading={isLoading} onRetry={handleRetry} onGenerateLetter={handleGenerateLetter} onMarkDispatched={handleMarkDispatched} highlightFailed />
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

interface LogListProps {
  rows: any[];
  loading?: boolean;
  onRetry: (id: string) => void;
  onGenerateLetter?: (id: string) => void;
  onMarkDispatched?: (id: string) => void;
  highlightFailed?: boolean;
}

const LogList: React.FC<LogListProps> = ({ rows, loading, onRetry, onGenerateLetter, onMarkDispatched }) => {
  if (loading) return <p className="text-sm text-muted-foreground p-4">Loading…</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground p-4">No communications recorded.</p>;
  return (
    <div className="rounded-md border divide-y">
      {rows.map((r) => {
        const dm = r.delivery_method || r.channel;
        const missing: string[] = Array.isArray(r.context?.missing) ? r.context.missing : [];
        const isBlocked = r.status === 'BLOCKED';
        const canRetry = r.status === 'FAILED' || r.status === 'SKIPPED' || r.status === 'BLOCKED';
        return (
        <div key={r.id} className="p-3 flex flex-col md:flex-row md:items-start gap-3 text-sm">
          <div className="flex items-center gap-2 min-w-[160px]">
            {channelIcon(dm)}
            <span className="font-medium">{dm}</span>
            <Badge variant="outline" className={STATUS_TONE[r.status] || ''}>
              {isBlocked && <Ban className="h-3 w-3 mr-1 inline" />}
              {r.status}
            </Badge>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs text-muted-foreground">{r.event_code}</p>
            <p className="truncate"><span className="text-muted-foreground">To {r.recipient_type}:</span> {r.recipient_address || '—'}</p>
            {r.subject && <p className="text-xs text-muted-foreground truncate">{r.subject}</p>}
            {r.error_message && (
              <p className="text-xs text-destructive flex items-center gap-1 mt-0.5">
                <AlertTriangle className="h-3 w-3" /> {r.error_message}
              </p>
            )}
            {missing.length > 0 && (
              <p className="text-xs text-orange-700 mt-0.5">Missing: {missing.join(', ')}</p>
            )}
            {r.context?.suggestedFix && (
              <p className="text-xs text-blue-700 mt-0.5"><strong>Fix:</strong> {r.context.suggestedFix}</p>
            )}
            {r.context?.fallbackNote && (
              <p className="text-xs text-muted-foreground italic mt-0.5">{r.context.fallbackNote}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span><Clock className="h-3 w-3 inline mr-1" />{formatTime(r.created_at)}</span>
            {canRetry && (
              <Button size="sm" variant="outline" onClick={() => onRetry(r.id)}>
                <RefreshCw className="h-3 w-3 mr-1" /> Retry
              </Button>
            )}
            {isBlocked && dm !== 'LETTER' && onGenerateLetter && (
              <Button size="sm" variant="outline" onClick={() => onGenerateLetter(r.id)}>
                <FileSignature className="h-3 w-3 mr-1" /> Generate Letter
              </Button>
            )}
            {(isBlocked || r.status === 'FAILED') && onMarkDispatched && (
              <Button size="sm" variant="outline" onClick={() => onMarkDispatched(r.id)}>
                <MailCheck className="h-3 w-3 mr-1" /> Mark Dispatched
              </Button>
            )}
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
