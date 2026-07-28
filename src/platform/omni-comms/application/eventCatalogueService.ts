/**
 * Omni-Comms Event Catalogue — typed RPC adapter.
 *
 * This module exposes strongly-typed wrappers around the Story 2 SECURITY
 * DEFINER RPCs. It does NOT import the browser Supabase client. Every
 * function accepts a supabase-like client instance (with an `.rpc(name,args)`
 * method) so it can be consumed by any surface that already holds a client
 * (admin UI, tests, or future server contexts) without introducing a new
 * façade or new dependency.
 *
 * Prohibited by contract: sendCommunication, edge functions, provider
 * adapters, queues, workers, direct browser table access.
 */
import {
  EventContractListItem,
  EventContractRow,
  EventDefinitionListItem,
  EventDefinitionRow,
  OMNI_COMMS_ERROR_CODES,
  OmniCommsErrorCode,
  OmniCommsRpcError,
} from './eventCatalogueTypes';

// Minimal structural type; avoids importing @supabase/supabase-js here.
export interface OmniCommsRpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; details?: string; code?: string } | null }>;
}

function parseError(raw: { message?: string; details?: string; code?: string } | null): OmniCommsRpcError {
  const msg = raw?.message ?? '';
  const codeMatch = msg.match(/\bOC(\d{3})\b/);
  const code = (codeMatch ? `OC${codeMatch[1]}` : 'OC500') as OmniCommsErrorCode;
  const detail = raw?.details ?? (msg.replace(/^OC\d{3}\s*/, '').trim() || undefined);
  return new OmniCommsRpcError(
    OMNI_COMMS_ERROR_CODES.includes(code) ? code : 'OC500',
    detail,
    msg || undefined,
  );
}

async function callRpc<T>(
  client: OmniCommsRpcClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw parseError(error);
  return data as T;
}

// ─── Event definition mutations ───────────────────────────────────────

export interface CreateEventDefinitionInput {
  code: string;
  moduleCode: string;
  entityType: string;
  name: string;
  description?: string | null;
  communicationClass:
    | 'transactional'
    | 'service'
    | 'security'
    | 'legal_mandatory'
    | 'operational'
    | 'marketing';
  defaultPriority?: 'low' | 'normal' | 'high' | 'urgent';
  correlationId?: string | null;
}

export function createEventDefinition(
  client: OmniCommsRpcClient,
  input: CreateEventDefinitionInput,
): Promise<string> {
  return callRpc<string>(client, 'omni_comms_event_definition_create', {
    p_code: input.code,
    p_module_code: input.moduleCode,
    p_entity_type: input.entityType,
    p_name: input.name,
    p_description: input.description ?? null,
    p_communication_class: input.communicationClass,
    p_default_priority: input.defaultPriority ?? 'normal',
    p_correlation_id: input.correlationId ?? null,
  });
}

export interface UpdateEventDefinitionDraftInput extends CreateEventDefinitionInput {
  id: string;
  expectedUpdatedAt: string;
}

export function updateEventDefinitionDraft(
  client: OmniCommsRpcClient,
  input: UpdateEventDefinitionDraftInput,
): Promise<string> {
  return callRpc<string>(client, 'omni_comms_event_definition_update_draft', {
    p_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_code: input.code,
    p_module_code: input.moduleCode,
    p_entity_type: input.entityType,
    p_name: input.name,
    p_description: input.description ?? null,
    p_communication_class: input.communicationClass,
    p_default_priority: input.defaultPriority ?? 'normal',
    p_correlation_id: input.correlationId ?? null,
  });
}

interface LifecycleInput {
  id: string;
  expectedUpdatedAt: string;
  correlationId?: string | null;
}

export const activateEventDefinition = (c: OmniCommsRpcClient, i: LifecycleInput) =>
  callRpc<string>(c, 'omni_comms_event_definition_activate', {
    p_id: i.id, p_expected_updated_at: i.expectedUpdatedAt, p_correlation_id: i.correlationId ?? null,
  });

export const suspendEventDefinition = (c: OmniCommsRpcClient, i: LifecycleInput) =>
  callRpc<string>(c, 'omni_comms_event_definition_suspend', {
    p_id: i.id, p_expected_updated_at: i.expectedUpdatedAt, p_correlation_id: i.correlationId ?? null,
  });

