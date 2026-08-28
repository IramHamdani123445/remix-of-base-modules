// Omni-Comms Runtime — Slice 2c-iii rendering orchestrator.
//
// Consumes the persisted Slice 2c-ii resolution snapshot, revalidates it,
// renders each eligible recipient × channel, and derives mode-aware message
// status, dispatch-job evidence and the final request status.
//
// No provider is contacted. No email is sent. No delivery attempt is created.
// A dispatch job may only be proposed as runnable when the fail-closed
// certification decision in `dispatchAuthorization.ts` authorises it; the
// persistence RPC independently re-evaluates the same contract, so this
// module can never widen what the database will accept.

import { renderMessage } from "./renderMessage.ts";
import { RenderingError } from "./renderingErrors.ts";
import { revalidateSnapshot } from "./snapshotRevalidator.ts";
import {
  type DispatchAuthorizationContext,
  type DispatchHoldReason,
  evaluateDispatchAuthorization,
} from "./dispatchAuthorization.ts";
import type {
  MessageCandidate,
  PersistedChannelResolution,
  PersistedDeliveryLeg,
  RenderContext,
} from "./renderingTypes.ts";

export type RuntimeMode = "dry_run" | "shadow" | "queued";

export interface DispatchJobCandidate {
  message_index: number;
  channel: string;
  mode: RuntimeMode;
  /** `queued` + `is_runnable: true` is only ever proposed for an AUTHORIZED job. */
  status: "held" | "queued";
  is_runnable: boolean;
  hold_reason: string | null;
  attempt_count: 0;
}

export interface OrchestratedRendering {
  messages: MessageCandidate[];
  /** Terminal message status per mode, applied by the persistence RPC. */
  successStatus: "dry_run_completed" | "shadow_completed" | "held";
  jobs: DispatchJobCandidate[];
  requestBlockers: string[];
  finalStatus: "completed" | "completed_with_blockers" | "blocked";
}

/** Ordered, most-specific-first hold reasons derived from persisted blockers. */
const HOLD_REASON_PRECEDENCE: Array<{ blocker: string; reason: string }> = [
  { blocker: "provider_credentials_unavailable", reason: "provider_credentials_unavailable" },
  { blocker: "provider_account_not_ready", reason: "provider_account_not_ready" },
  { blocker: "sender_not_verified", reason: "sender_not_verified" },
  { blocker: "live_delivery_disabled", reason: "live_delivery_disabled" },
];

/**
 * Resolve the dispatch state for one rendered leg.
 *
 * Resolution-time blockers win first (they are more specific than any
 * governance reason). Otherwise the fail-closed certification decision
 * applies: AUTHORIZED yields a runnable job, anything else yields its exact
 * hold reason. When no authorisation context is supplied at all — the default
 * for every non-certification deployment — the leg stays held under
 * `runtime_privileged_certification_pending`, exactly as before.
 */
export function resolveDispatchState(
  mode: RuntimeMode,
  blockers: string[],
  authorization?: DispatchAuthorizationContext | null,
): { runnable: boolean; holdReason: string | null } {
  if (mode === "shadow") return { runnable: false, holdReason: "shadow_mode" };
  for (const entry of HOLD_REASON_PRECEDENCE) {
    if (blockers.includes(entry.blocker)) return { runnable: false, holdReason: entry.reason };
  }
  if (!authorization) {
    return { runnable: false, holdReason: "runtime_privileged_certification_pending" };
  }
  const decision = evaluateDispatchAuthorization(authorization);
  if (decision.authorized) return { runnable: true, holdReason: null };
  return { runnable: false, holdReason: decision.reason satisfies DispatchHoldReason };
}

/** Back-compatible accessor retained for existing callers and tests. */
export function resolveHoldReason(
  mode: RuntimeMode,
  blockers: string[],
  authorization?: DispatchAuthorizationContext | null,
): string | null {
  return resolveDispatchState(mode, blockers, authorization).holdReason;
}


function recipientContext(recipient: RenderContext["recipients"][number]): Record<string, unknown> {
  return {
    display_name: recipient.display_name,
    locale: recipient.locale,
    reference: recipient.recipient_reference,
    type: recipient.recipient_type,
    ...(recipient.destination_snapshot ?? {}),
  };
}

function channelSettingSnapshot(
  context: RenderContext,
  channel: string,
): Record<string, unknown> {
  const setting = context.channel_settings.find((c) => c.channel === channel) ?? null;
  if (!setting) return { channel, enabled: false, live_delivery_enabled: false };
  return {
    channel: setting.channel,
    enabled: setting.enabled,
    live_delivery_enabled: setting.live_delivery_enabled,
    channel_setting_id: setting.id,
  };
}

