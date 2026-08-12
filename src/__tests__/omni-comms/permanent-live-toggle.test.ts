/**
 * OMNI-COMMS — Permanent LIVE toggle closure.
 *
 * Production LIVE is not a pilot: turning automatic Email delivery ON must
 * produce a release with NO expiry, running until it is explicitly turned
 * OFF/suspended or invalidated by a genuine safety gate. Controlled pilots
 * keep their mandatory bounded window.
 *
 * These assertions read the deployed SQL sources (migration text) and the
 * client-side release semantics. No provider is contacted and no Email is
 * sent by this suite.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isReleaseExpired,
  isProposalActive,
  type ChannelReleaseControl,
} from '@/platform/omni-comms/application/channelReleaseControlTypes';
import { buildDeliveryRequestBody } from '@/platform/omni-comms/application/deliveryToggleService';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../supabase/migrations');

function readMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
}

/** Latest definition of a given SQL function across the migration history. */
function latestFunctionBody(name: string): string {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const hits = readMigrations().filter((sql) => sql.includes(marker));
  expect(hits.length, `no migration defines ${name}`).toBeGreaterThan(0);
  const last = hits[hits.length - 1];
  return last.slice(last.indexOf(marker));
}

const LIVE_REQUEST = latestFunctionBody('omni_comms_priv_live_delivery_request');

function release(patch: Partial<ChannelReleaseControl>): ChannelReleaseControl {
  return {
    release_state: 'live',
    release_expires_at: null,
    proposed_state: null,
    proposal_expires_at: null,
    ...(patch as object),
  } as ChannelReleaseControl;
}

describe('permanent LIVE toggle — release lifetime', () => {
  it('LIVE preparation sets no release expiry', () => {
    expect(LIVE_REQUEST).toMatch(/release_expires_at\s*=\s*NULL/);
    expect(LIVE_REQUEST).not.toMatch(/release_expires_at\s*=\s*now\(\)\s*\+\s*interval\s*'7 days'/);
  });

  it('LIVE preparation does not invent an effectively unlimited lifetime number', () => {
    expect(LIVE_REQUEST).not.toMatch(/interval\s*'\d+\s*(year|years|days)'/);
  });

  it('LIVE preparation keeps the production volume ladder', () => {
    expect(LIVE_REQUEST).toMatch(/max_recipients_per_request\s*=\s*1/);
    expect(LIVE_REQUEST).toMatch(/max_messages_per_hour[^\n]*20/);
    expect(LIVE_REQUEST).toMatch(/max_messages_per_day[^\n]*100/);
    expect(LIVE_REQUEST).toMatch(/max_messages_total\s*=\s*NULL/);
  });

  it('keeps the pending approval governed by a 24 hour proposal expiry', () => {
    expect(LIVE_REQUEST).toMatch(/proposal_expires_at\s*=\s*now\(\)\s*\+\s*interval\s*'24 hours'/);
  });

  it('turning OFF suspends and never deletes evidence', () => {
    const disable = LIVE_REQUEST.slice(
      LIVE_REQUEST.indexOf("IF p_intent = 'disable'"),
      LIVE_REQUEST.indexOf("IF NOT (public.has_permission"),
    );
    expect(disable).toMatch(/release_state\s*=\s*'suspended'/);
    expect(disable).toMatch(/release_suspended/);
    expect(disable).not.toMatch(/\bDELETE\b/i);
  });

  it('re-enabling after OFF re-enters the maker/checker proposal path', () => {
    expect(LIVE_REQUEST).toMatch(/release_state IN \('test_only','controlled_pilot','suspended'\)/);
    expect(LIVE_REQUEST).toMatch(/proposed_state\s*=\s*'live'/);
    expect(LIVE_REQUEST).toMatch(/approved_by\s*=\s*NULL/);
    expect(LIVE_REQUEST).toMatch(/'awaiting_approval'/);
    expect(LIVE_REQUEST).toMatch(/'approve_ready'/);
  });
});

describe('permanent LIVE toggle — controlled pilot unchanged', () => {
  const GUARD = latestFunctionBody('omni_comms_priv_channel_release_control_guard');

  it('controlled pilot still requires an expiry', () => {
    expect(GUARD).toMatch(/release_expiry_required_for_controlled_pilot/);
  });

  it('controlled pilot longer than the permitted window is rejected', () => {
    expect(GUARD).toMatch(/release_window_exceeds_seven_days/);
  });

  it('controlled pilot still requires recipient rules', () => {
    expect(GUARD).toMatch(/release_recipient_rules_required/);
  });
});

describe('permanent LIVE toggle — decision and dispatch gates', () => {
  const DECISION = latestFunctionBody('omni_comms_priv_channel_release_decision');
  const DISPATCH = latestFunctionBody('omni_comms_priv_dispatch_claim_email');
  const PREREQ = latestFunctionBody('omni_comms_priv_channel_release_prerequisites');

  it('a NULL expiry is not treated as expired for LIVE', () => {
    expect(DECISION).toMatch(
      /v_live AND v_rel\.release_expires_at IS NOT NULL[\s\S]{0,80}release_expired/,
    );
  });

  it('a NULL expiry is still expiry-checked for non-live releases', () => {
    expect(DECISION).toMatch(
      /NOT v_live AND \(v_rel\.release_expires_at IS NULL OR v_rel\.release_expires_at <= now\(\)\)/,
    );
  });

  it('the dispatcher (used by the scheduler tick) accepts a NULL decision expiry', () => {
    expect(DISPATCH).toMatch(/release_expires_at_decision IS NOT NULL/);
  });

  it('the prerequisite time-window check passes for a live release with no expiry', () => {
    expect(PREREQ).toMatch(
      /v_live THEN CASE WHEN v_rel\.release_expires_at IS NULL OR v_rel\.release_expires_at > now\(\)/,
    );
  });
});

describe('permanent LIVE toggle — client semantics', () => {
  it('a live release with no expiry never reads as expired, even years later', () => {
    const live = release({ release_state: 'live', release_expires_at: null });
    expect(isReleaseExpired(live, new Date('2026-08-20T00:00:00Z'))).toBe(false);
    expect(isReleaseExpired(live, new Date('2036-08-20T00:00:00Z'))).toBe(false);
  });

  it('a pilot window in the past still reads as expired', () => {
    expect(
      isReleaseExpired(
        release({ release_state: 'controlled_pilot', release_expires_at: '2000-01-01T00:00:00Z' }),
        new Date('2026-08-12T00:00:00Z'),
      ),
    ).toBe(true);
  });

  it('an unapproved proposal still lapses after its own 24 hour window', () => {
    const proposed = release({
      release_state: 'test_only',
      proposed_state: 'live',
      proposal_expires_at: '2026-08-13T00:00:00Z',
    });
    expect(isProposalActive(proposed, new Date('2026-08-12T12:00:00Z'))).toBe(true);
    expect(isProposalActive(proposed, new Date('2026-08-14T00:00:00Z'))).toBe(false);
  });

  it('the operator control still sends only scope and intent (no pilot window)', () => {
    const body = buildDeliveryRequestBody({ organizationId: 'org-1', intent: 'enable' });
    expect(JSON.stringify(body)).not.toMatch(/expire|window|pilot/i);
  });
});
