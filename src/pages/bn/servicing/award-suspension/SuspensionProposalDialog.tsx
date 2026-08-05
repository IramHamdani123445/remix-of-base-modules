import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertTriangle, Info, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  listSuspensionReasonCodes,
  type AwardSuspensionListItem,
  type SuspensionReasonOption,
} from '@/services/bn/awardSuspensionViewService';
import { formatDate, formatMoney } from './suspensionViewModels';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  award: AwardSuspensionListItem | null;
  narrativeMinLength?: number;
  actionsEnabled?: boolean;
}

type ReasonsState =
  | { status: 'loading' }
  | { status: 'loaded'; options: SuspensionReasonOption[] }
  | { status: 'error' };

/**
 * Operator-facing copy for a failed reason lookup. The thrown error is never
 * rendered: raw database text, stack traces, hostnames, request identifiers
 * and internal function names must not reach the operator surface.
 */
const REASONS_ERROR_MESSAGE = 'Suspension reasons could not be loaded.';

type FieldKey = 'award' | 'reason' | 'effectiveDate' | 'narrative' | 'ack';

export function SuspensionProposalDialog({
  open,
  onOpenChange,
  award,
  narrativeMinLength = 20,
  actionsEnabled = false,
}: Props) {
  const [reasonCode, setReasonCode] = useState<string>('');
  const [reasonsState, setReasonsState] = useState<ReasonsState>({ status: 'loading' });
  const [effectiveDate, setEffectiveDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [narrative, setNarrative] = useState('');
  const [ack, setAck] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const reasonTriggerRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const narrativeRef = useRef<HTMLTextAreaElement>(null);
  const ackRef = useRef<HTMLButtonElement>(null);

  const loadReasons = useCallback(() => {
    setReasonsState({ status: 'loading' });
    listSuspensionReasonCodes()
      .then((options) => setReasonsState({ status: 'loaded', options }))
      .catch((e: unknown) => {
        setReasonsState({ status: 'error' });
        // Approved telemetry boundary only — never the operator surface.
        void import('@/lib/globalErrorHandler')
          .then(({ logApplicationError }) =>
            logApplicationError(e, {
              module: 'bn_award_suspension',
              action: 'list_suspension_reason_codes',
            })
          )
          .catch(() => undefined);
      });
  }, []);


  useEffect(() => {
    if (!open) return;
    setReasonCode('');
    setNarrative('');
    setAck(false);
    setSubmitAttempted(false);
    setEffectiveDate(new Date().toISOString().slice(0, 10));
    loadReasons();
  }, [open, loadReasons]);

  const reasons = reasonsState.status === 'loaded' ? reasonsState.options : [];
  const reasonsUnavailable = reasonsState.status !== 'loaded' || reasons.length === 0;

  /**
   * Authoritative validation. Unchanged in substance from the previous
   * implementation — only its *presentation* is progressive.
   */
  const fieldErrors = useMemo(() => {
    const errors: Partial<Record<FieldKey, string>> = {};
    if (!award) errors.award = 'An eligible award must be selected.';
    else if (award.awardStatus !== 'ACTIVE')
      errors.award = 'The selected award is not currently ACTIVE.';
    else if (award.openRequestId)
      errors.award = 'An open suspension request already exists for this award.';

    if (reasonsState.status === 'error')
      errors.reason = 'Suspension reasons could not be loaded. Retry before continuing.';
    else if (reasonsState.status === 'loaded' && reasons.length === 0)
      errors.reason = 'No active Award Suspension reasons are configured.';
    else if (!reasonCode) errors.reason = 'A suspension reason is required.';

    if (!effectiveDate) errors.effectiveDate = 'An effective date is required.';
    if (narrative.trim().length < narrativeMinLength)
      errors.narrative = `Narrative must be at least ${narrativeMinLength} characters (currently ${narrative.trim().length}).`;
    if (!ack) errors.ack = 'Acknowledge maker-checker responsibilities to continue.';
    return errors;
  }, [award, reasonsState, reasons.length, reasonCode, effectiveDate, narrative, narrativeMinLength, ack]);

  const errorCount = Object.keys(fieldErrors).length;
  const canSubmit = actionsEnabled && errorCount === 0;
  const showErrors = submitAttempted;

  const err = (k: FieldKey) => (showErrors ? fieldErrors[k] : undefined);

  const focusFirstInvalid = () => {
    const order: Array<[FieldKey, HTMLElement | null]> = [
      ['reason', reasonTriggerRef.current],
      ['effectiveDate', dateRef.current],
      ['narrative', narrativeRef.current],
      ['ack', ackRef.current],
    ];
    for (const [key, el] of order) {
      if (fieldErrors[key] && el) {
        el.scrollIntoView({ block: 'center' });
        el.focus();
        return;
      }
    }
  };

  const handleSubmit = () => {
    setSubmitAttempted(true);
    if (!canSubmit) {
      // Never dispatch a business command while the gate is closed or the form invalid.
      window.setTimeout(focusFirstInvalid, 0);
      return;
    }
    // Submission remains governed by the authoritative rollout gate; no RPC is
    // wired in this read-only slice.
  };

  const narrativeLength = narrative.trim().length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-[calc(100vw-1rem)] max-w-2xl max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-2rem)] sm:max-h-[calc(100dvh-2rem)]"
      >
        {/* pr-12 is repeated at sm so responsive px-* can never remove the
            clearance reserved for the dialog close control. */}
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 pr-12 py-4 text-left sm:px-6 sm:pr-12">
          <div className="min-w-0">

          <DialogTitle className="text-base sm:text-lg">New Suspension Request</DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Propose a temporary suspension of an active award. The proposal will follow the
            configured maker-checker workflow.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="suspension-proposal-body"
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6"
        >
          {!actionsEnabled && (
            <div
              role="status"
              data-testid="suspension-dark-launch-banner"
              className="flex items-start gap-2 rounded-md border border-amber-400/60 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">
                Read-only: submission is unavailable while Award Suspension controls are under
                verification. The form remains inspectable for review.
              </span>
            </div>
          )}

          <section className="rounded-md border p-3">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Award summary
            </h4>
            {!award ? (
              <p className="text-sm italic text-muted-foreground">
                Choose an award from the Awards register to prefill this form.
              </p>
            ) : (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Award #</dt>
                  <dd className="min-w-0 break-words font-mono text-xs">
                    {award.awardNumber ?? award.awardId.slice(0, 8)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Claimant</dt>
                  <dd className="min-w-0 break-words">{award.claimantName}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Current status</dt>
                  <dd className="min-w-0 break-words">{award.awardStatus}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Benefit</dt>
                  <dd className="min-w-0 break-words">{award.benefitCode ?? '—'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Base amount</dt>
                  <dd className="min-w-0 break-words">
                    {formatMoney(award.baseAmount, award.currency)}
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-muted-foreground">Start</dt>
                  <dd className="min-w-0 break-words">{formatDate(award.startDate)}</dd>
                </div>
              </dl>
            )}
            {err('award') && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {fieldErrors.award}
              </p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="suspend-reason">Suspension reason *</Label>
              <Select
                value={reasonCode}
                onValueChange={setReasonCode}
                disabled={reasonsUnavailable}
              >
                <SelectTrigger
                  id="suspend-reason"
                  ref={reasonTriggerRef}
                  className="min-h-[44px]"
                  aria-invalid={Boolean(err('reason'))}
                  aria-describedby="suspend-reason-help"
                >
                  <SelectValue
                    placeholder={
                      reasonsState.status === 'loading' ? 'Loading reasons…' : 'Select a reason…'
                    }
                  />
                </SelectTrigger>
                <SelectContent className="max-h-[50dvh]">
                  {reasons.map((r) => (
                    <SelectItem key={r.code} value={r.code}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div id="suspend-reason-help" className="text-xs">
                {reasonsState.status === 'loading' && (
                  <p className="flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                    Loading suspension reasons…
                  </p>
                )}
                {reasonsState.status === 'error' && (
                  <p className="flex flex-wrap items-center gap-2 text-destructive" role="alert">
                    <span className="min-w-0 break-words">
                      Suspension reasons could not be loaded.
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2"
                      onClick={loadReasons}
                    >
                      <RefreshCw className="mr-1 h-3 w-3" aria-hidden />
                      Retry
                    </Button>
                  </p>
                )}
                {reasonsState.status === 'loaded' && reasons.length === 0 && (
                  <p className="text-amber-700 dark:text-amber-300">
                    No active Award Suspension reasons are configured.
                  </p>
                )}
                {err('reason') && reasonsState.status === 'loaded' && reasons.length > 0 && (
                  <p className="text-destructive" role="alert">
                    {fieldErrors.reason}
                  </p>
                )}
              </div>
            </div>

            <div className="min-w-0 space-y-1">
              <Label htmlFor="suspend-effective">Effective from *</Label>
              <Input
                id="suspend-effective"
                ref={dateRef}
                type="date"
                className="min-h-[44px]"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                aria-invalid={Boolean(err('effectiveDate'))}
                aria-describedby={err('effectiveDate') ? 'suspend-effective-error' : undefined}
              />
              {err('effectiveDate') && (
                <p id="suspend-effective-error" className="text-xs text-destructive" role="alert">
                  {fieldErrors.effectiveDate}
                </p>
              )}
            </div>
          </div>

          <div className="min-w-0 space-y-1">
            <Label htmlFor="suspend-narrative">Narrative *</Label>
            <Textarea
              id="suspend-narrative"
              ref={narrativeRef}
              rows={4}
              placeholder={`Describe the situation, evidence and any beneficiary contact (min ${narrativeMinLength} characters).`}
              value={narrative}
              onChange={(e) => setNarrative(e.target.value)}
              aria-invalid={Boolean(err('narrative'))}
              aria-describedby="suspend-narrative-count"
            />
            <p
              id="suspend-narrative-count"
              className={`text-xs ${err('narrative') ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {narrativeLength}/{narrativeMinLength} characters minimum
            </p>
            {err('narrative') && (
              <p className="text-xs text-destructive" role="alert">
                {fieldErrors.narrative}
              </p>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-md border p-3">
            <Checkbox
              id="suspend-ack"
              ref={ackRef}
              checked={ack}
              onCheckedChange={(v) => setAck(Boolean(v))}
              aria-invalid={Boolean(err('ack'))}
              aria-describedby={err('ack') ? 'suspend-ack-error' : undefined}
            />
            <div className="min-w-0">
              <Label htmlFor="suspend-ack" className="text-sm leading-snug">
                I understand that this proposal is subject to maker-checker approval and that no
                payment change will occur until the workflow is applied.
              </Label>
              {err('ack') && (
                <p id="suspend-ack-error" className="mt-1 text-xs text-destructive" role="alert">
                  {fieldErrors.ack}
                </p>
              )}
            </div>
          </div>

          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              Approval levels and workbaskets are resolved from the sanctioned workflow
              configuration at the point of submission.
            </span>
          </p>

          {showErrors && errorCount > 0 && (
            <p
              data-testid="suspension-validation-summary"
              role="alert"
              className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {errorCount} {errorCount === 1 ? 'field requires' : 'fields require'} attention
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 flex-col-reverse gap-2 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end sm:px-6">
          <Button
            variant="outline"
            className="min-h-[44px] w-full sm:w-auto"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="min-h-[44px] w-full sm:w-auto"
            onClick={handleSubmit}
            disabled={!actionsEnabled}
            aria-disabled={!canSubmit}
            data-invalid={!canSubmit ? 'true' : undefined}
            title={
              !actionsEnabled
                ? 'Submission unavailable while suspension controls are under verification.'
                : undefined
            }
          >
            Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
