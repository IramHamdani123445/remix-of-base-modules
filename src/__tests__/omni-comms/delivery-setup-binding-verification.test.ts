/**
 * Omni-Comms Delivery Setup — trusted binding configuration verification.
 *
 * The administrator may only REQUEST verification; the result is computed and
 * recorded server-side. These tests pin the RPC contract and prove the adapter
 * never carries a caller-supplied verification status.
 */
import { describe, expect, it, vi } from 'vitest';
import * as bindingService from '@/platform/omni-comms/application/channelBindingService';
import type { ChannelBindingConfigurationVerification } from '@/platform/omni-comms/application/channelBindingTypes';
import { DELIVERY_SETUP_CHECK_KEYS } from '@/platform/omni-comms/admin/views/channels/readinessStages';

function client(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  return { client: { rpc } as never, rpc };
}

const verified: ChannelBindingConfigurationVerification = {
  bindingId: 'b1',
  verificationStatus: 'verified',
  verificationSource: 'service',
  resultCode: 'configuration_verified',
  checks: [{ key: 'sender_active', ok: true }],
  emailsSent: 0,
  providerCalls: 0,
};

describe('Trusted binding configuration verification', () => {
  it('calls the bounded verification RPC with only the binding id', async () => {
    const { client: c, rpc } = client(verified);
    await bindingService.verifyChannelBindingConfiguration(c, 'b1', 'corr-1');
    expect(rpc).toHaveBeenCalledWith('omni_comms_binding_verify_configuration', {
      p_id: 'b1',
      p_correlation_id: 'corr-1',
    });
  });

  it('never lets a caller supply a verification status', async () => {
    const { client: c, rpc } = client(verified);
    await bindingService.verifyChannelBindingConfiguration(c, 'b1');
    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(['p_correlation_id', 'p_id']);
  });

  it('returns the server verdict, which asserts zero sends and zero provider calls', async () => {
    const { client: c } = client(verified);
    const result = await bindingService.verifyChannelBindingConfiguration(c, 'b1');
    expect(result.verificationSource).toBe('service');
    expect(result.emailsSent).toBe(0);
    expect(result.providerCalls).toBe(0);
  });

  it('surfaces a failed verdict without throwing', async () => {
    const { client: c } = client({
      ...verified,
      verificationStatus: 'failed',
      resultCode: 'domain_verification_fresh',
    });
    const result = await bindingService.verifyChannelBindingConfiguration(c, 'b1');
    expect(result.verificationStatus).toBe('failed');
    expect(result.resultCode).toBe('domain_verification_fresh');
  });

  it('binding verification remains a Delivery Setup prerequisite', () => {
    expect(DELIVERY_SETUP_CHECK_KEYS).toContain('binding_verification');
    expect(DELIVERY_SETUP_CHECK_KEYS).toContain('event_callback');
    expect(DELIVERY_SETUP_CHECK_KEYS).toHaveLength(11);
  });
});
