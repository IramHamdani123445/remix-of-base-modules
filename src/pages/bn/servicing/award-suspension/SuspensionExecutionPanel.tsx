/**
 * BN-SUSP-EXEC — Execution panel.
 *
 * Shows the operational execution state of an APPROVED suspension case, the
 * server-computed payment impact preview, and (with permission) the controlled
 * execute action. All mutations go through `awardSuspensionCommandService`,
 * never through `awardServicingService.updateAwardStatus()`.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, ShieldAlert, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import {
  executeSuspension,
  previewSuspensionPaymentImpact,
  describeExecutionFailure,
  isExecutionFailure,
  SuspensionCommandError,
  type PaymentImpactPreview,
} from '@/services/bn/awardSuspensionCommandService';

import type { SuspensionExecutionState } from '@/services/bn/awardSuspensionViewService';
import { formatMoney } from './suspensionViewModels';

interface Props {
  suspensionId: string;
  /** RAW `bn_award_suspension_event.status` — never a display status. */
  caseStatus: string;
  execution: SuspensionExecutionState;
  currency: string | null;
  canExecute: boolean;
  canViewImpact: boolean;
  actionsEnabled: boolean;
  onExecuted: () => void;
}

const IMPACT_LABEL: Record<string, string> = {
  HELD: 'Will be held',
  EXCEPTION_RAISED: 'Manual exception',
  NO_ACTION: 'No action needed',
  RELEASED: 'Released',
  RETAINED: 'Retained (exception open)',
  ARREARS_CREATED: 'Arrears created',
};

export function SuspensionExecutionPanel({
  suspensionId,
  caseStatus,
  execution,
  currency,
  canExecute,
  canViewImpact,
  actionsEnabled,
  onExecuted,
}: Props) {
  const [impact, setImpact] = useState<PaymentImpactPreview | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const executable =
    caseStatus === 'APPROVED' || caseStatus === 'EXECUTION_FAILED';

  const loadImpact = useCallback(async () => {
    if (!canViewImpact) return;
    setLoading(true);
    setImpactError(null);
    try {
      setImpact(await previewSuspensionPaymentImpact(suspensionId));
    } catch (e) {
      setImpactError(
        e instanceof SuspensionCommandError ? e.message : 'Payment impact could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [suspensionId, canViewImpact]);

  useEffect(() => {
    if (executable) void loadImpact();
  }, [executable, loadImpact]);

  if (!executable && execution.executionStatus !== 'EXECUTED') return null;

  const onExecute = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const r = await executeSuspension({
        suspensionId,
        expectedRowVersion: execution.rowVersion,
        narrative: narrative.trim() || null,
      });
      // BN-SUSP-EXEC — a 200 response is NOT success. The command returns a
      // sanitized failure envelope that must be reported as a failure, and
      // "executed" is only claimed when the award really is suspended.
      if (isExecutionFailure(r)) {
        setActionError(
          `${describeExecutionFailure(
            (r as { error_code?: string | null }).error_code ?? null,
          )} The case remains retryable.`,
        );
      } else if (r.award_status === 'SUSPENDED') {
        setDone('Suspension executed. The award is now suspended.');
      } else {
        setActionError(
          `The command completed but the award status is ${r.award_status ?? 'unchanged'}. Refresh the case before retrying.`,
        );
      }
      onExecuted();
    } catch (e) {
      setActionError(
        e instanceof SuspensionCommandError ? e.message : 'Execution could not be completed.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-md border p-3 space-y-3" data-testid="suspension-execution-panel">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Execution
        </h3>
        <Badge variant={execution.executionStatus === 'FAILED' ? 'destructive' : 'secondary'}>
          {execution.executionStatus === 'EXECUTED'
            ? 'Executed'
            : execution.executionStatus === 'FAILED'
              ? 'Execution failed'
              : execution.due
                ? 'Approved — awaiting execution'
                : 'Scheduled'}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Effective from</dt>
        <dd>{execution.effectiveFrom ?? '—'}</dd>
        <dt className="text-muted-foreground">Due</dt>
        <dd>{execution.due ? 'Yes' : 'Not yet due — scheduler will execute'}</dd>
        <dt className="text-muted-foreground">Attempts</dt>
        <dd>{execution.executionAttempts}</dd>
        <dt className="text-muted-foreground">Executed at</dt>
        <dd>{execution.executedAt ? new Date(execution.executedAt).toLocaleString() : '—'}</dd>
      </dl>

      {execution.lastExecutionError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden />
          <span>
            Last execution failed: {describeExecutionFailure(execution.lastExecutionError)} The case
            remains retryable; technical detail is retained in the restricted operational log.
          </span>
        </p>
      )}


      {canViewImpact && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium">Payment impact</h4>
          {loading && (
            <p className="text-xs text-muted-foreground">
              <Loader2 className="inline h-3 w-3 animate-spin mr-1" aria-hidden />
              Calculating payment impact…
            </p>
          )}
          {impactError && <p className="text-xs text-destructive">{impactError}</p>}
          {impact && !loading && (
            <>
              <div className="flex gap-2 text-xs">
                <Badge variant="secondary">{impact.held_count} to hold</Badge>
                <Badge variant={impact.exception_count > 0 ? 'destructive' : 'outline'}>
                  {impact.exception_count} exception(s)
                </Badge>
                <Badge variant="outline">{impact.no_action_count} no action</Badge>
              </div>
              {impact.items.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No payment records fall on or after the effective date.
                </p>
              ) : (
                <ul className="divide-y rounded-md border text-xs" data-testid="impact-items">
                  {impact.items.slice(0, 25).map((it) => (
                    <li key={`${it.record_type}-${it.record_id}`} className="flex justify-between p-2">
                      <span className="font-mono">
                        {it.record_type.replace('PAYMENT_', '')} · {it.record_id.slice(0, 8)}
                      </span>
                      <span>{it.due_date ?? '—'}</span>
                      <span>{formatMoney(it.amount, currency)}</span>
                      <span
                        className={
                          it.action === 'EXCEPTION_RAISED'
                            ? 'text-destructive font-medium'
                            : 'text-muted-foreground'
                        }
                      >
                        {IMPACT_LABEL[it.action] ?? it.action}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {impact.exception_count > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Payments that are already batched, issued or paid cannot be stopped
                  automatically. Executing will raise a visible payment exception and an
                  operational task for each of them; nothing is deleted or reversed silently.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {execution.executionStatus !== 'EXECUTED' && (
        <div className="space-y-2">
          {!actionsEnabled && (
            <p className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" aria-hidden />
              Execution is disabled while the feature is dark-launched.
            </p>
          )}
          {!canExecute && (
            <p className="text-xs text-muted-foreground">
              You do not have the <code>bn_award_suspension.execute</code> permission.
            </p>
          )}
          {!execution.due && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" aria-hidden />
              Future-dated: the approved scheduler will execute this case on the effective date.
            </p>
          )}
          <Textarea
            aria-label="Execution narrative"
            placeholder="Optional execution narrative"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            rows={2}
          />
          {actionError && <p className="text-xs text-destructive">{actionError}</p>}
          {done && (
            <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" aria-hidden />
              {done}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={onExecute}
              disabled={!actionsEnabled || !canExecute || !execution.due || busy}
              aria-disabled={!actionsEnabled || !canExecute || !execution.due || busy}
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin mr-1" aria-hidden />}
              {execution.executionStatus === 'FAILED' ? 'Retry execution' : 'Execute suspension'}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
