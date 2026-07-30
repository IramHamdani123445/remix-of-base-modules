/**
 * Shared Omni-Comms empty / error / loading state presenter.
 *
 * Purely presentational. Gives every admin surface a consistent, explicit
 * message instead of a bare blank table.
 */
import React from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface OmniCommsEmptyStateProps {
  variant?: "empty" | "error" | "loading";
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export const OmniCommsEmptyState: React.FC<OmniCommsEmptyStateProps> = ({
  variant = "empty",
  title,
  description,
  actionLabel,
  onAction,
}) => {
  const Icon = variant === "error" ? AlertCircle : variant === "loading" ? Loader2 : Inbox;
  return (
    <div
      data-testid={`omni-comms-empty-state-${variant}`}
      className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed py-10 px-6 text-center"
    >
      <Icon
        className={`h-6 w-6 ${variant === "error" ? "text-destructive" : "text-muted-foreground"} ${
          variant === "loading" ? "animate-spin" : ""
        }`}
        aria-hidden="true"
      />
      <p className={`text-sm font-medium ${variant === "error" ? "text-destructive" : ""}`}>
        {title}
      </p>
      {description ? (
        <p className="text-xs text-muted-foreground max-w-md">{description}</p>
      ) : null}
      {actionLabel && onAction ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
};

export default OmniCommsEmptyState;
