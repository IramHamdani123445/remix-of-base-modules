/**
 * OmniCommsShell — shared wrapper mounted around every Omni-Comms admin route.
 *
 * Composes:
 *   - Route error boundary (`OmniCommsErrorBoundary`)
 *   - Tenant context provider (`OmniCommsTenantProvider`)
 *
 * Route-level auth remains handled by `OmniCommsAdminRoute` upstream in
 * `AppRoutes.tsx`; this shell adds cross-cutting UI concerns without
 * changing route counts or permission checks.
 */
import React from "react";
import { OmniCommsErrorBoundary } from "./OmniCommsErrorBoundary";
import { OmniCommsTenantProvider } from "../../context/OmniCommsTenantContext";

export const OmniCommsShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <OmniCommsErrorBoundary>
    <OmniCommsTenantProvider>{children}</OmniCommsTenantProvider>
  </OmniCommsErrorBoundary>
);

export default OmniCommsShell;
