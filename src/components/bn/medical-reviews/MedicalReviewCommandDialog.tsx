/**
 * BN Medical Reviews — generic operational command dialog.
 *
 * One shell for every Medical Review command so that idempotency, double-submit
 * prevention, version-conflict handling and replay/no-op reporting behave
 * identically on the Benefits, Provider and Board surfaces.
 *
 * The dialog owns nothing about the domain: callers supply the field
 * descriptors, the availability decision and the command invocation.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertTriangle, CheckCircle2, Info, RefreshCw } from 'lucide-react';
import type { CommandResult } from '@/services/bn/medicalReviewCommandService';
import { useMedicalReviewSubmission } from '@/hooks/bn/useMedicalReviewSubmission';
import type { ActionAvailability } from '@/features/bn/medical-reviews/model/actionAvailability';
import type { Option } from '@/features/bn/medical-reviews/model/controlledValues';
import ProviderPicker from './ProviderPicker';

export type CommandFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'datetime'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'provider';

export interface CommandField {
  name: string;
  label: string;
  type: CommandFieldType;
  required?: boolean;
  options?: Option[];
  help?: string;
  placeholder?: string;
  /** Provider picker scoping. */
  reviewType?: string | null;
}

export type CommandValues = Record<string, unknown>;

export interface MedicalReviewCommandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Mandatory statement shown above the submit control (e.g. proposal boundary). */
  boundaryNotice?: string;
  fields: CommandField[];
  submitLabel: string;
  availability: ActionAvailability;
  /** Current optimistic-concurrency token, refreshed after a conflict. */
  rowVersion: number | null;
  execute: (
    values: CommandValues,
    ctx: { idempotencyKey: string; expectedRowVersion: number | null },
  ) => Promise<CommandResult>;
  reloadRecord?: () => Promise<number | null>;
  onCompleted?: (result: CommandResult) => void | Promise<void>;
  testId: string;
}

