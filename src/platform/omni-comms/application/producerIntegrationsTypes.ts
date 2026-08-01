/**
 * Build 4A — Producer Integrations administration types.
 *
 * Pure declarations. Mirrors the bounded JSON projections returned by the
 * authorised producer-binding RPCs.
 */

export type ProducerBindingStatus = 'draft' | 'active' | 'suspended' | 'retired';

/** Modes an administrator may authorise in Build 4A. */
export const PRODUCER_BINDING_MODES = ['dry_run', 'shadow'] as const;
export type ProducerBindingMode = (typeof PRODUCER_BINDING_MODES)[number];

export interface ProducerEventBinding {
  id: string;
  organization_id: string;
  department_id: string | null;
  caller_module_code: string;
  event_definition_id: string;
  event_code: string;
  event_name: string;
  event_module_code: string | null;
  event_status: string;
  allowed_modes: string[];
  status: ProducerBindingStatus;
  integration_reference: string | null;
  lifecycle_reason: string | null;
  created_at?: string;
  updated_at: string;
  activated_at: string | null;
  suspended_at?: string | null;
  retired_at?: string | null;
}

export interface ProducerBindingDraftInput {
  id?: string | null;
  organizationId: string;
  departmentId?: string | null;
  callerModuleCode: string;
  eventDefinitionId: string;
  allowedModes: ProducerBindingMode[];
  integrationReference?: string | null;
}
