/**
 * OmniCommsAdminRoute — route gate for the parallel Omnichannel Communications
 * system.
 *
 * Reuses the SAME shared auth + permission hooks as the Legacy
 * `CommHubAdminRoute` guard (`useSupabaseAuth`, `useIsAdmin`,
 * `useModulePermissions`) and mirrors its loading / access-denied presentation,
 * but checks the `omni_comms.view` capability (module `omni_comms`, action
 * `view`). It does NOT import from or modify the Legacy guard.
 *
 * Access is granted when:
 *   - user is an Admin (via `is_admin` RPC), OR
 *   - user has the `omni_comms.view` module action.
 */
import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldAlert } from "lucide-react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useIsAdmin, useModulePermissions } from "@/hooks/useNavigationMenu";

interface OmniCommsAdminRouteProps {
  children: React.ReactNode;
}

export const OmniCommsAdminRoute: React.FC<OmniCommsAdminRouteProps> = ({ children }) => {
  const { isAuthenticated, isAuthReady, isLoading } = useSupabaseAuth();
  const isAdmin = useIsAdmin();
  const omniComms = useModulePermissions("omni_comms");
  const location = useLocation();

  if (isLoading || !isAuthReady) {
    return (
      <div
        data-testid="omni-comms-gate-loading"
        className="min-h-screen flex items-center justify-center bg-background"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (omniComms.isLoading && !isAdmin) {
    return (
      <div
        data-testid="omni-comms-gate-loading"
        className="min-h-screen flex items-center justify-center bg-background"
      >
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const allowed = isAdmin || omniComms.hasPermission("view");

  if (!allowed) {
    return (
      <div
        data-testid="omni-comms-not-authorized"
        className="min-h-screen flex items-center justify-center bg-background px-6"
      >
        <div className="max-w-md text-center space-y-3">
          <ShieldAlert className="h-10 w-10 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-sm text-muted-foreground">
            You do not have permission to view Omnichannel Communications.
            Contact your administrator if you believe this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default OmniCommsAdminRoute;
