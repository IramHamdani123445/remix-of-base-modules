/**
 * Omni-Comms — Template layout selection presentation and gating helpers.
 *
 * Pure functions only: no React, no Supabase, no runtime imports. The server
 * remains the final authority — these helpers exist so the administration UI
 * can present the persisted layout state honestly and disable approval BEFORE
 * an unavoidable `layout_selection_required` failure is provoked.
 */
import type {
  TemplateVersionLayoutSelectionFields,
  TemplateLayoutSelectionMode,
} from './templateCatalogueTypes';

export type LayoutSelectionDisplayKind =
  | 'not_selected'
  | 'resolved_default'
  | 'pinned'
  | 'invalid';

export interface LayoutSelectionDisplay {
  kind: LayoutSelectionDisplayKind;
  /** Human label rendered in the Versions table Layout column. */
  label: string;
}

const layoutLabel = (v: TemplateVersionLayoutSelectionFields): string =>
  v.layout_name ?? v.layout_code ?? v.layout_id ?? 'unknown layout';

/** Describe the persisted layout selection of a template version. */
export function describeLayoutSelection(
  v: TemplateVersionLayoutSelectionFields,
): LayoutSelectionDisplay {
  if (v.layout_selection_mode == null || v.layout_id == null) {
    return { kind: 'not_selected', label: 'Not selected' };
  }
  if (v.layout_selection_valid === false) {
    return { kind: 'invalid', label: 'Invalid selection' };
  }
  if (v.layout_selection_mode === 'pinned') {
    if (v.pinned_layout_version_id == null) {
      return { kind: 'invalid', label: 'Invalid selection' };
    }
    const n = v.pinned_layout_version_number;
    return {
      kind: 'pinned',
      label: `Pinned · ${layoutLabel(v)}${n != null ? ` · v${n}` : ''}`,
    };
  }
  return {
    kind: 'resolved_default',
    label: `Resolved default · ${layoutLabel(v)}`,
  };
}

/**
 * True when the layout selection is complete enough for approval.
 * Mirrors — never replaces — the database guard.
 */
export function isLayoutSelectionApprovable(
  v: TemplateVersionLayoutSelectionFields,
): boolean {
  const d = describeLayoutSelection(v);
  return d.kind === 'resolved_default' || d.kind === 'pinned';
}

export const LAYOUT_REQUIRED_BADGE = 'Layout required';

export const LAYOUT_REQUIRED_MESSAGE =
  'Layout selection is required before this version can be approved.';

/**
 * Controlled messages for layout-related server details. Never expose
 * SQLSTATE, trigger names, constraint names or function bodies.
 */
export const LAYOUT_ERROR_MESSAGES: Record<string, string> = {
  layout_selection_required:
    'Select and save a layout before approving this template version.',
  layout_required: 'Select a layout before saving.',
  layout_not_found: 'The selected layout no longer exists. Choose another layout.',
  layout_not_active: 'The selected layout is not active. Choose an active layout.',
  layout_version_required:
    'Pinned mode requires a published layout version. Select one.',
  layout_version_not_found:
    'The selected layout version no longer exists. Select another published version.',
  layout_version_not_published:
    'Only published layout versions can be pinned. Select a published version.',
  layout_version_mismatch:
    'The selected layout version does not belong to the selected layout.',
  pinned_version_layout_mismatch:
    'The selected layout version does not belong to the selected layout.',
  pinned_requires_layout_and_version:
    'Pinned mode requires both a layout and a published layout version.',
  layout_channel_mismatch:
    'The selected layout is not compatible with this template channel.',
  layout_selection_locked_after_draft:
    'Layout selection can only be changed while the version is a draft.',
  stale_template_version:
    'This draft was updated by someone else. Reload the version and try again.',
  updated_at_mismatch:
    'This draft was updated by someone else. Reload the version and try again.',
};

/** Map a server DETAIL to a controlled message, or null when not layout-related. */
export function mapLayoutErrorDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return LAYOUT_ERROR_MESSAGES[detail] ?? null;
}

export const LAYOUT_SELECTION_MODES: readonly TemplateLayoutSelectionMode[] = [
  'resolved_default',
  'pinned',
] as const;

export const LAYOUT_MODE_EXPLANATION: Record<TemplateLayoutSelectionMode, string> = {
  resolved_default:
    'The layout identity is fixed on the template version, while the applicable published layout version is resolved according to the authorised default rules.',
  pinned:
    'A specific published layout version is pinned to this template version and stays available for historical rendering.',
};

/** Layout kinds accepted for a template channel (matches the SQL helper). */
export function layoutKindsForChannel(channel: string): string[] {
  const c = channel.toUpperCase();
  if (c === 'PRINT') {
    return ['PRINT', 'LETTER', 'LETTERHEAD', 'NOTICE', 'STATEMENT', 'CERTIFICATE', 'REPORT', 'RECEIPT'];
  }
  return [c];
}

export function isLayoutKindCompatible(
  layoutKind: string | null | undefined,
  channel: string,
): boolean {
  if (layoutKind == null) return true;
  return layoutKindsForChannel(channel).includes(layoutKind.toUpperCase());
}
