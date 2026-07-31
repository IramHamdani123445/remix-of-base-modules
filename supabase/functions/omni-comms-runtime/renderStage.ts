// Omni-Comms Runtime — Slice 2c-iii rendering stage (Batch C).
//
// Runs strictly AFTER Slice 2c-ii finalisation has moved the request to
// `processing`. It loads the persisted render context, renders deterministically,
// and persists messages + timeline + held jobs atomically.
//
// Absolute boundaries enforced by this module:
//   * No provider is contacted, no email/SMS is sent.
//   * No delivery attempt is created.
//   * No runnable dispatch job is ever produced.

import { orchestrateRendering } from "./rendering/renderOrchestrator.ts";
import type { RenderContext } from "./rendering/renderingTypes.ts";
import {
  messagesFromPersistedProjection,
  type SendCommunicationMessageResult,
} from "./responseContract.ts";

export interface RenderStageOutcome {
  status: string;
  /**
   * Canonical contract messages, projected from the PERSISTED rows (not from
   * the in-memory render output). This is the same projection the replay path
   * returns, which is what makes fresh and replay responses identical.
   */
  messages: SendCommunicationMessageResult[];
  blockers: string[];
  heldJobCount: number;
  renderedCount: number;
  blockedCount: number;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export class RenderStageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RenderStageError";
    this.code = code;
  }
}

function isRenderContext(value: unknown): value is RenderContext {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.request !== null && typeof v.request === "object" &&
    Array.isArray(v.recipients) &&
    Array.isArray(v.template_versions) &&
    Array.isArray(v.layout_versions) &&
    Array.isArray(v.asset_versions) &&
    Array.isArray(v.senders) &&
    Array.isArray(v.channel_settings)
  );
}

export async function runRenderStage(
  admin: RpcClient,
  actorId: string,
  requestId: string,
  organizationId: string,
): Promise<RenderStageOutcome> {
  const { data: ctxData, error: ctxErr } = await admin.rpc(
    "omni_comms_priv_load_render_context",
    { p_actor_id: actorId, p_request_id: requestId, p_organization_id: organizationId },
  );
  if (ctxErr) throw new RenderStageError("render_context_unavailable");
  if (!isRenderContext(ctxData)) throw new RenderStageError("render_context_invalid");

  const context = ctxData;
  const outcome = await orchestrateRendering(context);

  const { data: persistData, error: persistErr } = await admin.rpc(
    "omni_comms_priv_persist_rendered_messages",
    {
      p_actor_id: actorId,
      p_request_id: requestId,
      p_organization_id: organizationId,
      p_messages: outcome.messages,
      p_jobs: outcome.jobs,
      p_success_status: outcome.successStatus,
      p_request_blockers: outcome.requestBlockers,
      p_final_status: outcome.finalStatus,
    },
  );
  if (persistErr) throw new RenderStageError("render_persistence_failed");

  const persisted = (persistData ?? {}) as { status?: string; held_job_count?: number };

  // Re-read the persisted messages through the canonical projection so the
  // fresh response carries real message ids and held dispatch-job ids, and is
  // byte-comparable with the replay response.
  const { data: projData, error: projErr } = await admin.rpc(
    "omni_comms_priv_load_persisted_messages",
    { p_actor_id: actorId, p_request_id: requestId, p_organization_id: organizationId },
  );
  if (projErr) throw new RenderStageError("render_projection_failed");
  const messages = messagesFromPersistedProjection(projData);

  return {
    status: persisted.status ?? outcome.finalStatus,
    messages,
    blockers: outcome.requestBlockers,
    heldJobCount: persisted.held_job_count ?? outcome.jobs.length,
    renderedCount: outcome.messages.filter((m) => m.status === "rendered").length,
    blockedCount: outcome.messages.filter((m) => m.status === "blocked").length,
  };
}
