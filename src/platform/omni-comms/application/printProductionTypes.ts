/**
 * Omni-Comms Print / Correspondence — physical production DTOs (Phase 3A).
 *
 * Boundaries (permanent):
 *   - No provider SDK types. Physical production is operator-driven.
 *   - Artefact evidence (rendered PDF) and physical evidence (paper attempts)
 *     are modelled separately and never merged.
 */

export const OMNI_COMMS_PRINT_STATUSES = [
  'artefact_produced',
  'queued_for_print',
  'printing',
  'printed',
  'print_failed',
  'spoiled',
  'held',
  'dispatched',
  'returned_undelivered',
] as const;

export type OmniCommsPrintStatus = (typeof OMNI_COMMS_PRINT_STATUSES)[number];

export const OMNI_COMMS_PRINT_STATUS_LABELS: Record<OmniCommsPrintStatus, string> = {
  artefact_produced: 'Artefact produced',
  queued_for_print: 'Queued for print',
  printing: 'Printing',
  printed: 'Printed',
  print_failed: 'Print failed',
  spoiled: 'Spoiled',
  held: 'Held',
  dispatched: 'Dispatched',
  returned_undelivered: 'Returned undelivered',
};

export const OMNI_COMMS_PRINT_ACTIONS = [
  'queue_for_print',
  'start_printing',
  'confirm_printed',
  'mark_failed',
  'mark_spoiled',
  'hold',
  'requeue',
  'confirm_dispatched',
  'mark_returned',
] as const;

export type OmniCommsPrintAction = (typeof OMNI_COMMS_PRINT_ACTIONS)[number];

export const OMNI_COMMS_PRINT_ACTION_LABELS: Record<OmniCommsPrintAction, string> = {
  queue_for_print: 'Queue for print',
  start_printing: 'Start printing',
  confirm_printed: 'Confirm printed',
  mark_failed: 'Mark print failed',
  mark_spoiled: 'Mark spoiled',
  hold: 'Hold',
  requeue: 'Requeue',
  confirm_dispatched: 'Confirm dispatch',
  mark_returned: 'Mark returned',
};

/** Actions that always require an operator reason. */
export const OMNI_COMMS_PRINT_REASON_REQUIRED: readonly OmniCommsPrintAction[] = [
  'hold',
  'mark_failed',
  'mark_spoiled',
  'mark_returned',
];

/**
 * Client mirror of the database predicate
 * `public.omni_comms_priv_print_transition_allowed`. The database remains
 * authoritative; this only decides which buttons are offered.
 */
const TRANSITIONS: Record<OmniCommsPrintStatus, OmniCommsPrintStatus[]> = {
  artefact_produced: ['queued_for_print', 'held'],
  queued_for_print: ['printing', 'held'],
  printing: ['printed', 'print_failed', 'held'],
  printed: ['spoiled', 'dispatched'],
  print_failed: ['queued_for_print', 'spoiled', 'held'],
  spoiled: ['queued_for_print'],
  held: ['queued_for_print', 'artefact_produced'],
  dispatched: ['returned_undelivered'],
  returned_undelivered: ['queued_for_print', 'held'],
};

const ACTION_TARGET: Record<OmniCommsPrintAction, OmniCommsPrintStatus> = {
  queue_for_print: 'queued_for_print',
  start_printing: 'printing',
  confirm_printed: 'printed',
  mark_failed: 'print_failed',
  mark_spoiled: 'spoiled',
  hold: 'held',
  requeue: 'queued_for_print',
  confirm_dispatched: 'dispatched',
  mark_returned: 'returned_undelivered',
};

