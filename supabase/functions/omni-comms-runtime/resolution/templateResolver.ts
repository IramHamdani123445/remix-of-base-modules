// Template family + version resolution.
// Precedence: route-pinned → event-scoped → department-scoped → organization-scoped.
import type { AggregateSnapshot } from "./resolutionTypes.ts";
import type { WinningRoute } from "./routeResolver.ts";

export interface ResolvedTemplate {
  familyId: string;
  familyScope: "route_pinned" | "event" | "department" | "organization";
  versionId: string;
  versionNumber: number;
  checksum: string;
  layoutSelectionMode: string | null;
  layoutId: string | null;
  pinnedLayoutVersionId: string | null;
  blockers: string[];
}

export function resolveTemplateForRoute(
  snap: AggregateSnapshot,
  route: WinningRoute,
  eventDefinitionId: string,
  organizationId: string,
  departmentId: string | null,
  localeFallbacks: string[],
): ResolvedTemplate | null {
  const activeFamilies = snap.template_families.filter(
    (f) =>
      f.status === "active" &&
      f.organization_id === organizationId &&
      (f.department_id === null || f.department_id === departmentId),
  );

  const routePinned = route.templateFamilyId
    ? activeFamilies.find((f) => f.id === route.templateFamilyId)
    : undefined;
  const eventScoped = activeFamilies.filter(
    (f) => f.event_definition_id === eventDefinitionId,
  );
  const deptScoped = activeFamilies.filter(
    (f) =>
      !f.event_definition_id &&
      f.department_id === departmentId &&
      departmentId !== null,
  );
  const orgScoped = activeFamilies.filter(
    (f) => !f.event_definition_id && f.department_id === null,
  );

  const ordered: Array<{
    scope: ResolvedTemplate["familyScope"];
    candidates: typeof activeFamilies;
  }> = [
    { scope: "route_pinned", candidates: routePinned ? [routePinned] : [] },
    { scope: "event", candidates: eventScoped },
    { scope: "department", candidates: deptScoped },
    { scope: "organization", candidates: orgScoped },
  ];

  for (const layer of ordered) {
    if (layer.candidates.length === 0) continue;
    if (layer.candidates.length > 1) return unresolved("template_ambiguous", layer.scope);
    const family = layer.candidates[0];
    // Pick a published version for the route.channel and best locale.
    const versions = snap.template_versions.filter(
      (v) => v.template_family_id === family.id && v.status === "published" &&
        v.channel === route.channel,
    );
    if (versions.length === 0) continue;

    for (const loc of localeFallbacks) {
      const forLocale = versions.filter((v) => v.locale === loc);
      if (forLocale.length === 0) continue;
      if (forLocale.length > 1) return unresolved("template_ambiguous", layer.scope, family.id);
      const v = forLocale[0];
      return {
        familyId: family.id,
        familyScope: layer.scope,
        versionId: v.id,
        versionNumber: v.version_number,
        checksum: v.checksum,
        layoutSelectionMode: v.layout_selection_mode,
        layoutId: v.layout_id,
        pinnedLayoutVersionId: v.pinned_layout_version_id,
        blockers: [],
      };
    }
  }
  return null;
}

function unresolved(
  code: string,
  scope: ResolvedTemplate["familyScope"],
  familyId?: string,
): ResolvedTemplate {
  return {
    familyId: familyId ?? "",
    familyScope: scope,
    versionId: "",
    versionNumber: 0,
    checksum: "",
    layoutSelectionMode: null,
    layoutId: null,
    pinnedLayoutVersionId: null,
    blockers: [code],
  };
}
