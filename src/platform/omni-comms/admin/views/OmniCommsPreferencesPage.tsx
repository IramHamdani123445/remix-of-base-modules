import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsPreferencesPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Preferences"
    capability="omni_comms.configure"
    description="Recipient and organisational communication preferences (opt-in / opt-out, quiet hours, locale, channel priority). Reserved for a future story."
  />
);

export default OmniCommsPreferencesPage;
