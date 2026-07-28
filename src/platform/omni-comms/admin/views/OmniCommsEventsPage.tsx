import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsEventsPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Events"
    capability="omni_comms.configure"
    description="Business-event catalogue for Omnichannel Communications. Defines the events business modules will invoke via the sendCommunication() façade once it exists. Reserved for a future story."
  />
);

export default OmniCommsEventsPage;
