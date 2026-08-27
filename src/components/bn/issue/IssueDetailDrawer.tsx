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
  Loader2, Zap, XCircle, RotateCcw, Ban, Clock, Unlock,
} from 'lucide-react';
import { useBnIssueRecordDetail, useReleaseHolding } from '@/hooks/bn/useBnPaymentIssue';
import {
  getAvailableIssueActions,
  type IssueAction,
  type ExecuteIssueActionParams,
} from '@/services/bn/paymentIssueService';
import { formatDateForDisplay } from '@/lib/format-config';
import { toast } from 'sonner';

import { formatNumber } from '@/lib/culture/culture';
import { useActorUserCode } from '@/hooks/bn/useActorUserCode';
const ACTION_CONFIG: Record<string, { label: string; icon: any; variant: any; requiresReason: boolean }> = {
  ISSUE:      { label: 'Issue Now',    icon: Zap,        variant: 'default',     requiresReason: false },
  VOID:       { label: 'Void',         icon: XCircle,    variant: 'destructive', requiresReason: true },
  REISSUE:    { label: 'Reissue',      icon: RotateCcw,  variant: 'outline',     requiresReason: true },
  STOP:       { label: 'Stop Payment', icon: Ban,         variant: 'destructive', requiresReason: true },
  STALE_DATE: { label: 'Stale Date',   icon: Clock,      variant: 'outline',     requiresReason: false },
  RETRY:      { label: 'Retry',        icon: RotateCcw,  variant: 'outline',     requiresReason: false },
};

const TARGET_LABELS: Record<string, string> = {
  cl_cheques: 'cl_cheques (Standard)',
  cl_cheques_holding: 'cl_cheques_holding (Held)',
  cl_cheques_survivor: 'cl_cheques_survivor (Survivor)',
};

interface Props {
  issueId: string | null;
  open: boolean;
  onClose: () => void;
  onAction: (params: ExecuteIssueActionParams) => Promise<void>;
  isActing: boolean;
}

export const IssueDetailDrawer: React.FC<Props> = ({ issueId, open, onClose, onAction, isActing }) => {
  // Writes must name a person, never the 'CURRENT_USER' placeholder.
  const { actor } = useActorUserCode();

  const { data: record, isLoading } = useBnIssueRecordDetail(issueId || undefined);
  const [reason, setReason] = useState('');
  const releaseHolding = useReleaseHolding();

  const availableActions = record ? getAvailableIssueActions(record.status) : [];
  const isHolding = record?.target_table === 'cl_cheques_holding' && record?.status === 'ISSUED';

  const handleAction = async (action: IssueAction) => {
    const cfg = ACTION_CONFIG[action];
    if (cfg?.requiresReason && !reason.trim()) return;
    await onAction({ issueId: issueId!, action, userCode: actor(), reason: reason.trim() || undefined });
    setReason('');
  };

  const handleReleaseHolding = async () => {
    try {
      await releaseHolding.mutateAsync({
        issueId: issueId!,
        userCode: actor(),
        reason: reason.trim() || undefined,
      });
      toast.success('Holding payment released to cl_cheques');
      setReason('');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : record ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                <span>Issue Record</span>
                <BnStatusBadge status={record.status} dot />
              </SheetTitle>
            </SheetHeader>

            <div className="mt-6 space-y-6">
              {/* Beneficiary & Claim */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">SSN:</span> <span className="font-mono">{record.ssn}</span></div>
                <div><span className="text-muted-foreground">Claim:</span> {record.claim_number || '—'}</div>
                <div><span className="text-muted-foreground">Beneficiary:</span> {record.beneficiary_name || '—'}</div>
                {record.survivor_id && (
                  <div><span className="text-muted-foreground">Survivor ID:</span> <span className="font-mono text-xs">{record.survivor_id}</span></div>
                )}
              </div>

              {/* Payment Details */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-muted-foreground">Amount:</span> <span className="font-mono font-semibold">{record.currency} {formatNumber(record.amount, 2)}</span></div>
                <div><span className="text-muted-foreground">Method:</span> {record.issue_method}</div>
                <div><span className="text-muted-foreground">Type:</span> {record.instruction_type}</div>
                {record.period_start && (
                  <div><span className="text-muted-foreground">Period:</span> {record.period_start} – {record.period_end}</div>
                )}
              </div>

              {/* Routing */}
              <div className="p-3 rounded-md bg-muted text-sm">
                <span className="text-muted-foreground font-medium">Target Table: </span>
                <span className="font-mono text-xs">{TARGET_LABELS[record.target_table]}</span>
              </div>

              {/* Instrument */}
              {(record.cheque_number || record.dd_reference) && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {record.cheque_number && (
                    <div><span className="text-muted-foreground">Cheque #:</span> <span className="font-mono">{record.cheque_number}</span></div>
                  )}
                  {record.dd_reference && (
                    <div><span className="text-muted-foreground">DD Ref:</span> <span className="font-mono">{record.dd_reference}</span></div>
                  )}
                  {record.issued_by && (
                    <div><span className="text-muted-foreground">Issued By:</span> {record.issued_by}</div>
                  )}
                  {record.issued_at && (
                    <div><span className="text-muted-foreground">Issued At:</span> {formatDateForDisplay(record.issued_at)}</div>
                  )}
                </div>
              )}

              {/* Failure Info */}
              {record.error_message && (
                <div className="p-3 bg-destructive/5 border border-destructive/20 rounded-md text-sm">
                  <span className="text-destructive font-medium">Error: </span>{record.error_message}
                  <div className="text-xs text-muted-foreground mt-1">
                    Retry {record.retry_count} / {record.max_retries}
                  </div>
                </div>
              )}

              {/* Void Info */}
              {record.void_reason && (
                <div className="p-3 bg-orange-500/5 border border-orange-500/20 rounded-md text-sm">
                  <span className="text-orange-700 dark:text-orange-400 font-medium">
                    {record.status === 'STOPPED' ? 'Stopped: ' : 'Void Reason: '}
                  </span>
                  {record.void_reason}
                </div>
              )}

              {/* Reissue Link */}
              {record.reissue_of && (
                <div className="p-3 bg-muted rounded-md text-sm">
                  <span className="text-muted-foreground">Reissue of: </span>
                  <span className="font-mono text-xs">{record.reissue_of}</span>
                </div>
              )}

              {/* Hold Info */}
              {record.hold_reason && (
                <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-md text-sm">
                  <span className="text-amber-700 dark:text-amber-400 font-medium">Hold Reason: </span>
                  {record.hold_reason}
                  {record.hold_released_at && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Released by {record.hold_released_by} at {formatDateForDisplay(record.hold_released_at)}
                    </div>
                  )}
                </div>
              )}

              <Separator />

              {/* Actions */}
              {(availableActions.length > 0 || isHolding) && (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Actions</h3>

                  {(availableActions.some(a => ACTION_CONFIG[a]?.requiresReason) || isHolding) && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reason / Narrative</Label>
                      <Textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Enter reason..."
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

                    {isHolding && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={releaseHolding.isPending}
                        onClick={handleReleaseHolding}
                        className="gap-1.5"
                      >
                        {releaseHolding.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlock className="h-3.5 w-3.5" />}
                        Release from Holding
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-muted-foreground">Record not found.</p>
        )}
      </SheetContent>
    </Sheet>
  );
};
