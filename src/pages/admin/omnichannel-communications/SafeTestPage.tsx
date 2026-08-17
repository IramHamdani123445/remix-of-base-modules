import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import View from "@/platform/omni-comms/admin/views/OmniCommsSafeTestPage";

export default function OmniCommsSafeTestRoutePage() {
  return (
    <OmniCommsShell>
      <View />
    </OmniCommsShell>
  );
}
