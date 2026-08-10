import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  deriveSenderCode,
  deriveSenderDomain,
  isReferenceSender,
  isValidSenderEmail,
  resolveSenderCode,
  senderBlockerAction,
  senderBlockerMessage,
  senderDisplayStatus,
  senderDomainLabel,
  senderProviderLabel,
  senderScopeLabel,
  senderUsageLabel,
  type SenderAddressRow,
} from '@/platform/omni-comms/application/senderAddressTypes';

function row(patch: Partial<SenderAddressRow> = {}): SenderAddressRow {
  return {
    id: 'id-1',
    code: 'benefits_department',
    display_name: 'Benefits Department',
    channel: 'email',
    identity_type: 'email_sender',
    identity_config: { from_address: 'benefits@secureserve.biz' },
    department_id: null,
    department_name: null,
    status: 'draft',
    data_origin: 'user',
    from_address: 'benefits@secureserve.biz',
    from_name: 'Benefits Department',
    reply_to_address: null,
    created_at: '2026-08-10T00:00:00Z',
    updated_at: '2026-08-10T00:00:00Z',
    activated_at: null,
    retired_at: null,
    retirement_reason: null,
    domain_name: 'secureserve.biz',
    channel_endpoint_id: 'ep-1',
    channel_endpoint_code: 'ssb_benefits_sending_domain',
    channel_endpoint_status: 'active',
    domain_verification_status: 'verified',
    domain_association_confirmed: true,
    domain_ready: true,
    provider_account_id: 'acc-1',
    provider_account_code: 'omni_pilot_sandbox',
    provider_account_name: 'Synthetic dry-run sandbox account',
    provider_account_status: 'active',
    usage_routes: 0,
    usage_bindings: 0,
    usage_messages: 0,
    usage_test_deliveries: 0,
    usage_total: 0,
    activation_blocker: null,
    can_activate: true,
    can_hard_delete: true,
    ...patch,
  };
}

describe('Omni-Comms — Sender Addresses model', () => {
  it('derives the sending domain from the From address', () => {
    expect(deriveSenderDomain('benefits@secureserve.biz')).toBe('secureserve.biz');
    expect(deriveSenderDomain(' Benefits@SecureServe.BIZ ')).toBe('secureserve.biz');
    expect(deriveSenderDomain('not-an-address')).toBeNull();
  });

  it('validates the From address shape', () => {
    expect(isValidSenderEmail('benefits@secureserve.biz')).toBe(true);
    expect(isValidSenderEmail('benefits@secureserve')).toBe(false);
    expect(isValidSenderEmail('')).toBe(false);
  });

  it('derives a stable technical code and resolves collisions', () => {
    expect(deriveSenderCode('Benefits Department')).toBe('benefits_department');
    expect(resolveSenderCode('Benefits Department', [])).toBe('benefits_department');
    expect(resolveSenderCode('Benefits Department', ['benefits_department']))
      .toBe('benefits_department_2');
  });

  it('shows Ready only when the backend says the sender can be activated', () => {
    expect(senderDisplayStatus(row())).toBe('Ready');
    expect(senderDisplayStatus(row({ can_activate: false }))).toBe('Draft');
    expect(senderDisplayStatus(row({ status: 'active' }))).toBe('Active');
    expect(senderDisplayStatus(row({ status: 'disabled' }))).toBe('Disabled');
    expect(senderDisplayStatus(row({ status: 'retired' }))).toBe('Retired');
  });

  it('reports domain and provider readiness from backend truth only', () => {
    expect(senderDomainLabel(row())).toBe('secureserve.biz — Verified');
    expect(
      senderDomainLabel(row({ domain_ready: false, domain_association_confirmed: false })),
    ).toBe('secureserve.biz — Verified, association pending');
    expect(
      senderDomainLabel(row({
        domain_ready: false,
        domain_verification_status: null,
        channel_endpoint_id: null,
      })),
    ).toBe('secureserve.biz — Not configured');
    expect(senderProviderLabel(row())).toBe('Synthetic dry-run sandbox account — Ready');
    expect(senderProviderLabel(row({ domain_ready: false })))
      .toBe('Synthetic dry-run sandbox account — Not ready');
  });

  it('explains activation blockers with one next action', () => {
    expect(senderBlockerMessage('domain_not_verified', 'secureserve.biz'))
      .toBe('Domain secureserve.biz has not been verified.');
    expect(senderBlockerAction('domain_not_verified')).toEqual({
      label: 'Configure domain', tab: 'endpoints',
    });
    expect(senderBlockerAction(null)).toBeNull();
    expect(senderBlockerMessage(null)).toBeNull();
  });

  it('describes scope and usage for operators', () => {
    expect(senderScopeLabel(row())).toBe('Organisation-wide');
    expect(senderScopeLabel(row({ department_id: 'd1', department_name: 'Benefits' })))
      .toBe('Benefits');
    expect(senderUsageLabel(row())).toBe('0 routes');
    expect(senderUsageLabel(row({ usage_routes: 1, usage_messages: 2 })))
      .toBe('1 route · 2 historical messages');
  });

  it('marks reference seed senders as protected reference data', () => {
    expect(isReferenceSender(row({ data_origin: 'reference_seed' }))).toBe(true);
    expect(isReferenceSender(row())).toBe(false);
  });
});

describe('Omni-Comms — Sender Addresses screen boundaries', () => {
  const panel = 'src/platform/omni-comms/admin/views/channels/senders/EmailSenderAddressesPanel.tsx';
  const dialog = 'src/platform/omni-comms/admin/views/channels/senders/SenderAddressDialog.tsx';

  it('screen files exist', () => {
    expect(existsSync(panel)).toBe(true);
    expect(existsSync(dialog)).toBe(true);
  });

  it('the Email identities tab delegates to the Sender Addresses screen', () => {
    const src = readFileSync(
      'src/platform/omni-comms/admin/views/channels/ChannelIdentitiesTab.tsx', 'utf8',
    );
    expect(src).toMatch(/EmailSenderAddressesPanel/);
    expect(src).toMatch(/definition\.code === 'email'/);
  });

  it('never sends, binds, routes or imports a provider SDK', () => {
    for (const f of [panel, dialog]) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from ['"]resend['"]/);
      expect(src).not.toMatch(/sendCommunication/);
      expect(src).not.toMatch(/omni-comms-dispatch/);
      expect(src).not.toMatch(/bindingService|releaseControl/);
    }
  });

  it('uses the sender-address service only', () => {
    const src = readFileSync(panel, 'utf8');
    expect(src).toMatch(/senderAddressService/);
    expect(src).not.toMatch(/integrations\/supabase\/client/);
  });
});
