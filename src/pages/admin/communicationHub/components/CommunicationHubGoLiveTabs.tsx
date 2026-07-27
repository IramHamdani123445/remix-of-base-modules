/**
 * Communication Hub — Operations / Readiness / Revalidation / Audit tab bar.
 *
 * Rendered at the top of each of the four workspaces so operators can move
 * between operations and diagnostics without leaving the runtime-contract
 * provider tree. Presentation only — no data fetch.
 */
import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/admin/communication-hub/go-live", label: "Operations", testId: "chub-tab-operations" },
  { to: "/admin/communication-hub/readiness", label: "Readiness", testId: "chub-tab-readiness" },
  { to: "/admin/communication-hub/revalidation", label: "Revalidation", testId: "chub-tab-revalidation" },
  { to: "/admin/communication-hub/audit", label: "Audit & Evidence", testId: "chub-tab-audit" },
] as const;

export function CommunicationHubGoLiveTabs() {
  return (
    <nav
      aria-label="Communication Hub Go-Live workspaces"
      data-testid="chub-golive-tabs"
      className="flex items-center gap-1 border-b"
    >
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end
          data-testid={t.testId}
          className={({ isActive }) =>
            [
              "px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
              isActive
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            ].join(" ")
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}

export default CommunicationHubGoLiveTabs;
