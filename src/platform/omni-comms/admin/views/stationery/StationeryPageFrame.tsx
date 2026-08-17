/**
 * Omni-Comms — Stationery page frame.
 *
 * Each stationery section is its own route and its own page, reached from the
 * left-hand menu (Omnichannel Communications › Stationery › …). No in-page tab
 * strip: the sidebar is the single navigation surface.
 *
 * IMPORTANT: these pages are a second entry point, not a second system. The
 * very same Communication Hub editors, hooks and tables are rendered here —
 * no duplicate records, no parallel editors.
 */
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';

export interface StationeryPageFrameProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export const StationeryPageFrame: React.FC<StationeryPageFrameProps> = ({
  title,
  description,
  children,
}) => (
  <div className="space-y-4" data-testid="omni-comms-stationery">
    <Card>
      <CardContent className="pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Stationery</p>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>

    <div>{children}</div>
  </div>
);

export default StationeryPageFrame;
