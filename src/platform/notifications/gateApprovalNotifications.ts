/**
 * Platform notification bridge — Omnichannel Communications gate approvals.
 *
 * Lives OUTSIDE the Omni-Comms namespace on purpose: Omni-Comms code may not
 * touch the platform notification tables directly. Callers pass intent only;
 * this module resolves the administrator audience and raises:
 *   - an in-app alert (notification centre + bell), and
 *   - a best-effort internal email through the existing send-notification
 *     platform function.
 *
 * Delivery here is advisory. A failure never blocks a gate decision.
 */
import { emitGateApprovalAlert } from '@/platform/omni-comms/integrations/business/platformApprovalAlertProducer';
import { supabase } from '@/integrations/supabase/client';

export type GateApprovalNotificationEvent = 'requested' | 'approved' | 'rejected';

export interface GateApprovalNotificationInput {
  event: GateApprovalNotificationEvent;
  /** Human title of the gate change, e.g. "Turn on automatic email delivery". */
  subject: string;
  /** Who acted, for the audit line in the message. */
  actorName?: string | null;
  /** Reason or comment supplied by the actor. */
  comment?: string | null;
  /** Central workflow instance id, used for de-duplication and deep links. */
  workflowInstanceId?: string | null;
  /** Where the recipient should go to act. */
  link?: string;
}

const ADMIN_ROLES = ['admin', 'super_admin', 'platform_admin'];
const MAX_RECIPIENTS = 25;

const HEADLINE: Record<GateApprovalNotificationEvent, string> = {
  requested: 'Approval needed: communications delivery gate',
  approved: 'Approved: communications delivery gate',
  rejected: 'Rejected: communications delivery gate',
};

interface Recipient {
  userId: string;
  email: string | null;
  name: string | null;
}

async function resolveAdminRecipients(): Promise<Recipient[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { data: roles, error } = await db
    .from('user_roles')
    .select('user_id, role')
    .in('role', ADMIN_ROLES)
    .limit(200);
  if (error || !roles?.length) return [];

  const ids = Array.from(
    new Set((roles as { user_id: string }[]).map((r) => r.user_id).filter(Boolean)),
  ).slice(0, MAX_RECIPIENTS);
  if (ids.length === 0) return [];

  const { data: people } = await db
    .from('profiles')
    .select('id, email, full_name, is_active')
    .in('id', ids);

  const byId = new Map(
    ((people ?? []) as {
      id: string;
      email: string | null;
      full_name: string | null;
      is_active: boolean | null;
    }[])
      .filter((p) => p.is_active !== false)
      .map((p) => [p.id, p]),
  );

  return ids
    .filter((id) => byId.has(id))
    .map((id) => {
      const p = byId.get(id)!;
      return { userId: id, email: p.email ?? null, name: p.full_name ?? null };
    });
}

function buildBody(input: GateApprovalNotificationInput): string {
  const lines = [
    input.event === 'requested'
      ? `${input.actorName ?? 'An operator'} requested: ${input.subject}.`
      : `${input.subject} was ${input.event} by ${input.actorName ?? 'an administrator'}.`,
  ];
  if (input.comment) lines.push(`Note: ${input.comment}`);
  if (input.event === 'requested') {
    lines.push('A second administrator must approve before it takes effect.');
  }
  return lines.join(' ');
}

/**
 * Raise in-app and email alerts for one gate approval event.
 * Never throws — the caller's gate decision must not depend on alerting.
 */
export async function notifyGateApprovalEvent(
  input: GateApprovalNotificationInput,
): Promise<{ inApp: number; emails: number }> {
  try {
    const recipients = await resolveAdminRecipients();
    if (recipients.length === 0) return { inApp: 0, emails: 0 };

    const title = HEADLINE[input.event];
    const body = buildBody(input);
    const link =
      input.link ??
      '/admin/omnichannel-communications/channels?channel=email&view=control-center';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const rows = recipients.map((r) => ({
      user_id: r.userId,
      title,
      body,
      link,
      notification_type: 'approval',
      priority: input.event === 'requested' ? 'high' : 'normal',
      module: 'OMNI_COMMS',
      related_record_id: input.workflowInstanceId ?? null,
      metadata: {
        source: 'omni_comms_gate_approval',
        event: input.event,
        workflow_instance_id: input.workflowInstanceId ?? null,
      },
    }));
    const { error: insertError } = await db.from('in_app_notifications').insert(rows);
    if (insertError) console.warn('[gate-approval-notify] in-app failed', insertError);

    // ── Omni-Comms convergence (Wave 4) ─────────────────────────────
    // The email leg is a governed business communication and is raised
    // through the single facade. No provider is contacted from here.
    // The in-app row above is retained as the compatibility surface until
    // PLATFORM alerts are certified for live delivery; it is not a second
    // sending path — it writes no provider traffic.
    const emission = await emitGateApprovalAlert({
      event: input.event,
      subject: input.subject,
      actorName: input.actorName ?? null,
      comment: input.comment ?? null,
      workflowInstanceId: input.workflowInstanceId ?? null,
      recipients: recipients.map((r) => ({
        userId: r.userId,
        name: r.name ?? null,
        email: r.email ?? null,
      })),
    });

    const emails =
      emission.outcome === 'accepted' || emission.outcome === 'replayed'
        ? recipients.filter((r) => Boolean(r.email)).length
        : 0;
    if (emails === 0 && emission.blockers.length > 0) {
      console.warn('[gate-approval-notify] email leg not accepted', emission.blockers);
    }

    return { inApp: insertError ? 0 : rows.length, emails };
  } catch (e) {
    console.warn('[gate-approval-notify] skipped', e);
    return { inApp: 0, emails: 0 };
  }
}

export default notifyGateApprovalEvent;
