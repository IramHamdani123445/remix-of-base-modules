import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsHealthPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Health"
    capability="omni_comms.view"
    description="System health and observability for Omnichannel Communications: worker heartbeats, provider health, queue depth, error rates. No metrics are surfaced in this shell story."
  />
);

export default OmniCommsHealthPage;
