/**
 * BN-SUSP-UI — Approve / Reject / Withdraw decision panel.
 *
 * Every mutation goes through `awardSuspensionCommandService`, which calls the
 * versioned SECURITY DEFINER commands. Nothing here writes to a table.
 *
 * UI safeguards (the server enforces the same rules authoritatively):
 *  • the proposer never sees approve/reject controls (maker-checker), and
 *    Admin is NOT exempt;
 *  • controls are disabled when the workflow task is no longer open;
 *  • the real task id and row version from the secured contract are sent —
 *    never a task inferred from a label or array position;
 *  • duplicate clicks are blocked by an in-flight ref;
 *  • the case is refreshed after every successful command.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react';
import {
  approveSuspension,
  rejectSuspension,
  withdrawSuspension,
  approveReinstatement,
  rejectReinstatement,
  withdrawReinstatement,
  SuspensionCommandError,
} from '@/services/bn/awardSuspensionCommandService';
import {
  listSuspensionRejectionReasonCodes,
  type SuspensionReasonOption,
  type SuspensionRequestDetails,
} from '@/services/bn/awardSuspensionViewService';

const OPEN_TASK_STATUSES = new Set(['OPEN', 'PENDING', 'IN_PROGRESS', 'ASSIGNED', 'CLAIMED']);

export const isTaskOpen = (taskStatus: string | null | undefined): boolean =>
  OPEN_TASK_STATUSES.has(String(taskStatus ?? '').toUpperCase());

/**
 * BN-SUSP-STATUS — Availability is decided from the RAW event status only.
 * Display statuses (PENDING_LEVEL_1 etc.) are presentation and must never
 * gate a command.
 */
const OPEN_EVENT_STATUSES: Record<'SUSPENSION' | 'REINSTATEMENT', string> = {
  SUSPENSION: 'PROPOSED',
  REINSTATEMENT: 'REINSTATEMENT_PROPOSED',
};

interface Props {
  details: SuspensionRequestDetails;
  currentUserId: string | null;
  canApprove: boolean;
  canPropose: boolean;
  actionsEnabled: boolean;
  onChanged: () => void;
}

