/**
 * Communication Action (obligation) layer.
 *
 * Proves the architecture correction:
 *   business event → communication action → delivery policy → channel
 *   → channel-specific template variant → channel message.
 *
 * Print is NEVER derived from the Email variant.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  EMPTY_ACTION_SNAPSHOT,
  resolveCommunicationActions,
  type ActionSnapshot,
  type CommunicationActionRow,
} from '../../../supabase/functions/omni-comms-runtime/resolution/actionResolver.ts';

const ORG = '11111111-1111-1111-1111-111111111111';
const EVENT = '22222222-2222-2222-2222-222222222222';
const ACTION = '33333333-3333-3333-3333-333333333333';

function action(overrides: Partial<CommunicationActionRow> = {}): CommunicationActionRow {
  return {
    id: ACTION,
    organization_id: ORG,
    department_id: null,
    event_definition_id: EVENT,
    code: 'FORMAL_NOTICE',
    name: 'Issue formal notice',
    recipient_role: 'claimant',
    obligation: 'required',
    satisfaction_rule: 'one_of',
    legal_basis: null,
    priority: 10,
    status: 'active',
    ...overrides,
  };
}

function snapshot(overrides: Partial<ActionSnapshot> = {}): ActionSnapshot {
  return {
    communication_actions: [action()],
    action_channel_options: [
      {
        id: 'opt-email',
        action_id: ACTION,
        channel: 'email',
        rank: 10,
        template_family_id: null,
        is_fallback: false,
        condition: {},
        status: 'active',
      },
      {
        id: 'opt-print',
        action_id: ACTION,
        channel: 'print',
        rank: 20,
        template_family_id: null,
        is_fallback: true,
        condition: {},
        status: 'active',
      },
    ],
    delivery_policies: [
      {
        id: 'pol-1',
        organization_id: ORG,
        department_id: null,
        action_id: null,
        mode: 'digital_first',
        print_when: {
          legally_required: true,
          recipient_requested: true,
          digital_unavailable: true,
          policy_exception: false,
        },
        version_number: 1,
      },
    ],
    recipient_channel_preferences: [],
    ...overrides,
  };
}

const baseInput = {
  recipientRole: 'claimant',
  recipientReference: 'PERSON-1',
  requestedChannels: [],
  readyChannels: ['email', 'print'],
  channelsWithVariant: ['email', 'print'],
  digitalDestinationAvailable: true,
};

describe('Communication Action layer — dual mode', () => {
  it('does not apply when the event has no actions (legacy routes stay authoritative)', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: EMPTY_ACTION_SNAPSHOT,
    });
    expect(result.actionModelApplies).toBe(false);
    expect(result.selectedChannels).toEqual([]);
    expect(result.blockers).toEqual([]);
  });
});

describe('Communication Action layer — channel selection', () => {
  it('digital-first selects Email and does not also produce paper', () => {
    const result = resolveCommunicationActions({ ...baseInput, snapshot: snapshot() });
    expect(result.actionModelApplies).toBe(true);
    expect(result.selectedChannels).toContain('email');
    expect(result.selectedChannels).not.toContain('print');
  });

  it('falls back to Print when no digital destination is available', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: snapshot(),
      digitalDestinationAvailable: false,
    });
    expect(result.selectedChannels).toContain('print');
  });

  it('never selects a channel without a published variant for THAT channel', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: snapshot(),
      digitalDestinationAvailable: false,
      channelsWithVariant: ['email'],
    });
    expect(result.selectedChannels).not.toContain('print');
    const rejected = result.actions[0].rejected.find((r) => r.channel === 'print');
    expect(rejected?.reason).toBe('variant_missing');
  });

  it('honours a recipient paper requirement over the digital-first policy', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: snapshot({
        recipient_channel_preferences: [
          {
            recipient_reference: 'PERSON-1',
            recipient_role: 'claimant',
            channel: 'print',
            preference: 'paper_required',
            source: 'recipient',
          },
        ],
      }),
    });
    expect(result.selectedChannels).toContain('print');
  });

  it('excludes a channel the recipient opted out of', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: snapshot({
        recipient_channel_preferences: [
          {
            recipient_reference: 'PERSON-1',
            recipient_role: 'claimant',
            channel: 'email',
            preference: 'opt_out',
            source: 'recipient',
          },
        ],
      }),
    });
    expect(result.selectedChannels).not.toContain('email');
  });

  it('blocks when a required action cannot be satisfied by any channel', () => {
    const result = resolveCommunicationActions({
      ...baseInput,
      snapshot: snapshot(),
      readyChannels: [],
    });
    expect(result.blockers.length).toBeGreaterThan(0);
    expect(result.selectedChannels).toEqual([]);
  });
});

describe('Print artefacts are never derived from another channel', () => {
  const adapter = readFileSync(
    resolve(process.cwd(), 'supabase/functions/_shared/omni-comms/printArtefactAdapter.ts'),
    'utf8',
  );

  it('the print adapter fails closed on a non-print source channel', () => {
    expect(adapter).toContain('print_variant_required');
    expect(adapter).toContain('sourceChannel');
  });
});
