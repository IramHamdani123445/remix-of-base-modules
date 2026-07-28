/**
 * Thin page wrapper for AppRoutes. Composes the Omnichannel Communications
 * landing view from src/platform/omni-comms. No business logic here.
 */
import React from "react";
import OmniCommsLandingPage from "@/platform/omni-comms/admin/views/OmniCommsLandingPage";

export default function OmnichannelCommunicationsLandingPage() {
  return <OmniCommsLandingPage />;
}
