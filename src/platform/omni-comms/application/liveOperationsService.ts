/**
 * Omni-Comms — production LIVE operations read model.
 *
 * Read-only projection of the server's live truth: capability readiness,
 * automatic dispatcher status, production quotas, scope and delivery
 * evidence. This module contacts no provider and sends nothing.
 */
import { callOmniCommsRpc, type OmniCommsRpcClient } from './omniCommsRpcErrors';

export interface LiveReadinessCheck {
  key: string;
  ready: boolean;
  detail: string;
}

export interface LiveOperationsSummary {
  release_state: string | null;
  live: boolean;
  automatic_dispatch: boolean;
  readiness: { checks: LiveReadinessCheck[]; ready_count: number; total: number };
  scheduler: {
    installed: boolean;
    frequency: string;
    last_run_at: string | null;
    last_run_scanned: number | null;
    last_run_claimed: number | null;
    last_run_blocker: string | null;
  };
  quotas: {
    max_recipients_per_request: number | null;
    max_messages_per_hour: number | null;
    max_messages_per_day: number | null;
    max_messages_total: number | null;
  };
  scope: {
    department_id: string | null;
    permitted_event_codes: string[];
    permitted_caller_modules: string[];
    permitted_modes: string[];
  };
  delivery_evidence: {
    attempts: number;
    accepted: number;
    delivered: number;
    last_attempt_at: string | null;
    last_accepted_at: string | null;
    last_delivered_at: string | null;
    last_bounce_at: string | null;
    last_complaint_at: string | null;
    last_outcome_unknown_at: string | null;
    queue_depth: number;
    has_production_delivery: boolean;
  };
  generated_at: string;
}

export function getLiveOperationsSummary(
  client: OmniCommsRpcClient,
  input: { organizationId: string; departmentId?: string | null },
): Promise<LiveOperationsSummary> {
  return callOmniCommsRpc<LiveOperationsSummary>(
    client,
    'omni_comms_live_operations_summary',
    {
      p_organization_id: input.organizationId,
      p_department_id: input.departmentId ?? null,
    },
  );
}

/** Maker step: propose promotion of the effective release to production live. */
export function proposeProductionLive(
  client: OmniCommsRpcClient,
  input: {
    id: string;
    expectedUpdatedAt: string;
    reason: string;
    correlationId?: string | null;
  },
): Promise<Record<string, unknown>> {
  return callOmniCommsRpc<Record<string, unknown>>(
    client,
    'omni_comms_channel_release_control_propose_live',
    {
      p_id: input.id,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_reason: input.reason,
      p_correlation_id: input.correlationId ?? null,
    },
  );
}

/** Checker step: approved through the trusted Edge boundary only. */
export function buildApproveActivateLiveBody(input: {
  releaseControlId: string;
  expectedUpdatedAt: string;
  expectedFingerprint: string;
  approvalNote?: string | null;
  correlationId?: string | null;
}) {
  return {
    action: 'approve_activate_live' as const,
    releaseControlId: input.releaseControlId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    expectedFingerprint: input.expectedFingerprint,
    approvalNote: input.approvalNote ?? null,
    correlationId: input.correlationId ?? null,
  };
}
