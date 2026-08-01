/**
 * Omni-Comms C1 — channel catalogue, selector, generic tab shell, seed isolation.
 */
import { describe, expect, it } from 'vitest';
import {
  OMNI_COMMS_CHANNELS,
  OMNI_COMMS_CHANNEL_CATALOGUE,
  OMNI_COMMS_DEFAULT_CHANNEL,
  OMNI_COMMS_GENERIC_TABS,
  channelSeedNamespace,
  getChannelDescriptor,
  getImplementedChannels,
  isOmniCommsChannel,
  isSeedKeyIsolatedTo,
  resolveChannelDescriptor,
  validateChannelCatalogue,
} from '@/platform/omni-comms/domain/channelCatalogue';

describe('C1 — channel catalogue', () => {
  it('declares exactly eight channels', () => {
    expect(OMNI_COMMS_CHANNELS).toHaveLength(8);
    expect(OMNI_COMMS_CHANNEL_CATALOGUE).toHaveLength(8);
  });

  it('passes structural validation', () => {
    expect(validateChannelCatalogue()).toEqual([]);
  });

  it('covers the C6–C10 chunk map', () => {
    const byChunk = (c: string) =>
      OMNI_COMMS_CHANNEL_CATALOGUE.filter((d) => d.chunk === c).map((d) => d.channel);
    expect(byChunk('C6')).toEqual(['email']);
    expect(byChunk('C7')).toEqual(['sms']);
    expect(byChunk('C8')).toEqual(['whatsapp']);
    expect(byChunk('C9')).toEqual(['push', 'in_app']);
    expect(byChunk('C10')).toEqual(['webhook', 'print', 'voice']);
  });

  it('only email has an implemented administration surface', () => {
    expect(getImplementedChannels().map((d) => d.channel)).toEqual(['email']);
  });

  it('exposes no provider adapters for unimplemented channels', () => {
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      if (!d.implemented) expect(d.reservedProviders).toEqual([]);
    }
  });

  it('reserves only resend for email', () => {
    expect(getChannelDescriptor('email').reservedProviders).toEqual(['resend']);
  });

  it('declares every tab from the generic tab vocabulary', () => {
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      for (const t of d.tabs) {
        expect(OMNI_COMMS_GENERIC_TABS).toContain(t);
      }
    }
  });

  it('gives webhook an endpoints tab and no identities tab', () => {
    const d = getChannelDescriptor('webhook');
    expect(d.tabs).toContain('endpoints');
    expect(d.tabs).not.toContain('identities');
  });

  it('gives in-app the narrowest surface', () => {
    expect(getChannelDescriptor('in_app').tabs).toEqual([
      'overview',
      'policies',
      'test',
      'diagnostics',
    ]);
  });
});

describe('C1 — channel resolution', () => {
  it('recognises catalogue members only', () => {
    expect(isOmniCommsChannel('email')).toBe(true);
    expect(isOmniCommsChannel('fax')).toBe(false);
    expect(isOmniCommsChannel(null)).toBe(false);
  });

  it('falls back to the default channel for unknown values', () => {
    expect(resolveChannelDescriptor('fax').channel).toBe(OMNI_COMMS_DEFAULT_CHANNEL);
    expect(resolveChannelDescriptor(null).channel).toBe('email');
    expect(resolveChannelDescriptor(undefined).channel).toBe('email');
    expect(resolveChannelDescriptor('').channel).toBe('email');
  });

  it('normalises case and whitespace', () => {
    expect(resolveChannelDescriptor('  SMS ').channel).toBe('sms');
    expect(resolveChannelDescriptor('WhatsApp').channel).toBe('whatsapp');
  });

  it('never throws for hostile input', () => {
    expect(() => resolveChannelDescriptor('../../etc/passwd')).not.toThrow();
  });
});

describe('C1 — seed isolation', () => {
  it('derives a unique namespace per channel', () => {
    const namespaces = OMNI_COMMS_CHANNEL_CATALOGUE.map((d) => d.seedNamespace);
    expect(new Set(namespaces).size).toBe(namespaces.length);
    for (const d of OMNI_COMMS_CHANNEL_CATALOGUE) {
      expect(d.seedNamespace).toBe(`omni-comms.seed.${d.channel}`);
    }
  });

  it('accepts keys inside the owning namespace', () => {
    expect(isSeedKeyIsolatedTo('omni-comms.seed.email.layout.default', 'email')).toBe(true);
  });

  it('rejects keys from another channel namespace', () => {
    expect(isSeedKeyIsolatedTo('omni-comms.seed.sms.layout.default', 'email')).toBe(false);
    expect(isSeedKeyIsolatedTo('omni-comms.seed.email.layout.default', 'sms')).toBe(false);
  });

  it('rejects unnamespaced or legacy keys', () => {
    expect(isSeedKeyIsolatedTo('layout.default', 'email')).toBe(false);
    expect(isSeedKeyIsolatedTo('comm_hub.seed.email.x', 'email')).toBe(false);
  });

  it('rejects a bare namespace with no key suffix', () => {
    expect(isSeedKeyIsolatedTo(channelSeedNamespace('email'), 'email')).toBe(false);
  });
});
