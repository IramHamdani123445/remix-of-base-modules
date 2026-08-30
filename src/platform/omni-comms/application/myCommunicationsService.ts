/**
 * Omni-Comms — "My Communications" (user inbox) application service.
 *
 * READ side of the user-facing communication experience. Every read goes
 * through a governed, `auth.uid()`-scoped RPC:
 *
 *   * omni_comms_in_app_list_my_communications
 *   * omni_comms_in_app_my_unread_count
 *
 * No user identity is ever sent from the browser: the server resolves the
 * owner itself, so a crafted request cannot retrieve another user's inbox.
 *
 * The WRITE side (read / action engagement) deliberately stays in
 * `inAppNotificationService`, which is the single governed mutation path and
 * produces Omni delivery evidence. This module never mutates.
 */
import type { InAppRpcClient } from './inAppNotificationService';

/** One communication as a normal user sees it. */
export interface MyCommunication {
  id: string;
  title: string;
  body: string;
  link: string | null;
  actionLabel: string | null;
  severity: 'info' | 'success' | 'warning' | 'critical' | string;
  category: string;
  moduleCode: string | null;
  eventCode: string | null;
  eventName: string | null;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  actedAt: string | null;
  receivedAt: string;
  hasAttachment: boolean;
  /** Traceability — surfaced only in the technical detail disclosure. */
  requestId: string | null;
  messageId: string | null;
}

export interface MyCommunicationsPage {
  items: MyCommunication[];
  total: number;
}

export class MyCommunicationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MyCommunicationsError';
  }
}

interface RawRow {
  id: string;
  title: string | null;
  body: string | null;
  link: string | null;
  action_label: string | null;
  severity: string | null;
  category: string | null;
  module_code: string | null;
  event_code: string | null;
  event_name: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean | null;
  read_at: string | null;
  acted_at: string | null;
  created_at: string;
  has_attachment: boolean | null;
  request_id: string | null;
  message_id: string | null;
  total_count: number | string | null;
}

/** Human wording for the governed communication classes. */
const CATEGORY_LABELS: Record<string, string> = {
  informational: 'Information',
  transactional: 'Update',
  operational: 'Operational',
  legal_mandatory: 'Official notice',
  reminder: 'Reminder',
  escalation: 'Escalation',
  marketing: 'Announcement',
};

export function categoryLabel(category: string | null | undefined): string {
  if (!category) return 'Information';
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

/** Human wording for a module code such as `INTERNAL_AUDIT`. */
export function moduleLabel(moduleCode: string | null | undefined): string | null {
  if (!moduleCode) return null;
  return moduleCode
    .split(/[_.-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function mapRow(row: RawRow): MyCommunication {
  return {
    id: row.id,
    title: (row.title ?? '').trim() || 'Communication',
    body: row.body ?? '',
    link: row.link,
    actionLabel: row.action_label,
    severity: row.severity ?? 'info',
    category: row.category ?? 'informational',
    moduleCode: row.module_code,
    eventCode: row.event_code,
    eventName: row.event_name,
    entityType: row.entity_type,
    entityId: row.entity_id,
    isRead: row.is_read === true,
    readAt: row.read_at,
    actedAt: row.acted_at,
    receivedAt: row.created_at,
    hasAttachment: row.has_attachment === true,
    requestId: row.request_id,
    messageId: row.message_id,
  };
}

function raise(error: { message?: string } | null, fallback: string): never {
  throw new MyCommunicationsError(error?.message?.trim() || fallback);
}

/** Loads one page of the signed-in user's Omni communications. */
export async function fetchMyCommunications(
  client: InAppRpcClient,
  options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
): Promise<MyCommunicationsPage> {
  const { data, error } = await client.rpc('omni_comms_in_app_list_my_communications', {
    p_limit: options.limit ?? 25,
    p_offset: options.offset ?? 0,
    p_unread_only: options.unreadOnly ?? false,
  });
  if (error) raise(error, 'Your communications could not be loaded.');

  const rows = Array.isArray(data) ? (data as RawRow[]) : [];
  const total = rows.length > 0 ? Number(rows[0].total_count ?? rows.length) : 0;
  return { items: rows.map(mapRow), total: Number.isFinite(total) ? total : rows.length };
}

/**
 * The single authoritative unread figure for the signed-in user.
 * Omni in-app communications only — never workflow approvals, legacy
 * notifications, held dispatch jobs or operator attention.
 */
export async function fetchMyUnreadCount(client: InAppRpcClient): Promise<number> {
  const { data, error } = await client.rpc('omni_comms_in_app_my_unread_count');
  if (error) raise(error, 'The unread count could not be loaded.');
  const value = Number(data ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
