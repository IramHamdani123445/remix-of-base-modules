import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import StationeryPageFrame from "@/platform/omni-comms/admin/views/stationery/StationeryPageFrame";
import View from "@/platform/omni-comms/admin/views/branding/BrandingDefaultsView";

export default function OmniCommsBrandingDefaultsPage() {
  return (
    <OmniCommsShell>
      <StationeryPageFrame
        title="Defaults & overrides"
        description="Which layout and shared assets apply for a module, department or event — and exactly which scope each value was inherited from."
      >
        <View />
      </StationeryPageFrame>
    </OmniCommsShell>
  );
}
