/**
 * Accelerated Build 1 — Shared Communication Assets types.
 *
 * These describe the return shape of the 12 authorised RPCs added for
 * shared assets, layout versions, assignments, template layout selection,
 * render manifest resolution, and pilot migration.
 */
export type AssetType =
  | 'logo'
  | 'media'
  | 'email_header'
  | 'email_footer'
  | 'email_signature'
  | 'disclaimer'
  | 'print_letterhead'
  | 'print_footer'
  | 'address_block'
  | 'text_block';

export type AssignmentKind = 'layout_default' | 'asset_slot';
export type OutputChannel = 'email' | 'sms' | 'whatsapp' | 'print' | 'in_app' | 'push';
export type LayoutSelectionMode = 'resolved_default' | 'pinned';
export type InheritanceSource = 'department' | 'organization' | 'pinned' | 'unresolved' | null;

export interface CommAssetSummary {
  id: string;
  code: string;
  name: string;
  asset_type: AssetType;
  department_id: string | null;
  active_version_id: string | null;
  updated_at: string;
}

export interface CommAssetVersion {
  id: string;
  asset_id: string;
  version_number: number;
  content_html: string | null;
  content_text: string | null;
  checksum: string;
  status: 'published' | 'retired';
  published_at: string;
}

export interface CommAssignmentRow {
  id: string;
  organization_id: string;
  department_id: string | null;
  output_channel: OutputChannel;
  assignment_kind: AssignmentKind;
  slot_code: string | null;
  layout_id: string | null;
  asset_id: string | null;
  updated_at: string;
}

export interface LayoutSlot {
  code: string;
  order: number;
  required?: boolean;
  allowed_asset_types?: AssetType[];
  wrapper?: string;
  fallback_policy?: string;
}

export interface ResolvedAsset {
  slot: string;
  asset_id: string | null;
  asset_version_id: string | null;
  asset_type: AssetType | null;
  inheritance_source: InheritanceSource;
  content_html?: string | null;
  content_text?: string | null;
  checksum?: string;
}

export interface RenderManifest {
  template_family_id: string;
  template_version_id: string;
  template_content: Record<string, string>;
  template_channel: string;
  template_locale: string;
  layout_id: string | null;
  layout_version_id: string | null;
  layout_inheritance_source: 'department' | 'organization' | 'pinned' | null;
  layout_slots: LayoutSlot[] | null;
  resolved_assets: ResolvedAsset[];
}

export interface PilotDryRunReport {
  organization_id: string;
  department_id: string;
  sources: Record<string, unknown>;
  destination_codes: Record<string, string>;
  ambiguity: 'none' | 'source_missing';
  storage_bucket_check: boolean;
  dry_run: true;
}

export interface PilotApplyReport {
  ok: true;
  organization_id: string;
  department_id: string;
  assets: Record<string, string | null>;
  versions: Record<string, string | null>;
  layout_version_id: string;
}
