/**
 * BN Claim Intake Service
 *
 * Single entry point used by every channel (PUBLIC_ONLINE, STAFF_OFFLINE,
 * ASSISTED_COUNTER, BACK_OFFICE_ENTRY, MIGRATED_LEGACY) to submit a benefit
 * application.
 *
 * Wraps the transactional RPC `bn_submit_claim_application`, which creates
 * `bn_claim`, `bn_claim_application`, snapshots, the document checklist, and
 * intake validations.
 *
 * Workflow integration:
 *   After the RPC commits, this service guarantees that every submitted claim
 *   is bound to the central workflow engine when a workflow_definition_id /
 *   workflow_template_id is configured on the resolved product version (or on
 *   its channel config). It calls `triggerBnWorkflow` (source_module='bn_claim')
 *   which creates the workflow_instance, first workflow_task, workflow_logs
 *   entry, and mirrors a bn_claim_event for domain traceability.
 *   If no workflow definition is configured, bn_claim_transition_rule remains
 *   the fallback transition matrix and no instance is created.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  triggerBnWorkflow,
  BN_WORKFLOW_MODULES,
  logBnWorkflowEvent,
} from '@/services/bn/bnWorkflowIntegrationService';
import { emitConfiguredBusinessEvent } from '@/platform/omni-comms/integrations/business/emitConfiguredBusinessEvent';
import {
  BENEFITS_CLAIM_ENTITY_TYPE,
  BENEFITS_CLAIM_INTAKE_MODULE_CODE,
  BENEFITS_CLAIM_SUBMITTED_ENTITY_VERSION,
  BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
  buildBenefitsClaimSubmittedCorrelationId,
} from '@/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer';
import type { BusinessProducerResult } from '@/platform/omni-comms/integrations/business/businessProducerTypes';

const db = supabase as any;

export type ApplicationChannel =
  | 'PUBLIC_ONLINE'
  | 'STAFF_OFFLINE'
  | 'ASSISTED_COUNTER'
  | 'BACK_OFFICE_ENTRY'
  | 'MIGRATED_LEGACY';

export interface SubmitClaimApplicationInput {
  ssn: string;
  productCode: string;
  claimDate: string; // yyyy-MM-dd
  channel: ApplicationChannel;
  formPayload: Record<string, any>;
  employerRegno?: string | null;
  submittedByUserId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | null;
  workbasketId?: string | null;
}

/** Observable, non-fatal outcome of the claimant acknowledgement emission. */
export interface ClaimIntakeCommunicationOutcome {
  outcome: BusinessProducerResult['outcome'] | 'skipped';
  eventCode: string | null;
  requestId: string | null;
  blockers: string[];
  /** Short, user-safe sentence describing what happened. */
  summary: string;
}

export interface SubmitClaimApplicationResult {
  claimId: string;
  claimNumber: string;
  workflowInstanceId: string | null;
  workflowEngine: 'CENTRAL' | 'BN_FALLBACK';
  /** Claimant acknowledgement outcome — evidence only, never fatal. */
  communication: ClaimIntakeCommunicationOutcome;
}

const CLAIM_COMMUNICATION_SUMMARY: Record<string, string> = {
  accepted:
    'Claimant acknowledgement recorded with the claim. It will be prepared automatically by Communications.',
  replayed:
    'Claimant acknowledgement already recorded for this claim — no duplicate was created.',
  blocked: 'Claimant acknowledgement not prepared.',
  unavailable: 'Claimant acknowledgement could not be prepared right now.',
  skipped: 'Claimant acknowledgement not applicable for this claim.',
};

/**
 * Durable evidence projection.
 *
 * The claim transaction itself recorded the communication obligation, so the
 * only thing left to report is WHAT was recorded. Nothing is emitted, resolved
 * or sent here.
 */
