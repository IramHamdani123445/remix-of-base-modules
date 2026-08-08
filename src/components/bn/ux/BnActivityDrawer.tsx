/**
 * BnActivityDrawer — secondary disclosure for timeline, history, audit and
 * technical metadata so they do not compete with the operational workflow.
 * Nothing is removed; everything remains reachable in one click.
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
import { History } from 'lucide-react';

interface Props {
  readonly title?: string;
  readonly description?: string;
  readonly triggerLabel?: string;
  readonly children: React.ReactNode;
}

export const BnActivityDrawer: React.FC<Props> = ({
  title = 'Activity & history',
  description = 'Timeline, audit trail and technical details for this record.',
  triggerLabel = 'Activity & history',
  children,
}) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline" size="sm" data-testid="bn-activity-drawer-trigger">
        <History className="mr-2 h-4 w-4" aria-hidden="true" />
        {triggerLabel}
      </Button>
    </SheetTrigger>
    <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="bn-activity-drawer">
      <SheetHeader>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription>{description}</SheetDescription>
      </SheetHeader>
      <div className="mt-4 space-y-4">{children}</div>
    </SheetContent>
  </Sheet>
);
