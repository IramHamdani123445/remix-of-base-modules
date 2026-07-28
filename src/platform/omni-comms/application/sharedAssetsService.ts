/**
 * Accelerated Build 1 — typed adapter for the 12 shared-asset RPCs.
 *
 * Consumers must obtain an OmniCommsRpcClient via useOmniCommsRpcClient()
 * (bound to the browser Supabase client) and never call `.from(...)` for
 * shared or Legacy asset tables.
 */
import {
  OmniCommsRpcClient,
  callOmniCommsRpc,
} from './omniCommsRpcErrors';
import type {
  CommAssetSummary,
  CommAssignmentRow,
  AssignmentKind,
  OutputChannel,
  LayoutSelectionMode,
  RenderManifest,
  PilotDryRunReport,
  PilotApplyReport,
} from './sharedAssetsTypes';

// 1. list active assets
export const listActiveCommAssets = (
  c: OmniCommsRpcClient,
  i: { organizationId: string; assetType?: string | null },
) =>
  callOmniCommsRpc<CommAssetSummary[]>(c, 'core_comm_asset_list_active', {
    p_organization_id: i.organizationId,
    p_asset_type: i.assetType ?? null,
  });

// 2. get single asset
export const getCommAsset = (c: OmniCommsRpcClient, i: { id: string }) =>
  callOmniCommsRpc<{ asset: unknown; active_version: unknown }>(c, 'core_comm_asset_get', {
    p_id: i.id,
  });

// 3. list active layouts
export const listActiveLayouts = (
  c: OmniCommsRpcClient,
  i: { layoutKind?: string | null } = {},
) =>
  callOmniCommsRpc<Array<{ id: string; code: string | null; name: string; layout_kind: string | null }>>(
    c,
    'core_template_layout_list_active',
    { p_layout_kind: i.layoutKind ?? null },
  );

// 4. get layout version
export const getLayoutVersion = (c: OmniCommsRpcClient, i: { id: string }) =>
  callOmniCommsRpc<unknown>(c, 'core_template_layout_version_get', { p_id: i.id });

// 5. list assignments
export const listAssignments = (
  c: OmniCommsRpcClient,
  i: { organizationId: string; departmentId?: string | null; outputChannel?: OutputChannel },
) =>
  callOmniCommsRpc<CommAssignmentRow[]>(c, 'core_comm_assignment_list', {
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId ?? null,
    p_output_channel: i.outputChannel ?? 'email',
  });

// 6. upsert org default
export const upsertOrgDefaultAssignment = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    outputChannel: OutputChannel;
    assignmentKind: AssignmentKind;
    slotCode?: string | null;
    layoutId?: string | null;
    assetId?: string | null;
  },
) =>
  callOmniCommsRpc<string>(c, 'core_comm_assignment_upsert_org_default', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: i.assignmentKind,
    p_slot_code: i.slotCode ?? null,
    p_layout_id: i.layoutId ?? null,
    p_asset_id: i.assetId ?? null,
  });

// 7. upsert dept override
export const upsertDepartmentOverrideAssignment = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    departmentId: string;
    outputChannel: OutputChannel;
    assignmentKind: AssignmentKind;
    slotCode?: string | null;
    layoutId?: string | null;
    assetId?: string | null;
  },
) =>
  callOmniCommsRpc<string>(c, 'core_comm_assignment_upsert_dept_override', {
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: i.assignmentKind,
    p_slot_code: i.slotCode ?? null,
    p_layout_id: i.layoutId ?? null,
    p_asset_id: i.assetId ?? null,
  });

// 8. reset dept override
export const resetDepartmentOverrideAssignment = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    departmentId: string;
    outputChannel: OutputChannel;
    assignmentKind: AssignmentKind;
    slotCode?: string | null;
  },
) =>
  callOmniCommsRpc<boolean>(c, 'core_comm_assignment_reset_dept_override', {
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: i.assignmentKind,
    p_slot_code: i.slotCode ?? null,
  });

// 9. set layout selection on template version draft
export const setTemplateVersionLayoutSelection = (
  c: OmniCommsRpcClient,
  i: {
    versionId: string;
    mode: LayoutSelectionMode;
    layoutId: string | null;
    pinnedLayoutVersionId?: string | null;
    expectedUpdatedAt: string;
  },
) =>
  callOmniCommsRpc<{ id: string; ok: true }>(c, 'omni_comms_template_version_set_layout_selection', {
    p_version_id: i.versionId,
    p_mode: i.mode,
    p_layout_id: i.layoutId,
    p_pinned_layout_version_id: i.pinnedLayoutVersionId ?? null,
    p_expected_updated_at: i.expectedUpdatedAt,
  });

// 10. resolve render manifest
export const resolveRenderManifest = (
  c: OmniCommsRpcClient,
  i: { templateVersionId: string; organizationId: string; departmentId?: string | null },
) =>
  callOmniCommsRpc<RenderManifest>(c, 'omni_comms_resolve_render_manifest', {
    p_template_version_id: i.templateVersionId,
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId ?? null,
  });

// 11. pilot dry-run
export const pilotMigrationDryRun = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    departmentId: string;
    letterheadId: string;
    signatureId: string;
    footerId: string;
    deptSignatureId?: string | null;
    emailLayoutId: string;
  },
) =>
  callOmniCommsRpc<PilotDryRunReport>(c, 'core_comm_pilot_migration_dry_run', {
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId,
    p_letterhead_id: i.letterheadId,
    p_signature_id: i.signatureId,
    p_footer_id: i.footerId,
    p_dept_signature_id: i.deptSignatureId ?? null,
    p_email_layout_id: i.emailLayoutId,
  });

// 12. pilot apply
export const pilotMigrationApply = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    departmentId: string;
    letterheadId: string;
    signatureId: string;
    footerId: string;
    deptSignatureId?: string | null;
    emailLayoutId: string;
  },
) =>
  callOmniCommsRpc<PilotApplyReport>(c, 'core_comm_pilot_migration_apply', {
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId,
    p_letterhead_id: i.letterheadId,
    p_signature_id: i.signatureId,
    p_footer_id: i.footerId,
    p_dept_signature_id: i.deptSignatureId ?? null,
    p_email_layout_id: i.emailLayoutId,
  });

export const SHARED_ASSETS_RPC_NAMES = [
  'core_comm_asset_list_active',
  'core_comm_asset_get',
  'core_template_layout_list_active',
  'core_template_layout_version_get',
  'core_comm_assignment_list',
  'core_comm_assignment_upsert_org_default',
  'core_comm_assignment_upsert_dept_override',
  'core_comm_assignment_reset_dept_override',
  'omni_comms_template_version_set_layout_selection',
  'omni_comms_resolve_render_manifest',
  'core_comm_pilot_migration_dry_run',
  'core_comm_pilot_migration_apply',
] as const;
