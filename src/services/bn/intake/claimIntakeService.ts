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
import { BENEFITS_CLAIM_SUBMITTED_EVENT_CODE } from '@/platform/omni-comms/integrations/business/benefitsClaimSubmittedProducer';
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

/**
 * How the claim reached a work queue (BUG-33).
 *
 *   WORKFLOW          — a workflow started and owns the routing
 *   DIRECT_ASSIGNMENT — no executable workflow, so the claim was assigned
 *                       straight to the workbasket already resolved for it
 *   UNASSIGNED        — neither was possible; the claim has no owner and this
 *                       must be reported, never left silent
 */
export type ClaimRoutingOutcome = 'WORKFLOW' | 'DIRECT_ASSIGNMENT' | 'UNASSIGNED';

export interface ClaimIntakeRoutingResult {
  outcome: ClaimRoutingOutcome;
  workbasketId: string | null;
  workbasketName: string | null;
  /** True when the product has no executable workflow — a configuration fault. */
  workflowMisconfigured: boolean;
  /** How the workbasket was found, or 'NONE' when it was not. */
  workbasketSource?: string | null;
  /** Why no workbasket could be resolved. Null when one was. */
  workbasketReason?: string | null;
  /** First step of the product's workflow, e.g. "INTAKE". */
  firstStep?: string | null;
  /** SLA deadline written onto the assignment, for the escalation runner. */
  dueAt?: string | null;
  /** Set when the channel-config lookup itself failed, rather than found nothing. */
  configLookupError?: string | null;
  /** User-safe sentence describing where the claim went, or why it went nowhere. */
  summary: string;
}

export interface SubmitClaimApplicationResult {
  claimId: string;
  claimNumber: string;
  workflowInstanceId: string | null;
  workflowEngine: 'CENTRAL' | 'BN_FALLBACK';
  /** Claimant acknowledgement outcome — evidence only, never fatal. */
  communication: ClaimIntakeCommunicationOutcome;
  /** Where the claim landed. A claim with no owner is reported here (BUG-33). */
  routing: ClaimIntakeRoutingResult;
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

  // BUG-33 — a claim must never be left without an owner. The workbasket is
  // resolved below whether or not a workflow can be started; if no workflow
  // starts, the claim is assigned to that workbasket directly rather than the
  // workbasket being discarded.
  const routing: ClaimIntakeRoutingResult = {
    outcome: workflowInstanceId ? 'WORKFLOW' : 'UNASSIGNED',
    workbasketId: null,
    workbasketName: null,
    workflowMisconfigured: false,
    summary: '',
  };

