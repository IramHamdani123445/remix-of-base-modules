/**
 * Phase 4B3 — Compact Go Live Gate Monitor service.
 *
 * Read-only wrapper around `get_comm_hub_go_live_gate_snapshot`.
 * The server is authoritative for every gate result. This module only
 * types the response and provides a fetch helper — it MUST NOT
 * determine pass/fail itself.
 */
import { supabase } from "@/integrations/supabase/client";

export type GateStatus =
  | "NOT_STARTED"
  | "CHECKING"
  | "PASSED"
  | "WARNING"
  | "BLOCKED"
  | "EXPIRED"
  | "SUPERSEDED"
  | "SKIPPED"
  | "UNAVAILABLE";

export type GateGroup =
  | "ACCESS"
  | "EVENT_SETUP"
  | "PREVIEW"
  | "APPROVAL"
  | "DRY_RUN_READINESS"
  | "PLATFORM_SERVICE"
  | "DRY_RUN_PROCESSING"
  | "CERTIFICATION";

export type ActionKind =
  | "REFRESH_SESSION"
  | "SIGN_IN_AGAIN"
  | "CREATE_FRESH_PREVIEW"
  | "APPROVE_PREVIEW"
  | "RECHECK_READINESS"
  | "OPEN_RECIPIENT_POLICY"
  | "OPEN_TEST_SCENARIO"
  | "OPEN_TEMPLATE_CONTRACT"
  | "OPEN_SENDER_PROFILE"
  | "OPEN_PROVIDER_SETTINGS"
  | "OPEN_OPERATING_MODE"
  | "RESUME_EXISTING_EXECUTION"
  | "PLATFORM_FIX"
  | "CONTACT_PLATFORM_ADMIN"
  | "NO_ACTION_REQUIRED";

export interface GateAction {
  kind: ActionKind;
  label: string;
  route: string | null;
}

export interface GateSource {
  layer: string;
  function: string;
  evaluator_version: string;
  checked_at: string;
  source_record_id?: string | null;
}

export interface GateEntry {
  id: string;
  group: GateGroup;
  name: string;
  sequence: number;
  status: GateStatus;
  summary: string;
  why_it_blocks?: string;
  current_value?: string;
  required_value?: string;
  blocker_codes?: string[];
  action: GateAction;
  retry_safe?: boolean;
  mutation_started?: boolean;
  source: GateSource;
}

export interface GoLiveGateSnapshot {
  snapshot_version: string;
  evaluated_at: string;
  module_code: string | null;
  event_code: string | null;
  channel: string | null;
  correlation_id: string | null;
  current_attempt_id: string | null;
  preview_snapshot_id: string | null;
  preview_approval_id: string | null;
  dry_run_execution_id: string | null;
  overall_status: GateStatus;
  passed_gate_count: number;
  total_gate_count: number;
  first_blocking_gate_id: string | null;
  recommended_action: GateAction;
  gates: GateEntry[];
}

export interface FetchSnapshotArgs {
  moduleCode: string | null;
  eventCode: string | null;
  channel: string | null;
  previewSnapshotId?: string | null;
  previewApprovalId?: string | null;
  dryRunExecutionId?: string | null;
}

/** Read-only. Does NOT create Preview, approval, execution, request, message,
 *  delivery-attempt, provider, or simulator rows. */
export async function fetchGoLiveGateSnapshot(
  args: FetchSnapshotArgs
): Promise<GoLiveGateSnapshot> {
  const { data, error } = await supabase.rpc(
    "get_comm_hub_go_live_gate_snapshot" as any,
    {
      p_module_code: args.moduleCode,
      p_event_code: args.eventCode,
      p_channel: args.channel,
      p_preview_snapshot_id: args.previewSnapshotId ?? null,
      p_preview_approval_id: args.previewApprovalId ?? null,
      p_dry_run_execution_id: args.dryRunExecutionId ?? null,
    }
  );
  if (error) throw error;
  return data as unknown as GoLiveGateSnapshot;
}

/** Unknown blocker codes fail closed as PLATFORM_FIX. */
export function safeActionKind(kind: string | null | undefined): ActionKind {
  const allowed: ActionKind[] = [
    "REFRESH_SESSION","SIGN_IN_AGAIN","CREATE_FRESH_PREVIEW","APPROVE_PREVIEW",
    "RECHECK_READINESS","OPEN_RECIPIENT_POLICY","OPEN_TEST_SCENARIO",
    "OPEN_TEMPLATE_CONTRACT","OPEN_SENDER_PROFILE","OPEN_PROVIDER_SETTINGS",
    "OPEN_OPERATING_MODE","RESUME_EXISTING_EXECUTION","PLATFORM_FIX",
    "CONTACT_PLATFORM_ADMIN","NO_ACTION_REQUIRED",
  ];
  return allowed.includes(kind as ActionKind) ? (kind as ActionKind) : "PLATFORM_FIX";
}

export const GATE_GROUPS: Array<{ id: GateGroup; label: string }> = [
  { id: "ACCESS", label: "Access" },
  { id: "EVENT_SETUP", label: "Setup" },
  { id: "PREVIEW", label: "Preview" },
  { id: "APPROVAL", label: "Approval" },
  { id: "DRY_RUN_READINESS", label: "Readiness" },
  { id: "PLATFORM_SERVICE", label: "Service" },
  { id: "DRY_RUN_PROCESSING", label: "Process" },
  { id: "CERTIFICATION", label: "Certify" },
];
