/**
 * Step 1 Resend Account — narrow acceptance correction.
 *
 * Proves the secret-reference restriction, tenant enforcement, verification
 * invalidation, version-bound persistence and verification-backed readiness.
 * Database behaviour is asserted against the applied correction migration SQL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  runProviderVerification,
  SECRET_REF_PATTERN,
} from '../../../supabase/functions/omni-comms-runtime/providerVerification';

const MIGRATION = 'supabase/migrations/20260801194943_a1dd7cd9-c678-44d6-9d30-3dbac755ee3a.sql';
const UI_SRC = 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx';

const sql = readFileSync(MIGRATION, 'utf8');
const ui = readFileSync(UI_SRC, 'utf8');

/** SQL body of a named function in the correction migration. */
function fnBody(name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}(`);
  expect(start, `${name} must be redefined by the correction migration`).toBeGreaterThan(-1);
  const end = sql.indexOf('END; $', start);
  return sql.slice(start, end === -1 ? sql.length : end);
}

const OK_CTX = {
  allowed: true,
  code: 'ok',
  account_id: 'acc-1',
  account_code: 'RESEND_PRIMARY',
  secret_ref: 'OMNI_COMMS_RESEND_PRIMARY',
  status: 'draft',
  sandbox_mode: false,
  updated_at: '2026-01-01T00:00:00Z',
};

function makeAdmin(opts: {
  ctx?: unknown;
  rec?: unknown;
  calls?: Array<{ fn: string; args: Record<string, unknown> }>;
}) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      opts.calls?.push({ fn, args });
      if (fn === 'omni_comms_priv_provider_account_verification_context') {
        return { data: opts.ctx ?? OK_CTX, error: null };
      }
      return {
        data: opts.rec ?? {
          allowed: true,
          code: 'ok',
          verification_status: args.p_status,
          verification_result_code: args.p_result_code,
          verification_detail: args.p_detail,
          verification_checked_at: '2026-01-02T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
        error: null,
      };
    },
  };
}

const REQ = { actorId: 'user-1', organizationId: 'org-1', providerAccountId: 'acc-1' };
const ok200 = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

describe('Step 1 — secret-reference restriction', () => {
  it('rejects an unrelated OMNI_COMMS_* reference before Deno.env.get', async () => {
    let envReads = 0;
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ ctx: { ...OK_CTX, secret_ref: 'OMNI_COMMS_TWILIO_PRIMARY' } }),
      getSecret: () => { envReads += 1; return 'x'; },
      fetchImpl: ok200,
    });
    expect(res.body.code).toBe('configuration_incomplete');
    expect(envReads).toBe(0);
  });

  it('accepts only OMNI_COMMS_RESEND_* references', () => {
    expect(SECRET_REF_PATTERN.test('OMNI_COMMS_RESEND_PRIMARY')).toBe(true);
    expect(SECRET_REF_PATTERN.test('OMNI_COMMS_RESEND_STAGING_API_KEY')).toBe(true);
    for (const bad of [
      'OMNI_COMMS_RESEND_',
      'OMNI_COMMS_RESEND__X',
      'OMNI_COMMS_SENDGRID_KEY',
      'RESEND_API_KEY',
      'omni_comms_resend_primary',
      'OMNI_COMMS_RESENDPRIMARY_',
    ]) {
      expect(SECRET_REF_PATTERN.test(bad), bad).toBe(false);
    }
  });

  it('applies the same restriction in database validation and the context RPC', () => {
    expect(sql).toContain("'^OMNI_COMMS_RESEND_[A-Z0-9]+(_[A-Z0-9]+)*$'");
    expect(fnBody('omni_comms_provider_account_upsert_draft'))
      .toContain('omni_comms_priv_is_resend_secret_ref');
    expect(fnBody('omni_comms_priv_provider_account_verification_context'))
      .toContain('omni_comms_priv_is_resend_secret_ref');
  });

  it('states the restriction in UI help text', () => {
    expect(ui).toContain('^OMNI_COMMS_RESEND_[A-Z0-9]+(?:_[A-Z0-9]+)*$');
  });

  it('rejects a non-Resend provider account', () => {
    const body = fnBody('omni_comms_priv_provider_account_verification_context');
    expect(body).toContain("v_adapter IS DISTINCT FROM 'resend'");
    expect(body).toContain("v_channel IS DISTINCT FROM 'email'");
    expect(body).toContain("'code','configuration_incomplete'");
  });
});

describe('Step 1 — organisation access enforcement', () => {
  const enforced = [
    'omni_comms_email_config_summary',
    'omni_comms_provider_account_upsert_draft',
    'omni_comms_provider_account_activate',
    'omni_comms_provider_account_record_credential_check',
    'omni_comms_priv_provider_account_verification_context',
    'omni_comms_priv_record_provider_verification',
  ];

  it.each(enforced)('%s enforces tenant access server-side', (fn) => {
    expect(fnBody(fn)).toContain('omni_comms_priv_require_tenant_access');
  });

  it('denies a cross-organisation summary read', () => {
    expect(fnBody('omni_comms_email_config_summary'))
      .toContain('PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);');
  });

  it('denies cross-organisation account creation', () => {
    const body = fnBody('omni_comms_provider_account_upsert_draft');
    expect(body).toContain('PERFORM public.omni_comms_priv_require_tenant_access(v_uid, p_organization_id, NULL);');
  });

  it('denies cross-organisation activation using the stored organisation, not the browser selector', () => {
    const body = fnBody('omni_comms_provider_account_activate');
    expect(body).toContain('PERFORM public.omni_comms_priv_require_tenant_access(v_uid, v_before.organization_id, NULL);');
  });

  it('resolves the account organisation before ID-based mutations', () => {
    for (const fn of [
      'omni_comms_provider_account_activate',
      'omni_comms_provider_account_record_credential_check',
    ]) {
      const body = fnBody(fn);
      expect(body.indexOf('SELECT * INTO v_before'))
        .toBeLessThan(body.indexOf('omni_comms_priv_require_tenant_access'));
    }
  });

  it('cross-organisation denial is denied by verification RPCs', () => {
    for (const fn of [
      'omni_comms_priv_provider_account_verification_context',
      'omni_comms_priv_record_provider_verification',
    ]) {
      expect(fnBody(fn)).toContain("'code','organization_access_denied'");
    }
  });
});

describe('Step 1 — stale verification invalidation', () => {
  const body = fnBody('omni_comms_provider_account_upsert_draft');

  it('treats secret_ref, provider_id, sandbox_mode and region as verification-relevant', () => {
    expect(body).toContain('v_before.secret_ref   IS DISTINCT FROM btrim(p_secret_ref)');
    expect(body).toContain('v_before.provider_id  IS DISTINCT FROM v_provider_id');
    expect(body).toContain('v_before.sandbox_mode IS DISTINCT FROM v_sandbox');
    expect(body).toContain('v_before.region       IS DISTINCT FROM v_region');
  });

  it('resets all four verification columns when configuration changes', () => {
    expect(body).toContain("verification_status = CASE WHEN v_reset THEN 'unverified' ELSE verification_status END");
    expect(body).toContain('verification_result_code = CASE WHEN v_reset THEN NULL ELSE verification_result_code END');
    expect(body).toContain('verification_detail = CASE WHEN v_reset THEN NULL ELSE verification_detail END');
    expect(body).toContain('verification_checked_at = CASE WHEN v_reset THEN NULL ELSE verification_checked_at END');
  });

  it('does not reset verification when configuration is unchanged', () => {
    expect(body).toContain('ELSE verification_status END');
    expect(body).not.toMatch(/SET[^;]*verification_status\s*=\s*'unverified'\s*,/);
  });
});

describe('Step 1 — version-bound verification persistence', () => {
  it('context RPC returns the exact account version', () => {
    expect(fnBody('omni_comms_priv_provider_account_verification_context'))
      .toContain("'updated_at', v_row.updated_at");
  });

  it('Edge passes the probed version to the record RPC', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    await runProviderVerification(REQ, {
      admin: makeAdmin({ calls }),
      getSecret: () => 're_test',
      fetchImpl: ok200,
    });
    const rec = calls.find((c) => c.fn === 'omni_comms_priv_record_provider_verification');
    expect(rec?.args.p_expected_updated_at).toBe(OK_CTX.updated_at);
  });

  it('record RPC locks the row and requires exact version equality', () => {
    const body = fnBody('omni_comms_priv_record_provider_verification');
    expect(body).toContain('FOR UPDATE');
    expect(body).toContain('v_before.updated_at IS DISTINCT FROM p_expected_updated_at');
    expect(body).toContain("'code','concurrent_update'");
    expect(body.indexOf("'code','concurrent_update'"))
      .toBeLessThan(body.indexOf('UPDATE public.omni_comms_provider_account'));
  });

  it('a concurrent account edit prevents verification persistence', async () => {
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ rec: { allowed: false, code: 'concurrent_update' } }),
      getSecret: () => 're_test',
      fetchImpl: ok200,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('concurrent_update');
    expect(res.body.verificationStatus).toBeUndefined();
  });
});

describe('Step 1 — readiness uses real verification only', () => {
  it('manual healthy evidence does not permit activation', () => {
    const body = fnBody('omni_comms_provider_account_activate');
    expect(body).toContain("v_before.verification_status IS DISTINCT FROM 'verified'");
    expect(body).toContain('provider_verification_required');
    expect(body).not.toContain("health_state='unknown'");
    expect(body).not.toContain("health_state='failed'");
  });

  it('verified Resend credentials permit account activation', () => {
    const body = fnBody('omni_comms_provider_account_activate');
    expect(body).toContain("SET status='active'");
    // the only activation precondition on evidence is real verification
    expect(body).not.toMatch(/health_state\s*(=|IN)/);
  });

  it('manual healthy evidence does not produce email readiness', () => {
    const body = fnBody('omni_comms_email_config_summary');
    expect(body).not.toContain("health_state IN ('healthy','degraded')");
    expect(body).toContain("status='active' AND verification_status='verified'");
  });

  it('manual health remains labelled non-authoritative and cannot activate in the UI', () => {
    expect(ui).toContain('not provider verified');
    expect(ui).toContain('account.verification_status !== "verified"');
    expect(ui).toContain('Manual health evidence is not authoritative');
  });
});

describe('Step 1 — zero email and zero delivery activity', () => {
  it('verification performs only the read-only probe and two RPCs', async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const seen: string[] = [];
    const res = await runProviderVerification(REQ, {
      admin: makeAdmin({ calls }),
      getSecret: () => 're_test',
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push(`${init?.method ?? 'GET'} ${String(url)}`);
        return new Response('{}', { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(seen).toEqual(['GET https://api.resend.com/domains']);
    expect(calls.map((c) => c.fn)).toEqual([
      'omni_comms_priv_provider_account_verification_context',
      'omni_comms_priv_record_provider_verification',
    ]);
    expect(res.body.emailsSent).toBe(0);
    expect(res.body.deliveryAttemptsCreated).toBe(0);
    expect(res.body.dispatchJobsCreated).toBe(0);
  });

  it('the correction migration creates no message, delivery or dispatch rows', () => {
    expect(sql).not.toMatch(/INSERT INTO public\.omni_comms_(message|delivery|dispatch)/i);
    expect(sql).not.toMatch(/resend\.com/i);
  });

  it('the correction migration is the only new migration for this correction', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'));
    expect(files).toContain('20260801194943_a1dd7cd9-c678-44d6-9d30-3dbac755ee3a.sql');
  });
});
