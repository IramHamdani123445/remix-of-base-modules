/**
 * Omni-Comms Phase C7 Closure Correction.
 *
 * Source-grounded assertions over the corrective migration, the dispatcher
 * Edge Function, the Resend adapter, the Resend callback receiver, the
 * rollback script and the closure verifier.
 *
 * These tests read source only. They contact no provider, claim no job and
 * mutate no database.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function migrationsDir(): string {
  return path.join(ROOT, 'supabase', 'migrations');
}

/** The corrective migration is the newest migration containing its marker. */
function closureMigration(): string {
  const files = fs
    .readdirSync(migrationsDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = fs.readFileSync(path.join(migrationsDir(), files[i]), 'utf8');
    if (body.includes('FUNCTION public.omni_comms_priv_dispatch_operator_scopes')) return body;
  }
  throw new Error('C7 closure correction migration not found');
}

const MIGRATION = closureMigration();
const DISPATCH = read('supabase/functions/omni-comms-dispatch/index.ts');
const WEBHOOK = read('supabase/functions/omni-comms-webhook-resend/index.ts');
const ADAPTER = read('supabase/functions/_shared/omni-comms/resendAdapter.ts');
const ROLLBACK = read(
  'scripts/omni-comms/rollback/c7-controlled-business-dispatch-rollback.sql',
);
const VERIFIER = read('scripts/omni-comms/verify-c7-closure-correction.sql');
const RELEASE_TYPES = read(
  'src/platform/omni-comms/application/channelReleaseControlTypes.ts',
);

// ---------------------------------------------------------------------------
// 1. Canonical recipient normalisation
// ---------------------------------------------------------------------------
describe('C7 closure — canonical recipient allow-list hashing', () => {
  it('claims use the C5A canonical target normaliser', () => {
    expect(MIGRATION).toContain('omni_comms_priv_channel_test_normalize_target');
  });

  it('no longer hashes a bare lower-cased address', () => {
    expect(MIGRATION).not.toContain("digest(v_recipient, 'sha256')");
  });

  it('refuses a recipient the normaliser rejects', () => {
    expect(MIGRATION).toContain("'recipient_invalid'");
  });

  it('refuses a recipient that is not on the approved pilot list', () => {
    expect(MIGRATION).toContain("'recipient_not_permitted'");
  });
});

// ---------------------------------------------------------------------------
// 2. Tenant isolation
// ---------------------------------------------------------------------------
describe('C7 closure — operator tenant isolation', () => {
  it('exposes a server-derived scope projection', () => {
    expect(MIGRATION).toContain('omni_comms_priv_dispatch_operator_scopes');
  });

  it('derives scopes from the actor own assignments, never from the caller', () => {
    expect(MIGRATION).toContain('core_staff_assignments');
    expect(MIGRATION).toContain("has_permission(p_actor, 'omni_comms', 'operate')");
  });

  it('keeps the scope projection out of reach of anon and authenticated', () => {
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_operator_scopes(uuid) FROM PUBLIC, anon, authenticated',
    );
  });

  it('returns the scopes from the operator tick authorizer', () => {
    expect(MIGRATION).toContain("'scopes', v_scopes->'scopes'");
  });

  it('claims nothing when an operator tick carries no scope', () => {
    expect(MIGRATION).toContain("'operator_scope_required'");
  });

  it('filters candidate jobs by the authorised organisation and department', () => {
    expect(MIGRATION).toContain("(s->>'organization_id')::uuid = j.organization_id");
    expect(MIGRATION).toContain("(s->>'department_id')::uuid IS NOT DISTINCT FROM m.department_id");
  });

  it('reserves the unrestricted path for a service-role scheduler only', () => {
    expect(MIGRATION).toContain('omni_comms_priv_dispatch_scheduler_tick');
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.omni_comms_priv_dispatch_scheduler_tick(text,integer,text,text) TO service_role',
    );
  });

  it('rejects an unknown execution context', () => {
    expect(MIGRATION).toContain('invalid_execution_context');
  });

  it('records the execution context on the attempt', () => {
    expect(MIGRATION).toContain('execution_context');
  });
});

// ---------------------------------------------------------------------------
// 3. Truthful C6 surface
// ---------------------------------------------------------------------------
describe('C7 closure — truthful release governance surface', () => {
  it('replaces prerequisite check 32 with a dispatcher-installation check', () => {
    expect(MIGRATION).toContain('business_dispatch_dispatcher_installed');
  });

  it('reports business dispatch truthfully from the decision oracle', () => {
    expect(MIGRATION).toContain("'business_dispatch_enabled', (v_allowed");
  });

  it('still recognises the legacy C6 check code in the UI adapter', () => {
    expect(RELEASE_TYPES).toContain('business_dispatch_dispatcher_installed');
    expect(RELEASE_TYPES).toContain('business_dispatch_not_implemented_c6');
  });
});

