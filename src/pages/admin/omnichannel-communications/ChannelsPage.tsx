import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsChannelsPage from "@/platform/omni-comms/admin/views/OmniCommsChannelsPage";

export default function OmnichannelCommunicationsChannelsPage() {
  return (
    <OmniCommsShell>
      <OmniCommsChannelsPage />
    </OmniCommsShell>
  );
}
