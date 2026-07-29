import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsHealthPage from "@/platform/omni-comms/admin/views/OmniCommsHealthPage";

export default function OmnichannelCommunicationsHealthPage() {
  return (
    <OmniCommsShell>
      <OmniCommsHealthPage />
    </OmniCommsShell>
  );
}
