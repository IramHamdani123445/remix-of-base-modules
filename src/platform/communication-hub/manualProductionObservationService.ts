/**
 * Client for the manual-production observation lifecycle.
 *
 * Observations are dispatched by the app via the standard business-module
 * façade `sendCommunication({...})` and then recorded here so the server
 * can bind lineage (request/message/attempt/trace) to the event
 * certification. Inbox confirmation is a separate RPC.
 */
import { supabase } from "@/integrations/supabase/client";
import { sendCommunication } from "./sendCommunication";

export interface RecordObservationInput {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  requestId?: string | null;
  messageId?: string | null;
  deliveryAttemptId?: string | null;
  traceId?: string | null;
  providerId?: string | null;
  providerName?: string | null;
  providerMessageId?: string | null;
  providerCallAttempted: boolean;
  providerOutcome?: string | null;
  recipientEmail: string;
  recipientSetHash?: string | null;
  senderProfileId?: string | null;
  templateVersionId?: string | null;
  idempotencyKey: string;
}

export interface RecordObservationResult {
  ok: boolean;
  observation_id: string;
  idempotent?: boolean;
  event_certification_id?: string;
}

export async function recordManualProductionObservation(
  input: RecordObservationInput,
): Promise<RecordObservationResult> {
  const { data, error } = await (supabase as any).rpc(
    "record_comm_hub_manual_production_observation",
    {
      p_payload: {
        module_code: input.moduleCode,
        event_code: input.eventCode,
        channel: input.channel ?? "email",
        request_id: input.requestId,
        message_id: input.messageId,
        delivery_attempt_id: input.deliveryAttemptId,
        trace_id: input.traceId,
        provider_id: input.providerId,
        provider_name: input.providerName,
        provider_message_id: input.providerMessageId,
        provider_call_attempted: input.providerCallAttempted,
        provider_outcome: input.providerOutcome,
        recipient_email: input.recipientEmail,
        recipient_set_hash: input.recipientSetHash,
        idempotency_key: input.idempotencyKey,
        sender_profile_id: input.senderProfileId,
        template_version_id: input.templateVersionId,
      },
    },
  );
  if (error) throw new Error(error.message ?? "record_comm_hub_manual_production_observation failed");
  return data as RecordObservationResult;
}

export async function confirmManualProductionObservation(input: {
  observationId: string;
  status: "CONFIRMED" | "NOT_RECEIVED";
  note?: string;
}): Promise<{ ok: boolean; status: string }> {
  const { data, error } = await (supabase as any).rpc(
    "confirm_comm_hub_manual_production_observation",
    {
      p_observation_id: input.observationId,
      p_status: input.status,
      p_note: input.note ?? null,
    },
  );
  if (error) throw new Error(error.message ?? "confirm_comm_hub_manual_production_observation failed");
  return data as { ok: boolean; status: string };
}

/**
 * Dispatch + record an observation in one call.  Uses `sendCommunication`
 * (the canonical business-module façade) so the platform's real Manual
 * Production dispatcher path is exercised — NOT the Stage 6 One Real Email
 * edge function.
 */
export async function dispatchAndRecordObservation(input: {
  moduleCode: string;
  eventCode: string;
  channel?: string;
  recipientEmail: string;
  recipientId?: string;
  data?: Record<string, unknown>;
  idempotencyKey: string;
  departmentCode?: string;
}): Promise<RecordObservationResult> {
  const sendResult: any = await sendCommunication({
    moduleCode: input.moduleCode,
    eventCode: input.eventCode,
    channels: [input.channel ?? "email"],
    recipient: { email: input.recipientEmail, id: input.recipientId },
    data: input.data ?? {},
    idempotencyKey: input.idempotencyKey,
    departmentCode: input.departmentCode,
    reference: { context: "manual_production_observation" },
  } as any);

  const providerCallAttempted = Boolean(
    sendResult?.providerCallAttempted ??
      sendResult?.provider_call_attempted ??
      sendResult?.messageId ??
      sendResult?.message_id,
  );

  return recordManualProductionObservation({
    moduleCode: input.moduleCode,
    eventCode: input.eventCode,
    channel: input.channel ?? "email",
    requestId: sendResult?.requestId ?? sendResult?.request_id ?? null,
    messageId: sendResult?.messageId ?? sendResult?.message_id ?? null,
    deliveryAttemptId:
      sendResult?.deliveryAttemptId ?? sendResult?.delivery_attempt_id ?? null,
    traceId: sendResult?.traceId ?? sendResult?.trace_id ?? null,
    providerId: sendResult?.providerId ?? sendResult?.provider_id ?? null,
    providerName: sendResult?.providerName ?? sendResult?.provider_name ?? null,
    providerMessageId:
      sendResult?.providerMessageId ?? sendResult?.provider_message_id ?? null,
    providerCallAttempted,
    providerOutcome:
      sendResult?.providerOutcome ?? sendResult?.provider_outcome ?? null,
    recipientEmail: input.recipientEmail,
    recipientSetHash:
      sendResult?.recipientSetHash ?? sendResult?.recipient_set_hash ?? null,
    senderProfileId:
      sendResult?.senderProfileId ?? sendResult?.sender_profile_id ?? null,
    templateVersionId:
      sendResult?.templateVersionId ?? sendResult?.template_version_id ?? null,
    idempotencyKey: input.idempotencyKey,
  });
}
