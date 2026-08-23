import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import {
  listWaiverRules,
  requestWaiver,
  type WaiverSource,
  type WaiverType,
} from '@/services/waiverService';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
  context: {
    employer_id: string;
    case_id?: string | null;
    violation_id?: string | null;
    fund?: string | null;
    source: WaiverSource;
    defaultAmount?: number;
  };
}

export default function RequestWaiverDialog({ open, onClose, onCreated, context }: Props) {
  const { userCode } = useUserCode();
  const [ruleId, setRuleId] = useState<string>('');
  const [type, setType] = useState<WaiverType>('PARTIAL');
  const [amount, setAmount] = useState<number>(context.defaultAmount ?? 0);
  const [reason, setReason] = useState<string>('');
  const [justification, setJustification] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const rulesQ = useQuery({ queryKey: ['waiver-rules-enabled'], queryFn: listWaiverRules, enabled: open });
  const enabledRules = (rulesQ.data ?? []).filter((r) =>
    r.enabled && (
      !context.fund ||
      !r.applicable_funds?.length ||
      r.applicable_funds.includes(context.fund)
    ),
  );
  const selectedRule = enabledRules.find((r) => r.id === ruleId) ?? null;

  const submit = async () => {
    try {
      setBusy(true);
      const id = await requestWaiver(
        {
          employer_id: context.employer_id,
          case_id: context.case_id ?? null,
          violation_id: context.violation_id ?? null,
          waiver_rule_id: ruleId || null,
          waiver_type: selectedRule?.waiver_type ?? type,
          source: context.source,
          amount_requested: amount,
          reason_code: reason || null,
          justification,
          fund: context.fund ?? null,
        },
        userCode || 'SYSTEM',
      );
      toast.success('Waiver request submitted');
      onCreated?.(id);
      onClose();
    } catch (e: any) {
      toast.error(e.message || 'Failed to submit waiver request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Waiver</DialogTitle>
          <DialogDescription>
            Routed via Workflow Mapping (event <code>waiver.approval</code>) if a rule requires approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Waiver Rule</Label>
            <Select value={ruleId} onValueChange={setRuleId}>
              <SelectTrigger><SelectValue placeholder="(no rule — manual)" /></SelectTrigger>
              <SelectContent>
                {enabledRules.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.code} · {r.name} ({r.waiver_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {!ruleId && (
            <div>
              <Label className="text-xs">Waiver Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as WaiverType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {/* Principal (contribution) waivers are policy-controlled: they are only
                      available by selecting an enabled PRINCIPAL waiver rule above. */}
                  {['PENALTY', 'INTEREST', 'FULL', 'PARTIAL'].map((t) =>
                    <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Principal (contribution) amounts cannot be waived here — they require an enabled
                principal waiver rule under Compliance &gt; Waiver Rules.
              </p>
            </div>
          )}

          <div>
            <Label className="text-xs">Amount Requested</Label>
            <Input type="number" min={0} value={amount}
              onChange={(e) => setAmount(Number(e.target.value))} />
          </div>
          {selectedRule && selectedRule.valid_reasons?.length > 0 && (
            <div>
              <Label className="text-xs">Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger><SelectValue placeholder="Select a valid reason" /></SelectTrigger>
                <SelectContent>
                  {selectedRule.valid_reasons.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">Justification</Label>
            <Textarea rows={4} value={justification} onChange={(e) => setJustification(e.target.value)} />
          </div>
          {selectedRule && selectedRule.required_documents?.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Required documents: {selectedRule.required_documents.join(', ')}.
              Upload via the case documents tab before submission.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || amount <= 0 || !justification.trim()} onClick={submit}>
            {busy ? 'Submitting…' : 'Submit Request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
