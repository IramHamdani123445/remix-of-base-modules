/**
 * CH-SIMPLE-P1 — Canonical Global Settings and Operating Mode
 *
 * The single, authoritative reader for the Communication Hub singleton
 * control-settings row and the sole entry point for transitioning the
 * operating mode.
 *
 * Rules:
 *   1. Always looks up by singleton_guard = 'primary'. Never orders.
 *   2. Never mutates recipient-approval fields (allowed_email_addresses,
 *      allowed_email_domains, recipient_release_mode). Those live in the
 *      recipient-policy layer (later prompt).
 *   3. Legacy compat booleans (dispatch_enabled, dry_run_only) are derived
 *      transactionally by the RPC from the target operating_mode.
 *   4. No pilot recipient address is hardcoded anywhere in this module.
 *      Recipient identity comes exclusively from configuration.
 */

import { supabase } from "@/integrations/supabase/client";

export const COMMUNICATION_SETTINGS_SINGLETON_GUARD = "primary" as const;

export type CommunicationOperatingMode =
  | "DRY_RUN"
  | "CONTROLLED_LIVE"
  | "MANUAL_PRODUCTION"
  | "AUTOMATED_PRODUCTION"
  | "EMERGENCY_STOP";

/** Modes an administrator is permitted to select. */
export const SELECTABLE_OPERATING_MODES: readonly CommunicationOperatingMode[] = [
  "DRY_RUN",
  "CONTROLLED_LIVE",
  "MANUAL_PRODUCTION",
  "EMERGENCY_STOP",
] as const;

/** Blocked mode kept in the enum for future activation; never selectable now. */
export const BLOCKED_OPERATING_MODES: readonly CommunicationOperatingMode[] = [
  "AUTOMATED_PRODUCTION",
] as const;

export type CommunicationAutomationState = "STANDBY" | "ARMED" | "SUSPENDED";

export interface CommunicationGlobalSettings {
  id: string;
  singletonGuard: "primary";
  operatingMode: CommunicationOperatingMode;
  previousOperatingMode: CommunicationOperatingMode | null;
  modeChangedAt: string;
  modeChangedBy: string | null;
  modeChangeReason: string | null;
  configurationVersion: number;
  /** Read-only compatibility booleans derived from operatingMode. */
  dispatchEnabled: boolean;
  dryRunOnly: boolean;
  emailLiveEnabled: boolean;
  smsLiveEnabled: boolean;
  whatsappLiveEnabled: boolean;
  printEnabled: boolean;
  letterEnabled: boolean;
  /** Phase 4A — server-owned automation activation state. */
  automationState: CommunicationAutomationState;
  automationArmedAt: string | null;
  automationArmedBy: string | null;
  automationArmReason: string | null;
  automationSuspendedAt: string | null;
  automationSuspensionReason: string | null;
  schedulerEnabled: boolean;
  automaticTriggersEnabled: boolean;
  retryWorkerEnabled: boolean;
  batchEnabled: boolean;
  bulkEnabled: boolean;
  updatedAt: string;
}

/**
 * Canonical singleton read.
 *
 * MUST NOT use `.order(...)`. MUST filter on singleton_guard.
 */
