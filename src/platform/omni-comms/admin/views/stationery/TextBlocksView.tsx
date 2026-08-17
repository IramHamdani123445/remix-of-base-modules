import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const TextBlocksPage = lazy(() => import('@/pages/admin/organization/TextBlocksPage'));

export const TextBlocksView: React.FC = () => (
  <StationeryPageFrame
    title="Text blocks"
    description="Reusable copy, disclaimers and legal footers shared by every channel."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <TextBlocksPage />
    </Suspense>
  </StationeryPageFrame>
);

export default TextBlocksView;
