/**
 * Module → Sender Profile assignment layer — unit tests.
 *
 * Pure model + adapter tests. No provider call, no email, no route mutation.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import {
  assignmentLabel,
  moduleCoverageStatus,
  moduleDefaultAssignment,
  moduleProfileReadiness,
  selectableSendersForModule,
  senderOptionLabel,
  type ModuleSenderAssignment,
  type ModuleSenderCoverageRow,
  type ModuleSenderProfileSummary,
} from '@/platform/omni-comms/application/moduleSenderProfileTypes';
import {
  bootstrapModuleSenderProfiles,
  deleteModuleSenderProfile,
  getModuleSenderProfileSummary,
  resolveModuleSenderForEvent,
  setModuleSenderProfileLifecycle,
  upsertModuleSenderProfileDraft,
} from '@/platform/omni-comms/application/moduleSenderProfileService';

const ORG = '11111111-1111-1111-1111-111111111111';
const SENDER = '22222222-2222-2222-2222-222222222222';

function assignment(over: Partial<ModuleSenderAssignment> = {}): ModuleSenderAssignment {
  return {
    id: 'a1',
    organization_id: ORG,
    department_id: null,
    department_name: 'Benefits',
    caller_module_code: 'BENEFITS',
    channel: 'email',
    sender_identity_id: SENDER,
    sender_code: 'benefits_department',
    sender_display_name: 'Benefits Department',
    sender_status: 'active',
    from_address: 'benefits@secureserve.biz',
    domain_name: 'secureserve.biz',
    domain_ready: true,
    provider_account_code: 'resend_pilot',
    provider_account_name: 'Resend — Omni-Comms Pilot',
    provider_account_status: 'active',
    profile_role: 'default',
    communication_class: null,
    is_default: true,
    allow_event_override: true,
    allow_organization_fallback: false,
    status: 'active',
    data_origin: 'system_seed',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    activated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

function moduleRow(over: Partial<ModuleSenderCoverageRow> = {}): ModuleSenderCoverageRow {
  return {
    module_code: 'BENEFITS',
    permission_module: 'benefits',
    module_active: true,
    notes: null,
    assignments: [assignment()],
    routes_total: 3,
    routes_using_default: 3,
    routes_with_override: 0,
    ...over,
  };
}

function rpcSpy(result: unknown = null) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args: args ?? {} });
      return { data: result, error: null };
    }),
  };
  return { client, calls };
}

describe('module sender profile — object registration', () => {
  it('registers the permanent object before use', () => {
    const entry = OMNI_COMMS_OBJECT_REGISTRY.find(
      (o) => o.name === 'omni_comms_module_sender_profile',
    );
    expect(entry).toBeDefined();
    expect(entry?.status).toBe('AVAILABLE');
    expect(entry?.writeAuthority).toBe('admin_rpc');
    expect(entry?.category).toBe('channels_senders_preferences');
  });

  it('does not overload producer-event binding or provider binding', () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        'src/platform/omni-comms/application/moduleSenderProfileService.ts',
      ),
      'utf8',
    );
    expect(src).not.toContain('producer_event_binding');
    expect(src).not.toContain('provider_binding');
  });
});

describe('module sender profile — coverage and readiness model', () => {
  it('reports CONFIGURED when an active default exists', () => {
    expect(moduleCoverageStatus(moduleRow())).toBe('CONFIGURED');
  });

  it('reports NO DEFAULT SENDER when nothing is assigned', () => {
    expect(moduleCoverageStatus(moduleRow({ assignments: [] }))).toBe('NO DEFAULT SENDER');
  });

  it('reports DEFAULT NOT ACTIVE for a draft default', () => {
    expect(
      moduleCoverageStatus(moduleRow({ assignments: [assignment({ status: 'draft' })] })),
    ).toBe('DEFAULT NOT ACTIVE');
  });

  it('reports MODULE INACTIVE for a deactivated caller module', () => {
    expect(moduleCoverageStatus(moduleRow({ module_active: false }))).toBe('MODULE INACTIVE');
  });

  it('module profile readiness requires module, mapping, sender, domain and provider', () => {
    expect(moduleProfileReadiness(moduleRow()).label).toBe('MODULE EMAIL PROFILE READY');
    expect(
      moduleProfileReadiness(moduleRow({ assignments: [assignment({ domain_ready: false })] }))
        .blocker,
    ).toBe('Sending domain is not ready');
    expect(
      moduleProfileReadiness(
        moduleRow({ assignments: [assignment({ provider_account_status: 'draft' })] }),
      ).blocker,
    ).toBe('Provider account is not ready');
    expect(
      moduleProfileReadiness(moduleRow({ assignments: [assignment({ sender_status: 'draft' })] }))
        .blocker,
    ).toBe('Sender address is not active');
  });

  it('module profile readiness never claims event or provider delivery readiness', () => {
    const r = moduleProfileReadiness(moduleRow());
    expect(r.label).not.toContain('EVENT ROUTE');
    expect(r.label).not.toContain('DELIVERY');
  });

  it('resolves the default assignment for the default role only', () => {
    const row = moduleRow({
      assignments: [
        assignment({ id: 'a2', is_default: true, profile_role: 'legal' }),
        assignment({ id: 'a3', is_default: true, profile_role: 'default' }),
      ],
    });
    expect(moduleDefaultAssignment(row)?.id).toBe('a3');
  });

  it('labels assignments and sender options without UUIDs', () => {
    expect(assignmentLabel(assignment())).toBe('Benefits Department');
    expect(
      senderOptionLabel({
        id: SENDER,
        code: 'benefits_department',
        display_name: 'Benefits Department',
        status: 'active',
        department_id: null,
        from_address: 'benefits@secureserve.biz',
        domain_ready: true,
      }),
    ).toBe('Benefits Department — benefits@secureserve.biz');
  });
});

describe('module sender profile — selectable senders', () => {
  const summary: ModuleSenderProfileSummary = {
    organization_id: ORG,
    channel: 'email',
    can_manage: true,
    modules: [moduleRow()],
    assignable_senders: [
      {
        id: SENDER,
        code: 'benefits_department',
        display_name: 'Benefits Department',
        status: 'active',
        department_id: null,
        from_address: 'benefits@secureserve.biz',
        domain_ready: true,
      },
      {
        id: 'fin-1',
        code: 'finance_department',
        display_name: 'Finance Department',
        status: 'active',
        department_id: null,
        from_address: 'finance@secureserve.biz',
        domain_ready: true,
      },
    ],
    generated_at: '2026-01-01T00:00:00Z',
  };

  it('excludes senders already assigned to the module', () => {
    const options = selectableSendersForModule(summary, summary.modules[0]);
    expect(options.map((s) => s.code)).toEqual(['finance_department']);
  });

  it('offers a sender that is not yet assigned to another module row', () => {
    const finance = moduleRow({ module_code: 'FINANCE', assignments: [] });
    const options = selectableSendersForModule(summary, finance);
    expect(options).toHaveLength(2);
  });
});

describe('module sender profile — RPC adapter contract', () => {
  it('reads the coverage summary through the bounded RPC', async () => {
    const { client, calls } = rpcSpy({ modules: [] });
    await getModuleSenderProfileSummary(client, ORG, 'email');
    expect(calls[0].fn).toBe('omni_comms_module_sender_profile_summary');
    expect(calls[0].args).toEqual({ p_organization_id: ORG, p_channel: 'email' });
  });

  it('creates assignments with logical codes only — no hard-coded UUIDs', async () => {
    const { client, calls } = rpcSpy('new-id');
    await upsertModuleSenderProfileDraft(client, {
      organizationId: ORG,
      callerModuleCode: 'BENEFITS',
      channel: 'email',
      senderIdentityId: SENDER,
      isDefault: true,
    });
    expect(calls[0].fn).toBe('omni_comms_module_sender_profile_upsert_draft');
    expect(calls[0].args.p_caller_module_code).toBe('BENEFITS');
    expect(calls[0].args.p_is_default).toBe(true);
    expect(calls[0].args.p_allow_organization_fallback).toBe(false);
    expect(calls[0].args.p_profile_role).toBe('default');
  });

  it('defaults organisation fallback to disabled', async () => {
    const { client, calls } = rpcSpy('id');
    await upsertModuleSenderProfileDraft(client, {
      organizationId: ORG,
      callerModuleCode: 'FINANCE',
      channel: 'email',
      senderIdentityId: 'fin-1',
    });
    expect(calls[0].args.p_allow_organization_fallback).toBe(false);
    expect(calls[0].args.p_allow_event_override).toBe(true);
  });

  it('sends lifecycle actions with optimistic concurrency and a reason', async () => {
    const { client, calls } = rpcSpy({ id: 'a1', status: 'disabled' });
    await setModuleSenderProfileLifecycle(client, {
      id: 'a1',
      expectedUpdatedAt: '2026-01-01T00:00:00Z',
      action: 'disable',
      reason: 'replaced',
    });
    expect(calls[0].fn).toBe('omni_comms_module_sender_profile_set_lifecycle');
    expect(calls[0].args.p_expected_updated_at).toBe('2026-01-01T00:00:00Z');
    expect(calls[0].args.p_reason).toBe('replaced');
  });

  it('deletes only with the expected version', async () => {
    const { client, calls } = rpcSpy({ deleted: true });
    await deleteModuleSenderProfile(client, 'a1', '2026-01-01T00:00:00Z');
    expect(calls[0].fn).toBe('omni_comms_module_sender_profile_delete');
    expect(calls[0].args.p_expected_updated_at).toBe('2026-01-01T00:00:00Z');
  });

  it('previews the bootstrap without applying it', async () => {
    const { client, calls } = rpcSpy({ created: 0, plan: [] });
    await bootstrapModuleSenderProfiles(client, ORG, false);
    expect(calls[0].args.p_apply).toBe(false);
  });

  it('resolves the module default for a new route at configuration time', async () => {
    const { client, calls } = rpcSpy({
      module_code: 'BENEFITS',
      module_default_sender_identity_id: SENDER,
      allow_event_override: true,
    });
    const res = await resolveModuleSenderForEvent(client, ORG, 'event-1', 'email');
    expect(calls[0].fn).toBe('omni_comms_module_sender_profile_resolve');
    expect(res.module_default_sender_identity_id).toBe(SENDER);
  });

  it('surfaces controlled RPC errors (unauthorised cross-module sender)', async () => {
    const client = {
      rpc: vi.fn(async () => ({
        data: null,
        error: { message: 'OC403 permission_denied', details: 'sender_not_authorised_for_module' },
      })),
    };
    await expect(
      upsertModuleSenderProfileDraft(client, {
        organizationId: ORG,
        callerModuleCode: 'BENEFITS',
        channel: 'email',
        senderIdentityId: 'fin-1',
      }),
    ).rejects.toMatchObject({ code: 'OC403', detail: 'sender_not_authorised_for_module' });
  });
});

describe('module sender profile — safety boundaries', () => {
  const files = [
    'src/platform/omni-comms/application/moduleSenderProfileService.ts',
    'src/platform/omni-comms/application/moduleSenderProfileTypes.ts',
    'src/platform/omni-comms/admin/views/channels/senders/ModuleSenderAssignmentsPanel.tsx',
  ];

  it('never imports a provider SDK or the Supabase singleton', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src).not.toContain('@/integrations/supabase/client');
      expect(src).not.toMatch(/from ['"](resend|twilio|nodemailer)['"]/);
    }
  });

  it('never mutates an event route', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src).not.toContain('omni_comms_event_route_upsert_draft');
      expect(src).not.toContain('omni_comms_event_route_set_lifecycle');
    }
  });

  it('never sends, enqueues or dispatches', () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8');
      expect(src).not.toContain('sendCommunication');
      expect(src).not.toContain('omni-comms-dispatch');
    }
  });
});

describe('module sender profile — event route editor integration', () => {
  const routeSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/platform/omni-comms/admin/views/events/EventRoutesTab.tsx'),
    'utf8',
  );

  it('preselects the module default only for new routes', () => {
    expect(routeSrc).toContain('resolveModuleSenderForEvent');
    expect(routeSrc).toContain('if (!state.open || existing || !eventId');
  });

  it('shows the inheritance hint to the operator', () => {
    expect(routeSrc).toContain('oc-route-module-default');
    expect(routeSrc).toContain('module default');
  });
});
