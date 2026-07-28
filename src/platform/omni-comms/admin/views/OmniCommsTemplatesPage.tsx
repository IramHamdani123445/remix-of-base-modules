import React from "react";
import OmniCommsNotImplemented from "../components/OmniCommsNotImplemented";

export const OmniCommsTemplatesPage: React.FC = () => (
  <OmniCommsNotImplemented
    title="Templates"
    capability="omni_comms.author_templates"
    description="Template authoring and approval workspace for Omnichannel Communications. Governed by the omni_comms.author_templates and omni_comms.approve_templates capabilities. Reserved for a future story."
  />
);

export default OmniCommsTemplatesPage;
