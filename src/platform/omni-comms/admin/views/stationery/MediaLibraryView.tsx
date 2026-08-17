import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const MediaLibraryPage = lazy(() => import('@/pages/admin/organization/MediaLibraryPage'));

export const MediaLibraryView: React.FC = () => (
  <StationeryPageFrame
    title="Media library"
    description="Logos, seals, watermarks and banners used by printed letters and branded emails."
  >
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <MediaLibraryPage />
    </Suspense>
  </StationeryPageFrame>
);

export default MediaLibraryView;
