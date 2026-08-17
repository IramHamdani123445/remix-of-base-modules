/**
 * Safe test — its own permanent route (previously `?view=safe-test`).
 *
 * Non-production only. In production the route falls back to Overview, which
 * is exactly the behaviour the tab had.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import ControlledDryRunPanel from './dryrun/ControlledDryRunPanel';
import { useOmniCommsCertificationPosture } from '../hooks/useOmniCommsCertificationPosture';
import { isNonProduction } from '../posture/omniCommsPosture';
import { OMNI_COMMS_ROUTES } from '../navigation/omniCommsNavigation';

export const OmniCommsSafeTestPage: React.FC = () => {
  const { environment } = useOmniCommsCertificationPosture({ autoProbe: false });
  if (!isNonProduction(environment)) {
    return <Navigate to={OMNI_COMMS_ROUTES.overview} replace />;
  }
  return (
    <div data-testid="omni-comms-safe-test-page">
      <ControlledDryRunPanel />
    </div>
  );
};

export default OmniCommsSafeTestPage;
