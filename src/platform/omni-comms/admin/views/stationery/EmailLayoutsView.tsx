import React, { Suspense, lazy } from 'react';
import StationeryPageFrame from './StationeryPageFrame';

const OrganizationEmailDefaultsPage = lazy(
  () => import('@/pages/admin/organization/OrganizationEmailDefaultsPage'),
);
const EmailLayoutsPage = lazy(() => import('@/pages/admin/organization/EmailLayoutsPage'));

/**
 * Email layouts — the email equivalent of a printed letterhead.
 *
 * Organisation defaults resolve first, a department override wins over them,
 * and a template/event override wins last. Every Omni-Comms email is wrapped
 * in the layout resolved here before it reaches the provider.
 */
export const EmailLayoutsView: React.FC = () => (
  <StationeryPageFrame
    title="Email layouts"
    description="Branded email shells applied to every outgoing email. Organisation defaults apply first, a department override wins over them, and an event or template override wins last."
  >
    <div className="space-y-6">
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        <OrganizationEmailDefaultsPage />
      </Suspense>
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        <EmailLayoutsPage />
      </Suspense>
    </div>
  </StationeryPageFrame>
);

export default EmailLayoutsView;
