/**
 * Omni-Comms — the ONE place technical evidence is exposed.
 *
 * Support engineers open this drawer to reach provider evidence, sender
 * bindings, domain evidence, authorisation history, dispatcher and callback
 * evidence, identifiers and raw blocker codes. Normal administrators never
 * need it, so nothing here appears on the plain surfaces.
 *
 * There is deliberately no `advanced` route segment: this is a drawer, not a
 * destination.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Wrench } from 'lucide-react';

export interface TechnicalDetailsPanelProps {
  /** Rendered inside the drawer. Mounted only while the drawer is open. */
  children: React.ReactNode;
  triggerLabel?: string;
  title?: string;
  description?: string;
}

export const TechnicalDetailsPanel: React.FC<TechnicalDetailsPanelProps> = ({
  children,
  triggerLabel = 'Technical details',
  title = 'Technical details',
  description =
  'Support evidence for engineers: provider, credentials, sender binding, '
  + 'domain, authorisation history, dispatcher, callbacks and identifiers.',
}) => {
  const [open, setOpen] = React.useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid="omni-comms-technical-details-trigger"
        >
          <Wrench className="mr-2 h-4 w-4" />
          {triggerLabel}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-3xl"
        data-testid="omni-comms-technical-details-panel"
      >
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6">{open ? children : null}</div>
      </SheetContent>
    </Sheet>
  );
};

export default TechnicalDetailsPanel;
