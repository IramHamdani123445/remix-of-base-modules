/**
 * Omni-Comms — Activity is business-event-first.
 *
 * Proves the read model is rooted on the recorded business event, that the
 * status vocabulary is business language, and that the adapter goes through
 * the capability-gated RPCs rather than table reads.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BUSINESS_EVENT_ATTENTION_STATUSES,
  BUSINESS_EVENT_STATUSES,
  businessEventStatusLabel,
  businessEventStatusTone,
  getBusinessEventActivityDetail,
  listBusinessEventActivity,
} from '@/platform/omni-comms/application/businessEventActivityService';

const REPO = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO, rel), 'utf8');
}

describe('business-event status vocabulary', () => {
  it('never claims a queued or claimed job was sent', () => {
    for (const status of BUSINESS_EVENT_STATUSES) {
      const label = businessEventStatusLabel(status).toLowerCase();
      if (status !== 'delivered' && status !== 'provider_accepted') {
        expect(label).not.toContain('sent');
        expect(label).not.toContain('delivered');
      }
    }
  });

  it('reserves acceptance and delivery for provider evidence', () => {
    expect(businessEventStatusLabel('provider_accepted')).toBe('Provider accepted');
    expect(businessEventStatusLabel('delivered')).toBe('Delivered');
  });

  it('surfaces a business event before any communication exists', () => {
    expect(BUSINESS_EVENT_STATUSES).toContain('event_recorded');
    expect(BUSINESS_EVENT_STATUSES).toContain('no_communication_configured');
    expect(businessEventStatusLabel('event_recorded')).toBe('Event recorded');
  });

  it('marks only actionable states as needing attention', () => {
    expect([...BUSINESS_EVENT_ATTENTION_STATUSES].sort()).toEqual([
      'failed',
      'needs_configuration',
      'needs_review',
    ]);
    expect(businessEventStatusTone('failed')).toBe('destructive');
    expect(businessEventStatusTone('delivered')).toBe('default');
  });

  it('falls back to readable text for an unknown status', () => {
    expect(businessEventStatusLabel('some_new_state')).toBe('some new state');
  });
});

describe('business-event activity adapter', () => {
  it('lists activity through the capability-gated RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { items: [], total: 0, limit: 25, offset: 0, generated_at: 'now' },
      error: null,
    });
    await listBusinessEventActivity({ rpc } as never, {
      organizationId: 'org-1',
      status: 'delivered',
      limit: 1000,
      offset: -5,
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_business_event_activity_list', {
      p_organization_id: 'org-1',
      p_status: 'delivered',
      p_module_code: null,
      p_event_code: null,
      p_search: null,
      p_limit: 100,
      p_offset: 0,
    });
  });

  it('loads one business event through the detail RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'e1' }, error: null });
    await getBusinessEventActivityDetail({ rpc } as never, {
      organizationId: 'org-1',
      eventId: 'e1',
    });
    expect(rpc).toHaveBeenCalledWith('omni_comms_business_event_activity_detail', {
      p_organization_id: 'org-1',
      p_event_id: 'e1',
    });
  });

  it('never reads runtime tables directly', () => {
    const src = read(
      'src/platform/omni-comms/application/businessEventActivityService.ts',
    );
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.from\(/);
    expect(src).not.toMatch(/integrations\/supabase\/client/);
  });
});

describe('activity surface is rooted on business events', () => {
  const page = read(
    'src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx',
  );

  it('drives the normal feed from the business-event projection', () => {
    expect(page).toContain('listBusinessEventActivity');
    expect(page).toContain('omni-comms-ops-event-row-');
    expect(page).toContain('Business event');
  });

  it('keeps the request register as technical evidence only', () => {
    const technicalIndex = page.indexOf('omni-comms-ops-technical-details');
    expect(technicalIndex).toBeGreaterThan(0);
    expect(page.indexOf('omni-comms-ops-request-register')).toBeGreaterThan(
      technicalIndex,
    );
  });

  it('opens a business event without adding a permanent route', () => {
    expect(page).toContain('businessEvent');
    expect(page).toContain('BusinessEventDetailPanel');
  });
});

describe('omni-comms documentation is standalone', () => {
  it('does not frame the platform as a parallel replacement', () => {
    const readme = read('src/platform/omni-comms/README.md');
    expect(readme).not.toMatch(/\bLegacy\b/);
    expect(readme).not.toMatch(/cutover/i);
    expect(readme).toContain('central communications platform');
  });
});
