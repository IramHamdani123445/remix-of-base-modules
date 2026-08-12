/**
 * Omni-Comms — the release summary must report the REAL installed business
 * dispatcher, and the final dispatch claim must keep accepting a restricted
 * (sending-only) provider credential.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = 'supabase/migrations';

function latestContaining(needle: string): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const body = readFileSync(`${MIGRATIONS}/${files[i]}`, 'utf8');
    if (body.includes(needle)) return body;
  }
  throw new Error(`no migration defines ${needle}`);
}

describe('release summary reports the dispatcher truthfully', () => {
  const summary = latestContaining(
    'FUNCTION public.omni_comms_channel_release_control_summary',
  );

  it('derives dispatch readiness instead of hard-coding it', () => {
    expect(summary).toContain(
      "'business_dispatch_implemented', public.omni_comms_priv_business_dispatch_installed()",
    );
    expect(summary).not.toContain("'business_dispatch_implemented', false");
  });

  it('derives installation from real installed dispatch capability', () => {
    const probe = latestContaining(
      'FUNCTION public.omni_comms_priv_business_dispatch_installed',
    );
    expect(probe).toContain('omni_comms_priv_dispatch_claim_email');
    expect(probe).toContain('omni_comms_priv_dispatch_attempt_complete');
    expect(probe).toContain('omni_comms_priv_dispatch_record_callback');
    // No faked readiness: existence is proven from the catalogue.
    expect(probe).toContain('pg_proc');
  });

  it('never hard-codes the flag in the trusted Edge boundary', () => {
    const fn = readFileSync(
      'supabase/functions/omni-comms-release-control/index.ts',
      'utf8',
    );
    expect(fn).not.toContain('business_dispatch_implemented: false');
    expect(fn).toContain('omni_comms_priv_business_dispatch_installed');
  });
});

describe('final dispatch claim keeps the canonical send-ready predicate', () => {
  it('is asserted against the deployed function by the SQL verifier', () => {
    const verifier = readFileSync(
      'supabase/verify/omni_comms_dispatch_send_ready.sql',
      'utf8',
    );
    expect(verifier).toContain('omni_comms_priv_dispatch_claim_email');
    expect(verifier).toContain('omni_comms_provider_credential_send_ready');
    // Full Resend access must never become a sending requirement.
    expect(verifier).toContain("verification_status = 'verified'");
    expect(verifier).toContain('restricted_api_key');
  });

  it('probes the dispatcher only when the send-ready predicate is present', () => {
    const probe = latestContaining(
      'FUNCTION public.omni_comms_priv_business_dispatch_installed',
    );
    expect(probe).toContain('omni_comms_provider_credential_send_ready');
  });
});
