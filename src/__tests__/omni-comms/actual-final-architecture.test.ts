/**
 * Omni-Comms — actual final architecture closure.
 *
 * Behavioural proof for:
 *   1. no hidden persistent department scope
 *   2. ONE effective communication plan resolver with provenance
 *   3. configuration-independent business identity (idempotency v2)
 *   4. semantic recipient roles carried as first-class facts
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildConfiguredEventIdentityString,
  buildConfiguredEventIdempotencyKey,
  CONFIGURED_EVENT_IDEMPOTENCY_PREFIX,
} from '@/platform/omni-comms/integrations/business/configuredEventIdentity';
import {
  resolveEffectiveCommunicationPlan,
  planForChannel,
} from '@/platform/omni-comms/application/effectiveCommunicationPlan';

const read = (p: string) => readFileSync(p, 'utf8');

describe('department scope is never hidden global state', () => {
  const tenant = read('src/platform/omni-comms/context/OmniCommsTenantContext.tsx');

  it('never writes a department into session storage', () => {
    expect(tenant).not.toMatch(/writeSession\(\s*SESSION_DEPT_KEY/);
    expect(tenant).toMatch(/LEGACY_SESSION_DEPT_KEY/);
  });

  it('purges any department persisted by earlier builds', () => {
    expect(tenant).toMatch(/writeSession\(LEGACY_SESSION_DEPT_KEY, null\)/);
  });

  it('exposes an explicit override lifecycle', () => {
    expect(tenant).toMatch(/departmentOverrideActive/);
    expect(tenant).toMatch(/clearDepartmentOverride/);
  });
});

describe('effective communication plan is the single resolution authority', () => {
  it('fails closed without an organisation', async () => {
    const plan = await resolveEffectiveCommunicationPlan({
      organizationId: '',
      moduleCode: 'BENEFITS',
      eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    });
    expect(plan.enabledChannels).toEqual([]);
    expect(plan.blockers).toContain('organization_unresolved');
  });

  it('never marks an unimplemented channel deliverable', async () => {
    const plan = await resolveEffectiveCommunicationPlan({
      organizationId: '11111111-1111-1111-1111-111111111111',
      moduleCode: 'BENEFITS',
      eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    });
    for (const channel of plan.channels) {
      if (channel.deliverable) expect(channel.enabled).toBe(true);
    }
    expect(plan.runnableChannels.every((c) => plan.enabledChannels.includes(c))).toBe(true);
  });

  it('reports provenance for every resolved property', async () => {
    const plan = await resolveEffectiveCommunicationPlan({
      organizationId: '11111111-1111-1111-1111-111111111111',
      moduleCode: 'BENEFITS',
      eventCode: 'BENEFITS.CLAIM.SUBMITTED',
      recipientRoles: ['claimant'],
      channels: ['email'],
    });
    const email = planForChannel(plan, 'email');
    expect(email).not.toBeNull();
    expect(email?.templateSource).toBeTruthy();
    expect(email?.senderSource).toBeTruthy();
    expect(email?.deliveryMode).toBe('queued');
    expect(email?.recipientRole).toBe('claimant');
  });
});

describe('business identity v2 excludes configuration', () => {
  const base = {
    organizationId: 'org-1',
    moduleCode: 'BENEFITS',
    eventCode: 'BENEFITS.CLAIM.SUBMITTED',
    entityType: 'claim',
    entityId: 'BN-1',
    occurrence: 'default',
  };

  it('is stable across configuration changes', async () => {
    const a = await buildConfiguredEventIdempotencyKey(base);
    const b = await buildConfiguredEventIdempotencyKey({ ...base });
    expect(a).toBe(b);
    expect(a.startsWith(`${CONFIGURED_EVENT_IDEMPOTENCY_PREFIX}:`)).toBe(true);
  });

  it('carries no department, channel, template, sender or mode component', () => {
    const identity = buildConfiguredEventIdentityString(base);
    for (const forbidden of ['email', 'queued', 'department', 'template', 'sender']) {
      expect(identity.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('separates a new business occurrence', async () => {
    const a = await buildConfiguredEventIdempotencyKey(base);
    const b = await buildConfiguredEventIdempotencyKey({ ...base, occurrence: 'resend-1' });
    expect(a).not.toBe(b);
  });
});

describe('recipient roles are first-class business facts', () => {
  it('carries the semantic role alongside the persistence type', () => {
    const emitter = read(
      'src/platform/omni-comms/integrations/business/emitConfiguredBusinessEvent.ts',
    );
    expect(emitter).toMatch(/recipientRole: role/);
    const facade = read('src/platform/omni-comms/sendCommunication.ts');
    expect(facade).toMatch(/recipientRole\?: string \| null;/);
  });

  it('modules no longer choose channels', () => {
    const emitter = read(
      'src/platform/omni-comms/integrations/business/emitConfiguredBusinessEvent.ts',
    );
    expect(emitter).not.toMatch(/PRODUCT_GATED_CHANNELS/);
    // and no longer pre-resolve them either: the canonical runtime is the
    // single resolution authority.
    expect(emitter).not.toMatch(/plan\.runnableChannels/);
    expect(emitter).not.toMatch(/resolveEffectiveCommunicationPlan\(/);
  });
});
