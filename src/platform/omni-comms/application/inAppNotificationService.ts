/**
 * Omni-Comms — In-App notification client operations.
 *
 * This is the ONLY place a React surface may mutate an Omni-Comms in-app
 * notification. Every Omni mutation goes through a governed, `auth.uid()`
 * scoped, idempotent, evidence-producing RPC:
 *
 *   * omni_comms_in_app_record_engagement       (one notification)
 *   * omni_comms_in_app_record_engagement_bulk  (a selection, or all unread)
 *
 * There is no direct-write fallback for Omni-Comms notifications: if the
 * governed call fails the caller surfaces an error and the notification state
 * is left untouched. Silently bypassing Omni evidence is never acceptable.
 *
 * Legacy (non-Omni) notifications keep a clearly separated compatibility path
 * that this module never mixes into a governed call.
 */

export const OMNI_COMMS_IN_APP_SOURCE = 'omni_comms';

export type InAppEngagement = 'read' | 'action';

export interface InAppRpcClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

/** Minimal shape the client surfaces need in order to route a mutation. */
export interface InAppNotificationRoutingFields {
  id: string;
  source?: string | null;
}

export class InAppEngagementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InAppEngagementError';
  }
}

/** True when the notification is owned by the Omni-Comms sending spine. */
export function isOmniCommsNotification(
  notification: InAppNotificationRoutingFields | null | undefined,
): boolean {
  return (notification?.source ?? null) === OMNI_COMMS_IN_APP_SOURCE;
}

/**
 * Splits a mixed selection so each half runs through its own correct path.
 * A legacy row is never folded into a governed Omni operation, and an Omni row
 * is never folded into a legacy direct update.
 */
export function splitBySource<T extends InAppNotificationRoutingFields>(
  notifications: readonly T[],
): { omni: T[]; legacy: T[] } {
  const omni: T[] = [];
  const legacy: T[] = [];
  for (const item of notifications) {
    (isOmniCommsNotification(item) ? omni : legacy).push(item);
  }
  return { omni, legacy };
}

/**
 * A business CTA may only point inside the portal. Anything absolute,
 * protocol-relative or carrying a scheme is refused so an in-app action can
 * never become an uncontrolled external navigation.
 */
export function isSafeInternalActionUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > 512) return false;
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//')) return false;
  if (/[\s<>"']/.test(trimmed)) return false;
  if (/^\/+\\/.test(trimmed)) return false;
  // `javascript:`, `data:` and friends can never survive a leading slash, but
  // an embedded scheme in a crafted path is refused explicitly all the same.
  if (/^\/[^?#]*:[^/?#]*\//.test(trimmed)) return false;
  return true;
}

function raise(error: { message?: string } | null, fallback: string): never {
  throw new InAppEngagementError(error?.message?.trim() || fallback);
}

/** Records one governed engagement (read or action click). */
export async function recordEngagement(
  client: InAppRpcClient,
  notificationId: string,
  engagement: InAppEngagement,
): Promise<void> {
  if (!notificationId) {
    throw new InAppEngagementError('A notification reference is required.');
  }
  const { error } = await client.rpc('omni_comms_in_app_record_engagement', {
    p_notification_id: notificationId,
    p_engagement: engagement,
  });
  if (error) raise(error, 'The notification could not be updated.');
}

/** Records a governed bulk read across an explicit selection. */
export async function recordEngagementBulk(
  client: InAppRpcClient,
  notificationIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(notificationIds.filter((id) => typeof id === 'string' && id !== ''))];
  if (ids.length === 0) return;
  const { error } = await client.rpc('omni_comms_in_app_record_engagement_bulk', {
    p_notification_ids: ids,
  });
  if (error) raise(error, 'The notifications could not be updated.');
}

/**
 * Marks every unread Omni-Comms notification of the signed-in user as read.
 * The server resolves the set from `auth.uid()`; no identity is sent.
 */
export async function markAllOmniUnread(client: InAppRpcClient): Promise<void> {
  const { error } = await client.rpc('omni_comms_in_app_record_engagement_bulk', {
    p_notification_ids: null,
  });
  if (error) raise(error, 'The notifications could not be updated.');
}
