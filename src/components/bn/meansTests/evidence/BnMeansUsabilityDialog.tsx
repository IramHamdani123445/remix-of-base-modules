/**
 * MEANS-TEST EPIC 6 — record an evidence usability check.
 *
 * A usability check answers "can this document be used later to verify a
 * fact?". It never decides whether the fact itself is true.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { MeansGovernedSelect } from '@/components/bn/meansTests/controls/MeansControls';
import {
  isUsabilityIssue,
  validateUsabilityDraft,
  type BnMeansEvidenceLink,
  type BnMeansEvidenceReference,
  type BnMeansEvidenceUsabilityStatus,
} from '@/types/bn/meansTests/meansEvidence';

export interface BnMeansUsabilityDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  link: BnMeansEvidenceLink | null;
  reference: BnMeansEvidenceReference | null;
  submitting: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

export const BnMeansUsabilityDialog: React.FC<BnMeansUsabilityDialogProps> = ({
  open, onOpenChange, link, reference, submitting, commandError, onSubmit,
}) => {
  const [status, setStatus] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [note, setNote] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStatus(link?.usability_status && link.usability_status !== 'RECEIVED' ? link.usability_status : '');
    setReasonCode(link?.usability_reason_code ?? '');
    setNote(link?.usability_note ?? '');
    setTouched(false);
  }, [open, link]);

  const validation = validateUsabilityDraft({
    usability_status: (status || null) as BnMeansEvidenceUsabilityStatus | null,
    usability_reason_code: reasonCode || null,
  });
  const errorFor = (field: string) =>
    touched ? validation.errors.find((e) => e.field === field)?.message : undefined;

  const issue = status ? isUsabilityIssue(status as BnMeansEvidenceUsabilityStatus) : false;

  function handleSubmit() {
    setTouched(true);
    if (!validation.ok || !link) return;
    onSubmit({
      link_id: link.link_id,
      usability_status: status,
      usability_reason_code: reasonCode || null,
      usability_note: note || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="means-evidence-usability-dialog">
        <DialogHeader>
          <DialogTitle>Record a usability check</DialogTitle>
          <DialogDescription>
            Confirm whether this document can be relied on during verification. This does not
            confirm that the underlying fact is correct.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{commandError.message}</AlertDescription>
          </Alert>
        )}

        {link && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p className="font-medium">{link.document_title ?? link.document_ref}</p>
            <p className="text-muted-foreground">{link.evidence_type}</p>
          </div>
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-evidence-usability-status"
            label="Outcome of the check"
            value={status}
            onChange={setStatus}
            optionSet={{
              state: 'SUCCESS',
              options: (reference?.USABILITY_STATUS ?? []).map((o) => ({
                value: o.value, label: o.label, description: o.description,
              })),
            }}
            required
            error={errorFor('usability_status')}
          />

          {issue && (
            <MeansGovernedSelect
              id="means-evidence-usability-reason"
              label="Why it cannot be used"
              value={reasonCode}
              onChange={setReasonCode}
              optionSet={{
                state: 'SUCCESS',
                options: (reference?.USABILITY_REASON ?? []).map((o) => ({
                  value: o.value, label: o.label,
                })),
              }}
              required
              error={errorFor('usability_reason_code')}
            />
          )}

          <div className="space-y-2">
            <Label htmlFor="means-evidence-usability-note">Note</Label>
            <Textarea id="means-evidence-usability-note" rows={3} value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What did the check show?" />
          </div>

          {issue && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This requirement will stay outstanding until a usable document is linked. Consider
                raising an information request.
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="means-evidence-usability-submit">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Record check
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansUsabilityDialog;
