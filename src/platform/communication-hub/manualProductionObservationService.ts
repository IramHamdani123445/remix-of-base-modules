/**
 * Client for the server-coordinated Manual Production observation.
 *
 * The browser only kicks off the observation and (optionally) polls for
 * finalisation. Every evidence field — request, message, delivery attempt,
 * trace, provider — is derived on the server from durable rows.
 *
 * Legacy browser-side `record_comm_hub_manual_production_observation`
 * has been revoked; do NOT call it from the frontend.
 */
import { supabase } from "@/integrations/supabase/client";

export type ObservationPhase =
  | "IDLE"
  | "ENQUEUED"
  | "DISPATCHED"
  | "AWAITING_PROVIDER"
  | "AWAITING_INBOX_CONFIRMATION"
  | "CONFIRMED"
  | "NOT_RECEIVED"
  | "FAILED";

export interface RunObservationInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  recipientEmail: string;
  data?: Record<string, unknown>;
  idempotencyKey: string;
}

export interface RunObservationResult {
  ok: boolean;
  phase: ObservationPhase;
  observation_id?: string;
  message_id?: string;
  request_id?: string;
  provider_message_id?: string | null;
  trace_id?: string | null;
  attempt_status?: string | null;
  message_status?: string | null;
  event_certification_id?: string;
  inbox_confirmation_status?: string | null;
  status?: string | null;
  blockers?: Array<{ code: string; detail?: unknown }>;
}

function derivePhase(body: any): ObservationPhase {
  if (!body) return "FAILED";
  if (body.phase) return body.phase as ObservationPhase;
  if (body.inbox_confirmation_status === "CONFIRMED") return "CONFIRMED";
  if (body.inbox_confirmation_status === "NOT_RECEIVED") return "NOT_RECEIVED";
  if (body.ok && body.observation_id) return "AWAITING_INBOX_CONFIRMATION";
  return body.ok ? "AWAITING_INBOX_CONFIRMATION" : "FAILED";
}

export async function runManualProductionObservation(
  input: RunObservationInput,
): Promise<RunObservationResult> {
  const { data, error } = await supabase.functions.invoke(
    "comm-hub-run-manual-production-observation",
    {
      body: {
        moduleCode: input.moduleCode,
        eventCode: input.eventCode,
        channel: input.channel ?? "email",
        recipientEmail: input.recipientEmail,
        data: input.data ?? {},
        idempotencyKey: input.idempotencyKey,
      },
    },
  );
  if (error) {
    const context: any = (error as any)?.context;
    let body: any = null;
    try { body = context ? await context.json() : null; } catch {}
    return {
      ok: false,
      phase: "FAILED",
      ...(body ?? {}),
      blockers: body?.blockers ?? [{ code: "invoke_failed", detail: error.message }],
    };
  }
  return { ...(data as any), phase: derivePhase(data) };
}

/**
 * Finalize a pending observation once the provider evidence has become
 * durable (used after an AWAITING_PROVIDER phase). Never confirms the inbox.
 */
export async function finalizeManualProductionObservation(input: {
  messageId: string; idempotencyKey: string;
}): Promise<RunObservationResult> {
  const { data, error } = await (supabase as any).rpc(
    "finalize_comm_hub_manual_production_observation",
    { p_message_id: input.messageId, p_idempotency_key: input.idempotencyKey },
  );
  if (error) return { ok: false, phase: "FAILED", blockers: [{ code: "finalize_failed", detail: error.message }] };
  return { ...(data as any), phase: derivePhase(data) };
}

/**
 * Explicit operator inbox confirmation. Decision must be CONFIRMED or NOT_RECEIVED.
 */
export async function confirmManualProductionObservation(input: {
  observationId: string; decision: "CONFIRMED" | "NOT_RECEIVED"; note?: string;
}): Promise<RunObservationResult> {
  const { data, error } = await (supabase as any).rpc(
    "confirm_comm_hub_manual_production_observation",
    { p_observation_id: input.observationId, p_decision: input.decision, p_note: input.note ?? null },
  );
  if (error) return { ok: false, phase: "FAILED", blockers: [{ code: "confirm_failed", detail: error.message }] };
  return { ...(data as any), phase: derivePhase(data) };
}
