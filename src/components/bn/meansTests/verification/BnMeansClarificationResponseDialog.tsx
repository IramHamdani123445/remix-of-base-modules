/**
 * MEANS-TEST EPIC 8 — clarification response dialog.
 *
 * Records what came back against an open clarification request. A response
 * never rewrites the frozen declaration: it adds information and returns the
 * fact for re-review.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import type {
  BnMeansVerificationFactCard,
  BnMeansVerificationReference,
} from '@/types/bn/meansTests/meansVerification';

export interface BnMeansClarificationResponseDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly fact: BnMeansVerificationFactCard | null;
  readonly reference: BnMeansVerificationReference | null;
  readonly busy: boolean;
  readonly onSubmit: (payload: Record<string, unknown>) => void;
}

export const BnMeansClarificationResponseDialog: React.FC<BnMeansClarificationResponseDialogProps> = ({
  open, onOpenChange, fact, reference, busy, onSubmit,
}) => {
  const [responseKind, setResponseKind] = React.useState('');
  const [note, setNote] = React.useState('');
  const [evidenceLinkId, setEvidenceLinkId] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setResponseKind(reference?.response_kinds?.[0]?.code ?? '');
      setNote('');
      setEvidenceLinkId('');
    }
  }, [open, fact?.work_id, reference]);

  const clarification = fact?.clarification ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg" data-testid="means-clarification-response-dialog">
        <DialogHeader>
          <DialogTitle>Record a clarification response</DialogTitle>
          <DialogDescription>
            {clarification?.information_required ?? 'Record what was received against this request.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="means-response-kind">Response type</Label>
            <select
              id="means-response-kind"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={responseKind}
              onChange={(e) => setResponseKind(e.target.value)}
            >
              {(reference?.response_kinds ?? []).map((r) => (
                <option key={r.code} value={r.code}>{r.label}</option>
              ))}
            </select>
          </div>

          {(fact?.evidence.length ?? 0) > 0 && (
            <div className="space-y-1">
              <Label htmlFor="means-response-evidence">Supporting document received</Label>
              <select
                id="means-response-evidence"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={evidenceLinkId}
                onChange={(e) => setEvidenceLinkId(e.target.value)}
              >
                <option value="">None</option>
                {(fact?.evidence ?? []).map((e) => (
                  <option key={e.link_id} value={e.link_id}>{e.document_title}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="means-response-note">What was received</Label>
            <Textarea
              id="means-response-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Summarise the response for the audit trail."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || !responseKind || !fact}
            data-testid="means-clarification-response-submit"
            onClick={() =>
              onSubmit({
                work_id: fact?.work_id,
                request_id: clarification?.request_id ?? null,
                response_kind: responseKind,
                note: note.trim() || null,
                evidence_link_id: evidenceLinkId || null,
              })
            }
          >
            Record response
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansClarificationResponseDialog;
