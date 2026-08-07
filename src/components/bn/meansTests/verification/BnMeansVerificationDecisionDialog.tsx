/**
 * MEANS-TEST EPIC 8 — verification decision dialog.
 *
 * Records one decision about one frozen fact. It never edits a declared
 * value. Outcome rules (which outcomes exist, which need a reason, which
 * raise a clarification) come from the governed reference payload.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  outcomeRequiresClarification,
  outcomeRequiresReason,
  reasonOptionsForOutcome,
  BN_MEANS_FACT_KIND_LABEL,
  type BnMeansVerificationFactCard,
  type BnMeansVerificationReference,
} from '@/types/bn/meansTests/meansVerification';

export interface BnMeansVerificationDecisionDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fact: BnMeansVerificationFactCard | null;
  readonly reference: BnMeansVerificationReference | null;
  readonly busy: boolean;
  readonly onSubmit: (payload: Record<string, unknown>, reasonCode: string | null) => void;
}

export const BnMeansVerificationDecisionDialog: React.FC<BnMeansVerificationDecisionDialogProps> = ({
  open, onOpenChange, fact, reference, busy, onSubmit,
}) => {
  const [outcome, setOutcome] = React.useState('VERIFIED');
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const [evidenceChecked, setEvidenceChecked] = React.useState(false);
  const [informationRequired, setInformationRequired] = React.useState('');
  const [recipientKind, setRecipientKind] = React.useState('CLAIMANT');
  const [dueDate, setDueDate] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setOutcome('VERIFIED');
      setReasonCode('');
      setNote('');
      setEvidenceChecked(false);
      setInformationRequired('');
      setRecipientKind('CLAIMANT');
      setDueDate('');
    }
  }, [open, fact?.work_id]);

  const needsReason = outcomeRequiresReason(reference, outcome);
  const needsClarification = outcomeRequiresClarification(reference, outcome);
  const reasons = reasonOptionsForOutcome(reference, outcome);
  const missing =
    (needsReason && !reasonCode.trim()) || (needsClarification && !informationRequired.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" data-testid="means-verification-decision-dialog">
        <DialogHeader>
          <DialogTitle>Record a verification decision</DialogTitle>
          <DialogDescription>
            {fact ? BN_MEANS_FACT_KIND_LABEL[fact.fact_kind] : 'Fact'} —{' '}
            {fact?.fact_summary ?? 'submitted fact'}. The declared value is not changed by this decision.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Decision</legend>
            <div className="grid gap-2">
              {(reference?.outcomes ?? []).map((option) => (
                <label
                  key={option.code}
                  className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm"
                  data-testid={`means-outcome-${option.code}`}
                >
                  <input
                    type="radio"
                    name="means-verification-outcome"
                    className="mt-1"
                    value={option.code}
                    checked={outcome === option.code}
                    onChange={() => { setOutcome(option.code); setReasonCode(''); }}
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    {option.description && (
                      <span className="block text-xs text-muted-foreground">{option.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {reasons.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="means-verification-reason">
                Reason {needsReason ? '(required)' : '(optional)'}
              </Label>
              <select
                id="means-verification-reason"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                <option value="">Select a reason…</option>
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>{r.label}</option>
                ))}
              </select>
            </div>
          )}

          {needsClarification && (
            <div className="space-y-3 rounded-md border border-dashed p-3">
              <p className="text-xs text-muted-foreground">
                A clarification request is raised for this fact. The fact returns for re-review
                once a response is recorded.
              </p>
              <div className="space-y-1">
                <Label htmlFor="means-clarification-required">What is needed (required)</Label>
                <Textarea
                  id="means-clarification-required"
                  value={informationRequired}
                  onChange={(e) => setInformationRequired(e.target.value)}
                  placeholder="Describe exactly what information or document is needed."
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="means-clarification-recipient">Ask</Label>
                  <select
                    id="means-clarification-recipient"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={recipientKind}
                    onChange={(e) => setRecipientKind(e.target.value)}
                  >
                    {(reference?.recipient_kinds ?? []).map((r) => (
                      <option key={r.code} value={r.code}>{r.label}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="means-clarification-due">Response due by</Label>
                  <Input
                    id="means-clarification-due"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="means-evidence-checked"
              checked={evidenceChecked}
              onCheckedChange={(v) => setEvidenceChecked(v === true)}
            />
            <Label htmlFor="means-evidence-checked" className="text-sm font-normal">
              I reviewed the supporting evidence for this fact
            </Label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="means-verification-note">Note</Label>
            <Textarea
              id="means-verification-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional explanation recorded on the audit trail."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || missing || !fact}
            data-testid="means-verification-decision-submit"
            onClick={() =>
              onSubmit(
                {
                  work_id: fact?.work_id,
                  outcome,
                  reason_code: reasonCode.trim() || null,
                  note: note.trim() || null,
                  evidence_checked: evidenceChecked,
                  ...(needsClarification
                    ? {
                        information_required: informationRequired.trim(),
                        recipient_kind: recipientKind,
                        due_date: dueDate || null,
                      }
                    : {}),
                },
                reasonCode.trim() || null,
              )
            }
          >
            Record decision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansVerificationDecisionDialog;
