/**
 * Omni-Comms UI Phase 2 (UX2) — resource management, lifecycle actions and
 * the mandated audit-history safety contract.
 *
 * Static + pure-function tests. No RPC, no network, no provider SDK.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMPTY_RESOURCE_FILTER,
  HISTORY_UNAVAILABLE_MESSAGE,
  RESOURCE_STATUS_FILTERS,
  backendLifecycleAction,
  filterResourceRows,
  formatTimestamp,
  isPermissionDenied,
  lifecycleRequiresReason,
  safeLifecycleFacts,
} from '@/platform/omni-comms/admin/views/channels/resourceManager';
import { OMNI_COMMS_RESOURCE_PARAM } from '@/platform/omni-comms/admin/hooks/useOmniCommsResourceParam';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/omniCommsRpcErrors';
import { accountLifecycleActions } from '@/platform/omni-comms/admin/views/channels/ChannelAccountsTab';

const ROOT = process.cwd();
const CH = 'src/platform/omni-comms/admin/views/channels';

const TAB_FILES = [
  `${CH}/ChannelProvidersTab.tsx`,
  `${CH}/ChannelAccountsTab.tsx`,
  `${CH}/ChannelIdentitiesTab.tsx`,
  `${CH}/ChannelEndpointsTab.tsx`,
  `${CH}/ChannelBindingsTab.tsx`,
  `${CH}/ChannelPoliciesTab.tsx`,
];

const UX2_FILES = [
  ...TAB_FILES,
  `${CH}/resourceManager.tsx`,
  'src/platform/omni-comms/admin/hooks/useOmniCommsResourceParam.ts',
];

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * Executable source only. Documentation comments legitimately *name* the
 * forbidden columns in order to prohibit them; the contract is that no code
 * path selects, fetches or renders them.
 */
const readCode = (rel: string) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/* ─── Audit-history safety contract ────────────────────────────────── */

describe('UX2 audit-history safety contract', () => {
  it('never queries core_audit_log anywhere in UX2 sources', () => {
    for (const f of UX2_FILES) {
      expect(readCode(f)).not.toMatch(/core_audit_log/);
    }
  });

  it('does not create a direct audit-read service', () => {
    expect(() => read(`${CH}/channelAuditHistoryService.ts`)).toThrow();
  });

  it('never selects, fetches or renders raw audit JSON or actor PII', () => {
    for (const f of UX2_FILES) {
      const src = readCode(f);
      expect(src).not.toMatch(/before_value/);
      expect(src).not.toMatch(/after_value/);
      expect(src).not.toMatch(/actor_email/);
    }
  });

  it('never renders a secret reference value in the resource manager', () => {
    expect(readCode(`${CH}/resourceManager.tsx`)).not.toMatch(/secret_ref/);
  });

  it('states the history-unavailable message rather than fabricating history', () => {
    expect(HISTORY_UNAVAILABLE_MESSAGE).toBe(
      'History is not available through a tenant-scoped safe projection.',
    );
    expect(read(`${CH}/resourceManager.tsx`)).toContain('Activity and history');
  });

  it('shows only whitelisted lifecycle facts from the summary row', () => {
    const facts = safeLifecycleFacts({
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      activated_at: null,
      verification_status: 'verified',
      retirement_reason: null,
    });
    const labels = facts.map((f) => f.label);
    expect(labels).toEqual([
      'Created',
      'Last updated',
      'Activated',
      'Verification status',
      'Retirement reason',
    ]);
    expect(labels).not.toContain('Actor');
    expect(labels).not.toContain('Before');
    expect(labels).not.toContain('After');
  });

  it('omits absent lifecycle fields instead of inventing them', () => {
    expect(safeLifecycleFacts({})).toEqual([]);
  });

  it('renders missing timestamps as Not recorded', () => {
    expect(formatTimestamp(null)).toBe('Not recorded');
    expect(formatTimestamp('not-a-date')).toBe('Not recorded');
  });
});

/* ─── Search and filtering ─────────────────────────────────────────── */

