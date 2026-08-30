/**
 * BN Notification Integration Service
 * 
 * Bridges Benefits module lifecycle events to the existing enterprise
 * notification system (notification_templates, notification_logs,
 * in_app_notifications, send-notification edge function).
 * 
 * Does NOT create a separate notification subsystem — reuses platform infrastructure.
 */
import { supabase } from '@/integrations/supabase/client';

import { formatAuditTimestamp, formatDate, formatNumber } from '@/lib/culture/culture';
const db = supabase as any;

// ─── Event Codes ───────────────────────────────────────────────────

export type BnEventCode =
  | 'bn.claim.created'
  | 'bn.claim.submitted'
  | 'bn.claim.verified'
  | 'bn.evidence.requested'
  | 'bn.calc.completed'
  | 'bn.decision.pending'
  | 'bn.claim.approved'
  | 'bn.claim.disallowed'
  | 'bn.entitlement.created'
  | 'bn.payable.blocked'
  | 'bn.payable.ready'
  | 'bn.schedule.created'
  | 'bn.batch.created'
  | 'bn.batch.approved'
  | 'bn.issue.started'
  | 'bn.issue.completed'
  | 'bn.issue.failed'
  | 'bn.postissue.completed'
  | 'bn.payment.cancel_requested'
  | 'bn.payment.reissue_requested'
  | 'bn.correction.completed'
  | 'bn.sla.escalated';

export type BnNotificationChannel = 'email' | 'sms' | 'in_app' | 'push';

export type BnNotificationPriority = 'low' | 'normal' | 'high' | 'critical';

// ─── Event Configuration ───────────────────────────────────────────

export interface BnEventConfig {
  eventCode: BnEventCode;
  channels: BnNotificationChannel[];
  priority: BnNotificationPriority;
  recipientStrategy: 'claimant' | 'officer' | 'supervisor' | 'finance' | 'multi';
  externalRecipient: boolean; // true = claimant-facing (email/sms)
  internalRecipient: boolean; // true = staff-facing (in-app)
  retryCount: number;
  retryIntervalSec: number;
  escalationMinutes?: number; // for in-app re-alert
  entityType: 'claim' | 'entitlement' | 'payment_batch' | 'payment_instruction' | 'post_issue';
}

