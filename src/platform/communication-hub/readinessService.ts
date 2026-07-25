/**
 * CH-GL — Readiness aggregator client.
 *
 * Wraps the server-side `check_comm_hub_readiness` RPC. The RPC is
 * strictly read-only: it never sends, never creates a request, never
 * touches a provider, and never mutates control settings. It returns
 * every blocker and warning together so the UI can show the complete
 * picture without repeated round-trips.
 */
import { supabase } from "@/integrations/supabase/client";
import type { CommunicationOperatingMode, ModeProfile } from "./releaseModeService";

export type ReleaseStageTarget =
  | "SAFE_TESTING"
  | "CONTROLLED_STUB"
  | "ONE_REAL_EMAIL"
  | "MANUAL_PRODUCTION"
  | "AUTOMATED_PRODUCTION";

export interface ReadinessBlocker {
  code: string;
  stage: string;
  severity: "critical" | "high" | "medium" | "low";
  title?: string;
  message?: string;
  fixAction?: string;
  fixRoute?: string;
  newAttemptRequired?: boolean;
  invalidatesPreview?: boolean;
  invalidatesDryRun?: boolean;
  retrySafe?: boolean;
}

export interface ReadinessEnvelope {
  ready: boolean;
  currentMode: CommunicationOperatingMode;
  targetStage: ReleaseStageTarget;
  configurationVersion: number;
  profile: ModeProfile | null;
  blockers: ReadinessBlocker[];
  warnings: ReadinessBlocker[];
  availableActions: string[];
  evaluatedAt: string;
}

export interface CheckReadinessInput {
  moduleCode?: string | null;
  eventCode?: string | null;
  channel?: string;
  targetStage: ReleaseStageTarget;
  /**
   * Stage 6 (ONE_REAL_EMAIL) authoritative lineage anchor. When supplied,
   * the RPC derives the approved recipient and Dry Run certification id
   * from durable server rows; any browser-supplied recipient is ignored.
   */
  controlledStubCertificationId?: string | null;
}

export async function checkCommHubReadiness(
  input: CheckReadinessInput,
): Promise<ReadinessEnvelope> {
  const { data, error } = await (supabase as any).rpc("check_comm_hub_readiness", {
    p_payload: {
      module_code: input.moduleCode ?? null,
      event_code: input.eventCode ?? null,
      channel: input.channel ?? "email",
      target_stage: input.targetStage,
      controlled_stub_certification_id: input.controlledStubCertificationId ?? null,
    },
  });
  if (error) throw new Error(error.message ?? "check_comm_hub_readiness failed");
  const raw = data as any;
  return {
    ready: !!raw?.ready,
    currentMode: raw?.currentMode,
    targetStage: raw?.targetStage,
    configurationVersion: Number(raw?.configurationVersion ?? 0),
    profile: raw?.profile ?? null,
    blockers: (raw?.blockers ?? []) as ReadinessBlocker[],
    warnings: (raw?.warnings ?? []) as ReadinessBlocker[],
    availableActions: (raw?.availableActions ?? []) as string[],
    evaluatedAt: raw?.evaluatedAt,
  };
}
