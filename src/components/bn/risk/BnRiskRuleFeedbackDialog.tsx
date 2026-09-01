/**
 * BN Risk — structured rule feedback dialogue (EPIC 6).
 *
 * The reviewer selects a governed feedback type from the published catalogue
 * and, where the catalogue requires it, a governed reason and structured
 * notes. The dialogue never invents feedback wording, never edits recorded
 * feedback and never offers a "change the rule" action: correcting feedback
 * records a superseding entry, and changing a rule is a separate, versioned
 * and authorised act on the scoring-configuration surface.
 */
import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { riskFeedbackService } from '@/services/bn/risk/riskFeedbackService';
import { BnBusyButton } from '@/components/bn/shared';
import {
  feedbackTargetLabel,
  type BnRiskFeedbackReadinessV1,
  type BnRiskFeedbackRecord,
  type BnRiskFeedbackTypeOption,
} from '@/types/bn/risk/riskFeedback';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assessmentId: string;
  mode: 'RECORD' | 'CORRECT';
  readiness: BnRiskFeedbackReadinessV1;
  /** Required in `CORRECT` mode — the record being superseded. */
  target?: BnRiskFeedbackRecord | null;
  onCompleted: (message: string | null) => void;
}

export const BnRiskRuleFeedbackDialog: React.FC<Props> = ({
  open, onOpenChange, assessmentId, mode, readiness, target = null, onCompleted,
}) => {
  const [feedbackCode, setFeedbackCode] = React.useState('');
  const [ruleKey, setRuleKey] = React.useState('');
  const [signalId, setSignalId] = React.useState('');
  const [factorId, setFactorId] = React.useState('');
  const [reasonCode, setReasonCode] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [correctionReason, setCorrectionReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFeedbackCode(mode === 'CORRECT' ? (target?.feedback_code ?? '') : '');
    setRuleKey('');
    setSignalId(mode === 'CORRECT' ? (target?.signal_id ?? '') : '');
    setFactorId(mode === 'CORRECT' ? (target?.factor_id ?? '') : '');
    setReasonCode('');
    setNotes('');
    setCorrectionReason('');
    setError(null);
  }, [open, mode, target]);

  const selected: BnRiskFeedbackTypeOption | undefined = readiness.feedback_catalogue
    .find((t) => t.feedback_code === feedbackCode);

  const targetKind = selected?.target_kind ?? null;
  const selectedRule = readiness.eligible_rules
    .find((r) => (r.contribution_id ?? r.rule_id ?? '') === ruleKey);

  const missing: string[] = [];
  if (!feedbackCode) missing.push('Select the feedback.');
  if (targetKind === 'RULE' && !ruleKey) missing.push('Select the scoring rule.');
  if (targetKind === 'SIGNAL' && !signalId) missing.push('Select the signal.');
  if (targetKind === 'FACTOR' && !factorId) missing.push('Select the factor.');
  if (selected?.requires_reason && !reasonCode) missing.push('Select the reason.');
  if (selected?.requires_notes && notes.trim().length < 10) {
    missing.push('Provide structured notes of at least 10 characters.');
  }
  if (mode === 'CORRECT' && !correctionReason) missing.push('Select the correction reason.');

  const mutation = useMutation({
    mutationFn: async () => {
      const base = {
        assessmentId,
        feedbackCode,
        ruleId: targetKind === 'RULE' ? (selectedRule?.rule_id ?? null) : null,
        contributionId: targetKind === 'RULE' ? (selectedRule?.contribution_id ?? null) : null,
        signalId: targetKind === 'SIGNAL' ? (signalId || null) : null,
        factorId: targetKind === 'FACTOR' ? (factorId || null) : null,
        reasonCode: reasonCode || null,
        notes: notes.trim() || null,
      };
      const result = mode === 'CORRECT' && target
        ? await riskFeedbackService.correctFeedback({
          ...base,
          feedbackId: target.feedback_id,
          correctionReasonCode: correctionReason,
          correctionJustification: notes.trim() || null,
        })
        : await riskFeedbackService.recordFeedback(base);
      if (result.status === 'FAILED') {
        throw new Error(result.errorMessage ?? 'The feedback was not recorded.');
      }
      return result;
    },
    onSuccess: (result) => {
      onOpenChange(false);
      onCompleted(result.businessMessage ?? null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl" data-testid="bn-risk-feedback-dialog">
        <DialogHeader>
          <DialogTitle>
            {mode === 'CORRECT' ? 'Correct rule feedback' : 'Record rule feedback'}
          </DialogTitle>
          <DialogDescription>
            Feedback is recorded against the rule version, signal or factor that informed this
            review. It is evidence for a later policy review and changes no scoring rule,
            weight, threshold, band or configuration, and rescores nothing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {readiness.scoring_provenance && (
            <div
              className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground"
              data-testid="bn-risk-feedback-provenance"
            >
              Scored with rule set {readiness.scoring_provenance.rule_set_code ?? 'unknown'}
              {' '}version {readiness.scoring_provenance.rule_set_version_no ?? '—'}
              {' '}(score version {readiness.scoring_provenance.score_version_no ?? '—'}).
              Feedback is attached to this version, never to a later one.
            </div>
          )}

          <div className="space-y-2">
            <Label>Feedback</Label>
            <Select value={feedbackCode} onValueChange={setFeedbackCode}>
              <SelectTrigger data-testid="bn-risk-feedback-type">
                <SelectValue placeholder="Select the feedback" />
              </SelectTrigger>
              <SelectContent>
                {readiness.feedback_catalogue.map((t) => (
                  <SelectItem key={t.feedback_code} value={t.feedback_code}>
                    {feedbackTargetLabel(t.target_kind)} — {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected?.description && (
              <p className="text-xs text-muted-foreground">{selected.description}</p>
            )}
          </div>

          {targetKind === 'RULE' && (
            <div className="space-y-2">
              <Label>Scoring rule</Label>
              <Select value={ruleKey} onValueChange={setRuleKey}>
                <SelectTrigger data-testid="bn-risk-feedback-rule">
                  <SelectValue placeholder="Select the rule that contributed" />
                </SelectTrigger>
                <SelectContent>
                  {readiness.eligible_rules.map((r) => (
                    <SelectItem
                      key={r.contribution_id ?? r.rule_id ?? r.rule_code ?? 'rule'}
                      value={r.contribution_id ?? r.rule_id ?? ''}
                    >
                      {r.rule_name ?? r.rule_code} — {r.outcome === 'MATCHED' ? 'matched' : 'not matched'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {readiness.eligible_rules.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No rule contributed to a score for this assessment, so rule feedback cannot
                  be recorded.
                </p>
              )}
            </div>
          )}

          {targetKind === 'SIGNAL' && (
            <div className="space-y-2">
              <Label>Signal</Label>
              <Select value={signalId} onValueChange={setSignalId}>
                <SelectTrigger data-testid="bn-risk-feedback-signal">
                  <SelectValue placeholder="Select the signal" />
                </SelectTrigger>
                <SelectContent>
                  {readiness.eligible_signals.map((s) => (
                    <SelectItem key={s.signal_id} value={s.signal_id}>
                      {s.signal_reference ?? s.signal_id} — {s.source_module ?? 'Unknown source'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {targetKind === 'FACTOR' && (
            <div className="space-y-2">
              <Label>Factor</Label>
              <Select value={factorId} onValueChange={setFactorId}>
                <SelectTrigger data-testid="bn-risk-feedback-factor">
                  <SelectValue placeholder="Select the factor" />
                </SelectTrigger>
                <SelectContent>
                  {readiness.eligible_factors.map((f) => (
                    <SelectItem key={f.factor_id} value={f.factor_id}>
                      {f.factor_type_label ?? f.factor_type_code ?? f.factor_id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selected?.requires_reason && (
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={reasonCode} onValueChange={setReasonCode}>
                <SelectTrigger data-testid="bn-risk-feedback-reason">
                  <SelectValue placeholder="Select the reason" />
                </SelectTrigger>
                <SelectContent>
                  {readiness.reason_catalogue.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode === 'CORRECT' && (
            <div className="space-y-2">
              <Label>Correction reason</Label>
              <Select value={correctionReason} onValueChange={setCorrectionReason}>
                <SelectTrigger data-testid="bn-risk-feedback-correction-reason">
                  <SelectValue placeholder="Select why the feedback is being corrected" />
                </SelectTrigger>
                <SelectContent>
                  {readiness.correction_reason_catalogue.map((r) => (
                    <SelectItem key={r.code} value={r.code}>{r.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Notes for policy review</Label>
            <Textarea
              data-testid="bn-risk-feedback-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Describe what the reviewer observed, in operational terms."
            />
            <p className="text-xs text-muted-foreground">
              Do not restate claimant personal detail here. Notes are read as aggregate policy
              evidence.
            </p>
          </div>

          {mode === 'CORRECT' && target && (
            <Alert data-testid="bn-risk-feedback-supersede-note">
              <AlertTitle>The previous feedback is retained</AlertTitle>
              <AlertDescription>
                {target.feedback_reference} stays on the record with its author and timestamp.
                A superseding entry is added; nothing is edited or deleted.
              </AlertDescription>
            </Alert>
          )}

          {missing.length > 0 && (
            <Alert data-testid="bn-risk-feedback-missing">
              <AlertTitle>Before this can be recorded</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive" data-testid="bn-risk-feedback-error">
              <AlertTitle>The feedback was not recorded</AlertTitle>
              <AlertDescription>{error} Nothing has been changed.</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <BnBusyButton loading={mutation.isPending}
            data-testid="bn-risk-feedback-submit"
            disabled={missing.length > 0 || mutation.isPending}
            onClick={() => { setError(null); mutation.mutate(); }}
          >>
            {mode === 'CORRECT' ? 'Record superseding feedback' : 'Record feedback'}
          </BnBusyButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
