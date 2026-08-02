/**
 * OmniCommsShell — shared wrapper mounted around every Omni-Comms admin route.
 *
 * Composes:
 *   - Route error boundary (`OmniCommsErrorBoundary`)
 *   - Tenant context provider (`OmniCommsTenantProvider`)
 *   - Shared module header (identity, environment, tenant selector, posture,
 *     module-local navigation)
 *
 * Route-level auth remains handled by `OmniCommsAdminRoute` upstream in
 * `AppRoutes.tsx`; this shell adds cross-cutting UI concerns without
 * changing route counts or permission checks.
 */
import React from "react";
import { OmniCommsErrorBoundary } from "./OmniCommsErrorBoundary";
import { OmniCommsTenantProvider } from "../../context/OmniCommsTenantContext";
import OmniCommsModuleHeader from "./OmniCommsModuleHeader";
import OmniCommsBreadcrumbs from "./OmniCommsBreadcrumbs";

export const OmniCommsShell: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <OmniCommsErrorBoundary>
    <OmniCommsTenantProvider>
      <div className="min-h-dvh bg-background" data-testid="omni-comms-shell">
        {/*
          UI Phase 1 — a single breadcrumb trail sits above the single module
          header. Admin → Omnichannel Communications → Section → Context.
        */}
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-2 sm:px-6">
            <OmniCommsBreadcrumbs />
          </div>
        </div>
        <OmniCommsModuleHeader />
        <main className="container mx-auto px-4 py-6 sm:px-6">{children}</main>
      </div>
    </OmniCommsTenantProvider>
  </OmniCommsErrorBoundary>
);


export default OmniCommsShell;