// ---------------------------------------------------------------------------
// 4. Immutable rendering-time release evidence
// ---------------------------------------------------------------------------
describe('C7 closure — release snapshot immutability', () => {
  it('never rewrites the dispatch-job release snapshot at claim time', () => {
    expect(MIGRATION).not.toContain('release_fingerprint_at_decision = v_rel.release_fingerprint');
  });

  it('fails closed when the job carries no rendering-time snapshot', () => {
    expect(MIGRATION).toContain("'release_snapshot_missing'");
  });

  it('fails closed when the snapshot has drifted from the live release', () => {
    expect(MIGRATION).toContain("'release_snapshot_stale'");
  });

  it('captures claim-time release evidence separately on the attempt', () => {
    expect(MIGRATION).toContain('release_expires_at_claim');
    expect(MIGRATION).toContain('deployed_revision_at_claim');
    expect(MIGRATION).toContain('claim_decision_snapshot');
  });
});

// ---------------------------------------------------------------------------
// 5. Exact persisted provider resolution
// ---------------------------------------------------------------------------
describe('C7 closure — exact provider resolution', () => {
  it('binds to the persisted identity and provider account exactly', () => {
    expect(MIGRATION).toContain('provider_account_id = v_job.msg_provider_account_id');
  });

  it('never re-selects a binding by priority at claim time', () => {
    expect(MIGRATION).not.toContain('ORDER BY coalesce(priority, 100)');
  });

  it('refuses an incomplete resolution snapshot', () => {
    expect(MIGRATION).toContain("'resolution_snapshot_incomplete'");
  });

  it('requires a verified binding', () => {
    expect(MIGRATION).toContain("verification_status = 'verified'");
  });

  it('requires a verified endpoint when the binding names one', () => {
    expect(MIGRATION).toContain("'endpoint_not_verified'");
  });

  it('refuses a cross-tenant identity, binding or account', () => {
    for (const code of [
      'identity_tenant_mismatch',
      'binding_tenant_mismatch',
      'provider_account_not_operational',
    ]) {
      expect(MIGRATION).toContain(code);
    }
  });

  it('still refuses a non-canonical secret reference', () => {
    expect(MIGRATION).toContain('^OMNI_COMMS_RESEND_');
  });
});

// ---------------------------------------------------------------------------
// 6. Provider payload fingerprint
// ---------------------------------------------------------------------------
describe('C7 closure — provider payload fingerprint', () => {
  it('adds a payload fingerprint column', () => {
    expect(MIGRATION).toContain('provider_payload_hash');
  });

  it('exposes a service-role only fingerprint gate', () => {
    expect(MIGRATION).toContain('omni_comms_priv_dispatch_record_payload_hash');
    expect(MIGRATION).toContain(
      'REVOKE ALL ON FUNCTION public.omni_comms_priv_dispatch_record_payload_hash(uuid,text,text) FROM PUBLIC, anon, authenticated',
    );
  });

  it('refuses a changed payload under the same idempotency key', () => {
    expect(MIGRATION).toContain('provider_payload_changed_for_idempotency_key');
  });

  it('computes the fingerprint canonically in the shared adapter', () => {
    expect(ADAPTER).toContain('canonicalProviderPayloadHash');
  });

  it('records the fingerprint BEFORE the provider is contacted', () => {
    const gate = DISPATCH.indexOf('omni_comms_priv_dispatch_record_payload_hash');
    const send = DISPATCH.indexOf('sendResendEmail(');
    expect(gate).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(gate);
  });

  it('reports that the provider was not contacted when the gate refuses', () => {
    expect(DISPATCH).toContain('provider_contacted: false');
  });
});

// ---------------------------------------------------------------------------
// 7. Acceptance and reference uniqueness
// ---------------------------------------------------------------------------
describe('C7 closure — acceptance evidence', () => {
  it('does not treat a missing provider reference as acceptance', () => {
    expect(MIGRATION).toContain('provider_acceptance_reference_missing');
  });

  it('enforces one provider reference per business attempt', () => {
    expect(MIGRATION).toContain('omni_comms_delivery_attempt_provider_msg_uq');
  });
});

// ---------------------------------------------------------------------------
// 8. Terminal-evidence immutability
// ---------------------------------------------------------------------------
describe('C7 closure — attempt evidence immutability', () => {
  it('installs a delivery-attempt immutability trigger', () => {
    expect(MIGRATION).toContain('omni_comms_delivery_attempt_immutable_trg');
  });

  it('blocks deletion of delivery evidence outright', () => {
    expect(MIGRATION).toContain('delivery attempt evidence cannot be deleted');
  });

  it('blocks any mutation of a terminal attempt', () => {
    expect(MIGRATION).toContain('terminal delivery attempt evidence is immutable');
  });

  it('protects the idempotency key, recipient hash and release fingerprint', () => {
    expect(MIGRATION).toContain('idempotency_key_immutable');
    expect(MIGRATION).toContain('recipient_hash_immutable');
    expect(MIGRATION).toContain('release_evidence_immutable');
  });

  it('allows an uncertain attempt to be resolved only by reconciliation', () => {
    expect(MIGRATION).toContain('omni_comms.reconciliation');
  });
});

