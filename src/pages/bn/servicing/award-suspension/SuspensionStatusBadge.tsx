import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SuspensionRequestStatus } from '@/services/bn/awardSuspensionViewService';

const styles: Record<SuspensionRequestStatus, string> = {
  PROPOSED: 'bg-sky-500/10 text-sky-700 border-sky-300 dark:text-sky-300',
  PENDING_APPROVAL: 'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  PENDING_LEVEL_1: 'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  PENDING_LEVEL_2: 'bg-amber-600/10 text-amber-800 border-amber-400 dark:text-amber-300',
  PENDING_LEVEL_N: 'bg-amber-700/10 text-amber-800 border-amber-500 dark:text-amber-300',
  APPROVED: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300',
  APPLIED: 'bg-emerald-600/15 text-emerald-800 border-emerald-400 dark:text-emerald-300',
  REJECTED: 'bg-destructive/10 text-destructive border-destructive/40',
  WITHDRAWN: 'bg-muted text-muted-foreground border-border',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  EXECUTION_FAILED: 'bg-destructive/10 text-destructive border-destructive/40',
  REINSTATEMENT_PENDING: 'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  REINSTATEMENT_APPROVED:
    'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300',
  REINSTATEMENT_REJECTED: 'bg-destructive/10 text-destructive border-destructive/40',
  REINSTATEMENT_WITHDRAWN: 'bg-muted text-muted-foreground border-border',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

const labels: Record<SuspensionRequestStatus, string> = {
  PROPOSED: 'Proposed',
  PENDING_APPROVAL: 'Pending approval',
  PENDING_LEVEL_1: 'Pending L1',
  PENDING_LEVEL_2: 'Pending L2',
  PENDING_LEVEL_N: 'Pending L3+',
  APPROVED: 'Approved',
  APPLIED: 'Applied',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  EXECUTION_FAILED: 'Execution failed',
  REINSTATEMENT_PENDING: 'Reinstatement pending',
  REINSTATEMENT_APPROVED: 'Reinstatement approved',
  REINSTATEMENT_REJECTED: 'Reinstatement rejected',
  REINSTATEMENT_WITHDRAWN: 'Reinstatement withdrawn',
  UNKNOWN: 'Unrecognised status',
};


export function SuspensionStatusBadge({
  status,
  className,
}: {
  status: SuspensionRequestStatus | null | undefined;
  className?: string;
}) {
  if (!status) {
    return (
      <Badge variant="outline" className={cn('text-muted-foreground', className)}>
        —
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className={cn(styles[status], 'font-medium', className)}>
      {labels[status]}
    </Badge>
  );
}
