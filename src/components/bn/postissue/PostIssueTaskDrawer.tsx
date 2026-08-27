import React, { useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { BnStatusBadge } from '@/components/bn/shared/BnStatusBadge';
import {
  Loader2, Zap, RotateCcw, SkipForward, Pause, XCircle, CheckCircle2, Star,
} from 'lucide-react';
import { useBnPostIssueTaskDetail } from '@/hooks/bn/useBnPostIssue';
import {
  getAvailableTaskActions,
  type PostIssueAction,
  type ExecutePostIssueActionParams,
} from '@/services/bn/postIssueService';
import { formatDateForDisplay } from '@/lib/format-config';

import { formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const TYPE_LABELS: Record<string, string> = {
  CL_HEAD_UPDATE: 'Update Claim Header',
  CLAIM_CLOSURE: 'Claim Closure',
  CLAIM_CONTINUATION: 'Claim Continuation',
  WAGES_CREDITED: 'Wages Credited Update',
  POSTAL_REG_UPDATE: 'Postal Registration',
  PENSION_SUPPORT: 'Pension Support Update',
  SURVIVOR_FOLLOWUP: 'Survivor Follow-up',
  HOLDING_FOLLOWUP: 'Holding Follow-up',
  ENTITLEMENT_UPDATE: 'Entitlement Balance Update',
  INSTRUCTION_FINALIZE: 'Instruction Finalization',
  BATCH_COMPLETION_CHECK: 'Batch Completion Check',
  AUDIT_COMPLETION: 'Audit Completion',
};

const ACTION_CONFIG: Record<string, { label: string; icon: any; variant: any; requiresReason: boolean }> = {
  EXECUTE:         { label: 'Execute',          icon: Zap,          variant: 'default',     requiresReason: false },
  RETRY:           { label: 'Retry',            icon: RotateCcw,    variant: 'outline',     requiresReason: false },
  SKIP:            { label: 'Skip',             icon: SkipForward,  variant: 'outline',     requiresReason: true },
  DEFER:           { label: 'Defer',            icon: Pause,        variant: 'outline',     requiresReason: true },
  CANCEL:          { label: 'Cancel',           icon: XCircle,      variant: 'destructive', requiresReason: true },
  COMPLETE_MANUAL: { label: 'Complete Manual',  icon: CheckCircle2, variant: 'default',     requiresReason: true },
};

interface Props {
  taskId: string | null;
  open: boolean;
  onClose: () => void;
  onAction: (params: ExecutePostIssueActionParams) => Promise<void>;
  isActing: boolean;
}

export const PostIssueTaskDrawer: React.FC<Props> = ({ taskId, open, onClose, onAction, isActing }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const { data: task, isLoading } = useBnPostIssueTaskDetail(taskId || undefined);
  const [reason, setReason] = useState('');

  const availableActions = task ? getAvailableTaskActions(task.status) : [];

  const handleAction = async (action: PostIssueAction) => {
    const cfg = ACTION_CONFIG[action];
    if (cfg?.requiresReason && !reason.trim()) return;
    await onAction({
      taskId: taskId!,
      action,
      userCode: actor(),
      reason: reason.trim() || undefined,
    });
    setReason('');
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : task ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <span>{TYPE_LABELS[task.task_type] || task.task_type}</span>
                <BnStatusBadge status={task.status} dot />
                {task.is_required && (
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                )}
              </SheetTitle>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Context */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">SSN:</span> <span className="font-mono">{task.ssn}</span></div>
                <div><span className="text-muted-foreground">Claim:</span> {task.claim_number || '—'}</div>
                <div><span className="text-muted-foreground">Cheque/Ref:</span> <span className="font-mono">{task.cheque_number || '—'}</span></div>
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-mono font-semibold">{formatNumber(task.amount, 2)}</span></div>
                {task.target_table && (
                  <div><span className="text-muted-foreground">Target:</span> <span className="font-mono text-xs">{task.target_table}</span></div>
                )}
                <div><span className="text-muted-foreground">Order:</span> #{task.task_order}</div>
              </div>

              {/* Required Badge */}
              <div className="p-3 rounded-md bg-muted text-sm">
                <span className="text-muted-foreground font-medium">Required: </span>
                <span className={task.is_required ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}>
                  {task.is_required ? 'Yes — must complete before issue finalization' : 'No — optional task'}
                </span>
              </div>

              {/* Execution Info */}
              {task.executed_at && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><span className="text-muted-foreground">Executed:</span> {formatDateForDisplay(task.executed_at)}</div>
                  <div><span className="text-muted-foreground">By:</span> {task.executed_by}</div>
                </div>
              )}

              {/* Result Data */}
              {task.result_data && Object.keys(task.result_data).length > 0 && (
                <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-md">
                  <h4 className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 mb-2">Result</h4>
                  <pre className="text-xs font-mono whitespace-pre-wrap">
                    {JSON.stringify(task.result_data, null, 2)}
                  </pre>
                </div>
              )}

              {/* Error */}
              {task.error_message && (
                <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-sm">
                  <span className="text-destructive font-medium">Error: </span>{task.error_message}
                  <div className="text-xs text-muted-foreground mt-1">
                    Retry {task.retry_count} / {task.max_retries}
                  </div>
                </div>
              )}

              {/* Deferred / Skip Reason */}
              {task.deferred_reason && (
                <div className="p-3 bg-violet-500/5 border border-violet-500/20 rounded-md text-sm">
                  <span className="font-medium">Deferred: </span>{task.deferred_reason}
                </div>
              )}
              {task.skip_reason && (
                <div className="p-3 bg-muted rounded-md text-sm">
                  <span className="font-medium">Skip Reason: </span>{task.skip_reason}
                </div>
              )}
              {task.notes && (
                <div className="p-3 bg-muted rounded-md text-sm">
                  <span className="text-muted-foreground font-medium">Notes: </span>{task.notes}
                </div>
              )}

              <Separator />

              {/* Actions */}
              {availableActions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Actions</h3>

                  {availableActions.some(a => ACTION_CONFIG[a]?.requiresReason) && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reason / Narrative</Label>
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Enter reason for this action..."
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    {availableActions.map((action) => {
                      const cfg = ACTION_CONFIG[action];
                      if (!cfg) return null;
                      const Icon = cfg.icon;
                      const disabled = isActing || (cfg.requiresReason && !reason.trim());
                      return (
                        <Button
                          key={action}
                          variant={cfg.variant}
                          size="sm"
                          disabled={disabled}
                          onClick={() => handleAction(action)}
                          className="gap-1.5"
                        >
                          {isActing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
                          {cfg.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Task not found.</p>
        )}
      </SheetContent>
    </Sheet>
  );
};
