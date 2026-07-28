import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsChannelsPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Channels"
    capability="omni_comms.configure"
    description="Channel and provider configuration (email, SMS, WhatsApp, push, print) for Omnichannel Communications. Provider integrations will live only in adapters/providers. Reserved for a future story."
  />
);

export default OmniCommsChannelsPage;
