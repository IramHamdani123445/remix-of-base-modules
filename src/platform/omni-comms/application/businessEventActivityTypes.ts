/**
 * Omni-Comms — business-event-first Activity read model.
 *
 * Activity is rooted on the recorded business event, never on the internal
 * communication request. A business event is visible from the moment the
 * originating module recorded it, before any request, message, dispatch job,
 * provider attempt or delivery evidence exists.
 *
 * The status vocabulary is business language. Claiming work is never "sent":
 * only a provider attempt may report acceptance, and only delivery evidence
 * may report delivery.
 */

export const BUSINESS_EVENT_STATUSES = [
  'event_recorded',
  'preparing_communication',
  'no_communication_configured',
  'waiting_to_send',
  'not_sent_historical',
  'sending',
  'provider_accepted',
  'delivered',
  'retrying',
  'needs_configuration',
  'needs_review',
  'failed',
] as const;

export type BusinessEventStatus = (typeof BUSINESS_EVENT_STATUSES)[number];

export const BUSINESS_EVENT_STATUS_LABEL: Record<BusinessEventStatus, string> = {
  event_recorded: 'Event recorded',
  preparing_communication: 'Preparing communication',
  no_communication_configured: 'No communication configured',
  waiting_to_send: 'Waiting to send',
  not_sent_historical: 'Not sent — historical record',
  sending: 'Sending',
  provider_accepted: 'Provider accepted',
  delivered: 'Delivered',
  retrying: 'Retrying',
  needs_configuration: 'Needs configuration',
  needs_review: 'Needs review',
  failed: 'Failed',
};

/**
 * Explanatory sub-text for statuses whose business meaning is easy to
 * misread. A historical record is deliberately never delivered.
 */
export const BUSINESS_EVENT_STATUS_HINT: Partial<Record<BusinessEventStatus, string>> = {
  not_sent_historical:
    'Recorded before delivery was switched on. Kept as audit evidence; it will never be sent.',
  waiting_to_send: 'Authorised work still waiting for its next automatic run.',
  no_communication_configured: 'No template or channel is configured for this event.',
};

export function businessEventStatusHint(status: string): string | null {
  return BUSINESS_EVENT_STATUS_HINT[status as BusinessEventStatus] ?? null;
}

/** Statuses an operator is expected to act on. */
export const BUSINESS_EVENT_ATTENTION_STATUSES: readonly BusinessEventStatus[] = [
  'needs_configuration',
  'needs_review',
  'failed',
];


export function businessEventStatusLabel(status: string): string {
  return (
    BUSINESS_EVENT_STATUS_LABEL[status as BusinessEventStatus] ??
    status.replace(/_/g, ' ')
  );
}

export function businessEventStatusTone(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'failed' || status === 'needs_configuration') return 'destructive';
  if (status === 'delivered') return 'default';
  if (status === 'needs_review' || status === 'retrying') return 'secondary';
  return 'outline';
}

export interface BusinessEventActivityRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly updated_at: string | null;
  readonly module_code: string;
  readonly event_code: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly status: BusinessEventStatus | string;
  readonly has_communication: boolean;
  readonly message_count: number;
  readonly recipient_count: number;
  readonly channels: readonly string[];
}

export interface BusinessEventActivityPage {
  readonly items: readonly BusinessEventActivityRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly generated_at: string;
}

export interface BusinessEventTimelineEntry {
  readonly at: string;
  readonly label: string;
  readonly detail: string;
}

export interface BusinessEventMessageSummary {
  readonly id: string;
  readonly channel: string;
  readonly status: string;
  readonly prepared_at: string;
  readonly recipient_role: string | null;
  /** Already masked server-side. */
  readonly recipient: string | null;
}

export interface BusinessEventActivityDetail {
  readonly id: string;
  readonly occurred_at: string;
  readonly module_code: string;
  readonly event_code: string;
  readonly entity_type: string | null;
  readonly entity_id: string | null;
  readonly status: BusinessEventStatus | string;
  readonly has_communication: boolean;
  readonly timeline: readonly BusinessEventTimelineEntry[];
  readonly messages: readonly BusinessEventMessageSummary[];
  readonly technical: Record<string, unknown>;
  readonly generated_at: string;
}

export interface BusinessEventActivityFilters {
  readonly organizationId: string;
  readonly status?: BusinessEventStatus | string | null;
  readonly moduleCode?: string | null;
  readonly eventCode?: string | null;
  readonly search?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

export const BUSINESS_EVENT_PAGE_SIZE_DEFAULT = 25;
export const BUSINESS_EVENT_PAGE_SIZE_MAX = 100;
