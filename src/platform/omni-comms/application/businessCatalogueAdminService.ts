/**
 * Omni-Comms — governed business catalogue administration adapters.
 *
 * Wraps the SECURITY DEFINER RPCs that administer:
 *   - Business Objects (the grouping level between module and event)
 *   - Communication Actions (the stable identity of a communication, which
 *     owns its channel templates and survives scope overrides)
 *
 * No table access, no sending, no template-code parsing.
 */
import { OmniCommsRpcClient, callOmniCommsRpc } from './omniCommsRpcErrors';

export type BusinessObjectStatus = 'active' | 'retired';

export interface BusinessObjectRow {
  id: string;
  module_code: string;
  code: string;
  name: string;
  description: string | null;
  display_order: number;
  status: BusinessObjectStatus;
  updated_at: string;
}

export const listBusinessObjects = (
  c: OmniCommsRpcClient,
  input: { moduleCode?: string | null; includeRetired?: boolean } = {},
) => callOmniCommsRpc<BusinessObjectRow[]>(c, 'omni_comms_business_object_list', {
  p_module_code: input.moduleCode ?? null,
  p_include_retired: input.includeRetired ?? false,
});

export interface CreateBusinessObjectInput {
  moduleCode: string;
  code: string;
  name: string;
  displayOrder?: number | null;
  description?: string | null;
  correlationId?: string | null;
}

export const createBusinessObject = (c: OmniCommsRpcClient, i: CreateBusinessObjectInput) =>
  callOmniCommsRpc<BusinessObjectRow>(c, 'omni_comms_business_object_create', {
    p_module_code: i.moduleCode,
    p_code: i.code,
    p_name: i.name,
    p_display_order: i.displayOrder ?? 1000,
    p_description: i.description ?? null,
    p_correlation_id: i.correlationId ?? null,
  });

export interface UpdateBusinessObjectInput {
  id: string;
  name?: string | null;
  displayOrder?: number | null;
  description?: string | null;
  status?: BusinessObjectStatus | null;
  correlationId?: string | null;
}

export const updateBusinessObject = (c: OmniCommsRpcClient, i: UpdateBusinessObjectInput) =>
  callOmniCommsRpc<BusinessObjectRow>(c, 'omni_comms_business_object_update', {
    p_id: i.id,
    p_name: i.name ?? null,
    p_display_order: i.displayOrder ?? null,
    p_description: i.description ?? null,
    p_status: i.status ?? null,
    p_correlation_id: i.correlationId ?? null,
  });

// ─── Communication actions ──────────────────────────────────────────────────

export type CommunicationActionScope = 'organization' | 'department' | 'event';

export interface CommunicationActionCreateResult {
  communication_action_id: string;
  code: string;
  name: string;
  event_definition_id: string | null;
  template_family_id: string;
  scope_type: CommunicationActionScope;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCommunicationActionInput {
  organizationId: string;
  /** Stable action identity, e.g. CLAIM_APPROVAL_NOTICE. */
  code: string;
  name: string;
  eventDefinitionId?: string | null;
  description?: string | null;
  scopeType?: CommunicationActionScope;
  departmentId?: string | null;
  correlationId?: string | null;
}

export const createCommunicationAction = (
  c: OmniCommsRpcClient,
  i: CreateCommunicationActionInput,
) => callOmniCommsRpc<CommunicationActionCreateResult>(
  c,
  'omni_comms_communication_action_create',
  {
    p_organization_id: i.organizationId,
    p_code: i.code,
    p_name: i.name,
    p_event_definition_id: i.eventDefinitionId ?? null,
    p_description: i.description ?? null,
    p_scope_type: i.scopeType ?? (i.eventDefinitionId ? 'event' : 'organization'),
    p_department_id: i.departmentId ?? null,
    p_correlation_id: i.correlationId ?? null,
  },
);

export interface AddCommunicationActionScopeInput {
  communicationActionId: string;
  scopeType: 'organization' | 'department';
  departmentId?: string | null;
  correlationId?: string | null;
}

/** Adds a scoped override family that stays inside the same action identity. */
export const addCommunicationActionScope = (
  c: OmniCommsRpcClient,
  i: AddCommunicationActionScopeInput,
) => callOmniCommsRpc<{ template_family_id: string; code: string; scope_type: string }>(
  c,
  'omni_comms_communication_action_add_scope',
  {
    p_communication_action_id: i.communicationActionId,
    p_scope_type: i.scopeType,
    p_department_id: i.departmentId ?? null,
    p_correlation_id: i.correlationId ?? null,
  },
);

/** Suggests a governed action code from an event code, e.g.
 *  BENEFITS.CLAIM.APPROVED → CLAIM_APPROVED_NOTICE. */
export function suggestActionCode(eventCode: string, suffix = 'NOTICE'): string {
  const parts = eventCode.toUpperCase().split('.').filter(Boolean);
  const tail = parts.slice(1).join('_') || parts.join('_');
  return `${tail}_${suffix}`.replace(/[^A-Z0-9_]/g, '_').slice(0, 80);
}
