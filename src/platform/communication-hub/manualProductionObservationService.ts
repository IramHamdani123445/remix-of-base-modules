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

export type TransportErrorClass =
  | "FunctionsFetchError"
  | "FunctionsHttpError"
  | "FunctionsRelayError"
  | "unknown";

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
  recovered?: boolean;
  runtime_build?: string;
  transport?: {
    errorClass: TransportErrorClass;
    httpStatus?: number;
    runtimeBuild?: string;
    responseBody?: string;
    correlationId?: string;
    resolved: boolean;
  };
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

function classifyError(error: any): TransportErrorClass {
  const name = String(error?.name ?? "");
  if (name === "FunctionsFetchError") return "FunctionsFetchError";
  if (name === "FunctionsHttpError") return "FunctionsHttpError";
  if (name === "FunctionsRelayError") return "FunctionsRelayError";
  return "unknown";
}

export async function probeManualProductionObservation(input: {
  moduleCode?: string; eventCode?: string; channel?: string;
}): Promise<{ ok: boolean; runtimeBuild?: string; probe?: any; error?: string }> {
  const { data, error } = await supabase.functions.invoke(
    "comm-hub-run-manual-production-observation",
    { body: { action: "probe", ...input, channel: input.channel ?? "email" } },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: !!(data as any)?.ok, runtimeBuild: (data as any)?.runtime_build, probe: (data as any)?.probe };
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
    const errorClass = classifyError(error);
    const context: any = (error as any)?.context;
    let body: any = null;
    let responseBody: string | undefined;
    let httpStatus: number | undefined;
    let runtimeBuild: string | undefined;
    let correlationId: string | undefined;
    try {
      if (context?.status) httpStatus = context.status;
      if (context?.headers?.get) {
        runtimeBuild = context.headers.get("x-comm-hub-runtime-build") ?? undefined;
        correlationId = context.headers.get("x-request-id") ?? context.headers.get("sb-request-id") ?? undefined;
      }
      if (context) {
        try { body = await context.clone().json(); }
        catch {
          try { responseBody = await context.clone().text(); } catch {}
        }
      }
    } catch {}
    if (body) {
      return {
        ok: false,
        phase: "FAILED",
        ...(body ?? {}),
        transport: { errorClass, httpStatus, runtimeBuild: runtimeBuild ?? body?.runtime_build, correlationId, responseBody, resolved: true },
        blockers: body?.blockers ?? [{ code: "invoke_failed", detail: error.message }],
      };
    }
    // Transport interruption — outcome unresolved. Try server-authoritative
    // recovery by idempotency key so we never fabricate a fresh key on retry.
    const recovery = await getObservationRecovery({
      moduleCode: input.moduleCode, eventCode: input.eventCode, channel: input.channel ?? "email",
    });
    if (recovery.hasPending && recovery.idempotencyKey === input.idempotencyKey) {
      return {
        ok: true,
        phase: recovery.phase ?? "AWAITING_PROVIDER",
        message_id: recovery.messageId,
        request_id: recovery.requestId,
        observation_id: recovery.observationId,
        inbox_confirmation_status: (recovery.inboxConfirmationStatus ?? null) as any,
        recovered: true,
        transport: { errorClass, httpStatus, runtimeBuild, correlationId, resolved: true },
      };
    }
    return {
      ok: false,
      phase: "FAILED",
      transport: { errorClass, httpStatus, runtimeBuild, correlationId, responseBody, resolved: false },
      blockers: [{ code: "invoke_failed", detail: error.message }],
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

/**
 * Server-authoritative recovery: load any unfinished observation intent
 * (ENQUEUED / AWAITING_PROVIDER / AWAITING_INBOX_CONFIRMATION) for the given
 * event so the panel can resume after a browser refresh without sending
 * another message.
 */
export interface ObservationRecovery {
  hasPending: boolean;
  idempotencyKey?: string;
  phase?: ObservationPhase;
  messageId?: string;
  requestId?: string;
  observationId?: string;
  inboxConfirmationStatus?: "CONFIRMED" | "NOT_RECEIVED" | null;
  recipientEmail?: string;
  createdAt?: string;
}

export async function getObservationRecovery(input: {
  moduleCode: string; eventCode: string; channel?: string;
}): Promise<ObservationRecovery> {
  const { data, error } = await (supabase as any).rpc("get_comm_hub_observation_recovery", {
    p_module_code: input.moduleCode,
    p_event_code: input.eventCode,
    p_channel: input.channel ?? "email",
  });
  if (error || !data?.has_pending) return { hasPending: false };
  return {
    hasPending: true,
    idempotencyKey: data.idempotency_key,
    phase: data.phase as ObservationPhase,
    messageId: data.message_id ?? undefined,
    requestId: data.request_id ?? undefined,
    observationId: data.observation_id ?? undefined,
    inboxConfirmationStatus: data.inbox_confirmation_status ?? null,
    recipientEmail: data.recipient_email,
    createdAt: data.created_at,
  };
}
