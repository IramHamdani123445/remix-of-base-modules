/**
 * Send Eligibility Failure Notice dialog
 *
 * Raises the eligibility outcome through Omni-Comms. The Hub resolves the
 * channel, template, recipient policy, branding and delivery state.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { AlertCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useBnTriggerOmniCommsCommunication } from '@/hooks/bn/useBnClaimCommunication';
import { useUserCode } from '@/hooks/useUserCode';

const EVENT_CODE = 'bn.eligibility.failed';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  productVersionId?: string | null;
  userCode: string;
  failedRules: any[];
  eligibilitySnapshot?: any;
}

export function SendEligibilityFailureNoticeDialog({
  open,
  onOpenChange,
  claimId,
  productVersionId,
  userCode,
  failedRules,
  eligibilitySnapshot,
}: Props) {
  const trigger = useBnTriggerOmniCommsCommunication();
  const { userId: currentUserId, fullName: currentUserName } = useUserCode();
  const [currentUserEmail, setCurrentUserEmail] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data: { user } }) => { if (!cancelled) setCurrentUserEmail(user?.email || undefined); });
    return () => { cancelled = true; };
  }, []);
  const [officerNote, setOfficerNote] = useState('');
  const [appealDeadline, setAppealDeadline] = useState('');
  const [officePhone, setOfficePhone] = useState('');
  const [officeEmail, setOfficeEmail] = useState('');

  useEffect(() => {
    if (!open) return;
    setOfficerNote('');
    setAppealDeadline('');
    setOfficePhone('');
    setOfficeEmail('');
  }, [open]);

  const failedRulesText = useMemo(
    () => failedRules.map((r) => `• ${r.rule_name || r.rule_code}${r.message ? ` — ${r.message}` : ''}`).join('\n'),
    [failedRules],
  );

  const handleDispatch = async () => {
    try {
      const res = await trigger.mutateAsync({
        eventCode: EVENT_CODE,
        claimId,
        ctx: {
          productVersionId: productVersionId || undefined,
          userCode,
          currentUserId: currentUserId || undefined,
          currentUserEmail,
          currentUserName: currentUserName || undefined,
          reasonCode: 'ELIGIBILITY_FAILED',
          reasonDescription: officerNote || undefined,
          appealDeadline: appealDeadline || undefined,
          extra: {
            failedRules,
            latestEligibility: eligibilitySnapshot,
            nextSteps: officerNote || undefined,
            officePhone: officePhone || undefined,
            officeEmail: officeEmail || undefined,
          },
        },
      });
      if (res.outcome === 'accepted' || res.outcome === 'replayed') {
        toast.success(res.message);
        onOpenChange(false);
      } else toast.error(res.message);
    } catch (e: any) {
      toast.error(e?.message || 'Could not dispatch notice');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2 shrink-0 border-b">
          <DialogTitle>Send Eligibility Failure Notice</DialogTitle>
          <DialogDescription>
             The Communication Hub centrally resolves the approved template, recipient, branding, channel and delivery gate. All actions are audited.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-6 py-4 overflow-y-auto flex-1 min-h-0">
          {/* Failed rules summary */}
          <section className="rounded border p-3 bg-muted/30">
            <div className="text-xs font-medium mb-1.5 flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
              Failed checks ({failedRules.length})
            </div>
            <ScrollArea className="max-h-32">
              <pre className="text-xs whitespace-pre-wrap font-sans">{failedRulesText || '—'}</pre>
            </ScrollArea>
          </section>

          {/* Officer inputs */}
          <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Appeal deadline (optional)</Label>
              <Input
                type="date"
                value={appealDeadline}
                onChange={(e) => setAppealDeadline(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Office phone (optional)</Label>
              <Input value={officePhone} onChange={(e) => setOfficePhone(e.target.value)} placeholder="e.g. +1 869 555 0100" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Office email (optional)</Label>
              <Input value={officeEmail} onChange={(e) => setOfficeEmail(e.target.value)} placeholder="claims@socialsecurity.gov" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Officer note / next steps</Label>
              <Textarea
                value={officerNote}
                onChange={(e) => setOfficerNote(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="What should the claimant do next? This becomes {{NEXT_STEPS}} in templates that include it."
              />
              <p className="text-[10px] text-muted-foreground">{officerNote.length}/1000</p>
            </div>
          </section>
        </div>

        <DialogFooter className="gap-2 p-4 border-t shrink-0 bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={trigger.isPending}>
            Cancel
          </Button>
          <Button onClick={handleDispatch} disabled={trigger.isPending} className="gap-1">
            <Send className="h-3.5 w-3.5" /> {trigger.isPending ? 'Raising…' : 'Raise Notice'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default SendEligibilityFailureNoticeDialog;
