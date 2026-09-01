/**
 * INTERNAL AUDIT — Annual plan distribution through governed Omni-Comms.
 *
 * DEF-2B. Plan distribution used to download the board-pack PDF into the
 * browser, base64 it and call the legacy notification edge function directly, once per
 * recipient.
 * That path chose its own subject, HTML, sender and attachment bytes, and left
 * no governed delivery evidence.
 *
 * This service replaces it with the certified pipeline:
 *
 *   ia-artifacts PDF  → SHA-256 verification
 *                     → omni_comms_register_attachment (governed registry)
 *                     → emitInternalAuditCommunication(INTERNAL_AUDIT.PLAN.DISTRIBUTED)
 *                     → request → outbox → dispatch → delivery evidence
 *
 * The module supplies FACTS and an ATTACHMENT ID only. It never supplies
 * bytes, subject, HTML, sender, provider, channel or template. The attachment
 * is `requiredForDelivery`, so a channel that cannot carry the plan PDF blocks
 * the message instead of delivering an incomplete distribution.
 */
import { supabase } from '@/integrations/supabase/client';
import { resolveBusinessCommunicationScope } from '@/platform/omni-comms/integrations/business/businessScopeResolver';
import { emitInternalAuditCommunication } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer';
import { INTERNAL_AUDIT_MODULE_CODE } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationCatalogue';

export const IA_PLAN_DISTRIBUTED_EVENT = 'INTERNAL_AUDIT.PLAN.DISTRIBUTED';
export const IA_PLAN_ARTIFACT_BUCKET = 'ia-artifacts';

export interface PlanDistributionArtifact {
  id: string;
  plan_id?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  mime_type?: string | null;
  checksum?: string | null;
  version_number?: number | null;
  status?: string | null;
  is_final?: boolean | null;
}

export interface PlanDistributionRecipientInput {
  name: string;
  email: string;
  type: string;
}

export type PlanDistributionPurpose = 'board_review' | 'final_distribution';

export interface PlanAttachmentRegistration {
  ok: boolean;
  attachmentId: string | null;
  checksum: string | null;
  byteSize: number | null;
  fileName: string;
  /** Bounded failure code. Never a raw provider or storage message. */
  code: string | null;
}

export interface PlanDistributionRecipientResult {
  recipient: PlanDistributionRecipientInput;
  outcome: 'queued' | 'sent' | 'skipped' | 'blocked' | 'failed';
  requestId: string | null;
  blockers: string[];
}

export interface PlanDistributionResult {
  attachment: PlanAttachmentRegistration;
  results: PlanDistributionRecipientResult[];
  acceptedCount: number;
  blockedCount: number;
}

const PURPOSE_LABEL: Record<PlanDistributionPurpose, string> = {
  board_review: 'Board review (pre-approval)',
  final_distribution: 'Official final distribution',
};

/** Hex SHA-256 of the artifact bytes. Web Crypto only — no bundled hasher. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify and register the exact plan artifact in the governed attachment
 * registry. Registration is content-addressed, so re-distributing the same
 * artifact returns the same attachment id.
 */
export async function registerPlanArtifactAttachment(
  artifact: PlanDistributionArtifact,
): Promise<PlanAttachmentRegistration> {
  const fileName = artifact?.file_name?.trim() || 'Internal-Audit-Plan.pdf';
  const base: PlanAttachmentRegistration = {
    ok: false,
    attachmentId: null,
    checksum: null,
    byteSize: null,
    fileName,
    code: null,
  };

  if (!artifact?.file_path) {
    return { ...base, code: 'artifact_file_missing' };
  }
  if (artifact.status === 'Superseded') {
    return { ...base, code: 'artifact_superseded' };
  }

  let bytes: ArrayBuffer;
  try {
    const { data, error } = await supabase.storage
      .from(IA_PLAN_ARTIFACT_BUCKET)
      .download(artifact.file_path);
    if (error || !data) return { ...base, code: 'artifact_download_failed' };
    bytes = await data.arrayBuffer();
  } catch {
    return { ...base, code: 'artifact_download_failed' };
  }

  const checksum = await sha256Hex(bytes);
  const declared = artifact.checksum?.trim().toLowerCase() ?? '';
  if (/^[0-9a-f]{64}$/.test(declared) && declared !== checksum) {
    return { ...base, checksum, code: 'artifact_checksum_mismatch' };
  }

  const scope = await resolveBusinessCommunicationScope({
    moduleCode: INTERNAL_AUDIT_MODULE_CODE,
  });
  if (!scope.organizationId) {
    return { ...base, checksum, code: 'organization_unresolved' };
  }

  const { data, error } = await supabase.rpc('omni_comms_register_attachment', {
    p_organization_id: scope.organizationId,
    p_owner_module_code: INTERNAL_AUDIT_MODULE_CODE,
    p_source_entity_type: 'ia_plan_artifact',
    p_source_entity_id: artifact.id,
    p_storage_bucket: IA_PLAN_ARTIFACT_BUCKET,
    p_storage_path: artifact.file_path,
    p_file_name: fileName,
    p_content_type: artifact.mime_type?.trim() || 'application/pdf',
    p_byte_size: bytes.byteLength,
    p_checksum_sha256: checksum,
    p_classification: 'internal',
    p_department_id: scope.departmentId,
  } as never);

  if (error) return { ...base, checksum, byteSize: bytes.byteLength, code: 'attachment_registration_failed' };

  const row = (data ?? {}) as { ok?: boolean; attachment_id?: string; code?: string };
  if (!row.ok || !row.attachment_id) {
    return { ...base, checksum, byteSize: bytes.byteLength, code: row.code ?? 'attachment_registration_failed' };
  }

  return {
    ok: true,
    attachmentId: row.attachment_id,
    checksum,
    byteSize: bytes.byteLength,
    fileName,
    code: null,
  };
}

