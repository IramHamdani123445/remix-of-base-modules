/**
 * Build 4A — Producer Integrations administration service.
 *
 * Read + lifecycle operations over `omni_comms_producer_event_binding`,
 * exclusively through the authorised SECURITY DEFINER RPC surface. No direct
 * table access, no provider contact, no Legacy reference.
 */
import { callOmniCommsRpc } from './omniCommsRpcCall';
import type { OmniCommsRpcClient } from './eventCatalogueService';
import type {
  ProducerEventBinding,
  ProducerBindingStatus,
  ProducerBindingDraftInput,
} from './producerIntegrationsTypes';

export async function listProducerEventBindings(
  client: OmniCommsRpcClient,
  args: { organizationId: string; departmentId?: string | null; status?: ProducerBindingStatus | null },
): Promise<ProducerEventBinding[]> {
  const data = await callOmniCommsRpc<{ bindings?: ProducerEventBinding[] }>(
    client,
    'omni_comms_list_producer_event_bindings',
    {
      p_organization_id: args.organizationId,
      p_department_id: args.departmentId ?? null,
      p_status: args.status ?? null,
    },
  );
  return Array.isArray(data?.bindings) ? data.bindings : [];
}

export async function getProducerEventBinding(
  client: OmniCommsRpcClient,
  id: string,
): Promise<ProducerEventBinding> {
  return callOmniCommsRpc<ProducerEventBinding>(
    client,
    'omni_comms_get_producer_event_binding',
    { p_id: id },
  );
}

export async function upsertProducerEventBindingDraft(
  client: OmniCommsRpcClient,
  input: ProducerBindingDraftInput,
): Promise<{ id: string; status: ProducerBindingStatus }> {
  return callOmniCommsRpc(client, 'omni_comms_upsert_producer_event_binding_draft', {
    p_id: input.id ?? null,
    p_organization_id: input.organizationId,
    p_department_id: input.departmentId ?? null,
    p_caller_module_code: input.callerModuleCode,
    p_event_definition_id: input.eventDefinitionId,
    p_allowed_modes: input.allowedModes,
    p_integration_reference: input.integrationReference ?? null,
  });
}

export async function setProducerEventBindingStatus(
  client: OmniCommsRpcClient,
  args: { id: string; targetStatus: 'active' | 'suspended' | 'retired'; reason?: string | null },
): Promise<{ id: string; status: ProducerBindingStatus }> {
  return callOmniCommsRpc(client, 'omni_comms_set_producer_event_binding_status', {
    p_id: args.id,
    p_target_status: args.targetStatus,
    p_reason: args.reason ?? null,
  });
}
