/**
 * Shared Benefits → Communication Hub adapter.
 *
 * Every Benefits servicing module (Life Certificates first, then Medical
 * Reviews, Suspensions, Overpayments, Mortality) writes a *communication
 * intent* row in its own outbox. This adapter is the only bridge from those
 * outboxes to the canonical sending spine.
 *
 * Boundary rules enforced here:
 *  - Benefits never sends, enqueues, prints or picks a template. It hands the
 *    hub a module code, event code, recipient reference and context; template,
 *    branding, sender identity, approval and dispatch stay with the hub.
 *  - Dispatch is deterministic: the dispatch key is derived from the source
 *    module and the intent id, so a retry replays the same communication
 *    request instead of creating a second one.
 *  - A communication failure never changes the obligation's own lifecycle
 *    state; it only advances the intent's delivery status and attempt count.
 *  - All commands are service-role only. They are intentionally unreachable
 *    from the browser: an authenticated session is rejected server-side.
 */

import { supabase } from '@/integrations/supabase/client';

/** Benefits modules allowed to publish communication intents. */
export type BnCommunicationSourceModule =
  | 'BN_LIFE_CERTIFICATE'
  | 'BN_AWARD_SUSPENSION'
  | 'BN_MEDICAL_REVIEW'
  | 'BN_OVERPAYMENT'
  | 'BN_MORTALITY';

export interface BnPendingCommunicationIntent {
  sourceModule: BnCommunicationSourceModule;
  sourceTable: string;
  sourceIntentId: string;
  sourceEntityId: string | null;
  awardId: string | null;
  eventCode: string;
  correlationId: string | null;
  context: Record<string, unknown>;
  attempts: number;
}

export type BnDispatchOutcome = 'DISPATCHED' | 'REPLAYED' | 'FAILED';

export interface BnDispatchResult {
  status: BnDispatchOutcome;
  communicationRequestId?: string;
  dispatchKey?: string;
  eventCode?: string;
  errorCode?: string;
}

/** Short, non-technical failure codes surfaced to callers and logs. */
export function sanitizeCommunicationError(message: unknown): string {
  const text = message instanceof Error ? message.message : String(message ?? '');
  return text.match(/E_[A-Z_]+/)?.[0] ?? 'E_UNKNOWN';
}

/** The deterministic identity of an intent's communication request. */
export function buildDispatchKey(
  sourceModule: BnCommunicationSourceModule,
  sourceIntentId: string,
): string {
  return `bn-comm:${sourceModule}:${sourceIntentId}`;
}

type RpcClient = Pick<typeof supabase, 'rpc'>;

/**
 * Undelivered intents across Benefits outboxes, oldest first. Intents that
 * exhausted their attempt budget are excluded so they can be handled manually.
 */
export async function listPendingIntents(
  limit = 50,
  client: RpcClient = supabase,
): Promise<BnPendingCommunicationIntent[]> {
  const { data, error } = await (client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'bn_communication_adapter_pending_v1',
    { p_limit: limit },
  );
  if (error) throw new Error(sanitizeCommunicationError(error.message));

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    sourceModule: row.source_module as BnCommunicationSourceModule,
    sourceTable: String(row.source_table ?? ''),
    sourceIntentId: String(row.source_intent_id ?? ''),
    sourceEntityId: (row.source_entity_id as string | null) ?? null,
    awardId: (row.bn_award_id as string | null) ?? null,
    eventCode: String(row.event_code ?? ''),
    correlationId: (row.correlation_id as string | null) ?? null,
    context: (row.context as Record<string, unknown>) ?? {},
    attempts: Number(row.attempts ?? 0),
  }));
}

/**
 * Hands one intent to the communication hub. Safe to call repeatedly: the
 * second call returns REPLAYED with the original request id.
 */
export async function dispatchIntent(
  sourceModule: BnCommunicationSourceModule,
  sourceIntentId: string,
  client: RpcClient = supabase,
): Promise<BnDispatchResult> {
  const { data, error } = await (client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'bn_communication_adapter_dispatch_v1',
    { p_source_module: sourceModule, p_source_intent_id: sourceIntentId },
  );
  if (error) throw new Error(sanitizeCommunicationError(error.message));

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    status: (row.status as BnDispatchOutcome) ?? 'FAILED',
    communicationRequestId: (row.communication_request_id as string | undefined) ?? undefined,
    dispatchKey: (row.dispatch_key as string | undefined) ?? undefined,
    eventCode: (row.event_code as string | undefined) ?? undefined,
    errorCode: (row.error_code as string | undefined) ?? undefined,
  };
}

/** Records a delivery failure against the intent only — never the obligation. */
export async function recordDispatchFailure(
  sourceModule: BnCommunicationSourceModule,
  sourceIntentId: string,
  errorCode: string,
  client: RpcClient = supabase,
): Promise<{ errorCode: string; attempts: number }> {
  const { data, error } = await (client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'bn_communication_adapter_record_failure_v1',
    {
      p_source_module: sourceModule,
      p_source_intent_id: sourceIntentId,
      p_error_code: sanitizeCommunicationError(errorCode),
    },
  );
  if (error) throw new Error(sanitizeCommunicationError(error.message));

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    errorCode: String(row.error_code ?? 'E_UNKNOWN'),
    attempts: Number(row.attempts ?? 0),
  };
}

/** Copies hub request status back onto the module outbox rows. */
export async function syncDeliveryStatus(
  limit = 200,
  client: RpcClient = supabase,
): Promise<{ synced: number }> {
  const { data, error } = await (client.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>)(
    'bn_communication_adapter_sync_v1',
    { p_limit: limit },
  );
  if (error) throw new Error(sanitizeCommunicationError(error.message));
  return { synced: Number((data as Record<string, unknown> | null)?.synced ?? 0) };
}

export const bnCommunicationAdapterService = {
  listPendingIntents,
  dispatchIntent,
  recordDispatchFailure,
  syncDeliveryStatus,
  buildDispatchKey,
  sanitizeCommunicationError,
};