export function mapDurableCommunicationEvidence(
  eventId: string | null,
  eventStatus: string | null,
): ClaimIntakeCommunicationOutcome {
  const status = (eventStatus ?? '').trim().toLowerCase();
  if (!eventId) {
    return {
      outcome: status === 'needs_review' ? 'unavailable' : 'skipped',
      eventCode: BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
      requestId: null,
      blockers: status ? [status] : [],
      summary:
        CLAIM_COMMUNICATION_SUMMARY[
          status === 'needs_review' ? 'unavailable' : 'skipped'
        ],
    };
  }
  const outcome: ClaimIntakeCommunicationOutcome['outcome'] =
    status === 'blocked' || status === 'needs_review' ? 'blocked' : 'accepted';
  return {
    outcome,
    eventCode: BENEFITS_CLAIM_SUBMITTED_EVENT_CODE,
    requestId: null,
    blockers: outcome === 'blocked' ? [status] : [],
    summary: CLAIM_COMMUNICATION_SUMMARY[outcome],
  };
}


/**
 * NOTE — there is deliberately NO post-commit producer here.
 *
 * The claimant acknowledgement obligation is recorded by the SAME database
 * transaction that registers the claim (`bn_submit_claim_application` →
 * `omni_comms_priv_enqueue_business_event`). The browser therefore cannot
 * emit, resolve, render, queue or send anything, and a claim can never exist
 * without its communication obligation. This service only REPORTS the durable
 * evidence the transaction produced.
 */


const CHANNEL_TO_CONFIG: Record<ApplicationChannel, string> = {
  PUBLIC_ONLINE: 'ONLINE',
  STAFF_OFFLINE: 'OFFLINE',
  ASSISTED_COUNTER: 'OFFLINE',
  BACK_OFFICE_ENTRY: 'OFFLINE',
  MIGRATED_LEGACY: 'OFFLINE',
};

