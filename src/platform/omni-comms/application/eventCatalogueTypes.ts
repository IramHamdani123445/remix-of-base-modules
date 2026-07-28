/**
 * Omni-Comms Event Catalogue — TypeScript RPC contract types.
 * These types mirror the SECURITY DEFINER RPC signatures created in the
 * Epic 2 — Story 2 migration. They are pure type declarations; they do not
 * import any Supabase client, React module, or Legacy code.
 */

export type EventDefinitionStatus = 'draft' | 'active' | 'suspended' | 'retired';
export type EventContractStatus = 'draft' | 'published' | 'retired';
export type CommunicationClass =
  | 'transactional'
  | 'service'
  | 'security'
  | 'legal_mandatory'
  | 'operational'
  | 'marketing';
export type EventPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface EventDefinitionRow {
  id: string;
  code: string;
  module_code: string;
  entity_type: string;
  name: string;
  description: string | null;
  communication_class: CommunicationClass;
  default_priority: EventPriority;
  status: EventDefinitionStatus;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface EventDefinitionListItem {
  id: string;
  code: string;
  module_code: string;
  entity_type: string;
  name: string;
  communication_class: CommunicationClass;
  default_priority: EventPriority;
  status: EventDefinitionStatus;
  updated_at: string;
}

export interface EventContractRow {
  id: string;
  event_definition_id: string;
  version_number: number;
  json_schema: Record<string, unknown>;
  sample_payload: Record<string, unknown> | null;
  sample_payload_redacted: boolean;
  status: EventContractStatus;
  checksum: string | null;
  published_at: string | null;
  published_by: string | null;
  retired_at: string | null;
  retired_by: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface EventContractListItem {
  id: string;
  event_definition_id: string;
  version_number: number;
  status: EventContractStatus;
  checksum: string | null;
  published_at: string | null;
  retired_at: string | null;
  updated_at: string;
}

/** Stable error codes returned by every Event Catalogue RPC. */
export const OMNI_COMMS_ERROR_CODES = [
  'OC401', // authentication_required
  'OC403', // permission_denied
  'OC404', // not_found
  'OC409', // duplicate_event_code
  'OC410', // duplicate_contract_version
  'OC412', // invalid_state
  'OC413', // concurrent_update (optimistic-concurrency failure)
  'OC422', // validation_error
  'OC450', // audit_write_failed
  'OC500', // unexpected_error
] as const;

export type OmniCommsErrorCode = (typeof OMNI_COMMS_ERROR_CODES)[number];

/** Controlled validation detail values recognised by the schema pipeline. */
export const OMNI_COMMS_VALIDATION_DETAILS = [
  'invalid_schema',
  'root_schema_not_object',
  'sample_payload_not_object',
  'sample_payload_invalid',
  'non_local_ref',
  'schema_too_large',
  'sample_payload_too_large',
  'synthetic_confirmation_required',
] as const;

export type OmniCommsValidationDetail =
  (typeof OMNI_COMMS_VALIDATION_DETAILS)[number];

export class OmniCommsRpcError extends Error {
  readonly code: OmniCommsErrorCode;
  readonly detail?: string;
  constructor(code: OmniCommsErrorCode, detail?: string, message?: string) {
    super(message ?? `${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'OmniCommsRpcError';
    this.code = code;
    this.detail = detail;
  }
}
