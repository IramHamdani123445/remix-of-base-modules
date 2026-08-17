import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import View from "@/platform/omni-comms/admin/views/OmniCommsSetupPage";

export default function OmniCommsSetupRoutePage() {
  return (
    <OmniCommsShell>
      <View />
    </OmniCommsShell>
  );
}
