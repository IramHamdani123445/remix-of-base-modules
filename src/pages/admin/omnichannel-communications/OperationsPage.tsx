import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsOperationsPage from "@/platform/omni-comms/admin/views/OmniCommsOperationsPage";

export default function OmnichannelCommunicationsOperationsPage() {
  return (
    <OmniCommsShell>
      <OmniCommsOperationsPage />
    </OmniCommsShell>
  );
}