export async function orchestrateRendering(context: RenderContext): Promise<OrchestratedRendering> {
  const mode = context.request.mode;
  const messages: MessageCandidate[] = [];
  const jobs: DispatchJobCandidate[] = [];
  const requestBlockers = new Set<string>();

  // Deterministic ordering: recipients as persisted, channels sorted.
  for (const recipient of context.recipients) {
    const resolutions: PersistedChannelResolution[] =
      recipient.resolution_snapshot?.channel_resolutions ?? [];
    const eligible = [...(recipient.resolved_channels ?? [])].sort();
    const persistedLegs = recipient.resolution_snapshot?.delivery_legs ?? [];

    // Under the Communication Action model the LEG is the unit of work: two
    // actions on the same channel render twice, from their own template
    // families. Legacy (route-only) requests keep the per-channel unit.
    const units: Array<{
      channel: string;
      resolution: PersistedChannelResolution;
      leg: PersistedDeliveryLeg | null;
    }> = persistedLegs.length > 0
      ? persistedLegs
        .filter((l) => eligible.includes(l.channel))
        .sort((a, b) => (a.leg_key < b.leg_key ? -1 : a.leg_key > b.leg_key ? 1 : 0))
        .map((l) => ({ channel: l.channel, resolution: l, leg: l }))
      : eligible.map((channel) => ({
        channel,
        resolution: resolutions.find((r) => r.channel === channel)!,
        leg: null,
      }));

    for (const unit of units) {
      const channel = unit.channel;
      const resolution = unit.resolution;
      if (!resolution) {
        requestBlockers.add("resolution_snapshot_missing");
        continue;
      }
      const leg = unit.leg;

      const revalidation = revalidateSnapshot(context, resolution);
      const base = {
        recipient_id: recipient.id,
        channel,
        event_route_id: resolution.route_id ?? null,
        template_family_id: resolution.template_family_id,
        template_version_id: resolution.template_version_id,
        layout_id: resolution.layout_id,
        layout_version_id: resolution.layout_version_id,
        resolved_asset_manifest: {
          assets: [...(resolution.assets ?? [])].sort((a, b) =>
            a.asset_version_id < b.asset_version_id ? -1 : a.asset_version_id > b.asset_version_id ? 1 : 0
          ),
        },
        sender_identity_id: resolution.sender_identity_id,
        provider_id: resolution.provider_id,
        provider_account_id: resolution.provider_account_id,
        channel_setting_snapshot: channelSettingSnapshot(context, channel),
        destination_snapshot: recipient.destination_snapshot ?? {},
        action_id: leg?.communication_action_id ?? null,
        action_channel_option_id: leg?.action_channel_option_id ?? null,
        delivery_policy_id: leg?.delivery_policy_id ?? null,
        delivery_leg_key: leg?.leg_key ?? null,
        resolution_reason: leg
          ? {
            action_code: leg.communication_action_code,
            obligation: leg.obligation,
            satisfaction_rule: leg.satisfaction_rule,
            reason: leg.resolution_reason,
            is_fallback: leg.is_fallback,
            template_family_source: leg.template_family_source,
            policy_version: leg.delivery_policy_version,
            policy_mode: leg.delivery_policy_mode,
          }
          : null,
      };


      if (!revalidation.ok) {
        for (const b of revalidation.blockers) requestBlockers.add(b);
        messages.push({
          ...base,
          rendered_subject: null,
          rendered_html: null,
          rendered_text: null,
          unresolved_tokens: [],
          unresolved_required_slots: [],
          rendered_checksum: null,
          status: "blocked",
          blockers: revalidation.blockers,
        });
        continue;
      }

      let rendered;
      try {
        rendered = await renderMessage({
          channel,
          resolution,
          template: revalidation.template,
          layout: revalidation.layout,
          sender: revalidation.sender,
          payload: context.request.payload_snapshot ?? {},
          recipientContext: recipientContext(recipient),
        });
      } catch (err) {
        const code = err instanceof RenderingError ? err.code : "rendering_failed";
        requestBlockers.add(code);
        messages.push({
          ...base,
          rendered_subject: null,
          rendered_html: null,
          rendered_text: null,
          unresolved_tokens: [],
          unresolved_required_slots: [],
          rendered_checksum: null,
          status: "blocked",
          blockers: [code],
        });
        continue;
      }

      const blocked = rendered.blockers.length > 0;
      if (blocked) for (const b of rendered.blockers) requestBlockers.add(b);

      const index = messages.length;
      messages.push({
        ...base,
        rendered_subject: rendered.subject,
        rendered_html: rendered.html,
        rendered_text: rendered.text,
        unresolved_tokens: rendered.unresolvedTokens,
        unresolved_required_slots: rendered.unresolvedRequiredSlots,
        rendered_checksum: rendered.checksum,
        status: blocked ? "blocked" : "rendered",
        blockers: rendered.blockers,
      });

      // Mode-aware job evidence — dry_run creates NO dispatch job at all.
      if (!blocked && mode !== "dry_run") {
        jobs.push({
          message_index: index,
          channel,
          mode,
          status: "held",
          is_runnable: false,
          hold_reason: resolveHoldReason(mode, resolution.blockers ?? []),
          attempt_count: 0,
        });
      }
    }
  }

  const successful = messages.filter((m) => m.status === "rendered").length;
  const blockedCount = messages.length - successful;

  let finalStatus: OrchestratedRendering["finalStatus"];
  if (messages.length === 0 || successful === 0) finalStatus = "blocked";
  else if (blockedCount > 0) finalStatus = "completed_with_blockers";
  else finalStatus = "completed";

  const successStatus = mode === "dry_run"
    ? "dry_run_completed"
    : mode === "shadow"
      ? "shadow_completed"
      : "held";

  return {
    messages,
    successStatus,
    jobs,
    requestBlockers: [...requestBlockers].sort(),
    finalStatus,
  };
}
