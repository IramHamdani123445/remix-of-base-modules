/**
 * BN Gap Module Route Gate (Part I of BN-GAP-MENU epic).
 *
 * Shared access decision for all six Benefits Gap modules:
 *   bn_mortality, bn_overpayments, bn_appeals,
 *   bn_means_tests, bn_risk_management, bn_uprating
 *
 * Enforces (in this exact order):
 *   1. authenticated user
 *   2. module exists in app_modules
 *   3. is_enabled = true
 *   4. routes_enabled = true
 *   5. explicit `view` permission OR Admin role
 *   6. surfaces read-only vs mutation-complete state via `actions_enabled`
 *      and `rollout_state` to the wrapped page.
 *
 * Menu hiding is NOT security — this gate protects direct URL entry.
 */

import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useIsAdmin } from "@/hooks/useNavigationMenu";
import { fetchAllUserPermissions } from "@/lib/permissions/fetchAllUserPermissions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, LockKeyhole, AlertTriangle, EyeOff } from "lucide-react";

export type BnGapModuleCode =
  | "bn_mortality"
  | "bn_overpayments"
  | "bn_appeals"
  | "bn_means_tests"
  | "bn_risk_management"
  | "bn_uprating"
  // Appeals child (page-surface) modules — canonical operational
  // capabilities remain on `bn_appeals`, but each screen enforces its
  // own child `view` permission before rendering.
  | "bn_appeals_dashboard"
  | "bn_appeals_register"
  | "bn_appeals_my_work"
  | "bn_appeals_hearings"
  | "bn_appeals_implementation"
  | "bn_appeals_config"
  | "bn_appeals_detail";

export interface BnModuleAccessContext {
  moduleCode: BnGapModuleCode;
  moduleId: string;
  displayName: string;
  isAdmin: boolean;
  routesEnabled: boolean;
  actionsEnabled: boolean;
  rolloutState: "hidden" | "internal_pilot" | "public";
  hasView: boolean;
  hasRead: boolean;
  hasWrite: boolean;
  hasDecide: boolean;
  hasAdmin: boolean;
  /** Every module action granted to the caller (Admin resolves to all). */
  grants: readonly string[];
  /** Capability probe for module-specific actions (verify, approve, config…). */
  can: (action: string) => boolean;
  /** When true the page must render as read-only (no mutation controls). */
  readOnly: boolean;
  reason: string;
}

export interface BnModuleAccessCapability {
  moduleCode: string;
  action: string;
}

interface Props {
  moduleCode: BnGapModuleCode;
  requiredAction?: "view" | "read" | "write" | "decide" | "admin";
  /**
   * Optional administrative fallback capabilities. When set, the gate
   * grants access if the user holds ANY of these (module_code, action)
   * pairs, even if the local child-module permission is absent. Used to
   * scope Configuration to `bn_appeals:admin` without hard-coding user
   * IDs.
   */
  adminCapabilities?: readonly BnModuleAccessCapability[];
  children: (ctx: BnModuleAccessContext) => React.ReactNode;
}


interface ModuleRow {
  id: string;
  name: string;
  display_name: string;
  is_enabled: boolean;
  routes_enabled: boolean;
  actions_enabled: boolean;
  rollout_state: "hidden" | "internal_pilot" | "public";
}

export const BnModuleRouteGate: React.FC<Props> = ({
  moduleCode,
  requiredAction = "view",
  adminCapabilities,
  children,
}) => {

  const { user, isAuthReady, isAuthenticated } = useSupabaseAuth();
  const isAdmin = useIsAdmin();

  const { data: moduleRow, isLoading: moduleLoading, error: moduleError } = useQuery({
    queryKey: ["bn-gap-module", moduleCode],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_modules")
        .select(
          "id,name,display_name,is_enabled,routes_enabled,actions_enabled,rollout_state",
        )
        .eq("name", moduleCode)
        .maybeSingle();
      if (error) throw error;
      return data as ModuleRow | null;
    },
    enabled: isAuthReady && isAuthenticated,
  });

  const { data: permissions = [], isLoading: permLoading } = useQuery({
    queryKey: ["user-navigation-permissions", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      return await fetchAllUserPermissions(user.id);
    },
    enabled: isAuthReady && isAuthenticated && !!user?.id,
  });

  if (!isAuthReady || moduleLoading || permLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading module access…
      </div>
    );
  }

  if (!isAuthenticated) {
    return renderDenied(
      "Sign-in required",
      "You must be signed in to access Benefits Gap modules.",
    );
  }

  if (moduleError || !moduleRow) {
    return renderDenied(
      "Module unavailable",
      `The module '${moduleCode}' is not registered in app_modules. Contact an administrator.`,
    );
  }

  if (!moduleRow.is_enabled) {
    return renderDenied(
      "Module disabled",
      `The '${moduleRow.display_name}' module is currently disabled by administration.`,
      EyeOff,
    );
  }

  if (!moduleRow.routes_enabled) {
    return renderDenied(
      "Route disabled",
      `Direct route access to '${moduleRow.display_name}' has been disabled. Actions may still run through the API.`,
      EyeOff,
    );
  }

  const grants = new Set(
    permissions
      .filter((p: any) => p.module_name === moduleCode && p.is_granted !== false)
      .map((p: any) => p.action_name),
  );
  const hasAction = (a: string) => isAdmin || grants.has(a);

  // Administrative fallback: if the child module permission is missing
  // but the caller supplied `adminCapabilities`, allow access when any
  // of them is held. Denials remain denied via `is_granted === false`
  // filter above.
  const holdsAdminFallback =
    isAdmin ||
    (adminCapabilities ?? []).some((cap) =>
      permissions.some(
        (p: any) =>
          p.module_name === cap.moduleCode &&
          p.action_name === cap.action &&
          p.is_granted !== false,
      ),
    );

  if (!hasAction(requiredAction) && !holdsAdminFallback) {
    return renderDenied(
      "Permission denied",
      `Your account lacks the '${requiredAction}' permission on '${moduleRow.display_name}'.`,
      LockKeyhole,
    );
  }


  const ctx: BnModuleAccessContext = {
    moduleCode,
    moduleId: moduleRow.id,
    displayName: moduleRow.display_name,
    isAdmin,
    routesEnabled: moduleRow.routes_enabled,
    actionsEnabled: moduleRow.actions_enabled,
    rolloutState: moduleRow.rollout_state,
    hasView: hasAction("view"),
    hasRead: hasAction("read"),
    hasWrite: hasAction("write"),
    hasDecide: hasAction("decide"),
    hasAdmin: hasAction("admin"),
    readOnly: !moduleRow.actions_enabled,
    reason:
      moduleRow.actions_enabled
        ? `Access granted (${moduleRow.rollout_state})`
        : "Read-only pilot — mutations disabled at app_modules.actions_enabled=false",
  };

  return <>{children(ctx)}</>;
};

function renderDenied(
  title: string,
  message: string,
  Icon: React.ComponentType<{ className?: string }> = AlertTriangle,
) {
  return (
    <div className="mx-auto max-w-2xl py-16 px-4">
      <Alert variant="destructive">
        <Icon className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    </div>
  );
}
