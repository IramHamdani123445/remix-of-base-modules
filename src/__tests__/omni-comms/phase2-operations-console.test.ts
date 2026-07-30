/**
 * Omni-Comms Minimum Usable Administration — Phase 2
 * Read-only Operations console and request timeline.
 *
 * These are static/source-level guarantees. Live database behaviour is
 * verified separately by scripts/omni-comms/verify-operations-read-console.sql.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { OMNI_COMMS_ROUTE_REGISTRY } from '@/platform/omni-comms/registry/routeRegistry';
import {
  OMNI_COMMS_OPERATIONAL_POSTURE,
  OMNI_COMMS_READINESS_MANIFEST,
} from '@/platform/omni-comms/registry/readinessManifest';
import {
  OPS_PAGE_SIZE_DEFAULT,
  OPS_PAGE_SIZE_MAX,
  OPS_REQUEST_MODES,
  OPS_REQUEST_STATUSES,
} from '@/platform/omni-comms/application/operationsTypes';
import * as operationsService from '@/platform/omni-comms/application/operationsService';

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');

const OPS_DIR = 'src/platform/omni-comms/admin/views/operations';
const PAGE = 'src/platform/omni-comms/admin/views/OmniCommsOperationsPage.tsx';
const SERVICE = 'src/platform/omni-comms/application/operationsService.ts';
const FILES = [
  PAGE,
  `${OPS_DIR}/OperationsPosture.tsx`,
  `${OPS_DIR}/OperationsSummaryCards.tsx`,
  `${OPS_DIR}/RequestDetailPanel.tsx`,
  `${OPS_DIR}/OpsTimeline.tsx`,
  `${OPS_DIR}/MessageContentDialog.tsx`,
];

describe('Phase 2 — Operations console files', () => {
  it('creates every Operations surface file', () => {
    for (const f of FILES) {
      expect(existsSync(resolve(ROOT, f)), f).toBe(true);
    }
  });

  it('replaces the Not-Implemented placeholder on the Operations page', () => {
    const src = read(PAGE);
    expect(src).not.toContain('OmniCommsNotImplemented');
    expect(src).toContain('data-testid="omni-comms-operations-page"');
  });
});

describe('Phase 2 — route surface is unchanged', () => {
  it('keeps exactly seven permanent Omni-Comms routes', () => {
    expect(OMNI_COMMS_ROUTE_REGISTRY).toHaveLength(7);
  });

  it('marks the Operations route Available', () => {
    const route = OMNI_COMMS_ROUTE_REGISTRY.find((r) =>
      r.path.endsWith('/operations'),
    );
    expect(route?.state).toBe('Available');
  });

  it('exposes request detail through a query parameter, not a new route', () => {
    const src = read(PAGE);
    expect(src).toContain('useSearchParams');
    expect(src).toContain("get(\"request\")");
    expect(
      OMNI_COMMS_ROUTE_REGISTRY.some((r) => r.path.includes('/operations/')),
    ).toBe(false);
  });
});

describe('Phase 2 — read-only guarantee', () => {
  const forbidden = ['retry', 'resend', 'cancel', 'suppress', 'requeue', 'dispatchNow'];

  it('exports no mutation function from the operations service', () => {
    const exported = Object.keys(operationsService).filter(
      (k) => typeof (operationsService as Record<string, unknown>)[k] === 'function',
    );
    for (const name of exported) {
      expect(/^(get|list)/.test(name), `${name} must be a read`).toBe(true);
    }
  });

  it('calls only omni_comms_ops_* / diagnostics read RPCs', () => {
    const src = read(SERVICE);
    const calls = [...src.matchAll(/'(omni_comms_[a-z0-9_]+)'/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(
        c.startsWith('omni_comms_ops_') || c === 'omni_comms_diagnostics',
        c,
      ).toBe(true);
    }
  });

  it('never calls a privileged runtime RPC from the browser layer', () => {
    for (const f of [...FILES, SERVICE]) {
      const src = read(f);
      expect(src).not.toContain('omni_comms_priv_');
    }
  });

  it('never reads runtime tables directly with .from()', () => {
    for (const f of [...FILES, SERVICE]) {
      const src = read(f);
      expect(src).not.toMatch(/\.from\(\s*['"]omni_comms_/);
    }
  });

  it('never imports the browser Supabase singleton in Operations views', () => {
    for (const f of [...FILES, SERVICE]) {
      expect(read(f)).not.toContain('@/integrations/supabase/client');
    }
  });

  it('offers no retry / resend / cancel / suppress control', () => {
    for (const f of FILES) {
      const src = read(f).toLowerCase();
      for (const word of forbidden) {
        const asControl = new RegExp(`onclick=\\{[^}]*${word}`, 'i');
        expect(asControl.test(src), `${f} exposes ${word}`).toBe(false);
      }
    }
  });
});

describe('Phase 2 — sensitive content handling', () => {
  it('renders message HTML only through the sandboxed preview', () => {
    const dialog = read(`${OPS_DIR}/MessageContentDialog.tsx`);
    expect(dialog).toContain('OmniCommsSandboxedPreview');
    for (const f of FILES) {
      expect(read(f)).not.toContain('dangerouslySetInnerHTML');
    }
  });

  it('gates reveal on the server-reported capability flag', () => {
    const panel = read(`${OPS_DIR}/RequestDetailPanel.tsx`);
    expect(panel).toContain('can_view_sensitive');
    expect(panel).toContain('revealSensitive');
  });

  it('defaults the request detail read to masked', () => {
    const src = read(SERVICE);
    expect(src).toContain('p_reveal_sensitive: input.revealSensitive ?? false');
  });
});

describe('Phase 2 — filters, paging and summary', () => {
  it('clamps page size to the declared bounds', () => {
    expect(OPS_PAGE_SIZE_DEFAULT).toBe(25);
    expect(OPS_PAGE_SIZE_MAX).toBe(100);
    const src = read(SERVICE);
    expect(src).toContain('OPS_PAGE_SIZE_MAX');
    expect(src).toContain('Math.max(Math.trunc(n), 0)');
  });

  it('passes every declared filter through to the list RPC', () => {
    const src = read(SERVICE);
    for (const p of [
      'p_mode',
      'p_status',
      'p_event_code',
      'p_caller_module_code',
      'p_date_from',
      'p_date_to',
      'p_has_blockers',
      'p_search',
      'p_limit',
      'p_offset',
    ]) {
      expect(src, p).toContain(p);
    }
  });

  it('exposes the canonical status and mode vocabularies', () => {
    expect(OPS_REQUEST_MODES).toEqual(['dry_run', 'shadow', 'queued']);
    expect(OPS_REQUEST_STATUSES).toContain('completed_with_blockers');
    expect(OPS_REQUEST_STATUSES).toContain('blocked');
  });

  it('debounces the register search input', () => {
    expect(read(PAGE)).toContain('setDebouncedSearch');
  });
});

describe('Phase 2 — timeline correctness', () => {
  it('orders timeline entries by event_sequence', () => {
    const src = read(`${OPS_DIR}/OpsTimeline.tsx`);
    expect(src).toContain('a.event_sequence - b.event_sequence');
  });

  it('surfaces server-reported gap and duplicate warnings', () => {
    const src = read(`${OPS_DIR}/OpsTimeline.tsx`);
    expect(src).toContain('OpsTimelineWarning');
    expect(src).toContain('omni-comms-ops-timeline-warnings');
  });
});

describe('Phase 2 — derived operational posture', () => {
  it('derives posture rather than hard-coding a second product status', () => {
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.schemaAvailable).toBe(true);
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.runtimeImplemented).toBe(true);
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.liveDeliveryEnabled).toBe(false);
  });

  it('reports runtime certification as pending while any certification row is unverified', () => {
    const pending = OMNI_COMMS_READINESS_MANIFEST.foundationStatus
      .filter((f) => /certification/i.test(f.item))
      .some((f) => f.state !== 'Verified');
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.runtimeCertified).toBe(!pending);
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.privilegedRuntimeCertification).toBe(
      pending ? 'Pending' : 'Certified',
    );
  });

  it('declares operational mutations as not implemented', () => {
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.operationalMutations).toBe('Not implemented');
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.retryResendCancelSuppress).toBe('Not implemented');
    expect(OMNI_COMMS_OPERATIONAL_POSTURE.providerDispatch).toBe('Not implemented');
  });

  it('warns in the UI while certification is pending', () => {
    const src = read(`${OPS_DIR}/OperationsPosture.tsx`);
    expect(src).toContain('omni-comms-certification-warning');
  });
});

describe('Phase 2 — empty and error states', () => {
  it('uses the shared empty-state presenter on every list surface', () => {
    for (const f of [PAGE, `${OPS_DIR}/RequestDetailPanel.tsx`, `${OPS_DIR}/OpsTimeline.tsx`]) {
      expect(read(f), f).toContain('OmniCommsEmptyState');
    }
  });

  it('requires an organisation selection before reading records', () => {
    const src = read(PAGE);
    expect(src).toContain('Select an organisation');
    expect(src).toContain('useOmniCommsTenant');
  });

  it('offers retry affordances on failure', () => {
    expect(read(PAGE)).toContain('actionLabel="Retry"');
    expect(read(`${OPS_DIR}/RequestDetailPanel.tsx`)).toContain('actionLabel="Retry"');
  });
});

describe('Phase 2 — database verifier', () => {
  it('ships a SQL verifier for the read console', () => {
    const p = 'scripts/omni-comms/verify-operations-read-console.sql';
    expect(existsSync(resolve(ROOT, p))).toBe(true);
    const sql = read(p);
    expect(sql).toContain('omni_comms_ops_request_detail');
    expect(sql).toContain('is_runnable IS TRUE');
    expect(sql).toContain('duplicate_sequences');
  });
});