export async function submitClaimApplication(
  input: SubmitClaimApplicationInput,
): Promise<SubmitClaimApplicationResult> {
  // ─── Pre-RPC Readiness Gate ───────────────────────────────────────
  // No DB row is created if the channel is not allowed or required
  // identity / OTP / documents are missing.
  const { validateReadiness, ClaimIntakeReadinessError } = await import(
    './intakeReadinessService'
  );
  const readiness = await validateReadiness(
    { productCode: input.productCode, claimDate: input.claimDate, channel: input.channel },
    {
      ssn: input.ssn,
      contact_email: (input.formPayload as any)?.contact_email ?? null,
      contact_phone: (input.formPayload as any)?.contact_phone ?? null,
      identity_verified: (input.formPayload as any)?.identity_verified === true,
      otp_verified: (input.formPayload as any)?.otp_verified === true,
      uploaded_document_codes:
        (input.formPayload as any)?.uploaded_document_codes ?? [],
      employerRegno: input.employerRegno ?? null,
    },
  );
  if (!readiness.ok) {
    throw new ClaimIntakeReadinessError(readiness);
  }

  const { data, error } = await db.rpc('bn_submit_claim_application', {
    p_ssn: input.ssn,
    p_product_code: input.productCode,
    p_claim_date: input.claimDate,
    p_channel: input.channel,
    p_form_payload: input.formPayload ?? {},
    p_employer_regno: input.employerRegno ?? null,
    p_submitted_by_user_id: input.submittedByUserId ?? null,
    p_source_ip: input.sourceIp ?? null,
    p_user_agent: input.userAgent ?? null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  const claimId: string = row.claim_id;
  const claimNumber: string = row.claim_number;
  let workflowInstanceId: string | null = row.workflow_instance_id ?? null;
  let workflowEngine: 'CENTRAL' | 'BN_FALLBACK' = workflowInstanceId
    ? 'CENTRAL'
    : 'BN_FALLBACK';

  // ─── Central Workflow Engine Integration ──────────────────────────
  // If RPC did not bind a workflow instance, attempt the central engine here.
  try {
    if (!workflowInstanceId) {
      // Hydrate the claim + product version channel config to decide routing.
      const { data: claim } = await db
        .from('bn_claim')
        .select(
          'id, claim_number, product_id, product_version_id, application_channel, priority, ssn, claim_date',
        )
        .eq('id', claimId)
        .maybeSingle();

      const productVersionId = claim?.product_version_id ?? null;
      const productId = claim?.product_id ?? null;
      const channelCode = CHANNEL_TO_CONFIG[input.channel];

      let workflowDefinitionId: string | null = null;
      let workbasketId: string | null = input.workbasketId ?? null;

      if (productVersionId) {
        // Channel-level workflow takes precedence
        const { data: cfg } = await db
          .from('bn_product_channel_config')
          .select(
            'workflow_definition_id, workflow_template_id, workbasket_id, is_enabled',
          )
          .eq('product_version_id', productVersionId)
          .eq('channel_code', channelCode)
          .maybeSingle();

        workflowDefinitionId =
          cfg?.workflow_definition_id ?? cfg?.workflow_template_id ?? null;
        workbasketId = workbasketId ?? cfg?.workbasket_id ?? null;

        // Channel-aware product workflow mapping (per-channel → default → legacy)
        if (!workflowDefinitionId) {
          const { resolveProductWorkflow } = await import(
            '@/services/bn/workflow/resolveProductWorkflow'
          );
          const resolved = await resolveProductWorkflow(productVersionId, channelCode);
          workflowDefinitionId =
            resolved.workflowDefinitionId ?? resolved.workflowTemplateId ?? null;
        }
      }

      if (workflowDefinitionId) {
        const instanceId = await triggerBnWorkflow({
          sourceModule: BN_WORKFLOW_MODULES.CLAIM,
          entityId: claimId,
          entityName: claimNumber,
          ssn: input.ssn,
          userId: input.submittedByUserId ?? '00000000-0000-0000-0000-000000000000',
          metadata: {
            product_id: productId,
            product_version_id: productVersionId,
            product_code: input.productCode,
            application_channel: input.channel,
            priority: input.priority ?? claim?.priority ?? 'NORMAL',
            workbasket_id: workbasketId,
            claim_date: input.claimDate,
            workflow_definition_id: workflowDefinitionId,
          },
        });

        if (instanceId) {
          workflowInstanceId = instanceId;
          workflowEngine = 'CENTRAL';
          await db
            .from('bn_claim')
            .update({ workflow_instance_id: instanceId })
            .eq('id', claimId);
        }
      }
    }

    // Always record the submission as a bn_claim_event (workflow-aware).
    await logBnWorkflowEvent({
      entityId: claimId,
      sourceModule: BN_WORKFLOW_MODULES.CLAIM,
      action: 'CLAIM_SUBMITTED',
      performedBy: input.submittedByUserId ?? 'PUBLIC',
      narrative: `Claim ${claimNumber} submitted via ${input.channel} (${workflowEngine === 'CENTRAL' ? 'central workflow' : 'bn fallback transitions'})`,
      workflowInstanceId: workflowInstanceId ?? undefined,
    });
  } catch (wfErr) {
    // Non-blocking: claim is already persisted, surface as console warning.
    console.warn('[claimIntake] Workflow integration error (non-fatal):', wfErr);
  }

  // ─── Mandatory Submission Audit ───────────────────────────────────
  try {
    const { auditSubmission } = await import('@/services/bn/audit/bnAuditService');
    await auditSubmission({
      action: 'CLAIM_SUBMITTED',
      entityType: 'bn_claim',
      entityId: claimId,
      performedBy: input.submittedByUserId || 'PUBLIC',
      afterValue: {
        claim_number: claimNumber,
        product_code: input.productCode,
        channel: input.channel,
        workflow_instance_id: workflowInstanceId,
        workflow_engine: workflowEngine,
        readiness_warnings: readiness.warnings,
      },
      notes: `Claim submitted via ${input.channel}`,
      critical: input.channel !== 'PUBLIC_ONLINE', // public 'PUBLIC' performer can't pass strict guard
    });
  } catch (auditErr) {
    // For PUBLIC_ONLINE we can't enforce critical audit (no user_code yet);
    // for staff channels the strict guard above will surface failure.
    console.warn('[claimIntake] Submission audit failed:', auditErr);
  }

  // ─── Omni-Comms claimant acknowledgement (durable outbox) ─────────
  // The obligation was already recorded INSIDE the claim transaction by
  // `bn_submit_claim_application`. The browser neither emits nor sends: the
  // ingest worker drains the outbox server-side. This is evidence only.
  const communication: ClaimIntakeCommunicationOutcome = mapDurableCommunicationEvidence(
    row?.communication_event_id ?? null,
    row?.communication_event_status ?? null,
  );


  return {
    claimId,
    claimNumber,
    workflowInstanceId,
    workflowEngine,
    communication,
  };
}

