// Omni-Comms Runtime — Slice 2c-iii rendering orchestrator.
//
// Consumes the persisted Slice 2c-ii resolution snapshot, revalidates it,
// renders each eligible recipient × channel, and derives mode-aware message
// status, held dispatch-job evidence and the final request status.
//
// No provider is contacted. No email is sent. No delivery attempt is created.
// No runnable dispatch job may ever be produced by this build.

import { renderMessage } from "./renderMessage.ts";
import { RenderingError } from "./renderingErrors.ts";
import { revalidateSnapshot } from "./snapshotRevalidator.ts";
import type {
  MessageCandidate,
  PersistedChannelResolution,
  RenderContext,
} from "./renderingTypes.ts";

export type RuntimeMode = "dry_run" | "shadow" | "queued";

export interface DispatchJobCandidate {
  message_index: number;
  channel: string;
  mode: RuntimeMode;
  status: "held";
  is_runnable: false;
  hold_reason: string;
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

export function resolveHoldReason(mode: RuntimeMode, blockers: string[]): string {
  if (mode === "shadow") return "shadow_mode";
  for (const entry of HOLD_REASON_PRECEDENCE) {
    if (blockers.includes(entry.blocker)) return entry.reason;
  }
  // Privileged live-provider readiness has not been certified in this build.
  return "runtime_privileged_certification_pending";
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

    for (const channel of eligible) {
      const resolution = resolutions.find((r) => r.channel === channel);
      if (!resolution) {
        requestBlockers.add("resolution_snapshot_missing");
        continue;
      }

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
