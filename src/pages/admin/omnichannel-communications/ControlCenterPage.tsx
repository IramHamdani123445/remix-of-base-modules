import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import View from "@/platform/omni-comms/admin/views/OmniCommsControlCenterPage";

export default function OmniCommsControlCenterRoutePage() {
  return (
    <OmniCommsShell>
      <View />
    </OmniCommsShell>
  );
}
