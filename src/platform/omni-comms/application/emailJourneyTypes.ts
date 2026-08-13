/**
 * Omni-Comms — Email journey read model (types only).
 *
 * One row per Email message, derived server-side from canonical evidence
 * (business event outbox → request → recipient → message → dispatch job →
 * provider attempt → delivery callback). Read-only: nothing here mutates
 * state, and recipient addresses always arrive masked from the server.
 */

export const EMAIL_JOURNEY_STAGES = [
  'event_recorded',
  'preparing',
  'prepared',
  'waiting_to_send',
  'held',
  'sending',
  'retrying',
  'provider_accepted',
  'delivered',
  'bounced',
  'complained',
  'failed',
  'needs_configuration',
  'needs_review',
  'cancelled',
  'test_completed',
] as const;

export type EmailJourneyStage = (typeof EMAIL_JOURNEY_STAGES)[number];

export const EMAIL_JOURNEY_STAGE_LABEL: Record<EmailJourneyStage, string> = {
  event_recorded: 'Event recorded',
  preparing: 'Preparing',
  prepared: 'Prepared',
  waiting_to_send: 'Waiting to send',
  held: 'Held',
  sending: 'Sending',
  retrying: 'Retrying',
  provider_accepted: 'Provider accepted',
  delivered: 'Delivered',
  bounced: 'Bounced',
  complained: 'Complaint',
  failed: 'Failed',
  needs_configuration: 'Needs configuration',
  needs_review: 'Needs review',
  cancelled: 'Cancelled',
  test_completed: 'Test completed',
};

/** Stages an operator is expected to act on. */
export const EMAIL_JOURNEY_ATTENTION_STAGES: readonly EmailJourneyStage[] = [
  'needs_configuration',
  'needs_review',
  'failed',
  'bounced',
  'complained',
];

export function emailJourneyStageLabel(stage: string): string {
  return (
    EMAIL_JOURNEY_STAGE_LABEL[stage as EmailJourneyStage] ??
    stage.replace(/_/g, ' ')
  );
}

export function emailJourneyStageTone(
  stage: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (
    stage === 'failed' ||
    stage === 'bounced' ||
    stage === 'complained' ||
    stage === 'needs_configuration'
  ) {
    return 'destructive';
  }
  if (stage === 'delivered' || stage === 'provider_accepted') return 'default';
  if (stage === 'needs_review' || stage === 'retrying' || stage === 'held') {
    return 'secondary';
  }
  return 'outline';
}

export interface EmailJourneyRow {
  readonly message_id: string;
  readonly business_event_id: string | null;
  readonly request_id: string | null;
  readonly organization_id: string;
  readonly module_code: string | null;
  readonly event_code: string | null;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly business_reference: string | null;
  readonly product_id: string | null;
  /** Already masked server-side. */
  readonly masked_recipient: string | null;
  readonly recipient_role: string | null;
  readonly template_name: string | null;
  readonly template_version: number | null;
  readonly sender_display: string | null;
  readonly provider_name: string | null;
  readonly current_stage: EmailJourneyStage | string;
  readonly last_action: string | null;
  readonly attempt_count: number;
  readonly event_recorded_at: string;
  readonly message_prepared_at: string | null;
  readonly queued_at: string | null;
  readonly picked_up_at: string | null;
  readonly provider_accepted_at: string | null;
  readonly callback_at: string | null;
  readonly delivered_at: string | null;
  readonly last_failure_at: string | null;
  readonly next_attempt_at: string | null;
  readonly end_to_end_duration_ms: number | null;
}

export interface EmailJourneyPage {
  readonly items: readonly EmailJourneyRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly generated_at: string;
}

export interface EmailJourneyModuleBreakdown {
  readonly module_code: string;
  readonly emails: number;
  readonly delivered: number;
}

export interface EmailJourneySummary {
  readonly initiated: number;
  readonly prepared: number;
  readonly queued: number;
  readonly picked_up: number;
  readonly provider_accepted: number;
  readonly delivered: number;
  readonly avg_event_to_prepared_ms: number | null;
  readonly avg_queue_to_accepted_ms: number | null;
  readonly avg_accepted_to_delivered_ms: number | null;
  readonly avg_end_to_end_ms: number | null;
  readonly oldest_waiting_at: string | null;
  readonly stages: Readonly<Record<string, number>>;
  readonly modules: readonly EmailJourneyModuleBreakdown[];
  readonly needs_attention: number;
  readonly delivery_rate: number | null;
  readonly generated_at: string;
}

export interface EmailJourneyAuditEntry {
  readonly at: string;
  readonly stage: string;
  readonly action: string;
  readonly result: string;
}

export interface EmailJourneyAttempt {
  readonly attempt_number: number;
  readonly started_at: string | null;
  readonly completed_at: string | null;
  readonly outcome: string | null;
  readonly retriable: boolean | null;
  readonly failure_category: string | null;
  readonly latency_ms: number | null;
}

export interface EmailJourneyCallback {
  readonly at: string;
  readonly event_type: string;
  readonly summary: string | null;
}

export interface EmailJourneyDetail extends EmailJourneyRow {
  readonly audit: readonly EmailJourneyAuditEntry[];
  readonly attempts: readonly EmailJourneyAttempt[];
  readonly callbacks: readonly EmailJourneyCallback[];
  readonly technical: Record<string, unknown>;
  readonly generated_at: string;
}

export interface EmailJourneyFilters {
  readonly organizationId: string;
  readonly moduleCode?: string | null;
  readonly eventCode?: string | null;
  readonly stage?: EmailJourneyStage | string | null;
  readonly productId?: string | null;
  readonly from?: string | null;
  readonly to?: string | null;
  readonly search?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

export const EMAIL_JOURNEY_PAGE_SIZE_DEFAULT = 25;
export const EMAIL_JOURNEY_PAGE_SIZE_MAX = 100;
