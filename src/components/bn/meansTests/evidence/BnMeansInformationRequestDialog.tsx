/**
 * MEANS-TEST EPIC 6 — raise an information or document request.
 *
 * The request records what is outstanding and from whom. Any actual message
 * to the person is issued by the Communication Hub through the backend
 * command boundary — never from this component.
 */
import React from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { MeansGovernedSelect } from '@/components/bn/meansTests/controls/MeansControls';
import {
  validateInformationRequestDraft,
  type BnMeansEvidenceReference,
  type BnMeansEvidenceRequirement,
  type BnMeansInformationRequestType,
} from '@/types/bn/meansTests/meansEvidence';

export interface BnMeansInformationRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requirement: BnMeansEvidenceRequirement | null;
  requirements: readonly BnMeansEvidenceRequirement[];
  reference: BnMeansEvidenceReference | null;
  submitting: boolean;
  commandError: { code: string; message: string } | null;
  onSubmit: (payload: Record<string, unknown>) => void;
}

const today = () => new Date().toISOString().slice(0, 10);

export const BnMeansInformationRequestDialog: React.FC<BnMeansInformationRequestDialogProps> = ({
  open, onOpenChange, requirement, requirements, reference, submitting, commandError, onSubmit,
}) => {
  const [requirementId, setRequirementId] = React.useState('');
  const [requestType, setRequestType] = React.useState('');
  const [recipientKind, setRecipientKind] = React.useState('');
  const [recipientLabel, setRecipientLabel] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [required, setRequired] = React.useState('');
  const [details, setDetails] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [blocking, setBlocking] = React.useState(true);
  const [touched, setTouched] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setRequirementId(requirement?.requirement_id ?? '');
    setRequestType('');
    setRecipientKind('');
    setRecipientLabel(requirement?.subject_label ?? '');
    setReasonCode('');
    setRequired(requirement ? `${requirement.requirement_label} for ${requirement.subject_label ?? 'this assessment'}` : '');
    setDetails('');
    setDueDate('');
    setBlocking(requirement ? requirement.obligation === 'MANDATORY' : true);
    setTouched(false);
  }, [open, requirement]);

  const active = requirements.find((r) => r.requirement_id === requirementId) ?? null;

  const validation = validateInformationRequestDraft({
    request_type: (requestType || null) as BnMeansInformationRequestType | null,
    recipient_kind: recipientKind || null,
    reason_code: reasonCode || null,
    information_required: required || null,
    due_date: dueDate || null,
    subject_kind: active?.subject_kind ?? null,
    subject_ref_id: active?.subject_ref_id ?? null,
  }, today());
  const errorFor = (field: string) =>
    touched ? validation.errors.find((e) => e.field === field)?.message : undefined;

  function handleSubmit() {
    setTouched(true);
    if (!validation.ok) return;
    onSubmit({
      request_type: requestType,
      requirement_code: active?.requirement_code ?? null,
      subject_kind: active?.subject_kind ?? 'ASSESSMENT',
      subject_ref_id: active?.subject_ref_id ?? null,
      recipient_kind: recipientKind,
      recipient_label: recipientLabel || null,
      reason_code: reasonCode,
      information_required: required,
      details: details || null,
      due_date: dueDate || null,
      is_blocking: blocking,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" data-testid="means-evidence-request-dialog">
        <DialogHeader>
          <DialogTitle>Request outstanding information</DialogTitle>
          <DialogDescription>
            Record exactly what is being asked for, from whom and by when. Responses are tracked
            against this request until it is closed.
          </DialogDescription>
        </DialogHeader>

        {commandError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{commandError.message}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          <MeansGovernedSelect
            id="means-evidence-request-requirement"
            label="Requirement this relates to"
            value={requirementId}
            onChange={setRequirementId}
            optionSet={{
              state: 'SUCCESS',
              options: requirements.map((r) => ({
                value: r.requirement_id,
                label: `${r.requirement_label} — ${r.subject_label ?? 'This assessment'}`,
              })),
            }}
            placeholder="This assessment as a whole"
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <MeansGovernedSelect
              id="means-evidence-request-type"
              label="Kind of request"
              value={requestType}
              onChange={setRequestType}
              optionSet={{
                state: 'SUCCESS',
                options: (reference?.REQUEST_TYPE ?? []).map((o) => ({ value: o.value, label: o.label })),
              }}
              required
              error={errorFor('request_type')}
            />
            <MeansGovernedSelect
              id="means-evidence-request-recipient"
              label="Who is being asked"
              value={recipientKind}
              onChange={setRecipientKind}
              optionSet={{
                state: 'SUCCESS',
                options: (reference?.REQUEST_RECIPIENT ?? []).map((o) => ({ value: o.value, label: o.label })),
              }}
              required
              error={errorFor('recipient_kind')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="means-evidence-request-recipient-label">Recipient name or reference</Label>
            <Input id="means-evidence-request-recipient-label" value={recipientLabel}
              onChange={(e) => setRecipientLabel(e.target.value)} />
          </div>

          <MeansGovernedSelect
            id="means-evidence-request-reason"
            label="Why it is needed"
            value={reasonCode}
            onChange={setReasonCode}
            optionSet={{
              state: 'SUCCESS',
              options: (reference?.REQUEST_REASON ?? []).map((o) => ({ value: o.value, label: o.label })),
            }}
            required
            error={errorFor('reason_code')}
          />

          <div className="space-y-2">
            <Label htmlFor="means-evidence-request-required">What is being asked for *</Label>
            <Textarea id="means-evidence-request-required" rows={2} value={required}
              onChange={(e) => setRequired(e.target.value)}
              placeholder="Describe the document or information required" />
            {errorFor('information_required') && (
              <p className="text-sm text-destructive">{errorFor('information_required')}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="means-evidence-request-details">Additional detail</Label>
            <Textarea id="means-evidence-request-details" rows={2} value={details}
              onChange={(e) => setDetails(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="means-evidence-request-due">Response due by</Label>
              <Input id="means-evidence-request-due" type="date" value={dueDate}
                onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox id="means-evidence-request-blocking" checked={blocking}
                onCheckedChange={(v) => setBlocking(v === true)} />
              <Label htmlFor="means-evidence-request-blocking" className="font-normal">
                Evidence cannot be completed until this is answered
              </Label>
            </div>
          </div>

          {validation.warnings.map((w) => (
            <Alert key={w.field}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{w.message}</AlertDescription>
            </Alert>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} data-testid="means-evidence-request-submit">
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Raise request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BnMeansInformationRequestDialog;
