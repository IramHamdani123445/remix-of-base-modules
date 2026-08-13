/**
 * Omni-Comms — TRUE final platform closure (server contract slice).
 *
 * Proves that business meaning survives the trusted boundary:
 *   1. recipientRole is a first-class canonical field (validated, normalised)
 *   2. business resolution context is canonicalized as business meaning only
 *   3. legacy fingerprints are byte-stable (no silent OC409 storm on replay)
 *   4. the browser and Deno canonicalizers stay wire-identical
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  canonicalizeRequest,
  canonicalJsonString,
  CanonicalizationError,
} from '@/platform/omni-comms/runtime/canonicalize';
import { computeRequestFingerprint } from '@/platform/omni-comms/runtime/fingerprint';
import type { SendCommunicationInput } from '@/platform/omni-comms/sendCommunication';

const ORG = '11111111-1111-1111-1111-111111111111';
const PRODUCT = '22222222-2222-2222-2222-222222222222';

function input(overrides: Partial<SendCommunicationInput> = {}): SendCommunicationInput {
  return {
    eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    organizationId: ORG,
    recipients: [{ recipientType: 'external', email: 'A@Example.com' }],
    payload: { claim_reference: 'BN-1' },
    mode: 'queued',
    idempotencyKey: 'omni-event-v2:abcdef1234567890',
    ...overrides,
  };
}

describe('recipient role is a first-class canonical fact', () => {
  it('normalises and carries the semantic role', () => {
    const c = canonicalizeRequest(
      input({
        recipients: [
          { recipientType: 'external', recipientRole: 'Claimant', email: 'a@b.com' },
        ],
      }),
    );
    expect(c.recipients[0].recipientRole).toBe('claimant');
    expect(c.recipients[0].recipientType).toBe('external');
  });

  it('defaults to null rather than inventing a role', () => {
    expect(canonicalizeRequest(input()).recipients[0].recipientRole).toBeNull();
  });

  it('rejects a malformed role instead of persisting it', () => {
    expect(() =>
      canonicalizeRequest(
        input({
          recipients: [
            { recipientType: 'external', recipientRole: 'not a role!', email: 'a@b.com' },
          ],
        }),
      ),
    ).toThrow(CanonicalizationError);
  });
});

describe('business context is business meaning only', () => {
  it('canonicalizes product and offered roles', () => {
    const c = canonicalizeRequest(
      input({ resolutionContext: { productId: PRODUCT, recipientRoles: ['Employer', 'claimant'] } }),
    );
    expect(c.businessContext.productId).toBe(PRODUCT);
    expect(c.businessContext.recipientRoles).toEqual(['claimant', 'employer']);
  });

  it('is empty when the caller supplies no business context', () => {
    const c = canonicalizeRequest(input());
    expect(c.businessContext).toEqual({ productId: null, recipientRoles: [] });
    expect(canonicalJsonString(c)).not.toContain('businessContext');
  });
});

describe('fingerprint continuity', () => {
  it('is byte-stable for pre-v2 requests', async () => {
    const legacy = canonicalizeRequest(input());
    expect(canonicalJsonString(legacy)).toBe(
      JSON.stringify({
        callerContext: { moduleCode: null, entityType: null, entityId: null },
        departmentId: null,
        eventCode: 'BENEFITS.CLAIM.SUBMITTED',
        mode: 'queued',
        organizationId: ORG,
        payload: { claim_reference: 'BN-1' },
        recipients: [
          {
            recipientType: 'external',
            recipientReference: null,
            displayName: null,
            locale: null,
            email: 'a@example.com',
            phone: null,
            pushDestination: null,
          },
        ],
        requestedChannels: [],
      }),
    );
    await expect(computeRequestFingerprint(legacy)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates a request that carries new business meaning', async () => {
    const a = await computeRequestFingerprint(canonicalizeRequest(input()));
    const b = await computeRequestFingerprint(
      canonicalizeRequest(
        input({
          recipients: [
            { recipientType: 'external', recipientRole: 'claimant', email: 'A@Example.com' },
          ],
        }),
      ),
    );
    expect(a).not.toBe(b);
  });
});

describe('browser and edge canonicalizers stay wire-identical', () => {
  const browser = readFileSync('src/platform/omni-comms/runtime/canonicalize.ts', 'utf8');
  const edge = readFileSync('supabase/functions/omni-comms-runtime/canonicalize.ts', 'utf8');

  it('both declare the same new canonical fields', () => {
    for (const src of [browser, edge]) {
      expect(src).toMatch(/recipientRole: string \| null;/);
      expect(src).toMatch(/businessContext: CanonicalBusinessContext;/);
      expect(src).toMatch(/ROLE_RE = \/\^\[a-z\]\[a-z0-9_\]\{0,63\}\$\//);
    }
  });

  it('both hash the role only when present', () => {
    for (const src of [browser, edge]) {
      expect(src).toMatch(/if \(r\.recipientRole\) base\.recipientRole = r\.recipientRole;/);
    }
  });
});

describe('edge runtime persists the new business fields', () => {
  const index = readFileSync('supabase/functions/omni-comms-runtime/index.ts', 'utf8');

  it('sends the immutable business context snapshot', () => {
    expect(index).toMatch(/p_business_context_snapshot: \{/);
    expect(index).toMatch(/product_id: canonical\.businessContext\.productId/);
  });

  it('persists the recipient role from the canonical request', () => {
    expect(index).toMatch(/recipient_role:\s*\n?\s*canonical\.recipients\[r\.inputIndex\]\?\.recipientRole/);
  });
});