export function printTransitionAllowed(
  from: OmniCommsPrintStatus,
  to: OmniCommsPrintStatus,
): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function availablePrintActions(
  status: OmniCommsPrintStatus,
): OmniCommsPrintAction[] {
  return OMNI_COMMS_PRINT_ACTIONS.filter((action) => {
    if (
      action === 'requeue' &&
      status !== 'print_failed' &&
      status !== 'spoiled' &&
      status !== 'held' &&
      status !== 'returned_undelivered'
    ) {
      return false;
    }
    if (action === 'queue_for_print' && status !== 'artefact_produced') return false;
    if (action === 'confirm_dispatched' && status !== 'printed') return false;
    if (action === 'mark_returned' && status !== 'dispatched') return false;
    return printTransitionAllowed(status, ACTION_TARGET[action]);
  });
}

export interface PrintProductionProfile {
  paper_size: string | null;
  sides: string | null;
  colour_mode: string | null;
  copies: number | null;
  letterhead_profile: string | null;
  envelope_profile: string | null;
  inserts: unknown[] | null;
  special_handling: string | null;
}

export interface PrintQueueRow {
  id: string;
  created_at: string;
  updated_at: string;
  letter_reference: string;
  request_id: string;
  message_id: string;
  module_code: string | null;
  event_code: string | null;
  recipient_reference: string | null;
  /** Masked unless the operator holds the operate capability. */
  recipient_display: string | null;
  postal_summary: string | null;
  issuing_authority: string | null;
  page_count: number | null;
  production_profile: PrintProductionProfile;
  production_account_id: string | null;
  production_account_name: string | null;
  physical_status: OmniCommsPrintStatus;
  attempt_count: number;
  version: number;
  hold_reason: string | null;
  last_failure_reason: string | null;
  /** Device the operator actually used on the most recent physical attempt. */
  last_equipment_reference: string | null;
  last_equipment_name: string | null;
  last_attempt_outcome: string | null;
  last_printed_at: string | null;
  age_hours: number | null;
}

export interface PrintQueueResult {
  items: PrintQueueRow[];
  total: number;
  full_detail_permitted: boolean;
  generated_at: string;
}

export interface PrintAttemptRow {
  attempt_number: number;
  outcome: 'in_progress' | 'printed' | 'failed' | 'spoiled' | 'abandoned';
  production_account_id: string | null;
  production_account_name: string | null;
  operator_id: string | null;
  started_at: string;
  completed_at: string | null;
  equipment_reference: string | null;
  failure_reason: string | null;
  page_count: number | null;
}

export interface PrintItemDetail {
  item: {
    id: string;
    letter_reference: string;
    request_id: string;
    message_id: string;
    physical_status: OmniCommsPrintStatus;
    version: number;
    attempt_count: number;
    issuing_authority: string | null;
    page_count: number | null;
    production_profile: PrintProductionProfile;
    production_account_id: string | null;
    hold_reason: string | null;
    last_failure_reason: string | null;
    created_at: string;
    updated_at: string;
  };
  artefact: {
    bucket: string | null;
    path: string | null;
    checksum_sha256: string | null;
    byte_size: number | null;
    page_count: number | null;
    state: 'artefact_produced';
  };
  recipient: {
    reference: string | null;
    display: string | null;
    postal_destination: Record<string, unknown> | null;
    postal_summary: string | null;
  };
  attempts: PrintAttemptRow[];
}

export interface PrintItemActionInput {
  id: string;
  action: OmniCommsPrintAction;
  /** Null skips optimistic concurrency (server still validates the transition). */
  expectedVersion: number | null;
  reason?: string | null;
  productionAccountId?: string | null;
  equipmentReference?: string | null;
  pageCount?: number | null;
  correlationId?: string | null;
  dispatch?: {
    dispatch_method: string;
    carrier?: string | null;
    service_level?: string | null;
    tracking_reference?: string | null;
    postage_cost?: number | null;
    postage_currency?: string | null;
    enclosure_count?: number | null;
    notes?: string | null;
  } | null;
}

export interface PrintItemActionResult {
  id: string;
  physical_status: OmniCommsPrintStatus;
  version: number;
  attempt_count: number;
  updated_at: string;
}
