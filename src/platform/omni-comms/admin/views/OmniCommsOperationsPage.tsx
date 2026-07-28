import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsOperationsPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Operations"
    capability="omni_comms.operate"
    description="Operational console for the new Omnichannel Communications system: queue inspection, retries, resends, cancellation and suppression. Reserved for a future story."
  />
);

export default OmniCommsOperationsPage;
