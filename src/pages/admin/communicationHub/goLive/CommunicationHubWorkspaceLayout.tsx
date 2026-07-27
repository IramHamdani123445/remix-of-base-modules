/**
 * CH-SIMPLE-P4 — Communication Hub Go-Live workspace layout route.
 *
 * Pathless React Router layout that mounts the runtime-contract provider and
 * the shared workspace selection provider ONCE for Operations, Readiness,
 * Revalidation and Audit. Tab switches never trigger a second runtime-contract
 * audit and never lose the selected module/event/channel.
 */
import { Outlet } from "react-router-dom";
import { RuntimeContractProvider } from "@/platform/communication-hub/RuntimeContractContext";
import { CommunicationHubWorkspaceProvider } from "./WorkspaceContext";

export default function CommunicationHubWorkspaceLayout() {
  return (
    <RuntimeContractProvider>
      <CommunicationHubWorkspaceProvider>
        <Outlet />
      </CommunicationHubWorkspaceProvider>
    </RuntimeContractProvider>
  );
}
