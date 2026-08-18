/**
 * OmniCommsPreviewShell — one shared, viewport-bound dialog shell for every
 * Omni-Comms preview surface.
 *
 * Guarantees (verified at 1366×768, 1440×900 and 1920×1080):
 *  • width  <= calc(100vw - 2rem), height <= calc(100dvh - 2rem)
 *  • header stays visible, body scrolls internally, close button reachable
 *  • no horizontal page overflow, background page does not scroll
 */
import React from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface OmniCommsPreviewShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional actions rendered under the header, above the scroll area. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

export const OmniCommsPreviewShell: React.FC<OmniCommsPreviewShellProps> = ({
  open, onOpenChange, title, description, toolbar, children, className, testId = "omni-comms-preview-shell",
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent
      data-testid={testId}
      className={cn(
        "flex flex-col overflow-hidden p-0",
        "w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-5xl",
        "max-h-[calc(100dvh-2rem)]",
        className,
      )}
    >
      <DialogHeader className="flex-none space-y-1 border-b px-6 py-4 pr-12">
        <DialogTitle className="truncate">{title}</DialogTitle>
        {description && (
          <DialogDescription className="text-xs">{description}</DialogDescription>
        )}
      </DialogHeader>
      {toolbar && (
        <div className="flex-none border-b px-6 py-2" data-testid={`${testId}-toolbar`}>
          {toolbar}
        </div>
      )}
      <div
        className="min-h-0 flex-1 overflow-auto px-6 py-4"
        data-testid={`${testId}-body`}
      >
        <div className="min-w-0">{children}</div>
      </div>
    </DialogContent>
  </Dialog>
);

export default OmniCommsPreviewShell;