export async function fetchGlobalSettings(): Promise<CommunicationGlobalSettings> {
  const { data, error } = await supabase
    .from("communication_hub_control_settings")
    .select(
      "id, singleton_guard, operating_mode, previous_operating_mode, mode_changed_at, mode_changed_by, mode_change_reason, configuration_version, dispatch_enabled, dry_run_only, email_live_enabled, sms_live_enabled, whatsapp_live_enabled, print_enabled, letter_enabled, scheduler_enabled, automatic_triggers_enabled, retry_worker_enabled, batch_enabled, bulk_enabled, automation_state, automation_armed_at, automation_armed_by, automation_arm_reason, automation_suspended_at, automation_suspension_reason, updated_at"
    )
    .eq("singleton_guard", COMMUNICATION_SETTINGS_SINGLETON_GUARD)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("communication hub settings singleton is missing");
  const row = data as any;
  return {
    id: row.id as string,
    singletonGuard: "primary",
    operatingMode: row.operating_mode as CommunicationOperatingMode,
    previousOperatingMode: (row.previous_operating_mode ?? null) as CommunicationOperatingMode | null,
    modeChangedAt: row.mode_changed_at as string,
    modeChangedBy: (row.mode_changed_by ?? null) as string | null,
    modeChangeReason: (row.mode_change_reason ?? null) as string | null,
    configurationVersion: Number(row.configuration_version ?? 0),
    dispatchEnabled: Boolean(row.dispatch_enabled),
    dryRunOnly: Boolean(row.dry_run_only),
    emailLiveEnabled: Boolean(row.email_live_enabled),
    smsLiveEnabled: Boolean(row.sms_live_enabled),
    whatsappLiveEnabled: Boolean(row.whatsapp_live_enabled),
    printEnabled: Boolean(row.print_enabled),
    letterEnabled: Boolean(row.letter_enabled),
    automationState: (row.automation_state ?? "STANDBY") as CommunicationAutomationState,
    automationArmedAt: (row.automation_armed_at ?? null) as string | null,
    automationArmedBy: (row.automation_armed_by ?? null) as string | null,
    automationArmReason: (row.automation_arm_reason ?? null) as string | null,
    automationSuspendedAt: (row.automation_suspended_at ?? null) as string | null,
    automationSuspensionReason: (row.automation_suspension_reason ?? null) as string | null,
    schedulerEnabled: Boolean(row.scheduler_enabled),
    automaticTriggersEnabled: Boolean(row.automatic_triggers_enabled),
    retryWorkerEnabled: Boolean(row.retry_worker_enabled),
    batchEnabled: Boolean(row.batch_enabled),
    bulkEnabled: Boolean(row.bulk_enabled),
    updatedAt: row.updated_at as string,
  };
}

export interface OperatingModeTransitionResult {
  previousMode: CommunicationOperatingMode | null;
  newMode: CommunicationOperatingMode;
  configurationVersion: number;
  changedAt: string;
  actor: string | null;
  reason: string | null;
}

/**
 * Transactional operating-mode transition.
 * Recipient approval settings are never modified by this RPC.
 */
export async function setOperatingMode(
  newMode: CommunicationOperatingMode,
  reason?: string,
  options?: { expectedVersion?: number; moduleCode?: string; eventCode?: string; channel?: string }
): Promise<OperatingModeTransitionResult> {
  if (BLOCKED_OPERATING_MODES.includes(newMode)) {
    throw new Error(`operating mode ${newMode} is not available`);
  }
  const { data, error } = await (supabase.rpc as any)(
    "apply_communication_release_mode",
    {
      p_new_mode: newMode,
      p_reason: reason ?? null,
      p_expected_version: options?.expectedVersion ?? null,
      p_module_code: options?.moduleCode ?? null,
      p_event_code: options?.eventCode ?? null,
      p_channel: options?.channel ?? null,
    }
  );
  if (error) throw error;
  const row = data as any;
  if (!row?.ok || row?.new_mode !== newMode) {
    throw new Error(`apply_communication_release_mode did not confirm ${newMode}`);
  }
  return {
    previousMode: (row?.previous_mode ?? null) as CommunicationOperatingMode | null,
    newMode: row?.new_mode as CommunicationOperatingMode,
    configurationVersion: Number(row?.configuration_version ?? 0),
    changedAt: row?.changed_at as string,
    actor: (row?.actor ?? null) as string | null,
    reason: (row?.reason ?? null) as string | null,
  };
}

/**
 * Derive the read-only compatibility booleans from an operating mode.
 * Mirrors the CASE expressions inside set_communication_operating_mode
 * so UI and tests can predict transactional post-conditions without a
 * round-trip.
 */
export function deriveCompatBooleans(mode: CommunicationOperatingMode): {
  dispatchEnabled: boolean;
  dryRunOnly: boolean;
} {
  return {
    dispatchEnabled: mode !== "EMERGENCY_STOP",
    dryRunOnly: mode === "DRY_RUN" || mode === "EMERGENCY_STOP",
  };
}
