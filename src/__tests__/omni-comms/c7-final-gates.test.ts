/**
 * Omni-Comms Phase C7 Final Closure Correction — dispatch gates.
 *
 * Source-grounded assertions over the final corrective migration, the
 * dispatcher Edge Function input contract and the extended closure verifier.
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

/** The final gate migration is the newest migration containing its marker. */
function gateMigration(): string {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = fs.readFileSync(path.join(dir, files[i]), 'utf8');
    if (body.includes('FUNCTION public.omni_comms_priv_dispatch_claim_safety_suspend')) return body;
  }
  throw new Error('C7 final gate migration not found');
}

const MIGRATION = gateMigration();
const DISPATCH = read('supabase/functions/omni-comms-dispatch/index.ts');
const VERIFIER = read('scripts/omni-comms/verify-c7-closure-correction.sql');

describe('C7 final gates — claim-time enforcement', () => {
  it('enforces business_dispatch_enabled at claim time', () => {
    expect(MIGRATION).toContain("'business_dispatch_disabled'");
    expect(MIGRATION).toMatch(/business_dispatch_enabled'\)::boolean, false\) IS NOT TRUE/);
  });

  it('enforces recipient rule satisfaction at claim time', () => {
    expect(MIGRATION).toMatch(/recipient_rules_satisfied'\)::boolean, false\) IS NOT TRUE/);
    expect(MIGRATION).toContain("'recipient_not_permitted'");
  });

  it('rejects an out-of-range batch limit instead of clamping it', () => {
    expect(MIGRATION).toContain('OC422 invalid_batch_limit');
    expect(MIGRATION).not.toContain('least(p_batch_limit');
    expect(MIGRATION).not.toContain('greatest(p_batch_limit');
  });

  it('keeps the rendering-time release snapshot immutable at claim time', () => {
    expect(MIGRATION).toContain("'release_snapshot_stale'");
    expect(MIGRATION).toContain("'release_fingerprint_mismatch'");
  });

  it('requires the exact persisted provider account recorded on the message', () => {
    expect(MIGRATION).toContain("'provider_identity_ambiguous'");
    expect(MIGRATION).toMatch(/v_account\.provider_id IS DISTINCT FROM v_job\.msg_provider_id/);
  });

  it('requires a verified sending domain bound to the same tenant', () => {
    expect(MIGRATION).toContain("'endpoint_missing'");
    expect(MIGRATION).toContain("'endpoint_not_verified'");
    expect(MIGRATION).toContain("'endpoint_tenant_mismatch'");
    expect(MIGRATION).toContain("'endpoint_department_mismatch'");
    expect(MIGRATION).toContain("'sending_domain'");
  });

  it('rejects an ambiguous or duplicate operational binding', () => {
    expect(MIGRATION).toContain("'binding_ambiguous'");
    expect(MIGRATION).toContain('v_binding_count > 1');
  });

  it('rejects reference-seed configuration as an operational source', () => {
    expect(MIGRATION.match(/reference_seed/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('keeps the bounded secret-reference pattern as the only credential gate', () => {
    expect(MIGRATION).toContain("'secret_reference_invalid'");
    expect(MIGRATION).toContain('OMNI_COMMS_RESEND_');
  });
});

describe('C7 final gates — bounded automatic safety suspension', () => {
  it('defines exactly one claim-safety suspension helper', () => {
    const hits = MIGRATION.match(
      /CREATE OR REPLACE FUNCTION public\.omni_comms_priv_dispatch_claim_safety_suspend/g,
    );
    expect(hits).toHaveLength(1);
  });

  it('reuses the existing pilot suspension primitive', () => {
    expect(MIGRATION).toContain('public.omni_comms_priv_dispatch_suspend_pilot(');
  });

  it('never suspends for ordinary configuration absence before a pilot is active', () => {
    expect(MIGRATION).toContain("'not_a_safety_trigger'");
    expect(MIGRATION).toContain("'pilot_not_active'");
    expect(MIGRATION).toMatch(/v_state IS DISTINCT FROM 'controlled_pilot'/);
  });

  it('suspends on genuine integrity failures only', () => {
    for (const code of [
      'certification_mismatch',
      'deployed_revision_mismatch',
      'release_fingerprint_mismatch',
      'live_delivery_enabled_unexpected',
      'recipient_not_permitted',
      'binding_ambiguous',
      'secret_reference_invalid',
    ]) {
      expect(MIGRATION).toContain(`'${code}'`);
    }
    expect(MIGRATION).not.toContain("'resolution_snapshot_incomplete',\n       'certification");
  });

  it('is service-role only', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_dispatch_claim_safety_suspend\(uuid, text, uuid\) FROM anon, authenticated;/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_dispatch_claim_safety_suspend\(uuid, text, uuid\) TO service_role;/,
    );
  });

  it('records the suspension outcome on the claim blocker', () => {
    expect(MIGRATION).toContain("'pilot_suspended'");
  });
});

describe('C7 final gates — tenant-scoped diagnostics', () => {
  it('scopes the queued producer binding count to the organisation', () => {
    expect(MIGRATION).toContain('b.organization_id = p_organization_id');
  });

  it('scopes the queued producer binding count to a compatible department', () => {
    expect(MIGRATION).toMatch(/b\.department_id IS NULL[\s\S]{0,120}b\.department_id = p_department_id/);
  });

  it('only counts bindings the effective release actually permits', () => {
    expect(MIGRATION).toContain('ed.event_code = ANY (v_rel.permitted_event_codes)');
    expect(MIGRATION).toContain('b.caller_module_code = ANY (v_rel.permitted_caller_modules)');
  });

  it('keeps the honest blocker when no in-tenant producer binding qualifies', () => {
    expect(MIGRATION).toContain("'pilot_business_producer_not_selected'");
  });

  it('scopes ambiguous callback counts to in-tenant attempts', () => {
    expect(MIGRATION).toMatch(/processing_result = 'ambiguous'[\s\S]{0,600}a\.organization_id = p_organization_id/);
  });

  it('still reports live delivery as disabled', () => {
    expect(MIGRATION).toContain("'live_delivery_enabled', false");
  });
});

describe('C7 final gates — truthful callback lifecycle', () => {
  it('marks the message failed for a complaint or hard bounce', () => {
    expect(MIGRATION).toMatch(/SET status = 'failed', failed_at = coalesce\(failed_at, now\(\)\)/);
  });

  it('fails the dispatch job for a terminal outcome', () => {
    expect(MIGRATION).toMatch(/hold_reason = CASE WHEN p_normalized_event_type = 'complained'/);
  });

  it('suspends the pilot before the request aggregate is recalculated', () => {
    const suspendAt = MIGRATION.lastIndexOf('omni_comms_priv_dispatch_suspend_pilot(\n      v_att.release_control_id');
    const recalcAt = MIGRATION.lastIndexOf('omni_comms_priv_dispatch_recalculate_request(v_job.request_id)');
    expect(suspendAt).toBeGreaterThan(-1);
    expect(recalcAt).toBeGreaterThan(suspendAt);
  });

  it('never lets opened or clicked reverse a terminal failure', () => {
    expect(MIGRATION).toContain('AND NOT v_terminal');
    expect(MIGRATION).toMatch(/coalesce\(v_msg_status,''\) <> 'failed'/);
  });

  it('treats a soft bounce as evidence without suspension', () => {
    expect(MIGRATION).toContain("v_bounce IN ('hard','permanent')");
  });

  it('records a bounded outcome when an ambiguous callback cannot resolve a release', () => {
    expect(MIGRATION).toContain("'release_not_resolvable'");
    expect(MIGRATION).toContain("'ambiguous_callback'");
  });
});

describe('C7 final gates — dispatcher input contract', () => {
  it('rejects a fractional, string or out-of-range batch limit', () => {
    expect(DISPATCH).toContain('batch_limit_invalid');
    expect(DISPATCH).toContain('candidate > MAX_BATCH_LIMIT');
    expect(DISPATCH).toContain('candidate < 1');
  });

  it('no longer clamps the batch limit silently', () => {
    expect(DISPATCH).not.toContain('Math.min(');
    expect(DISPATCH).not.toContain('Math.max(');
  });

  it('keeps the caller input allow-list closed', () => {
    expect(DISPATCH).toContain('caller_supplied_dispatch_input_forbidden');
  });
});

describe('C7 final gates — verifier coverage', () => {
  it('extends the closure verifier to check 52', () => {
    for (let i = 41; i <= 52; i += 1) {
      expect(VERIFIER).toContain(`C7F.${i}`);
    }
  });

  it('asserts live delivery remains disabled in the database', () => {
    expect(VERIFIER).toContain('WHERE live_delivery_enabled IS TRUE');
  });
});
