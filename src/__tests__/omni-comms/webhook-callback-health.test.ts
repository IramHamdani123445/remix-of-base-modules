/**
 * Omni-Comms — callback (webhook) health warning surface.
 *
 * Proves the admin UI can tell an operator WHY callbacks are missing, without
 * sending anything and without exposing any secret value.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CALLBACK_HEALTH_GUIDANCE,
  getCallbackHealth,
} from '@/platform/omni-comms/application/channelProviderConfigurationService';

function recordingClient(payload: unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args: args ?? {} });
      return { data: payload, error: null };
    },
  };
}

describe('callback health projection', () => {
  it('reads the bounded read-only health RPC', async () => {
    const client = recordingClient({
      organizationId: 'org-1',
      accounts: [],
      generatedAt: '2026-08-11T00:00:00Z',
    });
    await getCallbackHealth(client, 'org-1');
    expect(client.calls[0].fn).toBe('omni_comms_channel_callback_health');
    expect(client.calls[0].args.p_organization_id).toBe('org-1');
  });

  it('explains every observable state distinctly', () => {
    const states = Object.keys(CALLBACK_HEALTH_GUIDANCE).sort();
    expect(states).toEqual(['healthy', 'never_received', 'rejecting']);
    expect(CALLBACK_HEALTH_GUIDANCE.never_received).toMatch(/account=/);
    expect(CALLBACK_HEALTH_GUIDANCE.rejecting).toMatch(/does not match/i);
  });
});

describe('webhook admin surface', () => {
  const src = readFileSync(
    'src/platform/omni-comms/admin/views/channels/ProviderWebhookSection.tsx',
    'utf8',
  );

  it('renders an alert region for unhealthy callback states', () => {
    expect(src).toContain('omni-comms-webhook-health');
    expect(src).toContain("role={health.state === 'healthy' ? undefined : 'alert'}");
  });

  it('never renders a secret value', () => {
    expect(src).not.toMatch(/secretValue\s*}/);
  });
});

describe('rejected callback evidence', () => {
  const fn = readFileSync(
    'supabase/functions/omni-comms-webhook-resend/index.ts',
    'utf8',
  );

  it('records a bounded rejection when the signature does not match', () => {
    expect(fn).toContain('signature_mismatch');
    expect(fn).toContain('omni_comms_priv_webhook_record_rejection');
  });

  it('records a rejection when no signing secret is saved', () => {
    expect(fn).toContain('webhook_secret_missing');
  });

  it('never passes the signing secret into the evidence recorder', () => {
    const call = fn.slice(fn.indexOf('async function recordRejection'));
    expect(call.slice(0, 900)).not.toContain('signingSecret');
  });
});
