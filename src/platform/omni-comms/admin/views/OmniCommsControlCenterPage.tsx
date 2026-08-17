/** Control Center — its own permanent route (previously `?view=control-center`). */
import React from 'react';
import OmniCommsControlCenter from './control/OmniCommsControlCenter';

export const OmniCommsControlCenterPage: React.FC = () => (
  <div data-testid="omni-comms-control-center-page">
    <OmniCommsControlCenter />
  </div>
);

export default OmniCommsControlCenterPage;
