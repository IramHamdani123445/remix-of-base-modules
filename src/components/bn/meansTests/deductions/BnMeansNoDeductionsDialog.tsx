/**
 * MEANS-TEST EPIC 5 — explicit "nothing claimed" confirmation.
 *
 * A household that claims nothing is recorded explicitly, with a reason and
 * provenance. A missing claim is never treated as a confirmed none.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { MeansGovernedSelect } from '@/components/bn/meansTests/controls/MeansControls';
import type { BnMeansLoadState, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  deductionReasonLabel,
  type BnMeansDeductionMemberRef,
  type BnMeansDeductionReference,
  type BnMeansDeductionRules,
} from '@/types/bn/meansTests/meansDeductions';

export interface BnMeansNoDeductionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: readonly BnMeansDeductionMemberRef[];
  rules: BnMeansDeductionRules;
  reference: BnMeansDeductionReference | null;
  referenceState: Exclude<BnMeansLoadState, 'EMPTY'>;
  referenceReason?: string | null;
  busy: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

function set(
  options: readonly { value: string; label: string; description?: string }[] | undefined,
  state: BnMeansLoadState,
  reason?: string | null,
): BnMeansOptionSet {
  return {
    state: state === 'SUCCESS' && (options ?? []).length === 0 ? 'EMPTY' : state,
    options: options ?? [],
    reason: reason ?? undefined,
  };
}

export const BnMeansNoDeductionsDialog: React.FC<BnMeansNoDeductionsDialogProps> = ({
  open, onOpenChange, members, rules, reference, referenceState, referenceReason,
  busy, commandError, onSubmit,
}) => {
  const scope = rules.none_declaration_scope ?? 'ASSESSMENT';
  const [memberId, setMemberId] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [source, setSource] = React.useState('APPLICANT_DECLARATION');
  const [note, setNote] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMemberId('');
      setReasonCode('');
      setSource('APPLICANT_DECLARATION');
      setNote('');
      setSubmitted(false);
    }
  }, [open]);

  const errors: Record<string, string> = {};
  if (scope === 'MEMBER' && !memberId) {
    errors.memberId = deductionReasonLabel('MEMBER_DECLARATION_MISSING');
  }
  if (!reasonCode) errors.reasonCode = deductionReasonLabel('INVALID_NO_DEDUCTION_REASON');
  const showError = (key: string) => (submitted ? errors[key] ?? null : null);

  const memberOptions = members.map((m) => ({
    value: m.member_id,
    label: m.display_name,
    description: `${m.relationship_label} · ${m.is_current ? 'Current member' : 'Membership ended'}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="means-no-deductions-dialog">
        <DialogHeader>
          <DialogTitle>Confirm nothing is claimed</DialogTitle>
          <DialogDescription>
            Record an explicit confirmation that no deduction or disregard is claimed
            {scope === 'MEMBER' ? ' for this member.' : ' on this assessment.'} A missing claim is
            never treated as a confirmed none.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-no-deductions-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This confirmation was not saved</AlertTitle>
            <AlertDescription>{deductionReasonLabel(commandError.code)}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {scope === 'MEMBER' && (
            <MeansGovernedSelect
              id="means-no-deductions-member"
              label="Household member"
              required
              optionSet={set(memberOptions, members.length === 0 ? 'EMPTY' : 'SUCCESS')}
              value={memberId}
              placeholder="Select the member…"
              error={showError('memberId')}
              onChange={setMemberId}
            />
          )}
          <MeansGovernedSelect
            id="means-no-deductions-reason"
            label="Reason"
            required
            optionSet={set(reference?.NO_DEDUCTION_REASON, referenceState, referenceReason)}
            value={reasonCode}
            placeholder="Why is nothing claimed?"
            error={showError('reasonCode')}
            onChange={setReasonCode}
          />
          <MeansGovernedSelect
            id="means-no-deductions-source"
            label="Confirmation source"
            required
            optionSet={set(reference?.DEDUCTION_FACT_SOURCE, referenceState, referenceReason)}
            value={source}
            onChange={setSource}
          />
          <div className="space-y-1.5">
            <Label htmlFor="means-no-deductions-note">Confirmation note</Label>
            <Textarea
              id="means-no-deductions-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            data-testid="means-no-deductions-save"
            onClick={() => {
              setSubmitted(true);
              if (Object.keys(errors).length > 0) return;
              onSubmit({
                declaration_scope: scope,
                member_id: scope === 'MEMBER' ? memberId : null,
                reason_code: reasonCode,
                declaration_source: source,
                confirmation_note: note.trim() || null,
              });
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record confirmation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansNoDeductionsDialog;
