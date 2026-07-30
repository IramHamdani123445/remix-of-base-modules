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

export interface RenderStageOutcome {
  status: string;
  messages: Array<{
    recipientId: string;
    channel: string;
    status: string;
    renderedChecksum: string | null;
    unresolvedTokenCount: number;
    unresolvedSlotCount: number;
    blockers: string[];
  }>;
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

  return {
    status: persisted.status ?? outcome.finalStatus,
    messages: outcome.messages.map((m) => ({
      recipientId: m.recipient_id,
      channel: m.channel,
      status: m.status,
      renderedChecksum: m.rendered_checksum,
      unresolvedTokenCount: m.unresolved_tokens.length,
      unresolvedSlotCount: m.unresolved_required_slots.length,
      blockers: m.blockers,
    })),
    blockers: outcome.requestBlockers,
    heldJobCount: persisted.held_job_count ?? outcome.jobs.length,
    renderedCount: outcome.messages.filter((m) => m.status === "rendered").length,
    blockedCount: outcome.messages.filter((m) => m.status === "blocked").length,
  };
}
