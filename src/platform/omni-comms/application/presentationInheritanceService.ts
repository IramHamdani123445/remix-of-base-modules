/**
 * Omni-Comms — governed presentation inheritance service.
 *
 * The ONLY browser entry point for reading and changing which layout / shared
 * asset applies at organisation, module, department × module, module × event
 * or department × module × event scope.
 *
 * Boundaries:
 *   - no direct writes to core_template_layout or core_comm_assignment
 *   - no browser-side resolution authority (the database resolver decides)
 *   - every change is recorded in the presentation assignment history
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';
import type { AssignmentKind, OutputChannel } from './sharedAssetsTypes';
import type {
  PresentationHistoryEntry,
  ResolvedPresentation,
  ScopedAssignmentRow,
} from './presentationInheritanceTypes';
import { isValidScopeCombination } from '../domain/presentationScope';

export interface ScopeInput {
  moduleCode?: string | null;
  departmentId?: string | null;
  eventCode?: string | null;
}

function assertScope(scope: ScopeInput): void {
  if (
    !isValidScopeCombination({
      moduleCode: scope.moduleCode ?? null,
      departmentId: scope.departmentId ?? null,
      eventCode: scope.eventCode ?? null,
    })
  ) {
    throw new Error('An event-scoped override must also name its module.');
  }
}

/** Every configured assignment for a channel, at every scope. */
export const listScopedAssignments = (
  c: OmniCommsRpcClient,
  i: { organizationId: string; outputChannel: OutputChannel },
) =>
  callOmniCommsRpc<ScopedAssignmentRow[]>(c, 'omni_comms_assignment_list_scoped', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
  });

/** Effective layout + per-property asset resolution, with the source of each. */
export const resolvePresentationForContext = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    outputChannel: OutputChannel;
    moduleCode?: string | null;
    departmentId?: string | null;
    eventCode?: string | null;
    pinnedLayoutId?: string | null;
  },
) => {
  assertScope(i);
  return callOmniCommsRpc<ResolvedPresentation>(c, 'omni_comms_resolve_presentation', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_module_code: i.moduleCode ?? null,
    p_department_id: i.departmentId ?? null,
    p_event_code: i.eventCode ?? null,
    p_pinned_layout_id: i.pinnedLayoutId ?? null,
  });
};

/** Content + presentation manifest used identically by preview and production. */
export const resolveScopedRenderManifest = (
  c: OmniCommsRpcClient,
  i: {
    templateVersionId: string;
    organizationId: string;
    departmentId?: string | null;
    moduleCode?: string | null;
    eventCode?: string | null;
  },
) =>
  callOmniCommsRpc<Record<string, unknown>>(c, 'omni_comms_resolve_render_manifest_scoped', {
    p_template_version_id: i.templateVersionId,
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId ?? null,
    p_module_code: i.moduleCode ?? null,
    p_event_code: i.eventCode ?? null,
  });

/** Set (or replace) the layout used at a scope. */
export const setLayoutForScope = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    outputChannel: OutputChannel;
    layoutId: string;
  } & ScopeInput,
) => {
  assertScope(i);
  return callOmniCommsRpc<string>(c, 'omni_comms_assignment_upsert_scoped', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: 'layout_default' satisfies AssignmentKind,
    p_slot_code: null,
    p_module_code: i.moduleCode ?? null,
    p_department_id: i.departmentId ?? null,
    p_event_code: i.eventCode ?? null,
    p_layout_id: i.layoutId,
    p_asset_id: null,
  });
};

/** Set (or replace) the shared asset filling one slot at a scope. */
export const setAssetForScope = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    outputChannel: OutputChannel;
    slotCode: string;
    assetId: string;
  } & ScopeInput,
) => {
  assertScope(i);
  return callOmniCommsRpc<string>(c, 'omni_comms_assignment_upsert_scoped', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: 'asset_slot' satisfies AssignmentKind,
    p_slot_code: i.slotCode,
    p_module_code: i.moduleCode ?? null,
    p_department_id: i.departmentId ?? null,
    p_event_code: i.eventCode ?? null,
    p_layout_id: null,
    p_asset_id: i.assetId,
  });
};

/** Remove an override so the value inherits again. Organisation cannot reset. */
export const resetOverride = (
  c: OmniCommsRpcClient,
  i: {
    organizationId: string;
    outputChannel: OutputChannel;
    assignmentKind: AssignmentKind;
    slotCode?: string | null;
  } & ScopeInput,
) => {
  assertScope(i);
  if (!i.moduleCode && !i.departmentId && !i.eventCode) {
    throw new Error('The organisation default is the root value and cannot be reset.');
  }
  return callOmniCommsRpc<boolean>(c, 'omni_comms_assignment_reset_scoped', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_assignment_kind: i.assignmentKind,
    p_slot_code: i.slotCode ?? null,
    p_module_code: i.moduleCode ?? null,
    p_department_id: i.departmentId ?? null,
    p_event_code: i.eventCode ?? null,
  });
};

/** Change history for a channel's branding configuration. */
export const listPresentationHistory = (
  c: OmniCommsRpcClient,
  i: { organizationId: string; outputChannel: OutputChannel; limit?: number },
) =>
  callOmniCommsRpc<PresentationHistoryEntry[]>(c, 'omni_comms_assignment_history', {
    p_organization_id: i.organizationId,
    p_output_channel: i.outputChannel,
    p_limit: i.limit ?? 100,
  });