// ---------------------------------------------------------------------------
// 9. Runnability invariant and starvation resistance
// ---------------------------------------------------------------------------
describe('C7 closure — runnability and scanning', () => {
  it('constrains is_runnable to the ready state', () => {
    expect(MIGRATION).toContain('omni_comms_dispatch_job_runnable_chk');
  });

  it('derives is_runnable with a trigger rather than trusting the writer', () => {
    expect(MIGRATION).toContain('omni_comms_dispatch_job_runnable_trg');
  });

  it('scans wider than the claim budget', () => {
    expect(MIGRATION).toContain('v_scan_limit');
    expect(MIGRATION).toContain('EXIT WHEN v_claimed >= v_limit');
  });

  it('defers a blocked job so it cannot monopolise the scan window', () => {
    expect(MIGRATION).toContain("hold_reason = left(v_deny, 200)");
  });
});

// ---------------------------------------------------------------------------
// 10. Webhook matching order and lifecycle
// ---------------------------------------------------------------------------
describe('C7 closure — callback matching order', () => {
  it('matches C5B controlled test delivery FIRST', () => {
    const test = WEBHOOK.indexOf('omni_comms_priv_channel_test_delivery_record_event');
    const business = WEBHOOK.indexOf('omni_comms_priv_dispatch_record_callback');
    expect(test).toBeGreaterThan(-1);
    expect(business).toBeGreaterThan(test);
  });

  it('records an ambiguous provider reference without mutating evidence', () => {
    expect(MIGRATION).toContain('callback_ambiguous');
    expect(MIGRATION).toContain('v_matches > 1');
    expect(WEBHOOK).toContain('callback_ambiguous');
  });

  it('resolves an uncertain attempt from a verified callback', () => {
    expect(MIGRATION).toContain('reconciliation_resolved');
  });

  it('still refuses an unsigned callback', () => {
    expect(MIGRATION).toContain('OC401 signature_required');
  });

  it('still suspends the pilot on complaint or hard bounce', () => {
    expect(MIGRATION).toContain('omni_comms_priv_dispatch_suspend_pilot');
    expect(MIGRATION).toContain("'hard_bounce'");
    expect(MIGRATION).toContain("'complaint'");
  });
});

// ---------------------------------------------------------------------------
// 11. Uncertain outcomes and aggregates
// ---------------------------------------------------------------------------
describe('C7 closure — uncertain outcomes', () => {
  it('adds a bounded reconciliation representation', () => {
    expect(MIGRATION).toContain('reconciliation_state');
    expect(MIGRATION).toContain("'reconciliation_required'");
  });

  it('never asserts definite failure for an exhausted uncertain attempt', () => {
    expect(MIGRATION).toContain("hold_reason = 'reconciliation_required'");
  });

  it('recalculates the request aggregate after every terminal transition', () => {
    expect(MIGRATION).toContain('omni_comms_priv_dispatch_recalculate_request');
    expect(MIGRATION).toContain('completed_with_blockers');
  });
});

// ---------------------------------------------------------------------------
// 12. Evidence sanitisation and diagnostics scoping
// ---------------------------------------------------------------------------
describe('C7 closure — evidence sanitisation and diagnostics', () => {
  it('never stores the raw provider response body', () => {
    expect(MIGRATION).not.toContain(
      "safe_response_metadata = coalesce(p_provider_response, '{}'::jsonb)",
    );
    expect(MIGRATION).toContain('jsonb_strip_nulls');
  });

  it('stores only a presence flag for the provider reference in safe metadata', () => {
    expect(MIGRATION).toContain('provider_message_id_present');
  });

  it('scopes dispatcher diagnostics to the caller tenant', () => {
    expect(MIGRATION).toContain('omni_comms_priv_require_tenant_access(v_uid, p_organization_id, p_department_id)');
  });

  it('surfaces reconciliation and ambiguity counters to Operations', () => {
    expect(MIGRATION).toContain('reconciliation_required_count');
    expect(MIGRATION).toContain('ambiguous_callback_count');
  });
});

