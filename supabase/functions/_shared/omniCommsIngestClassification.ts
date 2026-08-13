/**
 * Omni-Comms — business-event handoff classification.
 *
 * OWNERSHIP MODEL.
 *
 * The business-event outbox answers exactly ONE question:
 *
 *     did this business event successfully hand off to Omni-Comms?
 *
 * Once a durable Omni-Comms request exists, the handoff is complete and the
 * outbox row is `processed` — permanently. Everything after that
 * (configuration blockers, rendering, dispatch, provider delivery) belongs to
 * the request / message / job lifecycle and is surfaced in Activity from
 * those records.
 *
 * A successfully materialised request is therefore NEVER resubmitted from the
 * business-event outbox.
 *
 * This module is intentionally dependency-free so the Deno worker and the
 * Node test-runner execute the SAME grammar.
 */

/** Communication is intentionally configured off — terminal, never retried. */
export const NO_COMMUNICATION_BLOCKERS = new Set([
  "no_communication_configured",
  "no_channel_configured",
  "communication_disabled",
  "channel_delivery_off",
]);

/**
 * The canonical runtime request vocabulary. Any of these means the runtime
 * accepted ownership of the obligation and a durable request exists.
 */
export const RUNTIME_REQUEST_STATUSES = new Set([
  "received",
  "accepted",
  "queued",
  "processing",
  "completed",
  "completed_with_blockers",
  "blocked",
  "replayed",
]);

export interface RuntimeOutcome {
  ok: boolean;
  httpStatus: number;
  status: string | null;
  requestId: string | null;
  blockers: string[];
  detail?: string | null;
}

export interface IngestClassification {
  status: "processed" | "retry" | "blocked" | "no_communication_configured";
  blockerCode: string | null;
}

export function classifyRuntimeOutcome(outcome: RuntimeOutcome): IngestClassification {
  const status = (outcome.status ?? "").trim().toLowerCase();

  // 1. A durable request exists → handoff complete, whatever the request says.
  if (outcome.requestId && (outcome.ok || RUNTIME_REQUEST_STATUSES.has(status))) {
    return { status: "processed", blockerCode: null };
  }

  // 2. No request, and communication is intentionally configured off.
  const off = outcome.blockers.find((b) => NO_COMMUNICATION_BLOCKERS.has(b));
  if (off) return { status: "no_communication_configured", blockerCode: off };

  // 3. Transient runtime unavailability before a durable request → retry.
  if (outcome.httpStatus >= 500 || outcome.httpStatus === 429 || outcome.httpStatus === 0) {
    return { status: "retry", blockerCode: "runtime_unavailable" };
  }

  // 4. A definite refusal with no durable request.
  return {
    status: "blocked",
    blockerCode: outcome.blockers[0] ?? outcome.detail ?? "runtime_blocked",
  };
}
