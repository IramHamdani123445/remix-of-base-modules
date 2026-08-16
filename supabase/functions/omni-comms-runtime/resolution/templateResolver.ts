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
      return build(family.id, layer.scope, forLocale[0]);
    }

    // Deterministic language-level fallback: a language-only candidate (e.g.
    // `en`) may be served by a regional published version (e.g. `en-US`) only
    // when EXACTLY one regional variant of that language exists. Anything
    // ambiguous stays unresolved rather than picking arbitrarily.
    for (const loc of localeFallbacks) {
      if (loc.includes("-")) continue;
      const prefix = `${loc}-`;
      const sameLanguage = versions.filter((v) =>
        typeof v.locale === "string" && v.locale.toLowerCase().startsWith(prefix.toLowerCase())
      );
      if (sameLanguage.length === 0) continue;
      if (sameLanguage.length > 1) return unresolved("template_ambiguous", layer.scope, family.id);
      return build(family.id, layer.scope, sameLanguage[0]);
    }
  }
  return null;
}

function build(
  familyId: string,
  scope: ResolvedTemplate["familyScope"],
  v: {
    id: string;
    version_number: number;
    checksum: string;
    layout_selection_mode: string | null;
    layout_id: string | null;
    pinned_layout_version_id: string | null;
  },
): ResolvedTemplate {
  return {
    familyId,
    familyScope: scope,
    versionId: v.id,
    versionNumber: v.version_number,
    checksum: v.checksum,
    layoutSelectionMode: v.layout_selection_mode,
    layoutId: v.layout_id,
    pinnedLayoutVersionId: v.pinned_layout_version_id,
    blockers: [],
  };
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

/**
 * Communication Action template binding.
 *
 * Resolves the published version of an EXPLICIT template family for an EXACT
 * channel. This is the authoritative content binding when the Communication
 * Action model applies: the Action decides the semantic leg and its
 * channel-specific family, and the transport route may never substitute it.
 *
 * Returns null when the family has no published version for THAT channel —
 * the caller then fails the leg closed with `variant_missing`. Content is
 * never derived from another channel's variant.
 */
export function resolveTemplateForFamilyChannel(
  snap: AggregateSnapshot,
  familyId: string,
  channel: string,
  organizationId: string,
  departmentId: string | null,
  localeFallbacks: string[],
): ResolvedTemplate | null {
  const family = snap.template_families.find(
    (f) =>
      f.id === familyId &&
      f.status === "active" &&
      f.organization_id === organizationId &&
      (f.department_id === null || f.department_id === departmentId),
  );
  if (!family) return null;

  const versions = snap.template_versions.filter(
    (v) =>
      v.template_family_id === family.id &&
      v.status === "published" &&
      v.channel === channel,
  );
  if (versions.length === 0) return null;

  for (const loc of localeFallbacks) {
    const forLocale = versions.filter((v) => v.locale === loc);
    if (forLocale.length === 1) return build(family.id, "route_pinned", forLocale[0]);
    if (forLocale.length > 1) return null;
  }
  for (const loc of localeFallbacks) {
    if (loc.includes("-")) continue;
    const sameLanguage = versions.filter(
      (v) => typeof v.locale === "string" && v.locale.startsWith(`${loc}-`),
    );
    if (sameLanguage.length === 1) return build(family.id, "route_pinned", sameLanguage[0]);
    if (sameLanguage.length > 1) return null;
  }
  return null;
}
