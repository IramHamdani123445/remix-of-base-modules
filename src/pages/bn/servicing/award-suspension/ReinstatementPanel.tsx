/**
 * BN-SUSP-EXEC — Reinstatement panel.
 *
 * Reinstatement is a separate, approvable case linked to an executed
 * suspension. Arrears are always computed server-side; the browser only
 * renders the server-returned snapshot.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2, ShieldAlert, CheckCircle2 } from 'lucide-react';
import {
  proposeReinstatement,
  approveReinstatement,
  rejectReinstatement,
  withdrawReinstatement,
  previewReinstatementArrears,
  executeReinstatement,
  SuspensionCommandError,
  type ArrearsResult,
} from '@/services/bn/awardSuspensionCommandService';
import type {
  LinkedReinstatementCase,
  SuspensionExecutionState,
} from '@/services/bn/awardSuspensionViewService';
import { formatMoney, formatDateTime } from './suspensionViewModels';

interface Props {
  suspensionId: string;
  caseStatus: string;
  execution: SuspensionExecutionState;
  reinstatement: LinkedReinstatementCase | null;
  currency: string | null;
  currentUserId: string | null;
  canPropose: boolean;
  canApprove: boolean;
  canExecute: boolean;
  actionsEnabled: boolean;
  onChanged: () => void;
}

export function ReinstatementPanel({
  suspensionId,
  caseStatus,
  execution,
  reinstatement,
  currency,
  currentUserId,
  canPropose,
  canApprove,
  canExecute,
  actionsEnabled,
  onChanged,
}: Props) {
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [narrative, setNarrative] = useState('');
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [arrears, setArrears] = useState<ArrearsResult | null>(null);
  const [arrearsError, setArrearsError] = useState<string | null>(null);

  const suspensionExecuted =
    execution.executionStatus === 'EXECUTED' || caseStatus === 'EXECUTED';

  const loadArrears = useCallback(async () => {
    if (!reinstatement) return;
    setArrearsError(null);
    try {
      setArrears(await previewReinstatementArrears(reinstatement.reinstatementId));
    } catch (e) {
      setArrearsError(
        e instanceof SuspensionCommandError ? e.message : 'Arrears could not be calculated.'
      );
    }
  }, [reinstatement]);

  useEffect(() => {
    void loadArrears();
  }, [loadArrears]);

  if (execution.caseKind !== 'SUSPENSION' || !suspensionExecuted) return null;

  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      onChanged();
    } catch (e) {
      setError(e instanceof SuspensionCommandError ? e.message : 'The action could not be completed.');
    } finally {
      setBusy(null);
    }
  };

  const isProposer =
    !!reinstatement && !!currentUserId && reinstatement.proposedByUserId === currentUserId;
  const pending =
    !!reinstatement &&
    ['PROPOSED', 'PENDING_APPROVAL', 'PENDING_LEVEL_1', 'PENDING_LEVEL_2'].includes(
      reinstatement.status
    );
  const approvedNotExecuted =
    !!reinstatement &&
    reinstatement.status === 'APPROVED' &&
    reinstatement.executionStatus !== 'EXECUTED';

  return (
    <section className="rounded-md border p-3 space-y-3" data-testid="reinstatement-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Reinstatement
        </h3>
        {reinstatement && <Badge variant="secondary">{reinstatement.status}</Badge>}
      </div>

      {!actionsEnabled && (
        <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          Reinstatement actions are disabled while the feature is dark-launched.
        </p>
      )}

      {!reinstatement && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            This award is suspended. Reinstatement is a separate approvable case; arrears for
            the suspended period are calculated by the server at execution time.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="reinst-date" className="text-xs">
                Effective from
              </Label>
              <Input
                id="reinst-date"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="reinst-reason" className="text-xs">
                Reason code
              </Label>
              <Input
                id="reinst-reason"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value.toUpperCase())}
                placeholder="e.g. EVIDENCE_RECEIVED"
              />
            </div>
          </div>
          <Textarea
            aria-label="Reinstatement narrative"
            rows={2}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            placeholder="Narrative / justification"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={
                !actionsEnabled ||
                !canPropose ||
                !effectiveFrom ||
                !reasonCode ||
                busy === 'propose'
              }
              onClick={() =>
                run(
                  'propose',
                  () =>
                    proposeReinstatement({
                      suspensionId,
                      effectiveFrom,
                      reasonCode,
                      narrative: narrative.trim() || null,
                    }),
                  'Reinstatement proposed and routed for approval.'
                )
              }
            >
              {busy === 'propose' && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}
              Propose reinstatement
            </Button>
          </div>
        </div>
      )}

      {reinstatement && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Effective from</dt>
            <dd>{reinstatement.effectiveFrom ?? '—'}</dd>
            <dt className="text-muted-foreground">Proposed</dt>
            <dd>{formatDateTime(reinstatement.proposedAt)}</dd>
            <dt className="text-muted-foreground">Reason</dt>
            <dd>{reinstatement.reasonCode ?? '—'}</dd>
            <dt className="text-muted-foreground">Execution</dt>
            <dd>{reinstatement.executionStatus}</dd>
          </dl>

          <div className="space-y-1">
            <h4 className="text-xs font-medium">Arrears (server-calculated)</h4>
            {arrearsError && <p className="text-xs text-destructive">{arrearsError}</p>}
            {arrears && (
              <div className="rounded-md border p-2 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Suspended period</span>
                  <span>
                    {arrears.period_from ?? '—'} → {arrears.period_to ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Units × rate</span>
                  <span>
                    {arrears.units} × {formatMoney(arrears.rate, arrears.currency ?? currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross payable</span>
                  <span>{formatMoney(arrears.gross_payable, arrears.currency ?? currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already paid / deductions</span>
                  <span>
                    {formatMoney(arrears.already_paid, arrears.currency ?? currency)} /{' '}
                    {formatMoney(arrears.deductions, arrears.currency ?? currency)}
                  </span>
                </div>
                <div className="flex justify-between font-medium">
                  <span>Net arrears</span>
                  <span>{formatMoney(arrears.net_arrears, arrears.currency ?? currency)}</span>
                </div>
                {arrears.status === 'REVIEW_REQUIRED' && (
                  <p className="text-amber-700 dark:text-amber-300">
                    Manual review required before arrears are released.
                    {arrears.notes ? ` ${arrears.notes}` : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {(pending || approvedNotExecuted) && (
            <div className="space-y-2">
              <Textarea
                aria-label="Decision note"
                rows={2}
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="Decision / execution note"
              />
              <div className="flex flex-wrap justify-end gap-2">
                {pending && isProposer && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!actionsEnabled || busy === 'withdraw'}
                    onClick={() =>
                      run(
                        'withdraw',
                        () =>
                          withdrawReinstatement({
                            reinstatementId: reinstatement.reinstatementId,
                            expectedRowVersion: reinstatement.rowVersion,
                            narrative: decisionNote.trim() || undefined,
                          }),
                        'Reinstatement withdrawn.'
                      )
                    }
                  >
                    Withdraw
                  </Button>
                )}
                {pending && canApprove && !isProposer && (
                  <>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={!actionsEnabled || !decisionNote.trim() || busy === 'reject'}
                      onClick={() =>
                        run(
                          'reject',
                          () =>
                            rejectReinstatement({
                              reinstatementId: reinstatement.reinstatementId,
                              expectedRowVersion: reinstatement.rowVersion,
                              reasonCode: 'REINSTATEMENT_REJECTED',
                              narrative: decisionNote.trim(),
                            }),
                          'Reinstatement rejected.'
                        )
                      }
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      disabled={!actionsEnabled || busy === 'approve'}
                      onClick={() =>
                        run(
                          'approve',
                          () =>
                            approveReinstatement({
                              reinstatementId: reinstatement.reinstatementId,
                              expectedRowVersion: reinstatement.rowVersion,
                              narrative: decisionNote.trim() || undefined,
                            }),
                          'Reinstatement approved.'
                        )
                      }
                    >
                      {busy === 'approve' && (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />
                      )}
                      Approve
                    </Button>
                  </>
                )}
                {approvedNotExecuted && (
                  <Button
                    size="sm"
                    disabled={!actionsEnabled || !canExecute || busy === 'execute'}
                    onClick={() =>
                      run(
                        'execute',
                        () =>
                          executeReinstatement({
                            reinstatementId: reinstatement.reinstatementId,
                            expectedRowVersion: reinstatement.rowVersion,
                            narrative: decisionNote.trim() || undefined,
                          }),
                        'Reinstatement executed; award returned to active and arrears recorded.'
                      )
                    }
                  >
                    {busy === 'execute' && (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />
                    )}
                    Execute reinstatement
                  </Button>
                )}
              </div>
              {pending && isProposer && (
                <p className="text-xs text-muted-foreground">
                  Maker–checker: you proposed this reinstatement, so you cannot approve or
                  reject it.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          {notice && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
