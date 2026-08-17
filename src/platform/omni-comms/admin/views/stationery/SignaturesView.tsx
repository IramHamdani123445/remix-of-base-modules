import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const SignaturesPage = lazy(() => import('@/pages/admin/organization/SignaturesPage'));

export const SignaturesView: React.FC = () => (
  <StationeryPageFrame
    title="Signatures"
    description="Signing officers and signature images applied to correspondence."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <SignaturesPage />
    </Suspense>
  </StationeryPageFrame>
);

export default SignaturesView;
