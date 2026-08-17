/** Setup readiness — its own permanent route (previously `?view=setup`). */
import React from 'react';
import SetupWizardPanel from './setup/SetupWizardPanel';

export const OmniCommsSetupPage: React.FC = () => (
  <div data-testid="omni-comms-setup-page">
    <SetupWizardPanel />
  </div>
);

export default OmniCommsSetupPage;
