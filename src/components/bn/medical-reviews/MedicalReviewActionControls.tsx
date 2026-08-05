/**
 * BN Medical Reviews — shared presentation primitives.
 *
 * `MedicalReviewActionButton` is the ONLY way a Medical Review screen renders
 * a mutating control. It composes two independent conditions:
 *   1. the caller holds the module action permission, and
 *   2. `app_modules.actions_enabled` is true (authoritative dark launch).
 *
 * When either fails the control renders disabled with an explanatory tooltip
 * rather than disappearing, so operators can see what the module will do once
 * it is switched on. This is presentation only — the server re-authorises.
 */
import React from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Lock, ShieldAlert, EyeOff } from 'lucide-react';
import type { MedicalReviewAction } from '@/features/bn/medical-reviews/model/permissions';

export interface MedicalReviewActionButtonProps extends Omit<ButtonProps, 'disabled'> {
  action: MedicalReviewAction;
  hasPermission: boolean;
  actionsEnabled: boolean;
  /** Additional business reason to block (e.g. wrong lifecycle state). */
  blockedReason?: string | null;
  children: React.ReactNode;
}

export const MedicalReviewActionButton: React.FC<MedicalReviewActionButtonProps> = ({
  action,
  hasPermission,
  actionsEnabled,
  blockedReason,
  children,
  ...buttonProps
}) => {
  const reason = !hasPermission
    ? `You do not hold bn.medical_review.${action}.`
    : !actionsEnabled
      ? 'Medical Reviews is in read-only dark launch. Operational actions are disabled for this environment.'
      : (blockedReason ?? null);

  const disabled = reason !== null;

  const button = (
    <Button {...buttonProps} disabled={disabled} data-testid={`mr-action-${action}`}>
      {disabled && <Lock className="mr-2 h-3.5 w-3.5" aria-hidden />}
      {children}
    </Button>
  );

  if (!disabled) return button;

  return (
    <TooltipProvider>
      <Tooltip>
        {/* span wrapper: disabled buttons do not emit pointer events */}
        <TooltipTrigger asChild>
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{reason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export const MedicalReviewDarkLaunchBanner: React.FC<{
  actionsEnabled: boolean;
  isLoading?: boolean;
}> = ({ actionsEnabled, isLoading }) => {
  if (isLoading) return null;
  if (actionsEnabled) return null;
  return (
    <Alert data-testid="mr-dark-launch-banner">
      <ShieldAlert className="h-4 w-4" />
      <AlertTitle>Read-only dark launch</AlertTitle>
      <AlertDescription>
        Medical Reviews is registered and readable, but every operational action is disabled
        because <code>app_modules.actions_enabled</code> is false for this module. Records shown
        here are live; nothing you do can change them until Benefits administration enables the
        module.
      </AlertDescription>
    </Alert>
  );
};

export const MedicalReviewStatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
  if (!status) return <Badge variant="outline">Unknown</Badge>;
  const tone =
    /OVERDUE|BREACH|REJECT|FAIL|EXPIRED/.test(status)
      ? 'bg-destructive/10 text-destructive border-destructive/30'
      : /COMPLETE|APPROVED|VERIFIED|CLOSED|FINALISED/.test(status)
        ? 'bg-emerald-500/10 text-emerald-700 border-emerald-300'
        : /PENDING|AWAIT|SUBMITTED|IN_PROGRESS|SCHEDULED|DUE/.test(status)
          ? 'bg-blue-500/10 text-blue-700 border-blue-300'
          : /DEFER|GRACE|CLARIF/.test(status)
            ? 'bg-amber-500/10 text-amber-700 border-amber-300'
            : 'bg-muted text-muted-foreground border-muted';
  return (
    <Badge variant="outline" className={tone}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
};

/** Used wherever confidential clinical content is deliberately withheld. */
export const ConfidentialWithheldNotice: React.FC<{ what?: string }> = ({
  what = 'Clinical findings',
}) => (
  <div
    className="flex items-start gap-2 rounded-md border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground"
    data-testid="mr-confidential-withheld"
  >
    <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
    <span>
      {what} are withheld. Viewing confidential medical evidence requires the
      <code className="mx-1">bn.medical_review.view_confidential_medical_evidence</code>
      permission and is separately audited.
    </span>
  </div>
);
