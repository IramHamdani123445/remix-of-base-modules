/**
 * Omni-Comms — presentation inheritance (Branding & Layouts) types.
 *
 * Presentation is deliberately separate from CONTENT (message templates) and
 * from the SHARED ASSETS themselves. This module only describes *which*
 * layout / asset applies at a scope, never what the communication says.
 */
import type {
  PresentationScopeLevel,
  PresentationSource,
} from '../domain/presentationScope';
import type { OutputChannel, AssignmentKind, LayoutSlot } from './sharedAssetsTypes';

export type { PresentationScopeLevel, PresentationSource };

export interface ScopedAssignmentRow {
  id: string;
  organization_id: string;
  output_channel: OutputChannel;
  assignment_kind: AssignmentKind;
  slot_code: string | null;
  module_code: string | null;
  department_id: string | null;
  event_code: string | null;
  layout_id: string | null;
  asset_id: string | null;
  scope_level: PresentationScopeLevel;
  scope_rank: number;
  updated_at: string;
}

export interface ResolvedPresentationAsset {
  slot: string;
  asset_id: string | null;
  asset_version_id: string | null;
  asset_type: string | null;
  /** Scope the asset was inherited from — per-property, independent of layout. */
  source_scope: PresentationSource;
  inheritance_source: PresentationSource;
  content_html?: string | null;
  content_text?: string | null;
  checksum?: string;
}

export interface PresentationTraceEntry {
  property: string;
  value_id: string | null;
  source_scope: PresentationSource;
}

export interface ResolvedPresentation {
  resolver_version: string;
  organization_id: string;
  module_code: string | null;
  department_id: string | null;
  event_code: string | null;
  output_channel: OutputChannel;
  layout_id: string | null;
  layout_version_id: string | null;
  layout_inheritance_source: PresentationSource;
  layout_slots: LayoutSlot[] | null;
  resolved_assets: ResolvedPresentationAsset[];
  trace: PresentationTraceEntry[];
}

export interface PresentationHistoryEntry {
  id: string;
  assignment_kind: AssignmentKind;
  slot_code: string | null;
  module_code: string | null;
  department_id: string | null;
  event_code: string | null;
  scope_level: PresentationScopeLevel;
  action: 'created' | 'updated' | 'reset';
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}