describe('UX2 search and status filtering', () => {
  const rows = [
    { code: 'alpha', name: 'Alpha account', status: 'active' },
    { code: 'beta', name: 'Beta account', status: 'draft' },
    { code: 'gamma', name: 'Gamma account', status: 'retired' },
  ];
  const searchable = (r: (typeof rows)[number]) => [r.code, r.name];
  const statusOf = (r: (typeof rows)[number]) => r.status;

  it('returns every row for the empty filter', () => {
    expect(filterResourceRows(rows, EMPTY_RESOURCE_FILTER, searchable, statusOf)).toHaveLength(3);
  });

  it('matches case-insensitively across searchable fields', () => {
    const out = filterResourceRows(rows, { query: 'BETA', status: 'all' }, searchable, statusOf);
    expect(out.map((r) => r.code)).toEqual(['beta']);
  });

  it('filters by lifecycle status', () => {
    const out = filterResourceRows(rows, { query: '', status: 'retired' }, searchable, statusOf);
    expect(out.map((r) => r.code)).toEqual(['gamma']);
  });

  it('combines query and status', () => {
    expect(
      filterResourceRows(rows, { query: 'alpha', status: 'draft' }, searchable, statusOf),
    ).toEqual([]);
  });

  it('exposes the four lifecycle statuses plus all', () => {
    expect(RESOURCE_STATUS_FILTERS).toEqual(['all', 'draft', 'active', 'disabled', 'retired']);
  });
});

/* ─── Lifecycle actions ────────────────────────────────────────────── */

describe('UX2 lifecycle action mapping', () => {
  it('maps Reactivate to the backend activate operation', () => {
    expect(backendLifecycleAction('reactivate')).toBe('activate');
  });

  it('passes through backend-supported operations unchanged', () => {
    expect(backendLifecycleAction('activate')).toBe('activate');
    expect(backendLifecycleAction('disable')).toBe('disable');
    expect(backendLifecycleAction('retire')).toBe('retire');
    expect(backendLifecycleAction('verify')).toBe('verify');
  });

  it('requires a reason only for retirement', () => {
    expect(lifecycleRequiresReason('retire')).toBe(true);
    expect(lifecycleRequiresReason('activate')).toBe(false);
    expect(lifecycleRequiresReason('disable')).toBe(false);
  });

  it('offers Reactivate for a disabled provider account', () => {
    const keys = accountLifecycleActions(
      { status: 'disabled', verification_status: 'verified' } as never,
      { verifiable: true, complete: true },
    ).map((a) => a.key);
    expect(keys).toContain('reactivate');
    expect(keys).not.toContain('activate');
  });

  it('blocks activation until credentials are complete and verified', () => {
    const [, activate] = accountLifecycleActions(
      { status: 'draft', verification_status: 'unverified' } as never,
      { verifiable: true, complete: false },
    );
    expect(activate.disabled).toBe(true);
    expect(activate.disabledReason).toBeTruthy();
  });

  it('never offers a hard delete, clone or policy reset action', () => {
    for (const f of TAB_FILES) {
      const src = readCode(f);
      expect(src).not.toMatch(/\bDelete\b/);
      expect(src).not.toMatch(/\bClone\b/);
      expect(src).not.toMatch(/Reset policy/i);
    }
  });

  it('offers no verify action for a non-verifiable adapter', () => {
    const keys = accountLifecycleActions(
      { status: 'draft', verification_status: 'unverified' } as never,
      { verifiable: false, complete: true },
    ).map((a) => a.key);
    expect(keys).not.toContain('verify');
  });
});

/* ─── Accessibility and safety of dialogs ──────────────────────────── */

describe('UX2 dialogs and permission handling', () => {
  it('removes every window.prompt from Omni-Comms admin views', () => {
    for (const f of TAB_FILES) {
      expect(read(f)).not.toMatch(/window\.prompt\(/);
    }
  });

  it('detects OC403 permission denied errors', () => {
    expect(isPermissionDenied(new OmniCommsRpcError('OC403', 'denied'))).toBe(true);
    expect(isPermissionDenied(new OmniCommsRpcError('OC412', 'state'))).toBe(false);
    expect(isPermissionDenied(new Error('boom'))).toBe(false);
  });

  it('uses the additive resource query parameter for deep links', () => {
    expect(OMNI_COMMS_RESOURCE_PARAM).toBe('resource');
  });

  it('preserves reference-seed records as read-only', () => {
    expect(read(`${CH}/ChannelAccountsTab.tsx`)).toContain("data_origin === 'reference_seed'");
  });
});

/* ─── Progressive policies surface ─────────────────────────────────── */

describe('UX2 progressive policies surface', () => {
  it('discloses advanced policy declarations through an accordion', () => {
    const src = read(`${CH}/ChannelPoliciesTab.tsx`);
    expect(src).toContain('<Accordion');
    for (const label of [
      'Volume limits',
      'Quiet hours',
      'Reliability declarations',
      'Retention',
      'Cost guardrails',
      'Channel-specific controls',
    ]) {
      expect(src).toContain(label);
    }
  });

  it('keeps state and scope outside the collapsed sections', () => {
    const src = read(`${CH}/ChannelPoliciesTab.tsx`);
    expect(src.indexOf('State and scope')).toBeLessThan(src.indexOf('<Accordion'));
  });
});
