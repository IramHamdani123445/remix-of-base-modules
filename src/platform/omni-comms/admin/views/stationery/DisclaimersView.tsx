import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const DisclaimersPage = lazy(() => import('@/pages/admin/organization/DisclaimersPage'));

export const DisclaimersView: React.FC = () => (
  <StationeryPageFrame
    title="Disclaimers"
    description="Legal disclaimers applied to letters, emails and messages. Single source of truth — the same records previously edited under Organisation Management › Brand Assets."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <DisclaimersPage />
    </Suspense>
  </StationeryPageFrame>
);

export default DisclaimersView;
