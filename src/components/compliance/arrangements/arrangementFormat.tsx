/**
 * Shared presentation helpers for Payment Arrangement operational screens.
 * Presentation only — no financial calculation lives here.
 */
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, Clock, AlertTriangle, CircleSlash, CirclePause } from 'lucide-react';

export const formatXCD = (amount: number | null | undefined) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'XCD',
    minimumFractionDigits: 2,
  }).format(Number(amount ?? 0));

const INSTALLMENT_STATUS: Record<
  string,
  { className: string; icon: typeof CheckCircle2; label: string }
> = {
  PAID: { className: 'bg-success/10 text-success border-success/20', icon: CheckCircle2, label: 'Paid' },
  PARTIAL: { className: 'bg-warning/10 text-warning-foreground border-warning/20', icon: CirclePause, label: 'Partial' },
  PENDING: { className: 'bg-muted text-muted-foreground border-border', icon: Clock, label: 'Pending' },
  OVERDUE: { className: 'bg-destructive/10 text-destructive border-destructive/30', icon: AlertTriangle, label: 'Overdue' },
  CANCELLED: { className: 'bg-muted text-muted-foreground border-border', icon: CircleSlash, label: 'Cancelled' },
  WAIVED: { className: 'bg-muted text-muted-foreground border-border', icon: CircleSlash, label: 'Waived' },
};

export function InstallmentStatusBadge({ status }: { status: string | null | undefined }) {
  const cfg = INSTALLMENT_STATUS[status ?? 'PENDING'] ?? INSTALLMENT_STATUS.PENDING;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

const HEALTH: Record<string, { className: string; label: string; icon: typeof CheckCircle2 }> = {
  HEALTHY: { className: 'bg-success/10 text-success border-success/20', label: 'Healthy', icon: CheckCircle2 },
  AT_RISK: { className: 'bg-warning/10 text-warning-foreground border-warning/20', label: 'At risk', icon: Clock },
  BREACHED: { className: 'bg-destructive/10 text-destructive border-destructive/30', label: 'Breached', icon: AlertTriangle },
  INACTIVE: { className: 'bg-muted text-muted-foreground border-border', label: 'Inactive', icon: CirclePause },
};

export function ArrangementHealthBadge({ health }: { health: string | null | undefined }) {
  const cfg = HEALTH[health ?? 'INACTIVE'] ?? HEALTH.INACTIVE;
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

export const arrangementStatusClass = (status: string | null | undefined) => {
  const map: Record<string, string> = {
    DRAFT: 'bg-muted text-muted-foreground',
    PENDING_APPROVAL: 'bg-warning/10 text-warning-foreground',
    ACTIVE: 'bg-success/10 text-success',
    COMPLETED: 'bg-primary/10 text-primary',
    BREACHED: 'bg-destructive/10 text-destructive',
    DEFAULTED: 'bg-destructive/10 text-destructive',
    CANCELLED: 'bg-muted text-muted-foreground',
    SUPERSEDED: 'bg-muted text-muted-foreground',
  };
  return map[status ?? ''] || 'bg-muted text-muted-foreground';
};
