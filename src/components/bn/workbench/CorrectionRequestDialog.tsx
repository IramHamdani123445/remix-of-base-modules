import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { useUserCode } from '@/hooks/useUserCode';
import { createCorrectionRequest } from '@/services/bn/amendmentPolicyService';
import { useQueryClient } from '@tanstack/react-query';
import type { ApplicationChannel, FieldOwnership } from '@/types/bn/amendment';
import { BnBusyButton } from '@/components/bn/shared';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claimId: string;
  channel: ApplicationChannel;
  /** Fields the officer may request correction on (typically APPLICANT_SUBMITTED / DOCTOR_SUBMITTED). */
  candidateFields: FieldOwnership[];
}

export function CorrectionRequestDialog({ open, onOpenChange, claimId, channel, candidateFields }: Props) {
  const { userCode } = useUserCode();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const fields = candidateFields
      .filter((f) => picked[f.field_key])
      .map((f) => ({ field_key: f.field_key, field_label: f.field_label ?? f.field_key }));
    if (fields.length === 0) {
      toast.error('Please check the form for valid information!', { description: 'Select at least one field to correct.' });
      return;
    }
    if (!message.trim()) {
      toast.error('Please check the form for valid information!', { description: 'Provide a message for the claimant.' });
      return;
    }
    setSubmitting(true);
    try {
      await createCorrectionRequest({
        claimId,
        requestedBy: userCode ?? 'SYSTEM',
        message: message.trim(),
        fields,
        channel,
      });
      toast.success('Correction request sent to claimant');
      queryClient.invalidateQueries({ queryKey: ['bn-claim-correction-requests', claimId] });
      onOpenChange(false);
      setMessage('');
      setPicked({});
    } catch (err: any) {
      toast.error('Failed to create correction request', { description: err?.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request Correction</DialogTitle>
          <DialogDescription>
            Select the applicant-submitted fields needing correction and write a message. The claimant will be notified and can update only the selected fields.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 max-h-72 overflow-auto">
          {candidateFields.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applicant-submitted fields configured for this product.</p>
          ) : candidateFields.map((f) => (
            <label key={f.field_key} className="flex items-start gap-2 text-sm cursor-pointer">
              <Checkbox
                checked={!!picked[f.field_key]}
                onCheckedChange={(c) => setPicked((p) => ({ ...p, [f.field_key]: !!c }))}
              />
              <span>
                <span className="font-medium">{f.field_label ?? f.field_key}</span>
                <span className="ml-1 text-xs text-muted-foreground">({f.field_owner})</span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-1">
          <Label htmlFor="msg">Message to claimant</Label>
          <Textarea id="msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={500} />
        </div>

        <DialogFooter>
          <BnBusyButton loading={submitting} variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</BnBusyButton>
          <BnBusyButton loading={submitting} onClick={handleSubmit} disabled={submitting}>{submitting ? 'Sending…' : 'Send Request'}</BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