const EVENT_CONFIGS: Record<BnEventCode, BnEventConfig> = {
  'bn.claim.created': {
    eventCode: 'bn.claim.created',
    channels: ['email', 'sms'],
    priority: 'normal',
    recipientStrategy: 'claimant',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.claim.submitted': {
    eventCode: 'bn.claim.submitted',
    channels: ['email', 'sms', 'in_app'],
    priority: 'normal',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.claim.verified': {
    eventCode: 'bn.claim.verified',
    channels: ['email'],
    priority: 'normal',
    recipientStrategy: 'claimant',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.evidence.requested': {
    eventCode: 'bn.evidence.requested',
    channels: ['email', 'sms'],
    priority: 'high',
    recipientStrategy: 'claimant',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.calc.completed': {
    eventCode: 'bn.calc.completed',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'officer',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'claim',
  },
  'bn.decision.pending': {
    eventCode: 'bn.decision.pending',
    channels: ['in_app', 'email'],
    priority: 'high',
    recipientStrategy: 'supervisor',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'claim',
  },
  'bn.claim.approved': {
    eventCode: 'bn.claim.approved',
    channels: ['email', 'sms', 'in_app'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.claim.disallowed': {
    eventCode: 'bn.claim.disallowed',
    channels: ['email', 'sms', 'in_app'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.entitlement.created': {
    eventCode: 'bn.entitlement.created',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'officer',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'entitlement',
  },
  'bn.payable.blocked': {
    eventCode: 'bn.payable.blocked',
    channels: ['in_app'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    escalationMinutes: 1440, // 24hrs
    entityType: 'payment_instruction',
  },
  'bn.payable.ready': {
    eventCode: 'bn.payable.ready',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'finance',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'payment_instruction',
  },
  'bn.schedule.created': {
    eventCode: 'bn.schedule.created',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'officer',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'claim',
  },
  'bn.batch.created': {
    eventCode: 'bn.batch.created',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'finance',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'payment_batch',
  },
  'bn.batch.approved': {
    eventCode: 'bn.batch.approved',
    channels: ['in_app'],
    priority: 'high',
    recipientStrategy: 'finance',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    escalationMinutes: 240, // 4hrs
    entityType: 'payment_batch',
  },
  'bn.issue.started': {
    eventCode: 'bn.issue.started',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'finance',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'payment_batch',
  },
  'bn.issue.completed': {
    eventCode: 'bn.issue.completed',
    channels: ['email', 'sms', 'in_app'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'payment_batch',
  },
  'bn.issue.failed': {
    eventCode: 'bn.issue.failed',
    channels: ['in_app', 'email'],
    priority: 'critical',
    recipientStrategy: 'multi',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    escalationMinutes: 15,
    entityType: 'payment_batch',
  },
  'bn.postissue.completed': {
    eventCode: 'bn.postissue.completed',
    channels: ['in_app'],
    priority: 'normal',
    recipientStrategy: 'officer',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    entityType: 'post_issue',
  },
  'bn.payment.cancel_requested': {
    eventCode: 'bn.payment.cancel_requested',
    channels: ['in_app', 'email'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'payment_instruction',
  },
  'bn.payment.reissue_requested': {
    eventCode: 'bn.payment.reissue_requested',
    channels: ['in_app'],
    priority: 'high',
    recipientStrategy: 'finance',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    escalationMinutes: 2880, // 48hrs
    entityType: 'payment_instruction',
  },
  'bn.correction.completed': {
    eventCode: 'bn.correction.completed',
    channels: ['email', 'sms', 'in_app'],
    priority: 'high',
    recipientStrategy: 'multi',
    externalRecipient: true,
    internalRecipient: true,
    retryCount: 3,
    retryIntervalSec: 60,
    entityType: 'claim',
  },
  'bn.sla.escalated': {
    eventCode: 'bn.sla.escalated',
    channels: ['in_app', 'email'],
    priority: 'critical',
    recipientStrategy: 'supervisor',
    externalRecipient: false,
    internalRecipient: true,
    retryCount: 0,
    retryIntervalSec: 0,
    escalationMinutes: 30,
    entityType: 'claim',
  },
};

// ─── Dispatch Request ──────────────────────────────────────────────

export interface BnNotificationDispatchRequest {
  eventCode: BnEventCode;
  entityId: string;
  claimId?: string;
  ssn?: string;
  templateData: Record<string, string | number | boolean>;
  triggeredBy: string; // UserCode
  /** Override channels from config */
  channelOverride?: BnNotificationChannel[];
  /** Additional in-app recipient user IDs */
  additionalInternalRecipients?: string[];
}

export interface BnNotificationResult {
  dispatched: boolean;
  channels: Array<{
    channel: BnNotificationChannel;
    success: boolean;
    logId?: string;
    error?: string;
  }>;
  workflowGoverned: boolean;
}

// ─── Core Service ──────────────────────────────────────────────────

/**
 * Check if the entity is under active workflow governance.
 * If so, notifications should flow through workflow_action_notifications.
 */
async function isWorkflowGoverned(entityId: string): Promise<boolean> {
  const { data } = await db
    .from('workflow_instances')
    .select('id')
    .eq('source_record_id', entityId)
    .not('status', 'in', '("Completed","Rejected","Cancelled")')
    .limit(1);
  return !!(data && data.length > 0);
}

/**
 * Resolve claimant contact info from ip_master via SSN.
 */
async function resolveClaimantContact(ssn: string): Promise<{
  email?: string;
  phone?: string;
  name: string;
} | null> {
  const { data } = await db
    .from('ip_master')
    .select('email, email_addr, phone_cell, phone_home, first_name, surname')
    .eq('ssn', ssn.trim())
    .maybeSingle();

  if (!data) return null;

  return {
    email: data.email || data.email_addr || undefined,
    phone: data.phone_cell || data.phone_home || undefined,
    name: `${data.first_name || ''} ${data.surname || ''}`.trim(),
  };
}

/**
 * Resolve assigned officer's profile for in-app notifications.
 */
async function resolveOfficerProfile(userId: string): Promise<{
  id: string;
  email?: string;
  name: string;
} | null> {
  const { data } = await db
    .from('profiles')
    .select('id, email, full_name, user_code')
    .eq('id', userId)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    email: data.email,
    name: data.full_name || data.user_code || 'Unknown',
  };
}

/**
 * Look up enabled notification templates by trigger_event.
 */
async function findTemplates(eventCode: string, channel?: string) {
  let q = db
    .from('notification_templates')
    .select('id, name, subject, body, placeholders, channel, trigger_event')
    .eq('trigger_event', eventCode)
    .eq('is_enabled', true);

  if (channel) {
    q = q.eq('channel', channel);
  }

  const { data, error } = await q;
  if (error) {
    console.error(`[BN-Notif] Template lookup failed for ${eventCode}:`, error);
    return [];
  }
  return data ?? [];
}

/**
 * Substitute template variables into a body string.
 */
function substituteVariables(body: string, variables: Record<string, string | number | boolean>): string {
  let result = body;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(value));
  }
  return result;
}

/**
 * Generate idempotency key to prevent duplicate sends.
 */
function makeIdempotencyKey(eventCode: string, entityId: string): string {
  const minuteBucket = Math.floor(Date.now() / 60000);
  return `bn:${eventCode}:${entityId}:${minuteBucket}`;
}

/**
 * Insert an in-app notification for a staff member.
 */
async function sendInAppNotification(params: {
  recipientUserId: string;
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  priority: string;
  module: string;
}): Promise<string | null> {
  const { data, error } = await db
    .from('in_app_notifications')
    .insert({
      user_id: params.recipientUserId,
      title: params.title,
      message: params.message,
      type: 'benefit_management',
      entity_type: params.entityType,
      entity_id: params.entityId,
      priority: params.priority,
      is_read: false,
      module: params.module,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[BN-Notif] In-app notification insert failed:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Log notification dispatch to notification_logs.
 */
async function logNotification(params: {
  templateId?: string;
  channel: string;
  recipientEmail?: string;
  recipientPhone?: string;
  status: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
}): Promise<string | null> {
  const { data, error } = await db
    .from('notification_logs')
    .insert({
      template_id: params.templateId,
      channel: params.channel,
      recipient_email: params.recipientEmail,
      recipient_phone: params.recipientPhone,
      status: params.status,
      module: 'benefit_management',
      entity_type: params.entityType,
      entity_id: params.entityId,
      metadata: params.metadata,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[BN-Notif] Log insert failed:', error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * Log audit event for notification dispatch.
 */
async function logAuditEvent(params: {
  action: string;
  entityType: string;
  entityId: string;
  afterValue: Record<string, any>;
  userId: string;
}) {
  try {
    await db.from('audit_logs').insert({
      action: params.action,
      module: 'benefit_management',
      entity_type: params.entityType,
      entity_id: params.entityId,
      after_value: params.afterValue,
      user_id: params.userId,
      source: 'App',
    });
  } catch (err) {
    console.error('[BN-Notif] Audit log failed:', err);
  }
}

/**
 * Dispatch external notification (email/SMS) via the platform's send-notification edge function.
 */
async function dispatchExternal(params: {
  channel: 'email' | 'sms';
  templateId: string;
  recipientEmail?: string;
  recipientPhone?: string;
  recipientName: string;
  subject: string;
  body: string;
  entityType: string;
  entityId: string;
}): Promise<{ success: boolean; logId?: string; error?: string }> {
  const logId = await logNotification({
    templateId: params.templateId,
    channel: params.channel,
    recipientEmail: params.recipientEmail,
    recipientPhone: params.recipientPhone,
    status: 'queued',
    entityType: params.entityType,
    entityId: params.entityId,
  });

  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const response = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseKey}`,
        apikey: supabaseKey,
      },
      body: JSON.stringify({
        to: params.channel === 'email' ? params.recipientEmail : params.recipientPhone,
        channel: params.channel,
        subject: params.subject,
        body: params.body,
        template_id: params.templateId,
        recipient_name: params.recipientName,
        module: 'benefit_management',
        entity_type: params.entityType,
        entity_id: params.entityId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      // Update log status to failed
      if (logId) {
        await db.from('notification_logs').update({ status: 'failed' }).eq('id', logId);
      }
      return { success: false, logId: logId ?? undefined, error: errText };
    }

    // Update log status to sent
    if (logId) {
      await db.from('notification_logs').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', logId);
    }

    return { success: true, logId: logId ?? undefined };
  } catch (err: any) {
    if (logId) {
      await db.from('notification_logs').update({ status: 'failed' }).eq('id', logId);
    }
    return { success: false, logId: logId ?? undefined, error: err.message };
  }
}

// ─── Main Dispatch Function ────────────────────────────────────────

/**
 * Dispatch a BN notification event through the existing enterprise notification system.
 * 
 * 1. Checks workflow governance (delegates if governed)
 * 2. Resolves templates by trigger_event
 * 3. Resolves recipient contacts
 * 4. Sends via appropriate channels
 * 5. Logs to notification_logs + audit_logs
 */
/**
 * QUARANTINED LEGACY PATH — Omni-Comms convergence.
 *
 * This dispatcher wrote Benefits notifications directly to
 * `in_app_notifications` / `notification_logs`, bypassing the governed
 * Omni-Comms spine. It has no remaining callers. It is retained for
 * historical reference and reading of legacy records only, and refuses to
 * dispatch. Benefits business communications go through
 * `triggerClaimCommunicationViaOmniComms()` → `sendCommunication`.
 */
export async function dispatchBnNotification(
  request: BnNotificationDispatchRequest
): Promise<BnNotificationResult> {
  throw new Error(
    'dispatchBnNotification is quarantined. Raise Benefits communications through Omni-Comms ' +
      '(triggerClaimCommunicationViaOmniComms / sendCommunication).',
  );
  // eslint-disable-next-line no-unreachable

  const config = EVENT_CONFIGS[request.eventCode];
  if (!config) {
    console.warn(`[BN-Notif] No config for event: ${request.eventCode}`);
    return { dispatched: false, channels: [], workflowGoverned: false };
  }

  // 1. Check workflow governance
  const governed = await isWorkflowGoverned(request.entityId);
  if (governed) {
    // Log audit event only; workflow handles notification dispatch
    await logAuditEvent({
      action: 'NOTIFICATION_DELEGATED_TO_WORKFLOW',
      entityType: config.entityType,
      entityId: request.entityId,
      afterValue: {
        event_code: request.eventCode,
        delegation_reason: 'Active workflow instance governs this entity',
      },
      userId: request.triggeredBy,
    });

    return { dispatched: true, channels: [], workflowGoverned: true };
  }

  // 2. Resolve SSN for claimant contact
  const ssn = request.ssn || await resolveClaimSsn(request.claimId || request.entityId);
  const channels = request.channelOverride || config.channels;
  const results: BnNotificationResult['channels'] = [];

  // 3. Process each channel
  for (const channel of channels) {
    if (channel === 'in_app' || channel === 'push') {
      // Internal: in-app notification to staff
      const internalResult = await handleInternalNotification(
        request, config, ssn
      );
      results.push({
        channel: 'in_app',
        success: internalResult.success,
        logId: internalResult.logId,
        error: internalResult.error,
      });
    } else if ((channel === 'email' || channel === 'sms') && config.externalRecipient && ssn) {
      // External: email/SMS to claimant
      const externalResult = await handleExternalNotification(
        request, config, channel, ssn
      );
      results.push(externalResult);
    }
  }

  // 4. Audit event
  await logAuditEvent({
    action: results.some(r => r.success) ? 'NOTIFICATION_DISPATCHED' : 'NOTIFICATION_FAILED',
    entityType: config.entityType,
    entityId: request.entityId,
    afterValue: {
      event_code: request.eventCode,
      channels: results.map(r => ({ channel: r.channel, success: r.success })),
      triggered_by: request.triggeredBy,
    },
    userId: request.triggeredBy,
  });

  return {
    dispatched: results.some(r => r.success),
    channels: results,
    workflowGoverned: false,
  };
}

// ─── Internal Helpers ──────────────────────────────────────────────

async function resolveClaimSsn(claimId: string): Promise<string | null> {
  const { data } = await db
    .from('bn_claim')
    .select('ssn')
    .eq('id', claimId)
    .maybeSingle();
  return data?.ssn ?? null;
}

async function handleInternalNotification(
  request: BnNotificationDispatchRequest,
  config: BnEventConfig,
  _ssn: string | null
): Promise<{ success: boolean; logId?: string; error?: string }> {
  // Find in-app template
  const templates = await findTemplates(request.eventCode, 'in_app');
  const template = templates[0];

  const title = template
    ? substituteVariables(template.subject || template.name, request.templateData)
    : `[BN] ${request.eventCode}`;
  const message = template
    ? substituteVariables(template.body, request.templateData)
    : JSON.stringify(request.templateData);

  // Determine internal recipients based on strategy
  const recipientIds: string[] = [];

  if (request.claimId || request.entityId) {
    // Get assigned officer from claim
    const { data: claim } = await db
      .from('bn_claim')
      .select('assigned_to, entered_by')
      .eq('id', request.claimId || request.entityId)
      .maybeSingle();

    if (claim?.assigned_to && config.recipientStrategy !== 'supervisor') {
      recipientIds.push(claim.assigned_to);
    }
    if (claim?.entered_by && config.recipientStrategy === 'officer') {
      recipientIds.push(claim.entered_by);
    }
  }

  // Add supervisor/finance roles for escalation events
  if (['supervisor', 'finance', 'multi'].includes(config.recipientStrategy)) {
    const { data: supervisors } = await db
      .from('user_roles')
      .select('user_id')
      .in('role', ['supervisor', 'manager', 'bn_approver', 'finance_officer'])
      .limit(10);

    if (supervisors) {
      recipientIds.push(...supervisors.map((s: any) => s.user_id));
    }
  }

  // Add explicit additional recipients
  if (request.additionalInternalRecipients) {
    recipientIds.push(...request.additionalInternalRecipients);
  }

  // Deduplicate
  const uniqueIds = [...new Set(recipientIds)];

  let anySuccess = false;
  let lastError: string | undefined;

  for (const userId of uniqueIds) {
    const id = await sendInAppNotification({
      recipientUserId: userId,
      title,
      message,
      entityType: config.entityType,
      entityId: request.entityId,
      priority: config.priority,
      module: 'benefit_management',
    });

    if (id) {
      anySuccess = true;
    } else {
      lastError = `Failed to send in-app to ${userId}`;
    }
  }

  return { success: anySuccess, error: lastError };
}

async function handleExternalNotification(
  request: BnNotificationDispatchRequest,
  config: BnEventConfig,
  channel: 'email' | 'sms',
  ssn: string
): Promise<{
  channel: BnNotificationChannel;
  success: boolean;
  logId?: string;
  error?: string;
}> {
  // Resolve claimant contact
  const contact = await resolveClaimantContact(ssn);
  if (!contact) {
    return {
      channel,
      success: false,
      error: `Claimant not found for SSN ${ssn}`,
    };
  }

  const recipientAddress = channel === 'email' ? contact.email : contact.phone;
  if (!recipientAddress) {
    return {
      channel,
      success: false,
      error: `No ${channel} contact for claimant ${ssn}`,
    };
  }

  // Find template for this channel
  const templates = await findTemplates(request.eventCode, channel);
  const template = templates[0];
  if (!template) {
    return {
      channel,
      success: false,
      error: `No enabled ${channel} template for ${request.eventCode}`,
    };
  }

  const allVars = {
    ...request.templateData,
    ClaimantName: contact.name,
  };

  const subject = substituteVariables(template.subject || '', allVars);
  const body = substituteVariables(template.body || '', allVars);

  const result = await dispatchExternal({
    channel,
    templateId: template.id,
    recipientEmail: channel === 'email' ? recipientAddress : undefined,
    recipientPhone: channel === 'sms' ? recipientAddress : undefined,
    recipientName: contact.name,
    subject,
    body,
    entityType: config.entityType,
    entityId: request.entityId,
  });

  return { channel, ...result };
}

// ─── Convenience Dispatchers ───────────────────────────────────────

export async function notifyClaimCreated(claimId: string, claimNumber: string, benefitType: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.claim.created',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, BenefitType: benefitType, SubmissionDate: formatDate(new Date()) },
    triggeredBy,
  });
}

export async function notifyClaimSubmitted(claimId: string, claimNumber: string, benefitType: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.claim.submitted',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, BenefitType: benefitType, SubmissionDate: formatDate(new Date()), ExpectedProcessingDays: 10 },
    triggeredBy,
  });
}

export async function notifyClaimVerified(claimId: string, claimNumber: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.claim.verified',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, VerifiedDate: formatDate(new Date()), NextStep: 'Benefit calculation and eligibility assessment' },
    triggeredBy,
  });
}

export async function notifyEvidenceRequested(
  claimId: string,
  claimNumber: string,
  evidenceType: string,
  evidenceDescription: string,
  dueDate: string,
  triggeredBy: string
) {
  return dispatchBnNotification({
    eventCode: 'bn.evidence.requested',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, EvidenceType: evidenceType, EvidenceDescription: evidenceDescription, DueDate: dueDate, UploadInstructions: 'Please visit the Social Security Board office or upload via the online portal.' },
    triggeredBy,
  });
}

export async function notifyCalculationCompleted(
  claimId: string,
  claimNumber: string,
  benefitType: string,
  weeklyRate: number,
  monthlyRate: number,
  lumpSum: number,
  overrideApplied: boolean,
  triggeredBy: string,
  supervisorId?: string
) {
  return dispatchBnNotification({
    eventCode: 'bn.calc.completed',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, BenefitType: benefitType, WeeklyRate: weeklyRate, MonthlyRate: monthlyRate, LumpSum: lumpSum, CalcDate: formatDate(new Date()), OverrideApplied: overrideApplied },
    triggeredBy,
    additionalInternalRecipients: overrideApplied && supervisorId ? [supervisorId] : undefined,
  });
}

export async function notifyDecisionPending(claimId: string, claimNumber: string, claimantName: string, benefitType: string, recommendedRate: number, assignedOfficer: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.decision.pending',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, ClaimantName: claimantName, BenefitType: benefitType, RecommendedRate: recommendedRate, AssignedOfficer: assignedOfficer, SLADeadline: '48 hours' },
    triggeredBy,
  });
}

export async function notifyClaimApproved(
  claimId: string,
  claimNumber: string,
  benefitType: string,
  weeklyRate: number,
  monthlyRate: number,
  lumpSum: number,
  effectiveDate: string,
  paymentMethod: string,
  approverName: string,
  triggeredBy: string
) {
  return dispatchBnNotification({
    eventCode: 'bn.claim.approved',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, BenefitType: benefitType, WeeklyRate: weeklyRate, MonthlyRate: monthlyRate, LumpSum: lumpSum, EffectiveDate: effectiveDate, PaymentMethod: paymentMethod, ApproverName: approverName },
    triggeredBy,
  });
}

export async function notifyClaimDisallowed(
  claimId: string,
  claimNumber: string,
  benefitType: string,
  reasonCode: string,
  reasonDescription: string,
  decisionDate: string,
  triggeredBy: string
) {
  return dispatchBnNotification({
    eventCode: 'bn.claim.disallowed',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, BenefitType: benefitType, ReasonCode: reasonCode, ReasonDescription: reasonDescription, DecisionDate: decisionDate, AppealDeadline: '30 days from date of decision', AppealInstructions: 'Submit a written appeal to the Director of the Social Security Board.' },
    triggeredBy,
  });
}

export async function notifyEntitlementCreated(claimId: string, entitlementId: string, claimNumber: string, entitlementType: string, effectiveDate: string, endDate: string, rate: number, frequency: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.entitlement.created',
    entityId: entitlementId,
    claimId,
    templateData: { ClaimNumber: claimNumber, EntitlementType: entitlementType, EffectiveDate: effectiveDate, EndDate: endDate, Rate: rate, Frequency: frequency },
    triggeredBy,
  });
}

export async function notifyPayableBlocked(instructionId: string, claimId: string, claimNumber: string, claimantName: string, amount: number, blockReason: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.payable.blocked',
    entityId: instructionId,
    claimId,
    templateData: { ClaimNumber: claimNumber, ClaimantName: claimantName, Amount: amount, BlockReason: blockReason, BlockedDate: formatDate(new Date()), InstructionId: instructionId },
    triggeredBy,
  });
}

export async function notifyPayableReady(instructionId: string, claimNumber: string, amount: number, paymentMethod: string, frequency: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.payable.ready',
    entityId: instructionId,
    templateData: { ClaimNumber: claimNumber, Amount: amount, PaymentMethod: paymentMethod, Frequency: frequency, ReadyDate: formatDate(new Date()) },
    triggeredBy,
  });
}

export async function notifyBatchCreated(batchId: string, batchNumber: string, batchType: string, instructionCount: number, totalAmount: number, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.batch.created',
    entityId: batchId,
    templateData: { BatchNumber: batchNumber, BatchType: batchType, CreatedDate: formatDate(new Date()), InstructionCount: instructionCount, TotalAmount: totalAmount },
    triggeredBy,
  });
}

export async function notifyBatchApproved(batchId: string, batchNumber: string, approvedBy: string, instructionCount: number, totalAmount: number, paymentMethod: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.batch.approved',
    entityId: batchId,
    templateData: { BatchNumber: batchNumber, ApprovedBy: approvedBy, ApprovedDate: formatDate(new Date()), InstructionCount: instructionCount, TotalAmount: totalAmount, PaymentMethod: paymentMethod },
    triggeredBy,
  });
}

export async function notifyIssueStarted(batchId: string, batchNumber: string, instructionCount: number, totalAmount: number, paymentMethod: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.issue.started',
    entityId: batchId,
    templateData: { BatchNumber: batchNumber, InstructionCount: instructionCount, TotalAmount: totalAmount, IssueStartTime: formatAuditTimestamp(new Date()), PaymentMethod: paymentMethod },
    triggeredBy,
  });
}

export async function notifyIssueCompleted(batchId: string, batchNumber: string, successCount: number, totalAmount: number, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.issue.completed',
    entityId: batchId,
    templateData: { BatchNumber: batchNumber, SuccessCount: successCount, TotalAmount: totalAmount, IssueDate: formatDate(new Date()) },
    triggeredBy,
  });
}

export async function notifyIssueFailed(batchId: string, batchNumber: string, failedCount: number, successCount: number, errorSummary: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.issue.failed',
    entityId: batchId,
    templateData: { BatchNumber: batchNumber, FailedCount: failedCount, SuccessCount: successCount, ErrorSummary: errorSummary, IssueDate: formatDate(new Date()) },
    triggeredBy,
  });
}

export async function notifyPostIssueCompleted(claimId: string, claimNumber: string, tasksCompleted: number, claimStatus: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.postissue.completed',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, TasksCompleted: tasksCompleted, CompletionDate: formatDate(new Date()), ClaimStatus: claimStatus },
    triggeredBy,
  });
}

export async function notifyCancellationRequested(instructionId: string, claimId: string, claimNumber: string, amount: number, cancellationReason: string, requestedBy: string, originalChequeNumber: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.payment.cancel_requested',
    entityId: instructionId,
    claimId,
    templateData: { ClaimNumber: claimNumber, Amount: amount, CancellationReason: cancellationReason, RequestedBy: requestedBy, RequestDate: formatDate(new Date()), OriginalChequeNumber: originalChequeNumber },
    triggeredBy,
  });
}

export async function notifyReissueRequested(instructionId: string, claimNumber: string, originalAmount: number, originalChequeNumber: string, reissueReason: string, requestedBy: string, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.payment.reissue_requested',
    entityId: instructionId,
    templateData: { ClaimNumber: claimNumber, OriginalAmount: originalAmount, OriginalChequeNumber: originalChequeNumber, ReissueReason: reissueReason, RequestedBy: requestedBy },
    triggeredBy,
  });
}

export async function notifyCorrectionCompleted(claimId: string, claimNumber: string, oldRate: number, newRate: number, correctionReason: string, effectiveDate: string, arrears: number, overpayment: number, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.correction.completed',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, OldRate: oldRate, NewRate: newRate, CorrectionReason: correctionReason, EffectiveDate: effectiveDate, Arrears: arrears, Overpayment: overpayment },
    triggeredBy,
  });
}

export async function notifySlaEscalation(claimId: string, claimNumber: string, taskType: string, assignedTo: string, dueDate: string, daysOverdue: number, escalationLevel: number, triggeredBy: string) {
  return dispatchBnNotification({
    eventCode: 'bn.sla.escalated',
    entityId: claimId,
    claimId,
    templateData: { ClaimNumber: claimNumber, TaskType: taskType, AssignedTo: assignedTo, DueDate: dueDate, DaysOverdue: daysOverdue, EscalationLevel: escalationLevel },
    triggeredBy,
  });
}

// ─── Query Helpers ─────────────────────────────────────────────────

/**
 * Get notification history for a claim (from notification_logs).
 */
export async function getClaimNotificationHistory(claimId: string) {
  const { data, error } = await db
    .from('notification_logs')
    .select('id, template_id, channel, status, recipient_email, recipient_phone, sent_at, created_at, metadata')
    .eq('module', 'benefit_management')
    .eq('entity_id', claimId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[BN-Notif] History query failed:', error);
    return [];
  }
  return data ?? [];
}

/**
 * Get notification statistics for a batch.
 */
export async function getBatchNotificationStats(batchId: string) {
  const { data, error } = await db
    .from('notification_logs')
    .select('status, channel')
    .eq('module', 'benefit_management')
    .eq('entity_id', batchId);

  if (error) return { total: 0, sent: 0, failed: 0, queued: 0 };

  const logs = data ?? [];
  return {
    total: logs.length,
    sent: logs.filter((l: any) => l.status === 'sent').length,
    failed: logs.filter((l: any) => l.status === 'failed').length,
    queued: logs.filter((l: any) => l.status === 'queued').length,
  };
}

/**
 * Retry a failed notification.
 */
export async function retryFailedNotification(logId: string, retriedBy: string): Promise<boolean> {
  const { data: log } = await db
    .from('notification_logs')
    .select('*')
    .eq('id', logId)
    .eq('status', 'failed')
    .single();

  if (!log) return false;

  // Reset to queued
  await db.from('notification_logs').update({ status: 'queued' }).eq('id', logId);

  await logAuditEvent({
    action: 'NOTIFICATION_RETRIED',
    entityType: log.entity_type || 'claim',
    entityId: log.entity_id || '',
    afterValue: { notification_log_id: logId, retried_by: retriedBy },
    userId: retriedBy,
  });

  return true;
}
