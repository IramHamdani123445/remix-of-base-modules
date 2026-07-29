import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsEventsPage from "@/platform/omni-comms/admin/views/OmniCommsEventsPage";

export default function OmnichannelCommunicationsEventsPage() {
  return (
    <OmniCommsShell>
      <OmniCommsEventsPage />
    </OmniCommsShell>
  );
}
