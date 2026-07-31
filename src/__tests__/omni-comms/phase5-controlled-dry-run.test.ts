/**
 * Phase 5 — Controlled Dry-Run Test Surface.
 *
 * Covers the bounded safety contract: dry-run-only mode, single synthetic
 * example.com recipient, email-only channel, validation staleness, result
 * classification, invariants, failure guidance and Rule 14 enforcement.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  ADMIN_DRY_RUN_CHANNEL,
  ADMIN_DRY_RUN_EMAIL_DOMAIN,
  ADMIN_DRY_RUN_MODULE_CODE,
  ADMIN_DRY_RUN_RECIPIENT_LIMIT,
  assertSyntheticRecipients,
  buildControlledDryRunInput,
  buildCorrelationId,
  buildIdempotencyKey,
  buildSafeSkeletonPayload,
  buildSyntheticRecipient,
  classifyDryRunResult,
  deriveInvariants,
  isExecutionPermitted,
  isValidationStale,
  mapDryRunFailure,
  mapDryRunRpcError,
  newDryRunId,
  parsePayloadText,
  payloadByteLength,
  type DryRunGate,
} from '@/platform/omni-comms/application/controlledDryRunService';
import { OmniCommsRpcError } from '@/platform/omni-comms/application/eventCatalogueTypes';
import {
  checkControlledDryRunBoundary,
  isControlledDryRunFile,
} from '@/platform/omni-comms/architecture/checks/checkControlledDryRunBoundary';
import { runArchitectureChecks } from '@/platform/omni-comms/architecture/runArchitectureChecks';
import type { RepositoryScan } from '@/platform/omni-comms/architecture/architectureCheck.types';
import type { SendCommunicationResult } from '@/platform/omni-comms/sendCommunication';
import { OMNI_COMMS_RESULT_CONTRACT_VERSION } from '@/platform/omni-comms/runtime/responseContract';

const REPO_ROOT = process.cwd();
const SERVICE = 'src/platform/omni-comms/application/controlledDryRunService.ts';
const PANEL = 'src/platform/omni-comms/admin/views/dryrun/ControlledDryRunPanel.tsx';

function read(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

function scanOf(files: { filePath: string; content: string }[]): RepositoryScan {
  return {
    files,
    routeSource: null,
    migrations: [],
    edgeFunctionDirs: [],
    dependencies: {},
  };
}

const OK_GATE: DryRunGate = {
  state: 'enabled',
  reason: 'ok',
  source: 'feature_flag',
  caller_module_code: ADMIN_DRY_RUN_MODULE_CODE,
  allowed_mode: 'dry_run',
  allowed_channels: ['email'],
  recipient_limit: 1,
  required_recipient_domain: 'example.com',
  live_delivery_enabled: false,
  can_view: true,
  can_operate: true,
  can_view_sensitive_content: false,
  execution_permitted: true,
  checked_at: '2026-01-01T00:00:00Z',
};

function result(over: Partial<SendCommunicationResult> = {}): SendCommunicationResult {
  return {
    contractVersion: OMNI_COMMS_RESULT_CONTRACT_VERSION,
    requestId: 'req-1',
    idempotencyKey: 'k',
    mode: 'dry_run',
    status: 'completed',
    recipients: [
      {
        recipientId: 'r1',
        inputIndex: 0,
        recipientReference: null,
        resolvedChannels: ['email'],
        eligibilityStatus: 'eligible',
        blockers: [],
      },
    ],
    messages: [
      {
        messageId: 'm1',
        recipientId: 'r1',
        channel: 'email',
        status: 'rendered',
        renderedChecksum: 'abc',
        dispatchJobId: null,
        blockers: [],
      },
    ],
    blockers: [],
    createdAt: '2026-01-01T00:00:00Z',
    replayed: false,
    ...over,
  };
}

describe('Phase 5 — controlled dry-run constants and gate', () => {
  it('fixes the channel to email', () => {
    expect(ADMIN_DRY_RUN_CHANNEL).toBe('email');
  });

  it('fixes the recipient limit to one', () => {
    expect(ADMIN_DRY_RUN_RECIPIENT_LIMIT).toBe(1);
  });

  it('fixes the recipient domain to example.com', () => {
    expect(ADMIN_DRY_RUN_EMAIL_DOMAIN).toBe('example.com');
  });

  it('blocks execution when the gate is disabled', () => {
    expect(isExecutionPermitted({ ...OK_GATE, state: 'disabled' }, true)).toBe(false);
  });

  it('blocks execution when the gate is unavailable', () => {
    expect(isExecutionPermitted({ ...OK_GATE, state: 'unavailable' }, true)).toBe(false);
  });

  it('blocks execution without the operate capability', () => {
    expect(isExecutionPermitted({ ...OK_GATE, can_operate: false }, true)).toBe(false);
  });

  it('blocks execution when configuration is not dry-run ready', () => {
    expect(isExecutionPermitted(OK_GATE, false)).toBe(false);
  });

  it('permits execution only when gate + readiness agree', () => {
    expect(isExecutionPermitted(OK_GATE, true)).toBe(true);
  });

  it('blocks execution when execution_permitted is absent', () => {
    const { execution_permitted: _drop, ...withoutField } = OK_GATE;
    expect(isExecutionPermitted(withoutField as typeof OK_GATE, true)).toBe(false);
  });

  it('blocks execution when execution_permitted is null', () => {
    expect(isExecutionPermitted({ ...OK_GATE, execution_permitted: null }, true)).toBe(
      false,
    );
  });

  it('blocks execution when execution_permitted is false', () => {
    expect(isExecutionPermitted({ ...OK_GATE, execution_permitted: false }, true)).toBe(
      false,
    );
  });

  it('never reports live delivery as enabled from the gate default', () => {
    expect(OK_GATE.live_delivery_enabled).toBe(false);
  });
});

describe('Phase 5 — payload handling', () => {
  it('rejects non-JSON payloads', () => {
    expect(parsePayloadText('{oops').ok).toBe(false);
  });

  it('rejects non-object payloads', () => {
    expect(parsePayloadText('[1,2]').ok).toBe(false);
  });

  it('accepts a JSON object payload', () => {
    const p = parsePayloadText('{"a":1}');
    expect(p.ok).toBe(true);
    expect(p.value).toEqual({ a: 1 });
  });

  it('rejects payloads above the 256 KiB ceiling', () => {
    const big = JSON.stringify({ a: 'x'.repeat(300000) });
    expect(parsePayloadText(big).ok).toBe(false);
  });

  it('measures payload size in UTF-8 bytes', () => {
    expect(payloadByteLength('é')).toBe(2);
  });

  it('builds a safe skeleton payload from a schema', () => {
    const skeleton = buildSafeSkeletonPayload({
      properties: {
        count: { type: 'integer' },
        active: { type: 'boolean' },
        items: { type: 'array' },
        contactEmail: { type: 'string', format: 'email' },
        nested: { type: 'object', properties: { ref: { type: 'string' } } },
      },
    });
    expect(skeleton).toEqual({
      count: 0,
      active: false,
      items: [],
      contactEmail: `synthetic@${ADMIN_DRY_RUN_EMAIL_DOMAIN}`,
      nested: { ref: 'TEST-REFERENCE' },
    });
  });

  it('never emits a non-example.com email in the skeleton', () => {
    const s = buildSafeSkeletonPayload({
      properties: { email: { type: 'string', format: 'email' } },
    }) as { email: string };
    expect(s.email.endsWith('@example.com')).toBe(true);
  });

  it('returns an empty skeleton for a schema without properties', () => {
    expect(buildSafeSkeletonPayload({})).toEqual({});
  });
});

describe('Phase 5 — validation staleness', () => {
  const base = {
    organizationId: 'org',
    departmentId: null,
    eventDefinitionId: 'evt',
    payloadText: '{}',
  };

  it('treats a missing validation as stale', () => {
    expect(isValidationStale(null, base)).toBe(true);
  });

  it('treats an identical scope as fresh', () => {
    expect(isValidationStale(base, { ...base })).toBe(false);
  });

  it('invalidates on payload change', () => {
    expect(isValidationStale(base, { ...base, payloadText: '{"a":1}' })).toBe(true);
  });

  it('invalidates on organisation change', () => {
    expect(isValidationStale(base, { ...base, organizationId: 'other' })).toBe(true);
  });

  it('invalidates on department change', () => {
    expect(isValidationStale(base, { ...base, departmentId: 'dep' })).toBe(true);
  });

  it('invalidates on event change', () => {
    expect(isValidationStale(base, { ...base, eventDefinitionId: 'e2' })).toBe(true);
  });
});

describe('Phase 5 — synthetic recipient and identifiers', () => {
  it('always produces an example.com recipient', () => {
    expect(buildSyntheticRecipient('run-1234abcd').email).toMatch(/@example\.com$/);
  });

  it('never populates phone or push destinations', () => {
    const input = buildControlledDryRunInput({
      eventCode: 'EVT',
      organizationId: 'org',
      payload: {},
      recipient: buildSyntheticRecipient('run-1'),
      runId: 'run-1',
      idempotencyKey: 'omni-admin-dryrun:EVT:run-1',
    });
    expect(input.recipients[0].phone).toBeNull();
    expect(input.recipients[0].pushDestination).toBeNull();
  });

  it('accepts exactly one valid synthetic recipient', () => {
    expect(assertSyntheticRecipients([buildSyntheticRecipient('run-1')])).toEqual([]);
  });

  it('rejects zero recipients', () => {
    expect(assertSyntheticRecipients([])).toContain('admin_dry_run_recipient_limit');
  });

  it('rejects more than one recipient', () => {
    const r = buildSyntheticRecipient('run-1');
    expect(assertSyntheticRecipients([r, r])).toContain('admin_dry_run_recipient_limit');
  });

  it('rejects a non-example.com address', () => {
    const r = { ...buildSyntheticRecipient('run-1'), email: 'real@ssb.kn' };
    expect(assertSyntheticRecipients([r])).toContain('admin_dry_run_domain_required');
  });

  it('rejects a phone destination', () => {
    const r = { ...buildSyntheticRecipient('run-1'), phone: '+18690000000' };
    expect(assertSyntheticRecipients([r])).toContain('admin_dry_run_recipient_invalid');
  });

  it('produces unique run identifiers', () => {
    expect(newDryRunId()).not.toBe(newDryRunId());
  });

  it('prefixes the idempotency key and stays within 200 chars', () => {
    const key = buildIdempotencyKey('EVT_CODE', 'run-1');
    expect(key.startsWith('omni-admin-dryrun:')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(200);
  });

  it('prefixes the correlation identifier', () => {
    expect(buildCorrelationId('run-1')).toContain('omni-admin-dryrun-corr');
  });
});

describe('Phase 5 — canonical façade input', () => {
  const input = buildControlledDryRunInput({
    eventCode: 'EVT',
    organizationId: 'org',
    departmentId: 'dep',
    payload: { a: 1 },
    recipient: buildSyntheticRecipient('run-1'),
    runId: 'run-1',
    idempotencyKey: 'omni-admin-dryrun:EVT:run-1',
  });

  it('always submits dry_run mode', () => {
    expect(input.mode).toBe('dry_run');
  });

  it('always requests only the email channel', () => {
    expect(input.requestedChannels).toEqual(['email']);
  });

  it('always submits exactly one recipient', () => {
    expect(input.recipients).toHaveLength(1);
  });

  it('tags the administration caller module', () => {
    expect(input.callerContext?.moduleCode).toBe(ADMIN_DRY_RUN_MODULE_CODE);
  });
});

describe('Phase 5 — result classification', () => {
  it('classifies a clean run as completed', () => {
    expect(classifyDryRunResult(result()).state).toBe('completed');
  });

  it('classifies an idempotent replay', () => {
    const r = classifyDryRunResult(result({ replayed: true }));
    expect(r.kind).toBe('idempotent_replay');
    expect(r.state).toBe('replayed');
  });

  it('classifies a payload mismatch as blocked', () => {
    const r = classifyDryRunResult(
      result({ blockers: ['idempotency_payload_mismatch'] }),
    );
    expect(r.kind).toBe('payload_mismatch');
    expect(r.state).toBe('blocked');
  });

  it('classifies a transport failure as uncertain', () => {
    const r = classifyDryRunResult(result({ blockers: ['runtime_transport_failed'] }));
    expect(r.state).toBe('transport_uncertain');
  });

  it('classifies blockers as completed_with_blockers', () => {
    expect(classifyDryRunResult(result({ blockers: ['sender_not_ready'] })).state).toBe(
      'completed_with_blockers',
    );
  });
});

describe('Phase 5 — post-run invariants', () => {
  const detail = {
    request: { id: 'req-1', mode: 'dry_run' },
    recipients: [{ id: 'r1' }],
    messages: [{ id: 'm1' }],
    dispatch_jobs: [],
    delivery_attempts: [],
    timeline: [{ id: 't1' }],
    timeline_warnings: [],
    can_view_sensitive: false,
    sensitive_visible: false,
    generated_at: '2026-01-01T00:00:00Z',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  it('confirms the request persisted in dry_run mode', () => {
    const inv = deriveInvariants(detail, result());
    expect(inv.requestPersisted).toBe(true);
    expect(inv.modeIsDryRun).toBe(true);
  });

  it('reports no dispatch job and no delivery attempt', () => {
    const inv = deriveInvariants(detail, result());
    expect(inv.dispatchJobCount).toBe(0);
    expect(inv.deliveryAttemptCount).toBe(0);
    expect(inv.safetyViolated).toBe(false);
  });

  it('never reports a provider contact or an email send', () => {
    const inv = deriveInvariants(detail, result());
    expect(inv.providerContacted).toBe(false);
    expect(inv.emailSent).toBe(false);
  });

  it('flags a safety violation when a dispatch job exists', () => {
    const inv = deriveInvariants(
      { ...detail, dispatch_jobs: [{ id: 'j1' }] },
      result(),
    );
    expect(inv.safetyViolated).toBe(true);
  });

  it('flags a safety violation when a delivery attempt exists', () => {
    const inv = deriveInvariants(
      { ...detail, delivery_attempts: [{ id: 'a1' }] },
      result(),
    );
    expect(inv.safetyViolated).toBe(true);
  });

  it('detects a recipient count mismatch', () => {
    const inv = deriveInvariants({ ...detail, recipients: [] }, result());
    expect(inv.recipientCountMatches).toBe(false);
  });
});

describe('Phase 5 — controlled failure guidance', () => {
  it('maps a missing published contract to the contracts screen', () => {
    expect(mapDryRunFailure('no_published_contract').target?.route).toContain('/events');
  });

  it('maps a missing route to the event routes screen', () => {
    expect(mapDryRunFailure('no_active_route').target?.query).toContain('routes');
  });

  it('maps an unresolved template to the templates screen', () => {
    expect(mapDryRunFailure('template_not_resolved').target?.route).toContain(
      '/templates',
    );
  });

  it('maps a sender problem to the channels screen', () => {
    expect(mapDryRunFailure('sender_not_ready').target?.route).toContain('/channels');
  });

  it('gives a safe fallback for unknown codes', () => {
    expect(mapDryRunFailure('mystery').title).toMatch(/could not complete/i);
  });

  it('maps OC403 to permission denied', () => {
    expect(mapDryRunRpcError(new OmniCommsRpcError('OC403')).code).toBe(
      'permission_denied',
    );
  });

  it('maps OC401 to authentication required', () => {
    expect(mapDryRunRpcError(new OmniCommsRpcError('OC401')).code).toBe(
      'authentication_required',
    );
  });

  it('maps OC422 to payload invalid', () => {
    expect(mapDryRunRpcError(new OmniCommsRpcError('OC422')).code).toBe(
      'payload_invalid',
    );
  });

  it('prefers a DETAIL slug over the numeric code', () => {
    expect(
      mapDryRunRpcError(new OmniCommsRpcError('OC422', 'sender_not_ready')).code,
    ).toBe('sender_not_ready');
  });

  it('never leaks provider or secret material in guidance text', () => {
    const text = ['no_active_route', 'sender_not_ready', 'render_stage_failed']
      .map((c) => JSON.stringify(mapDryRunFailure(c)))
      .join(' ');
    expect(text).not.toMatch(/api[_-]?key|secret|service_role/i);
  });
});

describe('Phase 5 — Rule 14 OMNI_CONTROLLED_DRY_RUN_BOUNDARY', () => {
  it('recognises the dry-run surface files', () => {
    expect(isControlledDryRunFile(SERVICE)).toBe(true);
    expect(isControlledDryRunFile(PANEL)).toBe(true);
    expect(isControlledDryRunFile('src/platform/omni-comms/sendCommunication.ts')).toBe(
      false,
    );
  });

  it('passes on the real dry-run surface files', () => {
    const violations = checkControlledDryRunBoundary(
      scanOf([
        { filePath: SERVICE, content: read(SERVICE) },
        { filePath: PANEL, content: read(PANEL) },
      ]),
    );
    expect(violations).toEqual([]);
  });

  it('flags a private RPC reference', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: "rpc('omni_comms_priv_send_communication')" }]),
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it('flags a non-approved RPC reference', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: "rpc('omni_comms_dispatch_now', {})" }]),
    );
    expect(v[0].ruleId).toBe('OMNI_CONTROLLED_DRY_RUN_BOUNDARY');
  });

  it('flags direct table access', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: PANEL, content: "client.from('omni_comms_request').select()" }]),
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it('flags direct edge-function invocation', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: 'supabase.functions.invoke("x")' }]),
    );
    expect(v.some((x) => x.message.includes('Edge Function'))).toBe(true);
  });

  it('flags runtime internal imports', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([
        {
          filePath: SERVICE,
          content: "import x from '@/platform/omni-comms/runtime/persist';",
        },
      ]),
    );
    expect(v.some((x) => x.message.includes('runtime internals'))).toBe(true);
  });

  it('flags a non dry_run mode submission', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: 'const i = { mode: "live" };' }]),
    );
    expect(v.some((x) => x.message.includes('mode "live"'))).toBe(true);
  });

  it('flags a hardcoded non-example.com address', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: PANEL, content: 'const to = "person@ssb.kn";' }]),
    );
    expect(v.some((x) => x.message.includes('non-example.com'))).toBe(true);
  });

  it('flags escalation vocabulary', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: 'createDispatchJob();' }]),
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it('flags secret material', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([{ filePath: SERVICE, content: 'const k = SUPABASE_SERVICE_ROLE_KEY;' }]),
    );
    expect(v.length).toBeGreaterThan(0);
  });

  it('flags a Legacy Communication Hub reference', () => {
    const v = checkControlledDryRunBoundary(
      scanOf([
        { filePath: PANEL, content: "import x from '@/platform/communication-hub/a';" },
      ]),
    );
    expect(v.some((x) => x.message.includes('Legacy'))).toBe(true);
  });

  it('ignores files outside the dry-run surface', () => {
    expect(
      checkControlledDryRunBoundary(
        scanOf([{ filePath: 'src/modules/x/y.ts', content: 'const mode = "live";' }]),
      ),
    ).toEqual([]);
  });
});

describe('Phase 5 — repository-wide architecture is clean', () => {
  it('reports zero failing violations', () => {
    const summary = runArchitectureChecks({ repoRoot: REPO_ROOT });
    const failing = summary.violations.filter(
      (v) => v.baselineStatus !== 'existing_baseline',
    );
    expect(failing).toEqual([]);
  });
});