// ---------------------------------------------------------------------------
// 13. Dispatcher input contract
// ---------------------------------------------------------------------------
describe('C7 closure — dispatcher input contract', () => {
  it('accepts a strict allow-list of exactly two keys', () => {
    expect(DISPATCH).toContain('ALLOWED_INPUT_KEYS');
    expect(DISPATCH).toContain('"batchLimit", "correlationId"');
  });

  it('refuses any unknown key', () => {
    expect(DISPATCH).toContain('caller_supplied_dispatch_input_forbidden');
  });

  it('refuses a non-integer batch limit and a malformed correlation id', () => {
    expect(DISPATCH).toContain('batch_limit_invalid');
    expect(DISPATCH).toContain('correlation_id_invalid');
  });

  it('passes only server-derived scopes to the claim RPC', () => {
    expect(DISPATCH).toContain('p_scopes: scopes');
    expect(DISPATCH).toContain('p_execution_context: "operator"');
  });

  it('refuses to run when the actor has no operable scope', () => {
    expect(DISPATCH).toContain('no_operable_scope');
  });
});

// ---------------------------------------------------------------------------
// 14. Rollback and verifier integrity
// ---------------------------------------------------------------------------
describe('C7 closure — rollback and verifier', () => {
  it('drops the corrected claim signature', () => {
    expect(ROLLBACK).toContain(
      'omni_comms_priv_dispatch_claim_email(text, integer, text, text, jsonb, text)',
    );
  });

  it('drops every closure RPC', () => {
    for (const fn of [
      'omni_comms_priv_dispatch_scheduler_tick',
      'omni_comms_priv_dispatch_record_payload_hash',
      'omni_comms_priv_dispatch_recalculate_request',
      'omni_comms_priv_dispatch_operator_scopes',
      'omni_comms_dispatch_diagnostics(uuid, uuid)',
    ]) {
      expect(ROLLBACK).toContain(fn);
    }
  });

  it('references no column that does not exist', () => {
    expect(ROLLBACK).not.toContain('leased_until');
  });

  it('never deletes recorded evidence', () => {
    expect(ROLLBACK).not.toMatch(/\bDELETE FROM\b/i);
    expect(ROLLBACK).not.toMatch(/DROP TABLE/i);
  });

  it('never asserts that an in-flight attempt failed', () => {
    expect(ROLLBACK).toContain("status = 'outcome_unknown'");
  });

  it('leaves C5B controlled test delivery untouched', () => {
    expect(ROLLBACK).not.toContain('omni_comms_priv_channel_test_delivery_record_event');
    expect(ROLLBACK).not.toContain('omni_comms_channel_test_delivery');
  });

  it('retains the safety trigger and the runnability invariant', () => {
    expect(ROLLBACK).not.toContain('DROP TRIGGER');
    expect(ROLLBACK).toContain('ENABLE TRIGGER omni_comms_delivery_attempt_immutable_trg');
  });

  it('publishes a closure verifier with every protected invariant', () => {
    for (const marker of [
      'C7C.01',
      'C7C.15',
      'C7C.24',
      'C7C.27',
      'C7C.28',
      'C7C.29',
      'C7C.32',
    ]) {
      expect(VERIFIER).toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// 15. Protected posture — nothing was activated
// ---------------------------------------------------------------------------
describe('C7 closure — protected posture is preserved', () => {
  it('keeps live delivery disabled in the claim result', () => {
    expect(MIGRATION).toContain("'live_delivery_enabled', false");
  });

  it('keeps the business pilot blocked', () => {
    expect(MIGRATION).toContain('pilot_business_producer_not_selected');
  });

  it('keeps Release Control live unavailable in diagnostics', () => {
    expect(MIGRATION).toContain("'release_live_state_available', false");
  });

  it('keeps Email the only dispatchable channel', () => {
    expect(MIGRATION).toContain("j.channel = 'email'");
    expect(MIGRATION).toContain("'dispatchable_channels', jsonb_build_array('email')");
  });

  it('keeps queued the only dispatchable mode', () => {
    expect(MIGRATION).toContain("j.mode = 'queued'");
    expect(MIGRATION).not.toContain("j.mode = 'shadow'");
  });

  it('never introduces a provider SDK import', () => {
    expect(MIGRATION).not.toMatch(/resend-node|npm:resend/i);
  });
});

// ---------------------------------------------------------------------------
// 16. Phase 1 navigation is untouched
// ---------------------------------------------------------------------------
describe('C7 closure — UI Phase 1 navigation preserved', () => {
  const NAV = 'src/platform/omni-comms/admin/navigation';

  it('keeps every Phase 1 navigation file', () => {
    for (const f of [
      'channelWorkspaceRail.ts',
      'omniCommsBreadcrumbs.ts',
      'omniCommsNavigation.ts',
      'searchParamMerge.ts',
    ]) {
      expect(fs.existsSync(path.join(ROOT, NAV, f))).toBe(true);
    }
  });

  it('keeps the scope-preserving href helper', () => {
    expect(read(`${NAV}/searchParamMerge.ts`)).toContain('mergeOmniCommsHref');
  });
});
