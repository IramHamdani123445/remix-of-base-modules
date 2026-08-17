import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const HeadersFootersPage = lazy(() => import('@/pages/admin/organization/HeadersFootersPage'));

export const HeadersFootersView: React.FC = () => (
  <StationeryPageFrame
    title="Headers & footers"
    description="Page headers and footers shared across printed correspondence."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <HeadersFootersPage />
    </Suspense>
  </StationeryPageFrame>
);

export default HeadersFootersView;
