/**
 * BN Uprating — Schedule execution dialog (Epic 2).
 *
 * Records the intent to execute an approved run later. Bounds, defaults and
 * the authoritative time zone all come from governed backend configuration.
 */
import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Loader2, ShieldAlert } from 'lucide-react';
import type { BnUpratingScheduleReadiness } from '@/types/bn/uprating/upratingRun';
import { BnBusyButton } from '@/components/bn/shared';

export interface ScheduleExecutionFormValues {
  readonly planned_execution_at: string;
  readonly time_zone: string;
  readonly window_start_at: string | null;
  readonly window_end_at: string | null;
  readonly batch_size: number;
  readonly max_concurrent_batches: number;
  readonly notes: string | null;
}

interface Props {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly readiness: BnUpratingScheduleReadiness | null;
  readonly mode: 'SCHEDULE' | 'RESCHEDULE';
  readonly isSaving: boolean;
  readonly onSubmit: (values: ScheduleExecutionFormValues) => void;
}

const toLocalInput = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toISOString().slice(0, 16) : '';

export const BnUpratingScheduleExecutionDialog: React.FC<Props> = ({
  open,
  onOpenChange,
  readiness,
  mode,
  isSaving,
  onSubmit,
}) => {
  const cfg = readiness?.configuration ?? {};
  const current = readiness?.current_schedule ?? null;

  const [plannedAt, setPlannedAt] = React.useState('');
  const [timeZone, setTimeZone] = React.useState('');
  const [windowStart, setWindowStart] = React.useState('');
  const [windowEnd, setWindowEnd] = React.useState('');
  const [batchSize, setBatchSize] = React.useState('');
  const [concurrency, setConcurrency] = React.useState('');
  const [notes, setNotes] = React.useState('');

  React.useEffect(() => {
    if (!open) return;
    setPlannedAt(mode === 'RESCHEDULE' ? toLocalInput(current?.planned_execution_at) : '');
    setTimeZone(current?.time_zone ?? cfg.DEFAULT_TIME_ZONE ?? 'UTC');
    setWindowStart(toLocalInput(current?.window_start_at));
    setWindowEnd(toLocalInput(current?.window_end_at));
    setBatchSize(String(current?.batch_size ?? cfg.DEFAULT_BATCH_SIZE ?? '200'));
    setConcurrency(String(current?.max_concurrent_batches ?? cfg.DEFAULT_MAX_CONCURRENT_BATCHES ?? '2'));
    setNotes(current?.notes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, readiness]);

  const blockers = mode === 'SCHEDULE' ? readiness?.blockers ?? [] : [];
  const valid = plannedAt.trim().length > 0 && timeZone.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'SCHEDULE' ? 'Schedule execution' : 'Reschedule execution'}</DialogTitle>
          <DialogDescription>
            This records when the approved run is intended to execute. Nothing is executed now and no
            award, entitlement or payment is changed.
          </DialogDescription>
        </DialogHeader>

        {blockers.length > 0 && (
          <Alert variant="destructive">
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>This run cannot be scheduled yet</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-5">
                {blockers.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="uprating-planned-at">Planned execution</Label>
            <Input
              id="uprating-planned-at"
              type="datetime-local"
              value={plannedAt}
              onChange={(e) => setPlannedAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uprating-time-zone">Time zone</Label>
            <Input
              id="uprating-time-zone"
              value={timeZone}
              onChange={(e) => setTimeZone(e.target.value)}
              placeholder={cfg.DEFAULT_TIME_ZONE ?? 'UTC'}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uprating-window-start">Execution window start (optional)</Label>
            <Input
              id="uprating-window-start"
              type="datetime-local"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uprating-window-end">Execution window end (optional)</Label>
            <Input
              id="uprating-window-end"
              type="datetime-local"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uprating-batch-size">
              Batch size ({cfg.MIN_BATCH_SIZE ?? '—'}–{cfg.MAX_BATCH_SIZE ?? '—'})
            </Label>
            <Input
              id="uprating-batch-size"
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="uprating-concurrency">
              Concurrent batches (1–{cfg.MAX_CONCURRENT_BATCHES ?? '—'})
            </Label>
            <Input
              id="uprating-concurrency"
              type="number"
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uprating-schedule-notes">Notes (optional)</Label>
          <Textarea
            id="uprating-schedule-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Operational notes for the execution team."
          />
        </div>

        <DialogFooter>
          <BnBusyButton loading={isSaving} variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </BnBusyButton>
          <Button
            onClick={() =>
              onSubmit({
                planned_execution_at: new Date(plannedAt).toISOString(),
                time_zone: timeZone.trim(),
                window_start_at: windowStart ? new Date(windowStart).toISOString() : null,
                window_end_at: windowEnd ? new Date(windowEnd).toISOString() : null,
                batch_size: Number(batchSize),
                max_concurrent_batches: Number(concurrency),
                notes: notes.trim() || null,
              })
            }
            disabled={isSaving || !valid}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === 'SCHEDULE' ? 'Schedule execution' : 'Reschedule execution'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
