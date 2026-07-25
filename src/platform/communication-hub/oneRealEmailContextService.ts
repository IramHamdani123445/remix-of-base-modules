/**
 * Stage 6 authoritative context loader.
 *
 * Reads `get_comm_hub_one_real_email_context(module,event,channel,cert_id)`.
 * The RPC is the single source of truth for the Stage 6 send lineage:
 * recipient, sender, provider, gate state, operating mode, snapshot /
 * approval / dry-run / controlled-stub IDs, configuration version, and
 * recipient policy version. The browser must not derive or guess any of
 * these values.
 */
import { supabase } from "@/integrations/supabase/client";

export interface OneRealEmailContextBlocker {
  code: string;
  message: string;
}

export interface OneRealEmailContext {
  ok: boolean;
  blockers: OneRealEmailContextBlocker[];
  moduleCode: string;
  eventCode: string;
  channel: string;
  recipient: string | null;
  recipientSetHash: string | null;
  configurationVersion: number | null;
  recipientPolicyVersion: number | null;
  previewSnapshotId: string | null;
  previewApprovalId: string | null;
  dryRunCertificationId: string | null;
  controlledStubCertificationId: string;
  senderProfileId: string | null;
  senderName: string | null;
  senderAddress: string | null;
  providerId: string | null;
  providerName: string | null;
  providerHealth: "READY" | "STUB" | "MISSING" | string | null;
  operatingMode: string | null;
  realEmailGateEnabled: boolean;
  realEmailGateOpenedBy: string | null;
  realEmailGateOpenedAt: string | null;
  evaluatedAt: string;
}

export async function fetchOneRealEmailContext(input: {
  moduleCode: string;
  eventCode: string;
  channel: string;
  controlledStubCertificationId: string;
}): Promise<OneRealEmailContext> {
  const { data, error } = await (supabase as any).rpc(
    "get_comm_hub_one_real_email_context",
    {
      p_module_code: input.moduleCode,
      p_event_code: input.eventCode,
      p_channel: input.channel,
      p_controlled_stub_certification_id: input.controlledStubCertificationId,
    },
  );
  if (error) throw new Error(error.message ?? "context RPC failed");
  const r = (data ?? {}) as any;
  const blockers: OneRealEmailContextBlocker[] = Array.isArray(r.blockers)
    ? r.blockers.map((b: any) => ({ code: String(b.code ?? "unknown"), message: String(b.message ?? "") }))
    : [];
  return {
    ok: r.ok === true,
    blockers,
    moduleCode: r.module_code ?? input.moduleCode,
    eventCode: r.event_code ?? input.eventCode,
    channel: r.channel ?? input.channel,
    recipient: r.recipient ?? null,
    recipientSetHash: r.recipient_set_hash ?? null,
    configurationVersion: r.configuration_version ?? null,
    recipientPolicyVersion: r.recipient_policy_version ?? null,
    previewSnapshotId: r.preview_snapshot_id ?? null,
    previewApprovalId: r.preview_approval_id ?? null,
    dryRunCertificationId: r.dry_run_certification_id ?? null,
    controlledStubCertificationId: r.controlled_stub_certification_id ?? input.controlledStubCertificationId,
    senderProfileId: r.sender_profile_id ?? null,
    senderName: r.sender_name ?? null,
    senderAddress: r.sender_address ?? null,
    providerId: r.provider_id ?? null,
    providerName: r.provider_name ?? null,
    providerHealth: r.provider_health ?? null,
    operatingMode: r.operating_mode ?? null,
    realEmailGateEnabled: r.real_email_gate_enabled === true,
    realEmailGateOpenedBy: r.real_email_gate_opened_by ?? null,
    realEmailGateOpenedAt: r.real_email_gate_opened_at ?? null,
    evaluatedAt: r.evaluated_at ?? new Date().toISOString(),
  };
}