export function SuspensionDecisionPanel({
  details,
  currentUserId,
  canApprove,
  canPropose,
  actionsEnabled,
  onChanged,
}: Props) {
  const req = details.request;
  const caseKind = req.caseKind === 'REINSTATEMENT' ? 'REINSTATEMENT' : 'SUSPENSION';
  const isReinstatement = caseKind === 'REINSTATEMENT';
  const isProposer = Boolean(currentUserId && req.proposedByUserId === currentUserId);
  const taskOpen = isTaskOpen(req.taskStatus) && Boolean(req.currentTaskId);
  const caseOpen = req.eventStatus === OPEN_EVENT_STATUSES[caseKind];

  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'withdraw'>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [narrative, setNarrative] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectNarrative, setRejectNarrative] = useState('');
  const [reasons, setReasons] = useState<SuspensionReasonOption[]>([]);
  const [reasonsFailed, setReasonsFailed] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!rejectOpen) return;
    setReasonsFailed(false);
    listSuspensionRejectionReasonCodes()
      .then(setReasons)
      .catch(() => setReasonsFailed(true));
  }, [rejectOpen]);

  const run = useCallback(
    async (kind: 'approve' | 'reject' | 'withdraw', fn: () => Promise<unknown>, ok: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(kind);
      setError(null);
      setSuccess(null);
      try {
        await fn();
        setSuccess(ok);
        setRejectOpen(false);
        onChanged();
      } catch (e) {
        setError(
          e instanceof SuspensionCommandError
            ? e.message
            : 'The action could not be completed.'
        );
      } finally {
        inFlight.current = false;
        setBusy(null);
      }
    },
    [onChanged]
  );

  const showApproval = canApprove && !isProposer && caseOpen;
  // Withdraw stays available for the whole open window (including while an
  // approval task is pending), not only before routing starts.
  const showWithdraw = canPropose && isProposer && caseOpen;
  const noun = isReinstatement ? 'reinstatement' : 'suspension';
  if (!showApproval && !showWithdraw) return null;

  const selectedReason = reasons.find((r) => r.code === rejectReason);
  const rejectNarrativeRequired = selectedReason?.requiresNarrative ?? false;
  const rejectValid =
    Boolean(rejectReason) &&
    (!rejectNarrativeRequired || rejectNarrative.trim().length >= 10);

  return (
    <section className="space-y-3 rounded-md border p-3" data-testid="suspension-decision-panel">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {showApproval ? 'Approval decision' : 'Proposer actions'}
      </h3>

      {!actionsEnabled && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          Actions are disabled while Award Suspension controls are under verification.
        </p>
      )}

      {actionsEnabled && showApproval && !taskOpen && (
        <p className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3 w-3" aria-hidden />
          No open approval task is assigned at this level. Refresh the request before deciding.
        </p>
      )}

      {canApprove && isProposer && (
        <p className="text-xs italic text-muted-foreground" data-testid="maker-checker-notice">
          Maker-checker: you proposed this case, so you cannot approve or reject it.
        </p>
      )}

      {showApproval && (
        <div className="space-y-1">
          <Label htmlFor="decision-narrative" className="text-xs">
            Decision narrative (optional)
          </Label>
          <Textarea
            id="decision-narrative"
            rows={2}
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
          />
        </div>
      )}

      {error && (
        <p role="alert" data-testid="decision-error" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {success && (
        <p role="status" data-testid="decision-success" className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" aria-hidden />
          {success}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {showWithdraw && (
          <Button
            variant="outline"
            size="sm"
            data-testid="withdraw-button"
            disabled={!actionsEnabled || busy !== null}
            onClick={() =>
              void run(
                'withdraw',
                () =>
                  isReinstatement
                    ? withdrawReinstatement({
                        reinstatementId: req.requestId,
                        narrative: narrative.trim() || undefined,
                        expectedRowVersion: req.rowVersion,
                      })
                    : withdrawSuspension({
                        suspensionId: req.requestId,
                        narrative: narrative.trim() || null,
                        expectedRowVersion: req.rowVersion,
                      }),
                `The ${noun} request was withdrawn.`
              )
            }
          >
            {busy === 'withdraw' && <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />}
            Withdraw
          </Button>
        )}

        {showApproval && (
          <>
            <Button
              variant="outline"
              size="sm"
              data-testid="reject-button"
              disabled={!actionsEnabled || !taskOpen || busy !== null}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </Button>
            <Button
              size="sm"
              data-testid="approve-button"
              disabled={!actionsEnabled || !taskOpen || busy !== null}
              onClick={() =>
                void run(
                  'approve',
                  () =>
                    isReinstatement
                      ? approveReinstatement({
                          reinstatementId: req.requestId,
                          taskId: req.currentTaskId as string,
                          narrative: narrative.trim() || undefined,
                          expectedRowVersion: req.rowVersion,
                        })
                      : approveSuspension({
                          suspensionId: req.requestId,
                          taskId: req.currentTaskId as string,
                          narrative: narrative.trim() || null,
                          expectedRowVersion: req.rowVersion,
                        }),
                  `The ${noun} request was approved.`
                )
              }
            >
              {busy === 'approve' && <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />}
              Approve
            </Button>
          </>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={(v) => !busy && setRejectOpen(v)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Reject {noun} request</DialogTitle>
            <DialogDescription>
              A rejection reason is required. The proposer will see this decision in the case
              history.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="reject-reason">Rejection reason *</Label>
              <Select value={rejectReason} onValueChange={setRejectReason}>
                <SelectTrigger id="reject-reason" className="min-h-[44px]">
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {reasonsFailed && (
                <p className="text-xs text-destructive" role="alert">
                  Rejection reasons could not be loaded.
                </p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="reject-narrative">
                Narrative {rejectNarrativeRequired ? '*' : '(optional)'}
              </Label>
              <Textarea
                id="reject-narrative"
                rows={3}
                value={rejectNarrative}
                onChange={(e) => setRejectNarrative(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              className="min-h-[44px] w-full sm:w-auto"
              disabled={busy !== null}
              onClick={() => setRejectOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="min-h-[44px] w-full sm:w-auto"
              data-testid="confirm-reject"
              disabled={!actionsEnabled || !taskOpen || !rejectValid || busy !== null}
              onClick={() =>
                void run(
                  'reject',
                  () =>
                    isReinstatement
                      ? rejectReinstatement({
                          reinstatementId: req.requestId,
                          reasonCode: rejectReason,
                          narrative: rejectNarrative.trim() || undefined,
                          expectedRowVersion: req.rowVersion,
                        })
                      : rejectSuspension({
                          suspensionId: req.requestId,
                          taskId: req.currentTaskId as string,
                          reasonCode: rejectReason,
                          narrative: rejectNarrative.trim() || null,
                          expectedRowVersion: req.rowVersion,
                        }),
                  `The ${noun} request was rejected.`
                )
              }
            >
              {busy === 'reject' && <Loader2 className="mr-2 h-3 w-3 animate-spin" aria-hidden />}
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
