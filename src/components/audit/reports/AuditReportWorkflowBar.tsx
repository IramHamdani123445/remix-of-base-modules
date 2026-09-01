import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CheckCircle2, ChevronRight, RotateCcw, Send, FileCheck, Eye, Clock } from 'lucide-react';

const WORKFLOW_STEPS = [
  { key: 'Draft', label: 'Draft', icon: Clock },
  { key: 'In Review', label: 'In Review', icon: Eye },
  { key: 'Submitted', label: 'Submitted', icon: Send },
  { key: 'Approved', label: 'Approved', icon: CheckCircle2 },
  { key: 'Final', label: 'Final / Issued', icon: FileCheck },
];

interface AuditReportWorkflowBarProps {
  currentStatus: string;
  onStatusChange: (newStatus: string) => void;
  disabled?: boolean;
}

export function AuditReportWorkflowBar({ currentStatus, onStatusChange, disabled }: AuditReportWorkflowBarProps) {
  const [confirmAction, setConfirmAction] = useState<{ status: string; label: string } | null>(null);
  const currentIdx = WORKFLOW_STEPS.findIndex((s) => s.key === currentStatus);

  const nextStep = currentIdx < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[currentIdx + 1] : null;
  const canRevert = currentIdx > 0 && currentStatus !== 'Final';

  const handleConfirm = () => {
    if (confirmAction) {
      onStatusChange(confirmAction.status);
      setConfirmAction(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 flex-wrap">
        {/* Stepper */}
        {WORKFLOW_STEPS.map((step, idx) => {
          const isCurrent = step.key === currentStatus;
          const isPast = currentIdx > idx;
          const StepIcon = step.icon;

          return (
            <div key={step.key} className="contents">
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                    : isPast
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800'
                    : 'bg-muted/50 text-muted-foreground border-border'
                }`}
              >
                {isPast ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : (
                  <StepIcon className="h-3 w-3" />
                )}
                <span className="hidden sm:inline">{step.label}</span>
              </div>
              {idx < WORKFLOW_STEPS.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              )}
            </div>
          );
        })}

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 ml-3">
          {canRevert && !disabled && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConfirmAction({ status: 'Draft', label: 'Revert to Draft' })}
            >
              <RotateCcw className="h-3 w-3 mr-1" /> Revert
            </Button>
          )}
          {nextStep && !disabled && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                setConfirmAction({
                  status: nextStep.key,
                  label: nextStep.key === 'Final' ? 'Issue Report' : `Move to ${nextStep.label}`,
                })
              }
            >
              {nextStep.key === 'Final' ? (
                <FileCheck className="h-3 w-3 mr-1" />
              ) : (
                <Send className="h-3 w-3 mr-1" />
              )}
              {nextStep.key === 'Final' ? 'Issue' : nextStep.label}
            </Button>
          )}
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Status Change</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to <strong>{confirmAction?.label}</strong>?
              {confirmAction?.status === 'Final' &&
                ' Once issued, the report will be locked and cannot be edited.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {confirmAction?.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
