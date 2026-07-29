// Layout resolution using the canonical shared surface.
import type { AggregateSnapshot } from "./resolutionTypes.ts";
import type { ResolvedTemplate } from "./templateResolver.ts";

export interface ResolvedLayout {
  layoutId: string;
  layoutVersionId: string;
  checksum: string;
  slots: unknown;
  wrapperHtml: string | null;
  inheritance: "pinned" | "department" | "organization";
  blockers: string[];
}

export function resolveLayoutForTemplate(
  snap: AggregateSnapshot,
  template: ResolvedTemplate,
  channel: string,
  organizationId: string,
  departmentId: string | null,
): ResolvedLayout | null {
  // Pinned mode: template_version carries layout_id + pinned_layout_version_id.
  if (template.layoutSelectionMode === "pinned") {
    if (!template.layoutId || !template.pinnedLayoutVersionId) {
      return unresolved("layout_pinned_mismatch", "pinned");
    }
    const layout = snap.layouts.find((l) => l.id === template.layoutId && l.is_active);
    if (!layout) return unresolved("layout_unresolved", "pinned");
    const version = snap.layout_versions.find(
      (v) => v.id === template.pinnedLayoutVersionId && v.layout_id === template.layoutId,
    );
    if (!version) return unresolved("layout_version_unresolved", "pinned");
    if (version.status !== "published") return unresolved("layout_version_unresolved", "pinned");
    return {
      layoutId: layout.id,
      layoutVersionId: version.id,
      checksum: version.checksum,
      slots: version.slots,
      wrapperHtml: version.wrapper_html,
      inheritance: "pinned",
      blockers: [],
    };
  }

  // Resolved-default: department default → org default.
  const assignments = snap.layout_assignments.filter(
    (a) =>
      a.organization_id === organizationId &&
      (a.output_channel === null || a.output_channel === channel),
  );
  const deptAssign = assignments.find((a) => a.department_id === departmentId && departmentId !== null);
  const orgAssign = assignments.find((a) => a.department_id === null);
  const winner = deptAssign ?? orgAssign;
  if (!winner) return unresolved("layout_unresolved", "organization");

  const layout = snap.layouts.find((l) => l.id === winner.layout_id && l.is_active);
  if (!layout) return unresolved("layout_unresolved", deptAssign ? "department" : "organization");
  // pick the latest published version for the layout deterministically by version_number desc, id asc.
  const versions = snap.layout_versions
    .filter((v) => v.layout_id === layout.id && v.status === "published")
    .sort((a, b) => (b.version_number - a.version_number) || (a.id < b.id ? -1 : 1));
  if (versions.length === 0) {
    return unresolved("layout_version_unresolved", deptAssign ? "department" : "organization");
  }
  const version = versions[0];
  return {
    layoutId: layout.id,
    layoutVersionId: version.id,
    checksum: version.checksum,
    slots: version.slots,
    wrapperHtml: version.wrapper_html,
    inheritance: deptAssign ? "department" : "organization",
    blockers: [],
  };
}

function unresolved(
  code: string,
  inheritance: ResolvedLayout["inheritance"],
): ResolvedLayout {
  return {
    layoutId: "",
    layoutVersionId: "",
    checksum: "",
    slots: null,
    wrapperHtml: null,
    inheritance,
    blockers: [code],
  };
}
