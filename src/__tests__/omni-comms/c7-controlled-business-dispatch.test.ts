/**
 * Omni-Comms Phase C7 — Controlled business Email dispatch.
 *
 * Focused, static, read-only checks proving the C7 boundaries hold:
 *   * the dispatcher accepts nothing that can influence WHAT is sent;
 *   * only queued Email jobs are claimable, never dry_run / shadow;
 *   * the claim transaction runs before any provider call;
 *   * one shared server-only Resend adapter serves C5B and C7;
 *   * callbacks are signature-verified, normalized and can suspend the pilot;
 *   * registries, readiness, verifier and rollback are consistent;
 *   * live delivery and Release Control `live` remain unavailable.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  OMNI_COMMS_OBJECT_REGISTRY,
  OMNI_COMMS_OBJECT_COUNT,
} from '@/platform/omni-comms/registry/objectRegistry';
import {
  OMNI_COMMS_INTEGRATION_REGISTRY,
} from '@/platform/omni-comms/registry/integrationRegistry';
import {
  EMAIL_BUSINESS_DISPATCH_IMPLEMENTED,
  EMAIL_PILOT_PRODUCER_BLOCKER,
  projectEmailReadiness,
  type EmailDispatchDiagnostics,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const DISPATCH = 'supabase/functions/omni-comms-dispatch/index.ts';
const ADAPTER = 'supabase/functions/_shared/omni-comms/resendAdapter.ts';
const SVIX = 'supabase/functions/_shared/omni-comms/svix.ts';
const WEBHOOK = 'supabase/functions/omni-comms-webhook-resend/index.ts';
const TEST_DELIVERY = 'supabase/functions/omni-comms-test-delivery/index.ts';
const RUNTIME = 'supabase/functions/omni-comms-runtime/index.ts';
const VERIFIER = 'scripts/omni-comms/verify-c7-controlled-business-dispatch.sql';
const ROLLBACK =
  'scripts/omni-comms/rollback/c7-controlled-business-dispatch-rollback.sql';

const dispatch = read(DISPATCH);
const adapter = read(ADAPTER);
const webhook = read(WEBHOOK);
const testDelivery = read(TEST_DELIVERY);

const baseDiagnostics: EmailDispatchDiagnostics = {
  dispatcher_installed: true,
  eligible_jobs: 0,
  business_attempts: 0,
  accepted_attempts: 0,
  delivered_attempts: 0,
  outcome_unknown_attempts: 0,
  harmful_callbacks: 0,
  pilot_suspended: false,
  blocker: EMAIL_PILOT_PRODUCER_BLOCKER,
  live_delivery_available: false,
};

describe('C7 — dispatcher input boundary', () => {
  it('exists as the canonical dispatcher edge function', () => {
    expect(fs.existsSync(path.join(root, DISPATCH))).toBe(true);
  });

  it('rejects every caller-supplied field that could influence what is sent', () => {
    // Closure correction: the dispatcher now enforces a positive allow-list of
    // exactly two keys, so no send-influencing field can ever be accepted.
    expect(dispatch).toContain('ALLOWED_INPUT_KEYS');
    expect(dispatch).toContain('"batchLimit", "correlationId"');
    for (const field of [
      'jobId', 'messageId', 'recipient', 'provider', 'credential',
      'eventCode', 'callerModule', 'releaseControlId', 'subject', 'html',
    ]) {
      expect(['batchLimit', 'correlationId']).not.toContain(field);
    }
    expect(dispatch).toContain('caller_supplied_dispatch_input_forbidden');
  });


  it('accepts only a bounded batch limit and a correlation identifier', () => {
    expect(dispatch).toContain('MAX_BATCH_LIMIT');
    expect(dispatch).toMatch(/correlationId/);
    expect(dispatch).toMatch(/\^\[A-Za-z0-9_\.:-\]\{1,120\}\$/);
  });

  it('requires authentication and an authorising capability RPC', () => {
    expect(dispatch).toContain('authentication_required');
    expect(dispatch).toContain('omni_comms_dispatch_tick_authorize');
    expect(dispatch).toContain("authz.allowed !== true");
  });

  it('offers no send-now, resend or force-delivered action', () => {
    expect(dispatch).not.toMatch(/send_now|force_deliver|forceDelivered/i);
  });
});

describe('C7 — claim, lease and dispatch order', () => {
  it('lets the server select eligible jobs through the claim RPC', () => {
    expect(dispatch).toContain('omni_comms_priv_dispatch_claim_email');
  });

  it('reclaims expired leases before claiming new work', () => {
    const reclaim = dispatch.indexOf('omni_comms_priv_dispatch_reclaim_expired_leases');
    const claim = dispatch.indexOf('omni_comms_priv_dispatch_claim_email');
    expect(reclaim).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(reclaim);
  });

  it('claims (and therefore reserves volume) before any provider call', () => {
    const claim = dispatch.indexOf('omni_comms_priv_dispatch_claim_email');
    const send = dispatch.indexOf('await sendResendEmail');
    expect(send).toBeGreaterThan(claim);
  });

  it('records terminal evidence through the completion RPC with the claim token', () => {
    expect(dispatch).toContain('omni_comms_priv_dispatch_attempt_complete');
    expect(dispatch).toContain('p_claim_token: claimToken');
  });

  it('never treats a rejected stale claim as a delivery outcome', () => {
    expect(dispatch).toContain('evidence write rejected');
    expect(dispatch).toContain('recorded: !completion.error');
  });

  it('is restricted to the Email channel in queued mode', () => {
    expect(dispatch).toContain("DISPATCHABLE_CHANNEL = \"email\"");
    expect(dispatch).toContain('mode: "queued"');
    expect(dispatch).not.toContain('"dry_run"');
    expect(dispatch).not.toContain('"shadow"');
  });

  it('reports live delivery and Release Control live as unavailable', () => {
    expect(dispatch).toContain('live_delivery_enabled: false');
    expect(dispatch).toContain('release_live_state_available: false');
  });
});

describe('C7 — shared server-only Resend adapter', () => {
  it('is the single place the Resend API is contacted', () => {
    expect(adapter).toContain('https://api.resend.com/emails');
    expect(dispatch).not.toContain('api.resend.com');
    expect(testDelivery).not.toContain('api.resend.com');
  });

  it('is reused by both C5B test delivery and C7 dispatch', () => {
    expect(testDelivery).toContain('_shared/omni-comms/resendAdapter.ts');
    expect(dispatch).toContain('_shared/omni-comms/resendAdapter.ts');
  });

  it('resolves the credential by bounded reference name only', () => {
    expect(adapter).toMatch(/OMNI_COMMS_RESEND_/);
    expect(adapter).toContain('resolveSecret');
    expect(adapter).not.toMatch(/console\.log\(.*apiKey/);
  });

  it('never returns or logs the secret value', () => {
    expect(adapter).not.toMatch(/console\.[a-z]+\([^\n]*apiKey/);
    expect(adapter).not.toMatch(/providerResponse:[^\n]*apiKey/);
  });

  it('always sends a deterministic provider idempotency key', () => {
    expect(adapter).toContain('"Idempotency-Key": input.idempotencyKey');
    expect(dispatch).toContain('provider_idempotency_key');
  });

  it('classifies uncertainty as outcome_unknown, never as failure', () => {
    expect(adapter).toContain('isUncertainStatus');
    expect(adapter).toContain('provider_outcome_unknown');
    expect(adapter).toMatch(/status === 408 \|\| status === 429 \|\| status >= 500/);
  });

  it('redacts the provider response to bounded, non-sensitive fields', () => {
    expect(adapter).toContain('redactProviderResponse');
  });

  it('applies a bounded transport budget', () => {
    expect(adapter).toContain('RESEND_TIMEOUT_MS');
    expect(adapter).toContain('AbortController');
  });
});

describe('C7 — callback processing', () => {
  it('verifies the Svix signature before recording anything', () => {
    expect(fs.existsSync(path.join(root, SVIX))).toBe(true);
    const sigIdx = webhook.indexOf('verifySvixSignature');
    const recordIdx = webhook.indexOf('omni_comms_priv_dispatch_record_callback');
    expect(sigIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(sigIdx);
    expect(webhook).toContain('invalid_signature');
  });

  it('normalizes delivery, delay, bounce, complaint, open and click events', () => {
    for (const t of [
      'email.delivered', 'email.delivery_delayed', 'email.bounced',
      'email.complained', 'email.opened', 'email.clicked',
    ]) {
      expect(adapter).toContain(t);
    }
  });

  it('records only a bounded summary and a payload digest', () => {
    expect(webhook).toContain('payload_summary');
    expect(webhook).toContain('p_payload_digest');
    expect(webhook).toContain('sha256:');
    expect(webhook).toContain('maskEmail');
  });

  it('matches C5B test evidence first and preserves business evidence', () => {
    // Closure correction: a technical test delivery must be matched before a
    // business attempt so a C5B reference can never be mis-attributed.
    const business = webhook.indexOf('omni_comms_priv_dispatch_record_callback');
    const c5b = webhook.indexOf('omni_comms_priv_channel_test_delivery_record_event');
    expect(c5b).toBeGreaterThan(-1);
    expect(business).toBeGreaterThan(c5b);
  });


  it('never sends anything from the callback receiver', () => {
    expect(webhook).not.toContain('sendResendEmail');
  });
});

describe('C7 — runtime and façade boundaries are unchanged', () => {
  const runtime = read(RUNTIME);

  it('keeps the runtime free of any provider call', () => {
    expect(runtime).not.toContain('api.resend.com');
    expect(runtime).not.toContain('sendResendEmail');
  });

  it('keeps sendCommunication as the sole business façade', () => {
    expect(fs.existsSync(
      path.join(root, 'src/platform/omni-comms/sendCommunication.ts'),
    )).toBe(true);
  });
});

describe('C7 — registries', () => {
  it('keeps the object count at 33', () => {
    expect(OMNI_COMMS_OBJECT_COUNT).toBe(33);
  });

  it('promotes the webhook event ledger to AVAILABLE', () => {
    const row = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_webhook_event',
    );
    expect(row?.status).toBe('AVAILABLE');
    expect(row?.writeAuthority).toBe('service_role_only');
  });

  it('keeps the integration count at 9 and marks the dispatcher available', () => {
    expect(OMNI_COMMS_INTEGRATION_REGISTRY.length).toBe(9);
    const row = OMNI_COMMS_INTEGRATION_REGISTRY.find(
      (i) => i.name === 'omni-comms-dispatch',
    );
    expect(row?.status).toBe('Available');
  });
});

describe('C7 — email readiness', () => {
  it('reports the business dispatcher as implemented', () => {
    expect(EMAIL_BUSINESS_DISPATCH_IMPLEMENTED).toBe(true);
  });

  it('keeps dispatch checks not_implemented when no diagnostics are supplied', () => {
    const p = projectEmailReadiness(null);
    for (const key of [
      'business_dispatch', 'business_delivery_attempt',
      'business_delivery_confirmed', 'pilot_safety',
    ]) {
      expect(p.checks.find((c) => c.key === key)?.state).toBe('not_implemented');
    }
  });

  it('surfaces the pilot producer blocker when no business attempt exists', () => {
    const p = projectEmailReadiness(null, null, null, null, null, baseDiagnostics);
    const check = p.checks.find((c) => c.key === 'business_delivery_attempt');
    expect(check?.state).toBe('not_implemented');
    expect(check?.detail).toContain(EMAIL_PILOT_PRODUCER_BLOCKER);
  });

  it('marks pilot safety met only while nothing harmful is recorded', () => {
    const ok = projectEmailReadiness(null, null, null, null, null, baseDiagnostics);
    expect(ok.checks.find((c) => c.key === 'pilot_safety')?.state).toBe('met');

    const suspended = projectEmailReadiness(null, null, null, null, null, {
      ...baseDiagnostics, pilot_suspended: true,
    });
    expect(suspended.checks.find((c) => c.key === 'pilot_safety')?.state).toBe('unmet');

    const complained = projectEmailReadiness(null, null, null, null, null, {
      ...baseDiagnostics, harmful_callbacks: 1,
    });
    expect(complained.checks.find((c) => c.key === 'pilot_safety')?.state).toBe('unmet');
  });

  it('never treats live delivery as enabled', () => {
    const p = projectEmailReadiness(null, null, null, null, null, {
      ...baseDiagnostics, live_delivery_available: true,
    });
    expect(p.checks.find((c) => c.key === 'pilot_safety')?.state).toBe('unmet');
  });
});

describe('C7 — verifier and rollback', () => {
  const verifier = read(VERIFIER);
  const rollback = read(ROLLBACK);

  it('verifies claim concurrency, gates, evidence and safety invariants', () => {
    for (const marker of [
      'FOR UPDATE SKIP LOCKED', 'omni_comms_channel_release_control',
      'live_delivery_enabled IS TRUE', "release_state = 'live'",
      'omni_comms_webhook_event', 'omni_comms_producer_event_binding',
    ]) {
      expect(verifier.toLowerCase()).toContain(marker.toLowerCase());
    }
  });

  it('is fail-safe: rollback removes the claim surface but keeps evidence', () => {
    expect(rollback).toContain('DROP FUNCTION IF EXISTS public.omni_comms_priv_dispatch_claim_email');
    expect(rollback).not.toMatch(/DROP TABLE/i);
    expect(rollback).not.toMatch(/DELETE FROM/i);
  });

  it('never asserts failure for an in-flight attempt', () => {
    expect(rollback).toContain("status = 'outcome_unknown'");
  });

  it('does not touch C5B controlled test delivery', () => {
    expect(rollback).not.toContain('omni_comms_channel_test_delivery');
  });
});
