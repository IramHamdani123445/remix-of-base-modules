/**
 * BnBusyButton — standard Benefits action button with an in-flight spinner.
 *
 * Use for every submit / save / activate / approve / confirm action in
 * Benefit Management so users get immediate feedback and cannot double-submit.
 */
import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BnBusyButtonProps extends ButtonProps {
  /** Show the spinner and disable the button while the action is in flight. */
  loading?: boolean;
  /** Optional label rendered while loading (defaults to the normal children). */
  loadingLabel?: React.ReactNode;
}

export const BnBusyButton = React.forwardRef<HTMLButtonElement, BnBusyButtonProps>(
  ({ loading = false, loadingLabel, disabled, children, className, ...props }, ref) => (
    <Button
      ref={ref}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(className)}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {loading && loadingLabel ? loadingLabel : children}
    </Button>
  ),
);
BnBusyButton.displayName = 'BnBusyButton';
