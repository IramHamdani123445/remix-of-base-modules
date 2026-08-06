/**
 * MEANS-TEST EPIC 2 — assessment context confirmation.
 *
 * Shows the assessment in officer language (person, claim or award,
 * period, policy) instead of raw identifiers, and offers a controlled
 * correction path. Whether a correction is permitted is decided by
 * `bn_means_available_actions_v1`, never by the browser.
 */
import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useQuery } from '@tanstack/react-query';
import { Loader2, PencilLine } from 'lucide-react';
import {
  MeansDateField,
  MeansFieldShell,
  MeansGovernedSelect,
} from '@/components/bn/meansTests/controls/MeansControls';
import { meansReferenceDataService } from '@/services/bn/meansTests/meansReferenceDataService';
import { humaniseMeansCode, type BnMeansOptionSet } from '@/types/bn/meansTests/meansFieldContract';

const PENDING: BnMeansOptionSet = { state: 'LOADING', options: [] };

export interface BnMeansContextPanelProps {
  assessment: Record<string, unknown>;
  /** Officer-readable subject line resolved by the workspace. */
  personLabel: string;
  claimLabel: string | null;
  awardLabel: string | null;
  policyLabel: string;
  canCorrect: boolean;
  correctionReason?: string | null;
  busy: boolean;
  onCorrect: (payload: Record<string, unknown>) => void;
}

export const BnMeansContextPanel: React.FC<BnMeansContextPanelProps> = ({
  assessment, personLabel, claimLabel, awardLabel, policyLabel, canCorrect,
  correctionReason, busy, onCorrect,
}) => {
  const [open, setOpen] = React.useState(false);
  const [effectiveFrom, setEffectiveFrom] = React.useState(String(assessment.effective_from ?? ''));
  const [effectiveTo, setEffectiveTo] = React.useState(String(assessment.effective_to ?? ''));
  const [reasonCode, setReasonCode] = React.useState('');
  const [justification, setJustification] = React.useState('');

  const reasons = useQuery({
    queryKey: ['bn-means-context-correction-reasons'],
    queryFn: () => meansReferenceDataService.options('CONTEXT_CORRECTION_REASON'),
    enabled: open,
  });

  const rows: readonly [string, string][] = [
    ['Assessed person', personLabel],
    ['Claim', claimLabel ?? 'Not linked to a claim'],
    ['Award', awardLabel ?? 'Not linked to an award'],
    ['Assessment reason', humaniseMeansCode(String(assessment.assessment_reason ?? ''))],
    ['Benefit programme', humaniseMeansCode(String(assessment.benefit_programme ?? ''))],
    ['Assessment period', `${assessment.effective_from ?? '—'} → ${assessment.effective_to ?? 'open-ended'}`],
    ['Policy in force', policyLabel],
    ['Currency', String(assessment.currency_code ?? '—')],
    ['Reassessment due', String(assessment.reassessment_due ?? 'Not scheduled')],
  ];

  const valid = Boolean(reasonCode) && justification.trim().length >= 10 && Boolean(effectiveFrom);

  return (
    <Card data-testid="means-context-panel">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Confirm the assessment context</CardTitle>
          <CardDescription>
            Check that this assessment is attached to the right person, claim or award and
            period before household information is captured.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!canCorrect && correctionReason && (
            <Badge variant="outline" data-testid="means-context-correction-reason">
              {correctionReason}
            </Badge>
          )}
          {canCorrect && (
            <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="means-context-correct">
              <PencilLine className="mr-1 h-4 w-4" /> Correct context
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="text-sm">{value || '—'}</p>
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Correct the assessment context</DialogTitle>
            <DialogDescription>
              A correction is recorded against the assessment with the reason you give.
              The person, claim and award links cannot be changed here.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <MeansDateField
                id="means-context-from"
                label="Effective from"
                required
                value={effectiveFrom}
                onChange={setEffectiveFrom}
              />
              <MeansDateField
                id="means-context-to"
                label="Effective to"
                description="Leave blank for an open-ended assessment."
                value={effectiveTo}
                onChange={setEffectiveTo}
              />
            </div>
            <MeansGovernedSelect
              id="means-context-reason"
              label="Correction reason"
              required
              optionSet={reasons.data ?? PENDING}
              value={reasonCode}
              onChange={setReasonCode}
            />
            <MeansFieldShell
              id="means-context-justification"
              label="Justification"
              description="At least 10 characters. Retained in the assessment audit trail."
              required
            >
              <Textarea
                id="means-context-justification"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
              />
            </MeansFieldShell>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!valid || busy}
              data-testid="means-context-correct-submit"
              onClick={() => {
                onCorrect({
                  effective_from: effectiveFrom,
                  effective_to: effectiveTo || null,
                  correction_reason: reasonCode,
                  justification: justification.trim(),
                });
                setOpen(false);
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

export default BnMeansContextPanel;
