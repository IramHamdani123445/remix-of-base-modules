import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const LetterheadsPage = lazy(() => import('@/pages/admin/organization/LetterheadsPage'));

export const LetterheadsView: React.FC = () => (
  <StationeryPageFrame
    title="Letterheads"
    description="Printed letterhead designs used by physical correspondence. These are the same records the Communication Hub edits — changed once, applied everywhere."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <LetterheadsPage />
    </Suspense>
  </StationeryPageFrame>
);

export default LetterheadsView;
