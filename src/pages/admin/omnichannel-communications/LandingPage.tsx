import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsLandingPage from "@/platform/omni-comms/admin/views/OmniCommsLandingPage";

export default function OmnichannelCommunicationsLandingPage() {
  return (
    <OmniCommsShell>
      <OmniCommsLandingPage />
    </OmniCommsShell>
  );
}
