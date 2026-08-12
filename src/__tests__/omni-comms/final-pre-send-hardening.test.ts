/**
 * Omni-Comms — FINAL pre-send hardening.
 *
 * Static, read-only assertions over the trusted boundaries. Nothing here
 * contacts a provider, claims a job or creates a delivery attempt.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildControlledSendBody,
  buildHeldPilotCandidateBody,
} from '@/platform/omni-comms/application/channelReleaseControlService';
import {
  buildModuleEnablementMatrix,
  sendingModules,
} from '@/platform/omni-comms/admin/views/channels/moduleEnablementMatrix';
import type { ProducerEventBinding } from '@/platform/omni-comms/application/producerIntegrationsTypes';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const RELEASE_FN = read('supabase/functions/omni-comms-release-control/index.ts');
const DISPATCH_FN = read('supabase/functions/omni-comms-dispatch/index.ts');
const TAB = read('src/platform/omni-comms/admin/views/channels/ChannelReleaseControlTab.tsx');

const binding = (over: Partial<ProducerEventBinding>): ProducerEventBinding => ({
  id: 'b', organization_id: 'o', department_id: null,
  caller_module_code: 'BENEFITS', event_definition_id: 'e',
  event_code: 'BENEFITS.CLAIM.SUBMITTED', event_name: 'Claim', event_module_code: 'BENEFITS',
  event_status: 'active', allowed_modes: ['queued'], status: 'active',
  integration_reference: null, lifecycle_reason: null, updated_at: 'now',
  activated_at: 'now', ...over,
});

describe('held-pilot candidate tenant isolation', () => {
  it('resolves the candidate through the scope-validated server RPC only', () => {
    expect(RELEASE_FN).toContain('omni_comms_priv_held_pilot_candidate');
    // No browser-scoped table read remains on this action.
    expect(RELEASE_FN).not.toContain(".from('omni_comms_dispatch_job')");
  });

  it('refuses a scope the actor may not operate', () => {
    expect(RELEASE_FN).toContain('held_candidate_scope_not_permitted');
  });

  it('never returns a raw recipient', () => {
    expect(RELEASE_FN).not.toContain('destination.email');
    expect(buildHeldPilotCandidateBody('o', 'd')).toHaveProperty('departmentId', 'd');
  });
});

describe('certification authority', () => {
  it('requires the server-side authority predicate', () => {
    expect(RELEASE_FN).toContain('omni_comms_priv_certification_authority');
    expect(RELEASE_FN).toContain('certification_authority_required');
  });

  it('never accepts a browser-supplied revision', () => {
    expect(RELEASE_FN).toContain("body.action === 'certify_deployment'");
    expect(RELEASE_FN).toContain('OMNI_COMMS_DEPLOYED_REVISION');
  });
});

describe('exact-release controlled dispatch', () => {
  it('lets the browser name only the release control', () => {
    expect(buildControlledSendBody('rel-1')).toEqual({
      action: 'release_one_controlled_message',
      releaseControlId: 'rel-1',
    });
    expect(JSON.stringify(buildControlledSendBody('rel-1'))).not.toContain('job');
  });

  it('resolves the job server-side through the preflight', () => {
    expect(RELEASE_FN).toContain('omni_comms_priv_release_controlled_send_preflight');
    expect(RELEASE_FN).toContain('expectedJobId: preflight.job_id');
  });

  it('binds the dispatcher tick to the exact release and job', () => {
    expect(DISPATCH_FN).toContain('p_release_control_id: releaseControlId');
    expect(DISPATCH_FN).toContain('p_expected_job_id: expectedJobId');
  });

  it('accepts the internal ticket only with the service-role credential', () => {
    expect(DISPATCH_FN).toContain('authHeader.slice(7).trim() === SERVICE_ROLE');
    expect(DISPATCH_FN).toContain("x-omni-comms-dispatch-ticket");
    expect(DISPATCH_FN).toContain('internal_dispatch_ticket_invalid');
  });

  it('keeps the public allow-list at exactly two keys', () => {
    expect(DISPATCH_FN).toContain('["batchLimit", "correlationId"]');
    expect(DISPATCH_FN).toContain('caller_supplied_dispatch_input_forbidden');
  });

  it('never enables live delivery', () => {
    expect(DISPATCH_FN).toContain('live_delivery_enabled: false');
    expect(RELEASE_FN).toContain('live_delivery_enabled: false');
  });
});

describe('pre-send confirmation and counters', () => {
  it('renders a server-derived confirmation before the send is possible', () => {
    expect(TAB).toContain('Final pre-send confirmation');
    expect(TAB).toContain('confirmOnly: true');
    expect(TAB).toContain("preSend?.ok !== true");
  });
});

describe('module enablement truth', () => {
  const rows = buildModuleEnablementMatrix([
    binding({}),
    binding({ id: 'c', caller_module_code: 'EMPLOYER_REGISTRATION',
      allowed_modes: ['dry_run', 'shadow'], event_code: 'EMPLOYER.REG.SUBMITTED' }),
    binding({ id: 'r', caller_module_code: 'LEGAL', status: 'retired' }),
  ]);

  it('authorises exactly one sending module for the first production proof', () => {
    expect(sendingModules(rows)).toEqual(['BENEFITS']);
  });

  it('keeps Employer Registration non-sending', () => {
    const employer = rows.find((r) => r.moduleCode === 'EMPLOYER_REGISTRATION');
    expect(employer?.canSendBusinessEmail).toBe(false);
    expect(employer?.statement).toMatch(/Non-sending/);
  });

  it('states plainly when a module is not integrated', () => {
    expect(rows.find((r) => r.moduleCode === 'FINANCE')?.statement)
      .toMatch(/Not integrated/);
  });

  it('never treats a retired binding as enabled', () => {
    expect(rows.find((r) => r.moduleCode === 'LEGAL')?.status).toBe('not_integrated');
  });
});
