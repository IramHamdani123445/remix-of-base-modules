/**
 * Omni-Comms Template Catalogue — TypeScript RPC contract types.
 * Mirrors the exact jsonb keys returned by the Story 2 RPCs. Types remain pure
 * declarations with no runtime imports of Supabase, React, or Legacy modules.
 */

export type TemplateFamilyStatus = 'draft' | 'active' | 'retired';
export type TemplateVersionStatus = 'draft' | 'approved' | 'published' | 'retired';
export type TemplateChannel = 'email' | 'sms' | 'in_app' | 'push' | 'whatsapp' | 'print';
export type TemplateScopeType = 'organization' | 'department' | 'event';

export const TEMPLATE_CHANNELS: readonly TemplateChannel[] = [
  'email', 'sms', 'in_app', 'push', 'whatsapp', 'print',
] as const;

/** Exact channel content schemas — mirrored by SQL validator. */
export const TEMPLATE_CHANNEL_KEYS: Record<TemplateChannel, {
  allowed: readonly string[];
  required: readonly string[];
  html: readonly string[];
}> = {
  email:    { allowed: ['subject','html','text','preheader'], required: ['subject'],       html: ['html'] },
  sms:      { allowed: ['body'],                             required: ['body'],           html: [] },
  in_app:   { allowed: ['title','body'],                     required: ['title','body'],   html: [] },
  push:     { allowed: ['title','body'],                     required: ['title','body'],   html: [] },
  whatsapp: { allowed: ['body'],                             required: ['body'],           html: [] },
  print:    { allowed: ['subject','html','text'],            required: ['subject'],        html: ['html'] },
};

// ─── DTOs returned by RPCs (exact key sets) ──────────────────────────────────

export interface TemplateFamilyCreateResult {
  id: string; code: string; name: string; description: string | null;
  scope_type: TemplateScopeType;
  organization_id: string; department_id: string | null; event_definition_id: string | null;
  status: TemplateFamilyStatus; created_at: string; updated_at: string;
}
export interface TemplateFamilyUpdateResult {
  id: string; code: string; name: string; description: string | null;
  status: TemplateFamilyStatus; updated_at: string;
}
export interface TemplateFamilyLifecycleResult {
  id: string; status: TemplateFamilyStatus;
  activated_at?: string | null; retired_at?: string | null;
}
export interface TemplateFamilyListItem {
  id: string; code: string; name: string; scope_type: TemplateScopeType;
  status: TemplateFamilyStatus; organization_id: string;
  department_id: string | null; event_definition_id: string | null;
  updated_at: string;
}
export interface TemplateFamilyListResult {
  items: TemplateFamilyListItem[]; total: number; limit: number; offset: number;
}
export interface TemplateFamilyGetResult {
  id: string; code: string; name: string; description: string | null;
  scope_type: TemplateScopeType; status: TemplateFamilyStatus;
  organization_id: string; department_id: string | null; event_definition_id: string | null;
  activated_at: string | null; retired_at: string | null; retirement_reason: string | null;
  created_at: string; updated_at: string;
}

export interface TemplateVersionCreateResult {
  id: string; template_family_id: string; version_number: number;
  channel: TemplateChannel; locale: string; status: TemplateVersionStatus;
  created_at: string; updated_at: string;
}
export interface TemplateVersionUpdateResult {
  id: string; status: TemplateVersionStatus; updated_at: string;
}
export interface TemplateVersionApproveResult {
  id: string; status: TemplateVersionStatus; checksum: string; approved_at: string;
}
export interface TemplateVersionPublishResult {
  id: string; status: TemplateVersionStatus; published_at: string;
  replaced_version_id: string | null;
}
export interface TemplateVersionRetireResult {
  id: string; status: TemplateVersionStatus; retired_at: string;
}
/**
 * Layout selection is persisted on the template VERSION and is required before
 * approval or publication. `null` means "not selected yet".
 */
export type TemplateLayoutSelectionMode = 'resolved_default' | 'pinned';

/** Layout-selection state returned by both the list and get RPCs. */
export interface TemplateVersionLayoutSelectionFields {
  layout_selection_mode: TemplateLayoutSelectionMode | null;
  layout_id: string | null;
  pinned_layout_version_id: string | null;
  /** Safe display metadata — nullable when nothing is selected. */
  layout_name?: string | null;
  layout_code?: string | null;
  pinned_layout_version_number?: number | null;
  layout_selection_valid?: boolean | null;
}

export interface TemplateVersionListItem extends TemplateVersionLayoutSelectionFields {
  id: string; template_family_id: string; version_number: number;
  channel: TemplateChannel; locale: string; status: TemplateVersionStatus;
  checksum: string | null;
  approved_at: string | null; published_at: string | null;
  retired_at: string | null; updated_at: string;
}
export interface TemplateVersionListResult {
  items: TemplateVersionListItem[]; total: number; limit: number; offset: number;
}
export interface TemplateVersionGetResult extends TemplateVersionLayoutSelectionFields {
  id: string; template_family_id: string; version_number: number;
  channel: TemplateChannel; locale: string; status: TemplateVersionStatus;
  checksum: string | null; content: Record<string, string>;
  approved_at: string | null; published_at: string | null;
  retired_at: string | null; retirement_reason: string | null;
  created_at: string; updated_at: string;
}
export interface TemplateResolveResult {
  template_family_id: string; family_code: string; scope_type: TemplateScopeType;
  template_version_id: string; version_number: number;
  channel: TemplateChannel; locale: string; checksum: string;
  content: Record<string, string>;
}
