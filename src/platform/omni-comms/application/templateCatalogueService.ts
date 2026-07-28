/**
 * Omni-Comms Template Catalogue — typed RPC adapter.
 * Wraps the 14 SECURITY DEFINER RPCs. Depends only on the neutral shared
 * error module (omniCommsRpcErrors) and on Template Catalogue types.
 */
import {
  OmniCommsRpcClient,
  callOmniCommsRpc,
} from './omniCommsRpcErrors';
import {
  TemplateChannel,
  TemplateFamilyCreateResult,
  TemplateFamilyGetResult,
  TemplateFamilyLifecycleResult,
  TemplateFamilyListResult,
  TemplateFamilyStatus,
  TemplateFamilyUpdateResult,
  TemplateResolveResult,
  TemplateScopeType,
  TemplateVersionApproveResult,
  TemplateVersionCreateResult,
  TemplateVersionGetResult,
  TemplateVersionListResult,
  TemplateVersionPublishResult,
  TemplateVersionRetireResult,
  TemplateVersionStatus,
  TemplateVersionUpdateResult,
} from './templateCatalogueTypes';

// ─── Family ─────────────────────────────────────────────────────────────────

export interface CreateTemplateFamilyInput {
  code: string; name: string; description?: string | null;
  scopeType: TemplateScopeType;
  organizationId: string;
  departmentId?: string | null;
  eventDefinitionId?: string | null;
  correlationId?: string | null;
}
export const createTemplateFamily = (c: OmniCommsRpcClient, i: CreateTemplateFamilyInput) =>
  callOmniCommsRpc<TemplateFamilyCreateResult>(c, 'omni_comms_template_family_create', {
    p_code: i.code, p_name: i.name, p_description: i.description ?? null,
    p_scope_type: i.scopeType,
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId ?? null,
    p_event_definition_id: i.eventDefinitionId ?? null,
    p_correlation_id: i.correlationId ?? null,
  });

export interface UpdateTemplateFamilyInput {
  id: string; name?: string; description?: string | null;
  expectedUpdatedAt: string; correlationId?: string | null;
}
export const updateTemplateFamily = (c: OmniCommsRpcClient, i: UpdateTemplateFamilyInput) =>
  callOmniCommsRpc<TemplateFamilyUpdateResult>(c, 'omni_comms_template_family_update', {
    p_id: i.id, p_name: i.name ?? null, p_description: i.description ?? null,
    p_expected_updated_at: i.expectedUpdatedAt,
    p_correlation_id: i.correlationId ?? null,
  });

export const activateTemplateFamily = (
  c: OmniCommsRpcClient, i: { id: string; reason?: string | null; correlationId?: string | null },
) => callOmniCommsRpc<TemplateFamilyLifecycleResult>(c, 'omni_comms_template_family_activate', {
  p_id: i.id, p_reason: i.reason ?? null, p_correlation_id: i.correlationId ?? null,
});

export const retireTemplateFamily = (
  c: OmniCommsRpcClient, i: { id: string; reason: string; correlationId?: string | null },
) => callOmniCommsRpc<TemplateFamilyLifecycleResult>(c, 'omni_comms_template_family_retire', {
  p_id: i.id, p_reason: i.reason, p_correlation_id: i.correlationId ?? null,
});

export interface ListTemplateFamiliesInput {
  search?: string | null; status?: TemplateFamilyStatus | null;
  scopeType?: TemplateScopeType | null; organizationId?: string | null;
  limit?: number; offset?: number;
}
export const listTemplateFamilies = (c: OmniCommsRpcClient, i: ListTemplateFamiliesInput = {}) =>
  callOmniCommsRpc<TemplateFamilyListResult>(c, 'omni_comms_template_family_list', {
    p_search: i.search ?? null, p_status: i.status ?? null,
    p_scope_type: i.scopeType ?? null, p_organization_id: i.organizationId ?? null,
    p_limit: i.limit ?? 50, p_offset: i.offset ?? 0,
  });

