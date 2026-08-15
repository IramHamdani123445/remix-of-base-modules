/**
 * Workflow → Omni-Comms bridge.
 * Called after a successful claim action transition so catalogued Benefits
 * communications are raised through the single governed façade.
 */
import {
  triggerClaimCommunicationViaOmniComms,
} from './bnClaimOmniCommsService';
import type { BnCommContext } from './bnCommunicationAdapter';

const ACTION_EVENT_MAP: Record<string, string | string[]> = {
  SUBMIT: 'bn.claim.submitted',
  START_REVIEW: 'bn.claim.intake.started',
  VERIFY_IDENTITY: 'bn.identity.verified',
  REQUEST_EVIDENCE: 'bn.evidence.requested',
  REQUEST_INFO: 'bn.evidence.requested',
  RECEIVE_EVIDENCE: 'bn.evidence.received',
  CHECK_ELIGIBILITY: 'bn.eligibility.passed', // refined below based on result
  RUN_CALCULATION: 'bn.calculation.completed',
  SUBMIT_DECISION: 'bn.decision.pending',
  APPROVE: 'bn.claim.approved',
  DENY: 'bn.claim.denied',
  DISALLOW: 'bn.claim.disallowed',
  SUSPEND: 'bn.claim.suspended',
  REOPEN: 'bn.claim.reopened',
  WITHDRAW: 'bn.claim.withdrawn',
  CLOSE: [], // no comm by default
};

export interface WorkflowActionContext {
  claimId: string;
  actionCode: string;
  userCode: string;
  reasonCode?: string;
  narrative?: string;
  productVersionId?: string;
  workflowStepId?: string;
  sideEffect?: Record<string, any>;
}

export async function onWorkflowActionExecuted(ctx: WorkflowActionContext) {
  let mapped = ACTION_EVENT_MAP[ctx.actionCode];
  if (mapped === undefined) return { dispatched: 0, skipped: 0, failed: 0, events: [] };

  // Eligibility outcome refines event
  if (ctx.actionCode === 'CHECK_ELIGIBILITY' && ctx.sideEffect && ctx.sideEffect.overallResult === false) {
    mapped = 'bn.eligibility.failed';
  }

  const events = Array.isArray(mapped) ? mapped : [mapped];
  const results: any[] = [];
  for (const eventCode of events) {
    if (!eventCode) continue;
    try {
      const commCtx: BnCommContext = {
        productVersionId: ctx.productVersionId,
        workflowStepId: ctx.workflowStepId,
        reasonCode: ctx.reasonCode,
        reasonDescription: ctx.narrative,
        userCode: ctx.userCode,
        extra: ctx.sideEffect,
      };
      const r = await triggerClaimCommunicationViaOmniComms(
        eventCode,
        ctx.claimId,
        commCtx,
      );
      results.push(r);
    } catch (err: any) {
      results.push({ eventCode, error: err?.message });
    }
  }
  return { events: results };
}
