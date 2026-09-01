/**
 * AuditCommunicationService — instance lifecycle:
 *   create draft → submit_for_approval → approve/reject → send (via dispatch) → audit events.
 *
 * Delivery is delegated to the Omni-Comms Hub through the governed Compliance
 * audit producer. This service NEVER contacts a provider directly: it keeps
 * ownership of the communication record, approval gating and the per-recipient
 * delivery ledger, and hands the approved communication to the Hub.
 */
import { supabase } from '@/integrations/supabase/client';
import type {
  AuditCommunication,
  AuditCommunicationApproval,
  AuditCommunicationDelivery,
  AuditCommunicationRecipient,
  CeCommApprovalRole,
  CeCommChannel,
  CreateCommunicationDraftInput,
} from '@/types/auditCommunication';
import { auditCommunicationTemplateService } from './auditCommunicationTemplateService';
import { auditCommunicationRecipientService } from './auditCommunicationRecipientService';
import { resolveOnlineResponse } from './onlineResponseResolver';
import { commApprovalPolicyService } from './commApprovalPolicyService';
import {
  emitAuditCommunicationIssued,
  type AuditCommunicationRecipientInput,
} from '@/platform/omni-comms/integrations/business/complianceAuditCommunicationProducer';
import type { OmniCommsChannel } from '@/platform/omni-comms/sendCommunication';

const COMM = 'ce_audit_communications' as any;
const REC = 'ce_audit_communication_recipients' as any;
const APP = 'ce_audit_communication_approvals' as any;
const DEL = 'ce_audit_communication_deliveries' as any;
const EVT = 'ce_audit_communication_events' as any;

type CommRow = AuditCommunication & {
  recipients?: AuditCommunicationRecipient[];
  approvals?: AuditCommunicationApproval[];
  deliveries?: AuditCommunicationDelivery[];
};

/** Render `{{var}}` placeholders against context, leaving unresolved keys blank. */
function renderTemplate(tpl: string | null, ctx: Record<string, unknown>): string {
  if (!tpl) return '';
  return tpl.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const v = (ctx as any)[key];
    return v == null ? '' : String(v);
  });
}

async function logEvent(communicationId: string, eventType: string, actor?: string, payload: Record<string, unknown> = {}) {
  await (supabase.from(EVT) as any).insert({
    communication_id: communicationId,
    event_type: eventType,
    actor_user_id: actor,
    payload,
  });
}

