import React from "react";
import OmniCommsShell from "@/platform/omni-comms/admin/components/OmniCommsShell";
import PrintProductionQueue from "@/platform/omni-comms/admin/views/operations/PrintProductionQueue";

export default function OmnichannelCommunicationsPrintQueuePage() {
  return (
    <OmniCommsShell>
      <PrintProductionQueue />
    </OmniCommsShell>
  );
}
