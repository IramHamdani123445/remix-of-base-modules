import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { requestWaiver, listWaiverRules, type WaiverType } from '@/services/waiverService';

const WAIVER_TYPES: WaiverType[] = ['PENALTY', 'INTEREST', 'PRINCIPAL', 'FULL', 'PARTIAL'];

interface Props {
  open: boolean;
  onClose: () => void;
}

const NewWaiverRequestDialog: React.FC<Props> = ({ open, onClose }) => {
  const queryClient = useQueryClient();
  const [employerId, setEmployerId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [waiverType, setWaiverType] = useState<WaiverType>('PENALTY');
  const [ruleId, setRuleId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [justification, setJustification] = useState('');

  const { data: rules = [] } = useQuery({
    queryKey: ['ce_waiver_rules', 'enabled'],
    queryFn: listWaiverRules,
    enabled: open,
  });
  const enabledRules = rules.filter(r => r.enabled && (!waiverType || r.waiver_type === waiverType));

  const reset = () => {
    setEmployerId(''); setCaseId(''); setWaiverType('PENALTY');
    setRuleId(''); setAmount(''); setJustification('');
  };

  const createMutation = useMutation({
    mutationFn: () =>
      requestWaiver({
        employer_id: employerId.trim(),
        case_id: caseId.trim() || null,
        waiver_rule_id: ruleId || null,
        waiver_type: waiverType,
        source: 'OFFICER',
        amount_requested: Number(amount),
        justification: justification.trim(),
      }),
    onSuccess: (waiverNumber) => {
      toast.success('Waiver request submitted', { description: `Reference: ${waiverNumber}` });
      queryClient.invalidateQueries({ queryKey: ['ce_waivers'] });
      reset();
      onClose();
    },
    onError: (e: any) => toast.error('Waiver request refused', { description: e.message }),
  });

  const amountNum = Number(amount);
  const valid =
    employerId.trim().length > 0 &&
    Number.isFinite(amountNum) && amountNum > 0 &&
    justification.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Waiver Request</DialogTitle>
          <DialogDescription>
            Submit a governed waiver request. It is validated against the active waiver rules and routed for approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="wv-employer">Employer ID *</Label>
              <Input
                id="wv-employer"
                value={employerId}
                onChange={(e) => setEmployerId(e.target.value)}
                placeholder="e.g. 100003"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wv-case">Case ID (optional)</Label>
              <Input
                id="wv-case"
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                placeholder="Linked case UUID"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Waiver Type *</Label>
              <Select value={waiverType} onValueChange={(v) => { setWaiverType(v as WaiverType); setRuleId(''); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WAIVER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Waiver Rule</Label>
              <Select value={ruleId} onValueChange={setRuleId}>
                <SelectTrigger><SelectValue placeholder="Select rule (optional)" /></SelectTrigger>
                <SelectContent>
                  {enabledRules.map(r => (
                    <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wv-amount">Amount Requested (XCD) *</Label>
            <Input
              id="wv-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wv-just">Justification * (min 10 characters)</Label>
            <Textarea
              id="wv-just"
              rows={3}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Explain the business reason for this waiver…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Cancel</Button>
          <Button onClick={() => createMutation.mutate()} disabled={!valid || createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Submit Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NewWaiverRequestDialog;
