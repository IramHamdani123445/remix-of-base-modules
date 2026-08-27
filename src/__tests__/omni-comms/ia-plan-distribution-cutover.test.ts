/**
 * DEF-2B — Internal Audit plan distribution cutover.
 *
 * Proves that plan distribution runs exclusively through the governed
 * Omni-Comms attachment pipeline: no direct provider/edge-function send, a
 * catalogued event, a required attachment and a stable per-recipient
 * occurrence key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

import { internalAuditEntry } from '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationCatalogue';
import { internalAuditTemplateEntry } from '@/platform/omni-comms/integrations/business/internal-audit/templates/internalAuditTemplateRegistry';

const emitMock = vi.fn();
const rpcMock = vi.fn();
const downloadMock = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    storage: { from: () => ({ download: (...a: unknown[]) => downloadMock(...a) }) },
  },
}));

vi.mock(
  '@/platform/omni-comms/integrations/business/businessScopeResolver',
  () => ({
    resolveBusinessCommunicationScope: async () => ({
      organizationId: '69afc88b-da5c-4f41-a1e7-199e1ee1d416',
      departmentId: null,
      departmentSource: 'none',
    }),
  }),
);

vi.mock(
  '@/platform/omni-comms/integrations/business/internal-audit/internalAuditCommunicationProducer',
  () => ({
    emitInternalAuditCommunication: (...args: unknown[]) => emitMock(...args),
  }),
);

const PDF = new Uint8Array([1, 2, 3, 4]);

function pdfBlob() {
  return { arrayBuffer: async () => PDF.buffer.slice(0) };
}

const ARTIFACT = {
  id: 'a1111111-1111-1111-1111-111111111111',
  file_name: 'Plan-2026-v2.pdf',
  file_path: 'plans/2026/v2.pdf',
  mime_type: 'application/pdf',
  checksum: null,
  version_number: 2,
  status: 'Generated',
  is_final: true,
};

describe('DEF-2B — plan distribution through governed Omni-Comms', () => {
  beforeEach(() => {
    emitMock.mockReset();
    rpcMock.mockReset();
    downloadMock.mockReset();
    downloadMock.mockResolvedValue({ data: pdfBlob(), error: null });
    rpcMock.mockResolvedValue({
      data: { ok: true, attachment_id: 'b2222222-2222-2222-2222-222222222222' },
      error: null,
    });
    emitMock.mockResolvedValue({
      outcome: 'queued',
      requestId: 'r-1',
      blockers: [],
    });
  });

  it('publishes INTERNAL_AUDIT.PLAN.DISTRIBUTED in the catalogue and registry', () => {
    const entry = internalAuditEntry('INTERNAL_AUDIT.PLAN.DISTRIBUTED');
    expect(entry).not.toBeNull();
    expect(entry?.entityType).toBe('ia_annual_plan');
    expect(entry?.recipientRole).toBe('audit_committee');
    expect(entry?.repeatable).toBe(true);
    const tpl = internalAuditTemplateEntry('INTERNAL_AUDIT.PLAN.DISTRIBUTED');
    expect(tpl?.tokens).toEqual(
      expect.arrayContaining(['artifactName', 'artifactVersion', 'distributionPurpose']),
    );
  });

  it('registers the artifact and emits one required attachment per recipient', async () => {
    const { distributeAuditPlan } = await import(
      '@/services/audit/planDistributionCommunicationService'
    );
    const result = await distributeAuditPlan({
      planId: 'p3333333-3333-3333-3333-333333333333',
      plan: { title: 'Annual Plan', fiscal_year: '2026' },
      artifact: ARTIFACT,
      recipients: [
        { name: 'Board Chair', email: 'chair@example.com', type: 'board' },
        { name: 'Member', email: 'member@example.com', type: 'board' },
      ],
      purpose: 'final_distribution',
    });

    expect(result.attachment.ok).toBe(true);
    expect(result.attachment.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.acceptedCount).toBe(2);
    expect(emitMock).toHaveBeenCalledTimes(2);

    const first = emitMock.mock.calls[0][0];
    expect(first.eventCode).toBe('INTERNAL_AUDIT.PLAN.DISTRIBUTED');
    expect(first.attachments).toEqual([
      {
        attachmentId: 'b2222222-2222-2222-2222-222222222222',
        disposition: 'attachment',
        requiredForDelivery: true,
      },
    ]);
    expect(first.occurrence).toContain('final_distribution:v2:');
    expect(first.occurrence).toContain('chair@example.com');
    // Business supplies facts only — never subject, html, sender or provider.
    expect(Object.keys(first)).not.toContain('subject');
    expect(Object.keys(first)).not.toContain('html');
  });

  it('blocks every recipient when the artifact checksum does not match', async () => {
    const { distributeAuditPlan } = await import(
      '@/services/audit/planDistributionCommunicationService'
    );
    const result = await distributeAuditPlan({
      planId: 'p3333333-3333-3333-3333-333333333333',
      plan: { title: 'Annual Plan', fiscal_year: '2026' },
      artifact: { ...ARTIFACT, checksum: 'f'.repeat(64) },
      recipients: [{ name: 'Board Chair', email: 'chair@example.com', type: 'board' }],
      purpose: 'board_review',
    });

    expect(result.attachment.ok).toBe(false);
    expect(result.attachment.code).toBe('artifact_checksum_mismatch');
    expect(emitMock).not.toHaveBeenCalled();
    expect(result.results[0].outcome).toBe('blocked');
  });

  it('PlanDistributionTab contains no direct send path', () => {
    const source = readFileSync('src/components/audit/PlanDistributionTab.tsx', 'utf8');
    for (const needle of [
      'functions.invoke',
      'send-notification',
      'notification_queue',
      'notification_logs',
      'btoa(',
      'from_email',
    ]) {
      expect(source.includes(needle), `PlanDistributionTab must not contain "${needle}"`).toBe(false);
    }
    expect(source.includes('distributeAuditPlan')).toBe(true);
  });
});
