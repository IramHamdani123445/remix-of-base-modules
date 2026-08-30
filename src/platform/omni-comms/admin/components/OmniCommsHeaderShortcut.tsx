/**
 * OmniCommsHeaderShortcut — application-header entry point to Omnichannel
 * Communications.
 *
 * Presentation only. It reuses the SAME authorization signals as
 * `OmniCommsAdminRoute` (`useIsAdmin` + the `omni_comms.view` module action),
 * so the icon is never shown to a user who would be refused at the route.
 *
 * It deliberately shows an "attention" indicator only — never a message count
 * — because message counts belong to the in-app notification bell, which is a
 * separate concern with a separate badge.
 */
import React from "react";
import { useNavigate } from "react-router-dom";
import { Radio } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";
import { useIsAdmin, useModulePermissions } from "@/hooks/useNavigationMenu";

const OPERATIONS_ROUTE = "/admin/omnichannel-communications/operations";

/**
 * Bounded attention probe: held / blocked / failed work needing an operator
 * decision. Resolves the caller's own organisation through the same
 * RLS-scoped source the module shell uses, so no extra privilege is implied.
 */
async function fetchAttentionCount(): Promise<number> {
  const { data: orgs, error: orgError } = await supabase
    .from("core_organization")
    .select("id, status")
    .order("legal_name", { ascending: true })
    .limit(5);
  if (orgError || !orgs?.length) return 0;
  const organizationId =
    orgs.find((o) => (o.status ?? "active").toLowerCase() !== "archived")?.id ??
    null;
  if (!organizationId) return 0;

  const { data, error } = await supabase.rpc("omni_comms_ops_summary", {
    p_organization_id: organizationId,
    p_department_id: null,
    p_since_hours: 720,
  });
  if (error) return 0;
  const summary = (data ?? null) as Record<string, unknown> | null;
  if (!summary) return 0;
  const numeric = (key: string): number => {
    const value = summary[key];
    const parsed = typeof value === "string" ? Number(value) : value;
    return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
  };
  return (
    numeric("blocked_requests") +
    numeric("failed_requests") +
    numeric("held_jobs")
  );
}


export const OmniCommsHeaderShortcut: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAuthReady } = useSupabaseAuth();
  const isAdmin = useIsAdmin();
  const omniComms = useModulePermissions("omni_comms");

  const allowed =
    isAuthReady && isAuthenticated && (isAdmin || omniComms.hasPermission("view"));

  const { data: attentionCount = 0 } = useQuery({
    queryKey: ["omni-comms-header-attention"],
    queryFn: fetchAttentionCount,
    enabled: allowed,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  if (!allowed) return null;

  const label =
    attentionCount > 0
      ? `Omnichannel Communications — ${attentionCount} item(s) need attention`
      : "Omnichannel Communications";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      data-testid="omni-comms-header-shortcut"
      onClick={() => navigate(OPERATIONS_ROUTE)}
      className="relative text-muted-foreground hover:text-foreground"
    >
      <Radio className="h-5 w-5" />
      {attentionCount > 0 && (
        <Badge
          className="absolute -top-1 -right-1 h-5 min-w-[20px] flex items-center justify-center p-0 px-1 text-[10px] bg-destructive text-destructive-foreground"
          data-testid="omni-comms-header-attention-badge"
        >
          {attentionCount > 9 ? "9+" : attentionCount}
        </Badge>
      )}
    </Button>
  );
};

export default OmniCommsHeaderShortcut;