export const auditCommunicationService = {
  /**
   * Create a draft communication: snapshots subject/body from template,
   * resolves recipients, and creates pending approval rows.
   */
  async createDraft(input: CreateCommunicationDraftInput): Promise<CommRow> {
    const tpl = await auditCommunicationTemplateService.getById(input.templateId);
    if (!tpl) throw new Error('Template not found');

    const ctx = input.contextData || {};
    const subject = renderTemplate(tpl.email_subject, ctx);
    const emailBody = renderTemplate(tpl.email_body, ctx);
    const smsBody = renderTemplate(tpl.sms_body, ctx);
    const channel: CeCommChannel = input.channel || tpl.channel;

    // Resolve the approval plan via the configurable policy layer.
    // Falls back to the template's static approval_rule_json if no policy matches.
    const fallbackRoles = ((tpl.approval_rule_json as any)?.roles ?? []) as any[];
    const plan = await commApprovalPolicyService.resolve(
      {
        commType: tpl.comm_type,
        lifecycleStage: tpl.lifecycle_stage ?? null,
        caseType: input.caseType ?? (input.contextData as any)?.case_type ?? null,
        enforcementStage: input.enforcementStage ?? (input.contextData as any)?.enforcement_stage ?? null,
        severity: input.severity ?? 'none',
      },
      fallbackRoles,
    );

    const { data: comm, error } = await (supabase.from(COMM) as any)
      .insert({
        inspection_id: input.inspectionId ?? null,
        employer_id: input.employerId,
        template_id: tpl.id,
        comm_type: tpl.comm_type,
        channel,
        status: 'draft',
        subject_snapshot: subject,
        email_body_snapshot: emailBody,
        sms_body_snapshot: smsBody,
        context_data_json: ctx,
        report_version_id: input.reportVersionId ?? null,
        scheduled_at: input.scheduledAt ?? null,
        created_by: input.createdBy,
        updated_by: input.createdBy,
        severity_snapshot: input.severity ?? 'none',
        applied_policy_id: plan.policyId,
      })
      .select()
      .single();
    if (error) throw error;

    // Resolve & insert recipients
    const resolved = await auditCommunicationRecipientService.resolve({
      inspectionId: input.inspectionId ?? null,
      employerId: input.employerId,
      prioritySources: tpl.recipient_rule_json?.priority,
    });
    const all = [
      ...resolved.map((r) => ({ ...r, source: r.source })),
      ...(input.manualRecipients || []).map((m, idx) => ({
        ...m,
        source: 'manual' as const,
        is_primary: resolved.length === 0 && idx === 0,
      })),
    ];
    if (all.length) {
      const { error: recErr } = await (supabase.from(REC) as any).insert(
        all.map((r) => ({
          communication_id: (comm as any).id,
          recipient_name: r.name ?? null,
          recipient_email: r.email ?? null,
          recipient_mobile: r.mobile ?? null,
          recipient_role: r.role ?? null,
          source: r.source,
          is_primary: r.is_primary ?? false,
        })),
      );
      if (recErr) throw recErr;
    }

    // Build approval chain from the resolved policy plan
    if (plan.requiredRoles.length) {
      await (supabase.from(APP) as any).insert(
        plan.requiredRoles.map((role, idx) => ({
          communication_id: (comm as any).id,
          step_no: idx + 1,
          required_role: role,
          status: 'pending',
        })),
      );
    }

    await logEvent((comm as any).id, 'draft_created', input.createdBy, {
      policy_id: plan.policyId,
      policy_code: plan.policyCode,
      direct_send_allowed: plan.directSendAllowed,
      required_roles: plan.requiredRoles,
      severity: input.severity ?? 'none',
    });
    return this.getById((comm as any).id) as Promise<CommRow>;
  },

  async getById(id: string): Promise<CommRow | null> {
    const { data, error } = await (supabase.from(COMM) as any)
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const [recipients, approvals, deliveries] = await Promise.all([
      (supabase.from(REC) as any).select('*').eq('communication_id', id).order('created_at'),
      (supabase.from(APP) as any).select('*').eq('communication_id', id).order('step_no'),
      (supabase.from(DEL) as any).select('*').eq('communication_id', id).order('attempted_at'),
    ]);
    return {
      ...(data as CommRow),
      recipients: recipients.data || [],
      approvals: approvals.data || [],
      deliveries: deliveries.data || [],
    };
  },

  async listForInspection(inspectionId: string): Promise<CommRow[]> {
    const { data, error } = await (supabase.from(COMM) as any)
      .select('*')
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as CommRow[];
  },

  async listForEmployer(employerId: string): Promise<CommRow[]> {
    const { data, error } = await (supabase.from(COMM) as any)
      .select('*')
      .eq('employer_id', employerId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []) as CommRow[];
  },

  async submitForApproval(id: string, userCode?: string) {
    const comm = await this.getById(id);
    if (!comm) throw new Error('Not found');
    const newStatus = (comm.approvals?.length ?? 0) > 0 ? 'pending_approval' : 'approved';
    const { error } = await (supabase.from(COMM) as any)
      .update({
        status: newStatus,
        submitted_at: new Date().toISOString(),
        approved_at: newStatus === 'approved' ? new Date().toISOString() : null,
        updated_by: userCode,
      })
      .eq('id', id);
    if (error) throw error;
    await logEvent(id, 'submitted_for_approval', userCode);
    return this.getById(id);
  },

  async cancel(id: string, reason: string, userCode?: string) {
    const { error } = await (supabase.from(COMM) as any)
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: reason,
        updated_by: userCode,
      })
      .eq('id', id);
    if (error) throw error;
    await logEvent(id, 'cancelled', userCode, { reason });
  },

  /**
   * Send the communication: must be in `approved` status.
   * Hands the approved communication to the Omni-Comms Hub. Returns the
   * aggregate hand-over result (accepted vs refused), not provider proof.
   */
  async send(id: string, userCode?: string): Promise<{ ok: boolean; sent: number; failed: number }> {
    const comm = await this.getById(id);
    if (!comm) throw new Error('Not found');
    if (comm.status !== 'approved') throw new Error(`Cannot send: status is ${comm.status}`);

    // Phase 3 — Snapshot resolved online-response permissions onto the
    // communication row at send time so policy edits cannot retroactively
    // change what the employer is allowed to do via the portal.
    let portalSnapshot: Awaited<ReturnType<typeof resolveOnlineResponse>> | null = null;
    try {
      portalSnapshot = await resolveOnlineResponse({
        caseType: (comm.context_data_json as any)?.case_type ?? null,
        communicationType: comm.comm_type,
        reportType: (comm.context_data_json as any)?.report_type ?? null,
        enforcementStage: (comm.context_data_json as any)?.enforcement_stage ?? null,
        templateId: comm.template_id,
      });
    } catch (e) {
      // Resolver failure must not block delivery — default to disabled.
      portalSnapshot = { enabled: false, mode: 'NONE', permissions: {}, review: {}, reason: 'resolver_error' };
    }

    await (supabase.from(COMM) as any)
      .update({
        status: 'sending',
        updated_by: userCode,
        portal_resolved_enabled: portalSnapshot.enabled,
        portal_resolved_mode: portalSnapshot.mode,
        portal_resolved_permissions_json: portalSnapshot.permissions,
        portal_resolved_review_json: portalSnapshot.review,
        portal_matched_policy_id: portalSnapshot.matched_policy_id ?? null,
      })
      .eq('id', id);
    await logEvent(id, 'sending_started', userCode, {
      portal_enabled: portalSnapshot.enabled,
      portal_mode: portalSnapshot.mode,
    });

    const recipients = comm.recipients || [];
    const wantEmail = comm.channel === 'email' || comm.channel === 'both';
    const wantSms = comm.channel === 'sms' || comm.channel === 'both';

    // Channels the Hub is asked to consider. Compliance states the business
    // intent; the Hub decides template, branding, sender and whether the
    // message may actually leave.
    const channels: OmniCommsChannel[] = [
      ...(wantEmail ? (['email'] as const) : []),
      ...(wantSms ? (['sms'] as const) : []),
    ];

    // Per-recipient delivery ledger stays owned by Compliance: it records that
    // the communication was handed to the Hub, not that a provider accepted it.
    const ledger: Array<{ deliveryId: string }> = [];
    const hubRecipients: AuditCommunicationRecipientInput[] = [];

    for (const r of recipients) {
      if (wantEmail && r.recipient_email) {
        const { data: del } = await (supabase.from(DEL) as any)
          .insert({
            communication_id: id,
            recipient_id: r.id,
            channel: 'email',
            recipient_address: r.recipient_email,
            status: 'queued',
          })
          .select()
          .single();
        if (del?.id) ledger.push({ deliveryId: del.id });
      }
      if (wantSms && r.recipient_mobile) {
        const { data: del } = await (supabase.from(DEL) as any)
          .insert({
            communication_id: id,
            recipient_id: r.id,
            channel: 'sms',
            recipient_address: r.recipient_mobile,
            status: 'queued',
          })
          .select()
          .single();
        if (del?.id) ledger.push({ deliveryId: del.id });
      }
      if ((wantEmail && r.recipient_email) || (wantSms && r.recipient_mobile)) {
        hubRecipients.push({
          recipientId: r.id,
          displayName: r.recipient_name ?? null,
          email: r.recipient_email ?? null,
          phone: r.recipient_mobile ?? null,
        });
      }
    }

    let sent = 0;
    let failed = 0;
    let handoverFailure: string | null = null;

    if (hubRecipients.length > 0 && channels.length > 0) {
      const result = await emitAuditCommunicationIssued({
        communicationId: id,
        commType: comm.comm_type ?? null,
        caseType: (comm.context_data_json as any)?.case_type ?? null,
        subject: comm.subject_snapshot ?? null,
        emailBody: comm.email_body_snapshot ?? null,
        smsBody: comm.sms_body_snapshot ?? null,
        channels,
        recipients: hubRecipients,
      });

      const accepted = result.outcome === 'accepted' || result.outcome === 'replayed';
      if (accepted) {
        sent = ledger.length;
      } else {
        failed = ledger.length;
        handoverFailure = result.blockers.join(', ') || result.outcome;
      }

      for (const entry of ledger) {
        await (supabase.from(DEL) as any)
          .update(
            accepted
              ? { status: 'queued', failure_reason: null }
              : { status: 'failed', failure_reason: handoverFailure?.slice(0, 500) ?? 'not_accepted' },
          )
          .eq('id', entry.deliveryId);
      }

      await logEvent(id, 'hub_handover', userCode, {
        outcome: result.outcome,
        blockers: result.blockers,
        request_id: result.requestId,
        channels,
      });
    }


    // `sent` here means "accepted by the Hub". Actual dispatch is decided by
    // the governed delivery state of the channel, never by Compliance.
    const finalStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
    await (supabase.from(COMM) as any)
      .update({ status: finalStatus, sent_at: new Date().toISOString(), updated_by: userCode })
      .eq('id', id);
    await logEvent(id, 'send_completed', userCode, { sent, failed });
    return { ok: failed === 0, sent, failed };
  },
};