export const getTemplateFamily = (c: OmniCommsRpcClient, id: string) =>
  callOmniCommsRpc<TemplateFamilyGetResult>(c, 'omni_comms_template_family_get', { p_id: id });

// ─── Version ────────────────────────────────────────────────────────────────

export interface CreateTemplateVersionInput {
  templateFamilyId: string; channel: TemplateChannel; locale: string;
  versionNumber: number; content: Record<string, string>;
  correlationId?: string | null;
}
export const createTemplateVersion = (c: OmniCommsRpcClient, i: CreateTemplateVersionInput) =>
  callOmniCommsRpc<TemplateVersionCreateResult>(c, 'omni_comms_template_version_create', {
    p_template_family_id: i.templateFamilyId, p_channel: i.channel, p_locale: i.locale,
    p_version_number: i.versionNumber, p_content: i.content,
    p_correlation_id: i.correlationId ?? null,
  });

export const updateTemplateVersion = (
  c: OmniCommsRpcClient,
  i: { id: string; content: Record<string, string>; expectedUpdatedAt: string; correlationId?: string | null },
) => callOmniCommsRpc<TemplateVersionUpdateResult>(c, 'omni_comms_template_version_update', {
  p_id: i.id, p_content: i.content,
  p_expected_updated_at: i.expectedUpdatedAt,
  p_correlation_id: i.correlationId ?? null,
});

export const approveTemplateVersion = (
  c: OmniCommsRpcClient, i: { id: string; approvalNote?: string | null; correlationId?: string | null },
) => callOmniCommsRpc<TemplateVersionApproveResult>(c, 'omni_comms_template_version_approve', {
  p_id: i.id, p_approval_note: i.approvalNote ?? null,
  p_correlation_id: i.correlationId ?? null,
});

export const publishTemplateVersion = (
  c: OmniCommsRpcClient, i: { id: string; reason?: string | null; correlationId?: string | null },
) => callOmniCommsRpc<TemplateVersionPublishResult>(c, 'omni_comms_template_version_publish', {
  p_id: i.id, p_reason: i.reason ?? null, p_correlation_id: i.correlationId ?? null,
});

export const retireTemplateVersion = (
  c: OmniCommsRpcClient, i: { id: string; reason: string; correlationId?: string | null },
) => callOmniCommsRpc<TemplateVersionRetireResult>(c, 'omni_comms_template_version_retire', {
  p_id: i.id, p_reason: i.reason, p_correlation_id: i.correlationId ?? null,
});

export interface ListTemplateVersionsInput {
  templateFamilyId: string;
  channel?: TemplateChannel | null; locale?: string | null;
  status?: TemplateVersionStatus | null;
  limit?: number; offset?: number;
}
export const listTemplateVersions = (c: OmniCommsRpcClient, i: ListTemplateVersionsInput) =>
  callOmniCommsRpc<TemplateVersionListResult>(c, 'omni_comms_template_version_list', {
    p_template_family_id: i.templateFamilyId,
    p_channel: i.channel ?? null, p_locale: i.locale ?? null,
    p_status: i.status ?? null,
    p_limit: i.limit ?? 50, p_offset: i.offset ?? 0,
  });

export const getTemplateVersion = (c: OmniCommsRpcClient, id: string) =>
  callOmniCommsRpc<TemplateVersionGetResult>(c, 'omni_comms_template_version_get', { p_id: id });

export interface ResolvePublishedTemplateInput {
  organizationId: string; channel: TemplateChannel; locale: string;
  departmentId?: string | null; eventDefinitionId?: string | null;
}
export const resolvePublishedTemplate = (c: OmniCommsRpcClient, i: ResolvePublishedTemplateInput) =>
  callOmniCommsRpc<TemplateResolveResult>(c, 'omni_comms_template_resolve_published', {
    p_event_definition_id: i.eventDefinitionId ?? null,
    p_organization_id: i.organizationId,
    p_department_id: i.departmentId ?? null,
    p_channel: i.channel, p_locale: i.locale,
  });