export const retireEventDefinition = (c: OmniCommsRpcClient, i: LifecycleInput) =>
  callRpc<string>(c, 'omni_comms_event_definition_retire', {
    p_id: i.id, p_expected_updated_at: i.expectedUpdatedAt, p_correlation_id: i.correlationId ?? null,
  });

// ─── Event contract mutations ─────────────────────────────────────────

export interface CreateEventContractInput {
  eventDefinitionId: string;
  versionNumber: number;
  jsonSchema: Record<string, unknown>;
  samplePayload?: Record<string, unknown> | null;
  correlationId?: string | null;
}

export function createEventContract(
  client: OmniCommsRpcClient,
  input: CreateEventContractInput,
): Promise<string> {
  return callRpc<string>(client, 'omni_comms_event_contract_create', {
    p_event_definition_id: input.eventDefinitionId,
    p_version_number: input.versionNumber,
    p_json_schema: input.jsonSchema,
    p_sample_payload: input.samplePayload ?? {},
    p_correlation_id: input.correlationId ?? null,
  });
}

export interface UpdateEventContractDraftInput {
  id: string;
  expectedUpdatedAt: string;
  jsonSchema: Record<string, unknown>;
  samplePayload?: Record<string, unknown> | null;
  correlationId?: string | null;
}

export function updateEventContractDraft(
  client: OmniCommsRpcClient,
  input: UpdateEventContractDraftInput,
): Promise<string> {
  return callRpc<string>(client, 'omni_comms_event_contract_update_draft', {
    p_id: input.id,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_json_schema: input.jsonSchema,
    p_sample_payload: input.samplePayload ?? null,
    p_correlation_id: input.correlationId ?? null,
  });
}

export const publishEventContract = (c: OmniCommsRpcClient, i: LifecycleInput) =>
  callRpc<string>(c, 'omni_comms_event_contract_publish', {
    p_id: i.id, p_expected_updated_at: i.expectedUpdatedAt, p_correlation_id: i.correlationId ?? null,
  });

export const retireEventContract = (c: OmniCommsRpcClient, i: LifecycleInput) =>
  callRpc<string>(c, 'omni_comms_event_contract_retire', {
    p_id: i.id, p_expected_updated_at: i.expectedUpdatedAt, p_correlation_id: i.correlationId ?? null,
  });

// ─── Reads ────────────────────────────────────────────────────────────

export async function getEventDefinition(
  client: OmniCommsRpcClient,
  id: string,
): Promise<EventDefinitionRow | null> {
  const rows = await callRpc<EventDefinitionRow[]>(client, 'omni_comms_event_definition_get', {
    p_id: id,
  });
  return rows?.[0] ?? null;
}

export interface ListEventDefinitionsInput {
  limit?: number;
  offset?: number;
  status?: 'draft' | 'active' | 'suspended' | 'retired' | null;
  moduleCode?: string | null;
}

export function listEventDefinitions(
  client: OmniCommsRpcClient,
  input: ListEventDefinitionsInput = {},
): Promise<EventDefinitionListItem[]> {
  return callRpc<EventDefinitionListItem[]>(client, 'omni_comms_event_definition_list', {
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
    p_status: input.status ?? null,
    p_module_code: input.moduleCode ?? null,
  });
}

export async function getEventContract(
  client: OmniCommsRpcClient,
  id: string,
): Promise<EventContractRow | null> {
  const rows = await callRpc<EventContractRow[]>(client, 'omni_comms_event_contract_get', {
    p_id: id,
  });
  return rows?.[0] ?? null;
}

export interface ListEventContractsInput {
  eventDefinitionId: string;
  limit?: number;
  offset?: number;
  status?: 'draft' | 'published' | 'retired' | null;
}

export function listEventContracts(
  client: OmniCommsRpcClient,
  input: ListEventContractsInput,
): Promise<EventContractListItem[]> {
  return callRpc<EventContractListItem[]>(client, 'omni_comms_event_contract_list', {
    p_event_definition_id: input.eventDefinitionId,
    p_limit: input.limit ?? 50,
    p_offset: input.offset ?? 0,
    p_status: input.status ?? null,
  });
}
