/**
 * Omni-Comms — scheduled automation status (read-only).
 *
 * TWO distinct automatic workers are tracked separately and must never be
 * merged into one ambiguous "scheduler":
 *
 *   * BUSINESS EVENT PROCESSOR (`omni-comms-business-event-ingest`)
 *     business event outbox -> runtime -> communication / message / dispatch
 *     job. It NEVER contacts a provider.
 *   * DELIVERY PROCESSOR (`omni-comms-dispatch`)
 *     eligible queued dispatch jobs -> provider.
 *
 * The server projection carries only safe operational facts: no cron command
 * SQL, no authorization headers, no keys, no scheduler nonce, no provider
 * response bodies.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';

export type AutomationRunResult = 'success' | 'blocked';
export type AutomationStage = 'business_event_ingest' | 'dispatch';

export interface AutomationProcessorBase {
  worker: string;
  installed: boolean;
  active: boolean;
  /** Raw cron expression. Technical details only — never a normal surface. */
  schedule: string | null;
  /** Operator wording, e.g. "Runs every minute". */
  frequency_label: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_cron_success_at: string | null;
  last_result: AutomationRunResult | null;
  last_run_found: number | null;
  last_run_handled: number | null;
  last_blocker: string | null;
  run_fresh: boolean;
  healthy: boolean;
}

export interface BusinessEventProcessorStatus extends AutomationProcessorBase {
  pending_events: number;
  processing_events: number;
  retry_events: number;
  blocked_events: number;
  needs_review_events: number;
  oldest_pending_at: string | null;
  oldest_retry_at: string | null;
  last_run_detail: Record<string, unknown> | null;
}

export interface DeliveryProcessorStatus extends AutomationProcessorBase {
  waiting_jobs: number;
  ready_jobs: number;
  held_jobs: number;
  retry_wait_jobs: number;
  currently_claimed: number;
  oldest_waiting_at: string | null;
  last_attempt_at: string | null;
  last_provider_accepted_at: string | null;
  last_delivered_at: string | null;
  last_outcome_unknown_at: string | null;
}

export interface CallbackReceiverStatus {
  healthy: boolean;
  callback_endpoint_ready: boolean;
  last_callback_at: string | null;
  last_delivered_callback_at: string | null;
  last_bounce_at: string | null;
  last_complaint_at: string | null;
  recent_invalid_signature_count: number | null;
}

export interface AutomationRun {
  at: string;
  stage: AutomationStage;
  found: number;
  handled: number;
  result: AutomationRunResult;
  blocker: string | null;
}

export interface AutomationStatus {
  business_event_processor: BusinessEventProcessorStatus;
  delivery_processor: DeliveryProcessorStatus;
  callback_receiver: CallbackReceiverStatus;
  recent_runs: AutomationRun[];
  thresholds: { stale_run_seconds: number; backlog_seconds: number };
  generated_at: string;
}

/** Operational thresholds. Single source of truth for the UI wording. */
export const AUTOMATION_STALE_RUN_SECONDS = 180;
export const AUTOMATION_BACKLOG_SECONDS = 300;
/** UI polling only. This creates NO cron job. */
export const AUTOMATION_REFRESH_MS = 20_000;
/** Recent runs shown on the normal surface. */
export const AUTOMATION_RECENT_RUN_LIMIT = 8;

export const AUTOMATION_STAGE_LABEL: Record<AutomationStage, string> = {
  business_event_ingest: 'Event processing',
  dispatch: 'Email delivery',
};

/** Business-friendly wording for a bounded symbolic blocker code. */
export const AUTOMATION_BLOCKER_MESSAGE: Record<string, string> = {
  scheduler_not_installed: 'Automatic processing is not installed.',
  scheduler_inactive: 'Automatic processing is switched off.',
  worker_did_not_complete: 'Needs attention — worker did not complete.',
  no_recent_successful_run: 'No successful run in the last few minutes.',
  events_backlogged: 'Business events have been waiting too long.',
  delivery_backlogged: 'Emails have been waiting to send for too long.',
  events_need_review: 'Some business events need review.',
};

export function automationBlockerMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return AUTOMATION_BLOCKER_MESSAGE[code] ?? 'Needs attention.';
}

export function automationHealthLabel(healthy: boolean): 'Healthy' | 'Needs attention' {
  return healthy ? 'Healthy' : 'Needs attention';
}

/**
 * A tick that ran successfully and found zero work is HEALTHY — it must never
 * be presented as a failure.
 */
export function runResultLabel(run: Pick<AutomationRun, 'result'>): string {
  return run.result === 'success' ? 'Success' : 'Blocked';
}

export function getAutomationStatus(
  client: OmniCommsRpcClient,
  input?: { organizationId?: string | null },
): Promise<AutomationStatus> {
  return callOmniCommsRpc<AutomationStatus>(client, 'omni_comms_automation_status', {
    p_organization_id: input?.organizationId ?? null,
  });
}
