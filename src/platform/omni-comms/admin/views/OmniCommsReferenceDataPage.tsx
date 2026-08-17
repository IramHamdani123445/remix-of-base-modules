/**
 * Reference data — non-production configuration tool, previously
 * `?view=reference-data`. Not advertised in normal navigation.
 */
import React from 'react';
import { Navigate } from 'react-router-dom';
import ReferenceSeedPanel from './seed/ReferenceSeedPanel';
import { useOmniCommsCertificationPosture } from '../hooks/useOmniCommsCertificationPosture';
import { isNonProduction } from '../posture/omniCommsPosture';
import { OMNI_COMMS_ROUTES } from '../navigation/omniCommsNavigation';

export const OmniCommsReferenceDataPage: React.FC = () => {
  const { environment } = useOmniCommsCertificationPosture({ autoProbe: false });
  if (!isNonProduction(environment)) {
    return <Navigate to={OMNI_COMMS_ROUTES.overview} replace />;
  }
  return (
    <div data-testid="omni-comms-reference-data-page">
      <ReferenceSeedPanel />
    </div>
  );
};

export default OmniCommsReferenceDataPage;
