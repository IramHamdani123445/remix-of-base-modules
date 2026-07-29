import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import OmniCommsPreferencesPage from "@/platform/omni-comms/admin/views/OmniCommsPreferencesPage";

export default function OmnichannelCommunicationsPreferencesPage() {
  return (
    <OmniCommsShell>
      <OmniCommsPreferencesPage />
    </OmniCommsShell>
  );
}