/** Stable per-recipient occurrence: the same artifact version is sent once. */
export function planDistributionOccurrence(
  artifact: PlanDistributionArtifact,
  purpose: PlanDistributionPurpose,
  email: string,
): string {
  const version = artifact?.version_number ?? 1;
  return `${purpose}:v${version}:${artifact?.id ?? 'artifact'}:${String(email ?? '')
    .trim()
    .toLowerCase()}`;
}

export interface DistributeAuditPlanInput {
  planId: string;
  plan: {
    title?: string | null;
    fiscal_year?: string | number | null;
    plan_year?: string | number | null;
    plan_reference?: string | null;
  } | null;
  artifact: PlanDistributionArtifact;
  recipients: PlanDistributionRecipientInput[];
  purpose: PlanDistributionPurpose;
}

/**
 * Distribute a plan artifact to every recipient through Omni-Comms.
 * Total: a communication failure never throws into the audit UI.
 */
export async function distributeAuditPlan(
  input: DistributeAuditPlanInput,
): Promise<PlanDistributionResult> {
  const attachment = await registerPlanArtifactAttachment(input.artifact);

  if (!attachment.ok || !attachment.attachmentId) {
    return {
      attachment,
      results: input.recipients.map((recipient) => ({
        recipient,
        outcome: 'blocked' as const,
        requestId: null,
        blockers: [attachment.code ?? 'attachment_unavailable'],
      })),
      acceptedCount: 0,
      blockedCount: input.recipients.length,
    };
  }

  const planYear = String(
    input.plan?.fiscal_year ?? input.plan?.plan_year ?? '',
  ).trim();
  const reference =
    input.plan?.plan_reference?.trim() ||
    `Annual Audit Plan ${planYear || input.planId.slice(0, 8)}`;
  const distributedOn = new Date().toISOString().slice(0, 10);

  const results: PlanDistributionRecipientResult[] = [];

  for (const recipient of input.recipients) {
    const emission = await emitInternalAuditCommunication({
      eventCode: IA_PLAN_DISTRIBUTED_EVENT,
      entityId: input.planId,
      occurrence: planDistributionOccurrence(
        input.artifact,
        input.purpose,
        recipient.email,
      ),
      recipientName: recipient.name?.trim() || recipient.email,
      recipientEmail: recipient.email,
      audience: recipient.type === 'internal' ? 'internal' : 'external',
      reference,
      values: {
        planTitle: input.plan?.title ?? '',
        planYear,
        distributionPurpose: PURPOSE_LABEL[input.purpose],
        artifactName: attachment.fileName,
        artifactVersion: String(input.artifact?.version_number ?? 1),
        distributedOn,
      },
      attachments: [
        {
          attachmentId: attachment.attachmentId,
          disposition: 'attachment',
          requiredForDelivery: true,
        },
      ],
    });

    results.push({
      recipient,
      outcome: emission.outcome as PlanDistributionRecipientResult['outcome'],
      requestId: emission.requestId ?? null,
      blockers: emission.blockers ?? [],
    });
  }

  const acceptedCount = results.filter(
    (r) => r.outcome === 'queued' || r.outcome === 'sent',
  ).length;

  return {
    attachment,
    results,
    acceptedCount,
    blockedCount: results.length - acceptedCount,
  };
}