  // ─── Central Workflow Engine Integration ──────────────────────────
  // If RPC did not bind a workflow instance, attempt the central engine here.
  try {
    if (!workflowInstanceId) {
      // Hydrate the claim + product version channel config to decide routing.
      // The product's category is joined in, not read from bn_claim — bn_claim
      // has no category column, so reading it there silently yielded undefined
      // and the workbasket category preference never applied.
      const { data: claim } = await db
        .from('bn_claim')
        .select(
          'id, claim_number, product_id, product_version_id, application_channel, priority, ssn, claim_date, ' +
          'product:bn_product(category)',
        )
        .eq('id', claimId)
        .maybeSingle();

      const productVersionId = claim?.product_version_id ?? null;
      const productId = claim?.product_id ?? null;
      // One channel vocabulary for the whole platform. The intake spellings
      // (STAFF_OFFLINE, PUBLIC_ONLINE…) match nothing stored in the config or
      // mapping tables, so an un-normalised value can never find a workflow.
      const channelCode =
        normalizeChannelCode(input.channel) ?? CHANNEL_TO_CONFIG[input.channel] ?? null;


      let workflowDefinitionId: string | null = null;
      let workbasketId: string | null = input.workbasketId ?? null;

      if (productVersionId) {
        // Channel-level workflow takes precedence.
        //
        // This select used to ask for `workbasket_id`, a column that does not
        // exist on bn_product_channel_config. PostgREST rejects the whole
        // query on an unknown column, and the error was discarded — so
        // `workflow_definition_id` was never read either, and no workflow could
        // ever be found from the channel config. That is a cause of BUG-33, not
        // just a symptom of it.
        const { data: cfg, error: cfgError } = await db
          .from('bn_product_channel_config')
          .select('workflow_definition_id, workflow_template_id, is_enabled')
          .eq('product_version_id', productVersionId)
          .eq('channel_code', channelCode)
          .maybeSingle();
        if (cfgError) {
          // Surfaced rather than swallowed: a broken routing lookup must not
          // look identical to "this product has no workflow".
          console.warn('[claimIntake] channel config lookup failed:', cfgError.message);
          routing.configLookupError = cfgError.message;
        }

        workflowDefinitionId =
          cfg?.workflow_definition_id ?? cfg?.workflow_template_id ?? null;

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

      // BUG-33 — the workbasket comes from the PRODUCT, the same place the
      // workflow does: the first step of the product version's workflow
      // template names the role that owns a new claim. Resolved whether or not
      // a workflow can be started, so the fallback has somewhere to put it.
      if (!workbasketId) {
        const { resolveClaimWorkbasket } = await import('./claimWorkbasketResolver');
        const wb = await resolveClaimWorkbasket({
          productVersionId,
          channelCode,
          productCategory: (claim as any)?.product?.category ?? null,
        });
        workbasketId = wb.workbasketId;
        routing.workbasketName = wb.workbasketName;
        routing.workbasketSource = wb.source;
        routing.firstStep = wb.stepName;
        routing.dueAt = wb.dueAt;
        if (!wb.workbasketId) routing.workbasketReason = wb.reason;
      }

      // The workbasket is now known whatever happens next — keep it.
      routing.workbasketId = workbasketId;
      // A product whose workflow template has no executable definition is a
      // configuration fault, not a normal path.
      routing.workflowMisconfigured = !workflowDefinitionId;

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
          routing.outcome = 'WORKFLOW';
          await db
            .from('bn_claim')
            .update({ workflow_instance_id: instanceId })
            .eq('id', claimId);
        }
      }

      // ─── BUG-33 fallback: assign directly when no workflow took ownership ──
      if (!workflowInstanceId && workbasketId) {
        const { assignClaimToWorkbasket } = await import(
          '@/services/bn/approvalLevelService'
        );
        await assignClaimToWorkbasket(
          claimId,
          workbasketId,
          input.submittedByUserId ?? 'SYSTEM',
          'Assigned at intake — no executable workflow for this product/channel',
          // Unclaimed, so every officer holding the basket's role sees it; and
          // carrying the first step's SLA so escalation has a deadline to watch.
          { assignedTo: null, dueAt: routing.dueAt ?? null },
        );
        routing.outcome = 'DIRECT_ASSIGNMENT';
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

  // ─── BUG-33: routing must be reported, never silent ────────────────
  // Previously a claim with no workflow was saved and left with no owner, and
  // the submission reported complete success. The outcome is now named, given a
  // workbasket label for the officer, and recorded against the claim.
  try {
    if (routing.workbasketId) {
      const { data: basket } = await db
        .from('bn_workbasket')
        .select('id, basket_name')
        .eq('id', routing.workbasketId)
        .maybeSingle();
      routing.workbasketName = (basket as any)?.basket_name ?? null;
    }

    const basketLabel = routing.workbasketName ?? routing.workbasketId ?? 'a workbasket';
    routing.summary =
      routing.outcome === 'WORKFLOW'
        ? `Claim routed by workflow${routing.workbasketName ? ` to ${basketLabel}` : ''}.`
        : routing.outcome === 'DIRECT_ASSIGNMENT'
          ? `No executable workflow is configured for this product and channel, so the claim was assigned directly to ${basketLabel}. Report this to configuration — the workflow template has no workflow definition linked.`
          : 'This claim has NOT been placed in any work queue: ' +
          (routing.workbasketReason
            ? `${routing.workbasketReason}. `
            : 'no workflow could be started and no workbasket could be resolved for this product and channel. ') +
          'It has no owner and will not appear in the Claim Queue. Escalate to configuration immediately.';

    await logBnWorkflowEvent({
      entityId: claimId,
      sourceModule: BN_WORKFLOW_MODULES.CLAIM,
      action:
        routing.outcome === 'UNASSIGNED'
          ? 'CLAIM_UNASSIGNED'
          : routing.outcome === 'DIRECT_ASSIGNMENT'
            ? 'CLAIM_ASSIGNED_WITHOUT_WORKFLOW'
            : 'CLAIM_ROUTED',
      performedBy: input.submittedByUserId ?? 'PUBLIC',
      narrative: routing.summary,
      workflowInstanceId: workflowInstanceId ?? undefined,
    });

    // A product that cannot route a claim is a configuration defect. Recorded
    // as a critical audit entry so it is visible outside this one submission.
    if (routing.outcome !== 'WORKFLOW') {
      const { auditConfigChange } = await import('@/services/bn/audit/bnAuditService');
      await auditConfigChange({
        action: 'UPDATE',
        entityType: 'bn_product_channel_config',
        entityId: row.product_version_id ?? claimId,
        afterValue: {
          defect: 'CLAIM_ROUTING_UNAVAILABLE',
          product_code: input.productCode,
          channel: input.channel,
          claim_number: claimNumber,
          workflow_misconfigured: routing.workflowMisconfigured,
          routing_outcome: routing.outcome,
          workbasket_source: routing.workbasketSource ?? null,
          workbasket_reason: routing.workbasketReason ?? null,
          first_step: routing.firstStep ?? null,
          config_lookup_error: routing.configLookupError ?? null,
          detail: routing.summary,
        },
        performedBy: input.submittedByUserId ?? 'PUBLIC',
        critical: routing.outcome === 'UNASSIGNED',
      });
    }
  } catch (routeErr) {
    console.warn('[claimIntake] Routing report failed (non-fatal):', routeErr);
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
    routing,
  };
}

