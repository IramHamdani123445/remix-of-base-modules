/**
 * MEANS-TEST EPIC 3 — explicit "no income" declaration.
 *
 * Missing information is never stored as a zero-value income fact. An
 * officer records an explicit declaration instead, with a reason, a period
 * and provenance.
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
import {
  MeansDateField,
  MeansGovernedSelect,
} from '@/components/bn/meansTests/controls/MeansControls';
import type { BnMeansLoadState, BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';
import {
  incomeReasonLabel,
  type BnMeansIncomeMemberRef,
  type BnMeansIncomeReference,
} from '@/types/bn/meansTests/meansIncome';

export interface BnMeansNoIncomeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  members: readonly BnMeansIncomeMemberRef[];
  reference: BnMeansIncomeReference | null;
  referenceState: Exclude<BnMeansLoadState, 'EMPTY'>;
  referenceReason?: string | null;
  assessmentFrom: string;
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

export const BnMeansNoIncomeDialog: React.FC<BnMeansNoIncomeDialogProps> = ({
  open, onOpenChange, members, reference, referenceState, referenceReason,
  assessmentFrom, busy, commandError, onSubmit,
}) => {
  const [memberId, setMemberId] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [source, setSource] = React.useState('APPLICANT_DECLARATION');
  const [from, setFrom] = React.useState(assessmentFrom);
  const [to, setTo] = React.useState('');
  const [note, setNote] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMemberId('');
      setReasonCode('');
      setSource('APPLICANT_DECLARATION');
      setFrom(assessmentFrom);
      setTo('');
      setNote('');
      setSubmitted(false);
    }
  }, [open, assessmentFrom]);

  const errors: Record<string, string> = {};
  if (!memberId) errors.memberId = incomeReasonLabel('INCOME_MEMBER_REQUIRED');
  if (!reasonCode) errors.reasonCode = incomeReasonLabel('INVALID_NO_INCOME_REASON');
  if (!from) errors.from = incomeReasonLabel('INCOME_START_REQUIRED');
  if (to && from && to < from) errors.to = incomeReasonLabel('INVALID_INCOME_PERIOD');
  const showError = (key: string) => (submitted ? errors[key] ?? null : null);

  const memberOptions = members.map((m) => ({
    value: m.member_id,
    label: m.display_name,
    description: `${m.relationship_label} · ${m.is_current ? 'Current member' : 'Membership ended'}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="means-no-income-dialog">
        <DialogHeader>
          <DialogTitle>Declare no income for a member</DialogTitle>
          <DialogDescription>
            Record an explicit confirmation that this member receives no income during the
            period. Missing information is never recorded as zero income.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive" data-testid="means-no-income-error">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>This declaration was not saved</AlertTitle>
            <AlertDescription>{incomeReasonLabel(commandError.code)}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-no-income-member"
            label="Household member"
            required
            optionSet={set(memberOptions, members.length === 0 ? 'EMPTY' : 'SUCCESS')}
            value={memberId}
            placeholder="Select the member…"
            error={showError('memberId')}
            onChange={setMemberId}
          />
          <MeansGovernedSelect
            id="means-no-income-reason"
            label="Reason"
            required
            optionSet={set(reference?.NO_INCOME_REASON, referenceState, referenceReason)}
            value={reasonCode}
            placeholder="Why does this member have no income?"
            error={showError('reasonCode')}
            onChange={setReasonCode}
          />
          <MeansGovernedSelect
            id="means-no-income-source"
            label="Declaration source"
            required
            optionSet={set(reference?.INCOME_FACT_SOURCE, referenceState, referenceReason)}
            value={source}
            onChange={setSource}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <MeansDateField
              id="means-no-income-from"
              label="Effective from"
              required
              value={from}
              onChange={setFrom}
              error={showError('from')}
            />
            <MeansDateField
              id="means-no-income-to"
              label="Effective to"
              value={to}
              onChange={setTo}
              error={showError('to')}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="means-no-income-note">Confirmation note</Label>
            <Textarea
              id="means-no-income-note"
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
            data-testid="means-no-income-save"
            onClick={() => {
              setSubmitted(true);
              if (Object.keys(errors).length > 0) return;
              onSubmit({
                member_id: memberId,
                reason_code: reasonCode,
                declaration_source: source,
                effective_from: from,
                effective_to: to || null,
                confirmation_note: note.trim() || null,
              });
            }}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record declaration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansNoIncomeDialog;
