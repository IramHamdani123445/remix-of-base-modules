import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsTemplatesPage from "@/platform/omni-comms/admin/views/OmniCommsTemplatesPage";

export default function OmnichannelCommunicationsTemplatesPage() {
  return (
    <OmniCommsShell>
      <OmniCommsTemplatesPage />
    </OmniCommsShell>
  );
}
