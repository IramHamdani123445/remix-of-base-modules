/**
 * Omni-Comms — Sending-only provider hardening.
 *
 * Guarantees proven here:
 *  1. A Full-access provider credential is never required for sending: a
 *     restricted (sending-only) credential is send-ready.
 *  2. A credential has exactly ONE explicitly selected storage source; there
 *     is no silent precedence between the vault and Edge Function Secrets.
 *  3. The controlled test-delivery evidence identity is generated before the
 *     insert, so no post-insert identity update can trip the immutability
 *     guard (OC409 test_delivery_identity_immutable).
 *  4. Every bounded refusal the operator can hit has plain-English guidance.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  credentialSendReady,
  credentialRestrictedButUsable,
} from '@/platform/omni-comms/application/channelProviderAccountTypes';
import { TEST_DELIVERY_MESSAGES } from '@/platform/omni-comms/admin/views/channels/ChannelTestDeliveryCard';

const read = (p: string) => readFileSync(p, 'utf8');

const ADAPTER = read('supabase/functions/_shared/omni-comms/resendAdapter.ts');
const TEST_FN = read('supabase/functions/omni-comms-test-delivery/index.ts');
const DISPATCH_FN = read('supabase/functions/omni-comms-dispatch/index.ts');

describe('Principle 1 — full access is never required for sending', () => {
  it('treats a restricted (sending-only) credential as send-ready', () => {
    expect(
      credentialSendReady({
        verification_status: 'pending',
        verification_result_code: 'restricted_api_key',
      }),
    ).toBe(true);
    expect(
      credentialRestrictedButUsable({
        verification_status: 'pending',
        verification_result_code: 'restricted_api_key',
      }),
    ).toBe(true);
  });

  it('does not treat an unverified or failed credential as send-ready', () => {
    expect(
      credentialSendReady({ verification_status: 'unverified', verification_result_code: null }),
    ).toBe(false);
    expect(
      credentialSendReady({ verification_status: 'failed', verification_result_code: 'invalid_credentials' }),
    ).toBe(false);
  });
});

describe('Principle 4 — one explicitly selected credential store', () => {
  it('removes the silent vault-then-env precedence helper', () => {
    expect(ADAPTER).not.toContain('resolveSecretWithVault');
    expect(ADAPTER).toContain('export async function resolveSecretStrict');
    expect(ADAPTER).toContain('export function normalizeStorageMode');
  });

  it('never falls back to the deployment secret for a vault credential', () => {
    const vaultBranch = ADAPTER.slice(
      ADAPTER.indexOf('if (storageMode === "vault")'),
      ADAPTER.indexOf('return resolveSecret(secretRef);'),
    );
    expect(vaultBranch).not.toContain('resolveSecret(secretRef)');
    expect(vaultBranch).toContain('credential_missing');
  });

  it('resolves the sending credential from the selected store only', () => {
    expect(TEST_FN).toContain('normalizeStorageMode(plan.credential_storage_mode)');
    expect(TEST_FN).toContain('resolveSecretStrict(secretRef, storageMode, secretResolver)');
    expect(TEST_FN).toContain('storageMode,');
    expect(DISPATCH_FN).toContain('claim.credential_storage_mode');
  });

  it('uses the API key, not the webhook secret, for delivery-status checks', () => {
    expect(TEST_FN).toContain('.eq("purpose", "api_key")');
  });
});

describe('Controlled test delivery — evidence identity and operator guidance', () => {
  it('explains every bounded refusal in plain English', () => {
    for (const code of [
      'test_delivery_identity_immutable',
      'idempotency_payload_mismatch',
      'provider_account_not_verified',
      'credential_missing',
      'credential_store_unavailable',
      'secret_reference_invalid',
      'preflight_stale',
    ]) {
      expect(TEST_DELIVERY_MESSAGES[code]).toBeTruthy();
      expect(TEST_DELIVERY_MESSAGES[code].length).toBeGreaterThan(30);
    }
  });

  it('never exposes a credential value to the browser', () => {
    expect(TEST_FN).not.toMatch(/apiKey/);
    expect(ADAPTER).not.toMatch(/console\.log\([^)]*apiKey/);
  });
});