export const MedicalReviewCommandDialog: React.FC<MedicalReviewCommandDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  boundaryNotice,
  fields,
  submitLabel,
  availability,
  rowVersion,
  execute,
  reloadRecord,
  onCompleted,
  testId,
}) => {
  const [values, setValues] = useState<CommandValues>({});
  const [effectiveRowVersion, setEffectiveRowVersion] = useState<number | null>(rowVersion);

  const controller = useMedicalReviewSubmission({
    reloadRecord: reloadRecord
      ? async () => {
          const refreshed = await reloadRecord();
          setEffectiveRowVersion(refreshed);
          return refreshed;
        }
      : undefined,
    onSettled: onCompleted,
  });

  const { reset } = controller;

  useEffect(() => {
    if (open) {
      setValues({});
      setEffectiveRowVersion(rowVersion);
      reset();
    }
    // Only re-run when the dialog is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const missing = useMemo(
    () =>
      fields
        .filter((f) => f.required)
        .filter((f) => {
          const v = values[f.name];
          if (Array.isArray(v)) return v.length === 0;
          return v === undefined || v === null || v === '';
        })
        .map((f) => f.label),
    [fields, values],
  );

  const reasonMissing =
    availability.reasonRequired &&
    !fields.some((f) => f.name === 'reason') &&
    !values.reason;

  const conflictBlocking =
    controller.phase === 'conflict' && controller.conflict?.acknowledged !== true;

  const canSubmit =
    availability.enabled &&
    missing.length === 0 &&
    !reasonMissing &&
    !controller.isPending &&
    !conflictBlocking &&
    controller.phase !== 'success';

  const handleSubmit = async () => {
    await controller.submit(
      { ...values, expectedRowVersion: effectiveRowVersion },
      async (payload, idempotencyKey) => {
        const { expectedRowVersion, ...rest } = payload as CommandValues & {
          expectedRowVersion: number | null;
        };
        return execute(rest, { idempotencyKey, expectedRowVersion });
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {!availability.enabled && (
          <Alert data-testid={`${testId}-blocked`}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Action unavailable</AlertTitle>
            <AlertDescription>{availability.blockedReason}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {fields.map((field) => {
            const value = values[field.name];
            const id = `${testId}-${field.name}`;
            return (
              <div key={field.name} className="space-y-1.5">
                <Label htmlFor={id}>
                  {field.label}
                  {field.required && <span className="ml-1 text-destructive">*</span>}
                </Label>

                {field.type === 'textarea' && (
                  <Textarea
                    id={id}
                    data-testid={id}
                    value={(value as string) ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) => setValue(field.name, e.target.value)}
                  />
                )}

                {(field.type === 'text' ||
                  field.type === 'date' ||
                  field.type === 'datetime' ||
                  field.type === 'number') && (
                  <Input
                    id={id}
                    data-testid={id}
                    type={
                      field.type === 'datetime'
                        ? 'datetime-local'
                        : field.type === 'date'
                          ? 'date'
                          : field.type === 'number'
                            ? 'number'
                            : 'text'
                    }
                    value={(value as string) ?? ''}
                    placeholder={field.placeholder}
                    onChange={(e) =>
                      setValue(
                        field.name,
                        field.type === 'number'
                          ? e.target.value === ''
                            ? null
                            : Number(e.target.value)
                          : e.target.value,
                      )
                    }
                  />
                )}

                {field.type === 'select' && (
                  <Select
                    value={(value as string) ?? ''}
                    onValueChange={(v) => setValue(field.name, v)}
                  >
                    <SelectTrigger id={id} data-testid={id}>
                      <SelectValue placeholder="Select…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options ?? []).map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {field.type === 'multiselect' && (
                  <div className="space-y-1.5" data-testid={id}>
                    {(field.options ?? []).map((o) => {
                      const list = Array.isArray(value) ? (value as string[]) : [];
                      return (
                        <label key={o.value} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            data-testid={`${id}-${o.value}`}
                            checked={list.includes(o.value)}
                            onCheckedChange={(checked) =>
                              setValue(
                                field.name,
                                checked ? [...list, o.value] : list.filter((v) => v !== o.value),
                              )
                            }
                          />
                          {o.label}
                        </label>
                      );
                    })}
                  </div>
                )}

                {field.type === 'checkbox' && (
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      data-testid={id}
                      checked={value === true}
                      onCheckedChange={(checked) => setValue(field.name, checked === true)}
                    />
                    {field.help ?? field.label}
                  </label>
                )}

                {field.type === 'provider' && (
                  <ProviderPicker
                    value={(value as string) ?? null}
                    reviewType={field.reviewType ?? null}
                    onChange={(providerId) => setValue(field.name, providerId)}
                  />
                )}

                {field.help && field.type !== 'checkbox' && (
                  <p className="text-xs text-muted-foreground">{field.help}</p>
                )}
              </div>
            );
          })}
        </div>

        {boundaryNotice && (
          <Alert data-testid={`${testId}-boundary`}>
            <Info className="h-4 w-4" />
            <AlertDescription>{boundaryNotice}</AlertDescription>
          </Alert>
        )}

        {controller.phase === 'conflict' && controller.conflict && (
          <Alert variant="destructive" data-testid={`${testId}-version-conflict`}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Another user updated this record</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                You submitted against version{' '}
                <strong>{controller.conflict.previousRowVersion ?? '—'}</strong>. The record is now
                at version <strong>{controller.conflict.currentRowVersion ?? 'unknown'}</strong>.
              </p>
              {controller.conflict.reloadFailed && (
                <p>The refreshed record could not be loaded. Reload the screen before retrying.</p>
              )}
              <p>
                Your entered details have been preserved. Review the refreshed state, then confirm
                to resubmit against the current version.
              </p>
              {!controller.conflict.acknowledged && (
                <Button
                  size="sm"
                  variant="outline"
                  data-testid={`${testId}-confirm-refreshed`}
                  onClick={controller.acknowledgeConflict}
                >
                  I have reviewed the refreshed record
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {controller.phase === 'error' && controller.error && (
          <Alert variant="destructive" data-testid={`${testId}-error`}>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>The command did not complete</AlertTitle>
            <AlertDescription>
              {controller.error.message} Retrying reuses the same submission key, so it cannot
              create a duplicate.
            </AlertDescription>
          </Alert>
        )}

        {controller.phase === 'success' && controller.result && (
          <Alert data-testid={`${testId}-outcome`}>
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>
              {controller.result.replayed
                ? 'Replayed'
                : controller.result.noOp
                  ? 'No change'
                  : 'Applied'}
            </AlertTitle>
            <AlertDescription>{controller.outcomeLabel}</AlertDescription>
          </Alert>
        )}

        {missing.length > 0 && (
          <p className="text-xs text-muted-foreground">Required: {missing.join(', ')}.</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {controller.phase === 'success' ? 'Close' : 'Cancel'}
          </Button>
          {controller.phase !== 'success' && (
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              data-testid={`${testId}-submit`}
            >
              {controller.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {controller.phase === 'error' ? 'Retry' : submitLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MedicalReviewCommandDialog;
