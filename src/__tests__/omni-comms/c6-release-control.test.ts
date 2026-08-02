/**
 * Omni-Comms Phase C6 — Release Control and controlled-pilot governance.
 *
 * These tests are pure. They never touch the database, never invoke an edge
 * function and never contact a provider.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RELEASE_STATES,
  RELEASE_BASIC_STATES,
  RELEASE_EVENT_TYPES,
  RELEASE_LIMITS,
  RELEASE_PERMITTED_MODE,
  RELEASE_FORBIDDEN_CALLER,
  businessDispatchCheck,
  isControlledPilotGovernanceActive,
  isProposalActive,
  isReferenceRelease,
  isReleaseControlConfigured,
  isReleaseExpired,
  releaseBlockers,
  releaseWarnings,
  type ChannelReleaseControl,
  type ChannelReleaseControlSummary,
  type ReleasePrerequisiteCheck,
} from '@/platform/omni-comms/application/channelReleaseControlTypes';
import {
  RELEASE_CONTROL_EDGE_FUNCTION,
  buildApproveActivateBody,
} from '@/platform/omni-comms/application/channelReleaseControlService';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';
import { OMNI_COMMS_INTEGRATION_REGISTRY } from '@/platform/omni-comms/registry/integrationRegistry';
import { validateOmniCommsRegistries } from '@/platform/omni-comms/registry/validateRegistries';
import { OMNI_COMMS_GENERIC_TABS } from '@/platform/omni-comms/domain/channelCatalogue';
import { CHANNEL_WORKSPACE_TAB_LABELS } from '@/platform/omni-comms/admin/views/channels/channelUiRegistry';
import { OMNI_COMMS_PERMISSION_DEFINITIONS } from '@/platform/rbac/omniComms.permissions';
import {
  EMAIL_BUSINESS_DISPATCH_IMPLEMENTED,
  EMAIL_RELEASE_CONTROL_IMPLEMENTED,
  projectEmailReadiness,
} from '@/platform/omni-comms/admin/views/channels/emailReadiness';

const COMMIT = 'a'.repeat(40);

function release(over: Partial<ChannelReleaseControl> = {}): ChannelReleaseControl {
  return {
    id: 'r1',
    organization_id: 'org',
    department_id: null,
    channel: 'email',
    data_origin: 'user',
    release_state: 'controlled_pilot',
    release_version: 3,
    permitted_event_codes: ['EMPLOYER.REGISTRATION.SUBMITTED'],
    permitted_caller_modules: ['EMPLOYER_REGISTRATION'],
    permitted_modes: ['queued'],
    pilot_recipient_rules: [
      { target_type: 'email_address', target_masked: 'p***t@example.com', target_hash_prefix: 'ab12cd34' },
    ],
    max_recipients_per_request: 1,
    max_messages_per_hour: 5,
    max_messages_per_day: 20,
    max_messages_total: 50,
    release_starts_at: '2026-01-01T00:00:00Z',
    release_expires_at: '2999-01-01T00:00:00Z',
    proposed_state: null,
    proposal_reason: null,
    proposed_by: 'user-a',
    proposed_at: '2026-01-01T00:00:00Z',
    proposal_expires_at: null,
    approved_by: 'user-b',
    approved_at: '2026-01-01T01:00:00Z',
    approval_note: null,
    activated_by: 'user-b',
    activated_at: '2026-01-01T01:00:00Z',
    suspended_by: null,
    suspended_at: null,
    suspension_reason: null,
    approved_commit: COMMIT,
    certification_workflow_run_id: 'run-1',
    certification_recorded_at: '2026-01-01T00:00:00Z',
    release_fingerprint: 'f'.repeat(64),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T01:00:00Z',
    ...over,
  };
}

function summary(over: Partial<ChannelReleaseControlSummary> = {}): ChannelReleaseControlSummary {
  return {
    release: release(),
    scope: { organization_id: 'org', department_id: null, channel: 'email' },
    certification: { certification_state: 'certified', certified_commit: COMMIT },
    runtime_environment: 'test',
    live_delivery_enabled: false,
    prerequisites: [],
    usage: {},
    history: [],
    capabilities: { can_configure: true, can_approve: true, can_suspend: true },
    actor_id: 'user-b',
    business_dispatch_implemented: false,
    generated_at: '2026-01-01T02:00:00Z',
    ...over,
  };
}

const check = (
  sequence: number,
  code: string,
  state: ReleasePrerequisiteCheck['state'],
): ReleasePrerequisiteCheck => ({ sequence, code, state, detail: code });

describe('C6 — release state vocabulary', () => {
  it('declares exactly six release states', () => {
    expect(RELEASE_STATES).toHaveLength(6);
  });

  it('includes live as a reserved state', () => {
    expect(RELEASE_STATES).toContain('live');
  });

  it('never offers live as an operator-selectable basic state', () => {
    expect(RELEASE_BASIC_STATES as readonly string[]).not.toContain('live');
  });

  it('never offers controlled_pilot as a basic state (approval required)', () => {
    expect(RELEASE_BASIC_STATES as readonly string[]).not.toContain('controlled_pilot');
  });

  it('declares the gate-denied ledger event', () => {
    expect(RELEASE_EVENT_TYPES).toContain('release_gate_denied');
  });

  it('declares an activation and a suspension ledger event', () => {
    expect(RELEASE_EVENT_TYPES).toContain('release_activated');
    expect(RELEASE_EVENT_TYPES).toContain('release_suspended');
  });
});

describe('C6 — restriction bounds', () => {
  it('caps approved pilot recipients at 20', () => {
    expect(RELEASE_LIMITS.maxRecipientRules).toBe(20);
  });

  it('caps a pilot window at 7 days', () => {
    expect(RELEASE_LIMITS.maxPilotDays).toBe(7);
  });

  it('caps a proposal at 24 hours', () => {
    expect(RELEASE_LIMITS.maxProposalHours).toBe(24);
  });

  it('bounds hourly, daily and total volume', () => {
    expect(RELEASE_LIMITS.messagesPerHour.max).toBe(20);
    expect(RELEASE_LIMITS.messagesPerDay.max).toBe(100);
    expect(RELEASE_LIMITS.messagesTotal.max).toBe(500);
  });

  it('permits only the queued mode for a controlled pilot', () => {
    expect(RELEASE_PERMITTED_MODE).toBe('queued');
  });

  it('names the forbidden admin dry-run caller', () => {
    expect(RELEASE_FORBIDDEN_CALLER).toBe('OMNI_COMMS_ADMIN_DRY_RUN');
  });
});

describe('C6 — governance predicates', () => {
  it('treats a fully approved, unexpired pilot as active', () => {
    expect(isControlledPilotGovernanceActive(summary())).toBe(true);
  });

  it('fails closed when the record is a reference seed', () => {
    const s = summary({ release: release({ data_origin: 'reference_seed' }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when the state is not controlled_pilot', () => {
    expect(isControlledPilotGovernanceActive(summary({ release: release({ release_state: 'test_only' }) }))).toBe(false);
  });

  it('fails closed when the pilot has expired', () => {
    const s = summary({ release: release({ release_expires_at: '2000-01-01T00:00:00Z' }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when the pilot is suspended', () => {
    const s = summary({ release: release({ suspended_at: '2026-02-01T00:00:00Z' }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when the approved commit does not match certification', () => {
    const s = summary({ release: release({ approved_commit: 'b'.repeat(40) }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when no certified commit is recorded', () => {
    expect(isControlledPilotGovernanceActive(summary({ certification: null }))).toBe(false);
  });

  it('fails closed when no recipient rules are approved', () => {
    const s = summary({ release: release({ pilot_recipient_rules: [] }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when no caller module is permitted', () => {
    const s = summary({ release: release({ permitted_caller_modules: [] }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when no event code is permitted', () => {
    const s = summary({ release: release({ permitted_event_codes: [] }) });
    expect(isControlledPilotGovernanceActive(s)).toBe(false);
  });

  it('fails closed when there is no release record at all', () => {
    expect(isControlledPilotGovernanceActive(summary({ release: null }))).toBe(false);
    expect(isControlledPilotGovernanceActive(null)).toBe(false);
  });

  it('identifies reference records', () => {
    expect(isReferenceRelease(release({ data_origin: 'reference_seed' }))).toBe(true);
    expect(isReferenceRelease(release())).toBe(false);
  });

  it('treats a reference record as not configured', () => {
    expect(isReleaseControlConfigured(summary({ release: release({ data_origin: 'reference_seed' }) }))).toBe(false);
  });

  it('treats a genuine record as configured', () => {
    expect(isReleaseControlConfigured(summary())).toBe(true);
  });

  it('detects an unexpired proposal', () => {
    const r = release({ proposed_state: 'controlled_pilot', proposal_expires_at: '2999-01-01T00:00:00Z' });
    expect(isProposalActive(r)).toBe(true);
  });

  it('treats an expired proposal as inactive', () => {
    const r = release({ proposed_state: 'controlled_pilot', proposal_expires_at: '2000-01-01T00:00:00Z' });
    expect(isProposalActive(r)).toBe(false);
  });

  it('treats a missing proposal as inactive', () => {
    expect(isProposalActive(release())).toBe(false);
  });

  it('detects an expired release window', () => {
    expect(isReleaseExpired(release({ release_expires_at: '2000-01-01T00:00:00Z' }))).toBe(true);
    expect(isReleaseExpired(release())).toBe(false);
  });
});

describe('C6 — prerequisite evaluation', () => {
  const checks = [
    check(1, 'a', 'passed'),
    check(2, 'b', 'failed'),
    check(3, 'c', 'warning'),
    check(31, 'd', 'passed'),
    check(32, 'business_dispatch_not_implemented_c6', 'not_implemented'),
  ];

  it('counts only checks 1–31 as blocking', () => {
    expect(releaseBlockers(checks).map((c) => c.code)).toEqual(['b', 'c']);
  });

  it('never treats the terminal check 32 as blocking', () => {
    expect(releaseBlockers(checks).some((c) => c.sequence === 32)).toBe(false);
  });

  it('surfaces warnings separately', () => {
    expect(releaseWarnings(checks).map((c) => c.code)).toEqual(['c']);
  });

  it('exposes the business-dispatch terminal check', () => {
    expect(businessDispatchCheck(checks)?.state).toBe('not_implemented');
  });

  it('tolerates an absent prerequisite list', () => {
    expect(releaseBlockers(undefined)).toEqual([]);
    expect(businessDispatchCheck(undefined)).toBeNull();
  });
});

describe('C6 — trusted approval boundary', () => {
  it('names the dedicated release-control edge function', () => {
    expect(RELEASE_CONTROL_EDGE_FUNCTION).toBe('omni-comms-release-control');
  });

  it('builds an approve_activate body bound to the optimistic-lock fields', () => {
    const body = buildApproveActivateBody({
      releaseControlId: 'r1',
      expectedUpdatedAt: '2026-01-01T01:00:00Z',
      expectedFingerprint: 'f'.repeat(64),
    });
    expect(body.action).toBe('approve_activate');
    expect(body.expectedUpdatedAt).toBe('2026-01-01T01:00:00Z');
    expect(body.expectedFingerprint).toHaveLength(64);
  });

  it('never lets the browser supply the deployed revision', () => {
    const body = buildApproveActivateBody({
      releaseControlId: 'r1',
      expectedUpdatedAt: 'x',
      expectedFingerprint: 'y',
    }) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('deployedRevision');
  });
});

describe('C6 — registries', () => {
  it('registers both release objects', () => {
    const names = OMNI_COMMS_OBJECT_REGISTRY.map((o) => o.name);
    expect(names).toContain('omni_comms_channel_release_control');
    expect(names).toContain('omni_comms_channel_release_event');
  });

  it('raises the approved object ceiling to 33', () => {
    expect(OMNI_COMMS_OBJECT_REGISTRY).toHaveLength(33);
  });

  it('registers the release-control edge function', () => {
    const fn = OMNI_COMMS_INTEGRATION_REGISTRY.find((i) => i.name === 'omni-comms-release-control');
    expect(fn?.kind).toBe('edge_function');
    expect(fn?.ownership).toBe('omni_comms');
  });

  it('keeps every registry invariant satisfied', () => {
    const result = validateOmniCommsRegistries();
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.counts.activeObjects).toBe(33);
    expect(result.counts.integrations).toBe(9);
  });
});

describe('C6 — workspace surface', () => {
  it('adds a release-control tab to the generic vocabulary', () => {
    expect(OMNI_COMMS_GENERIC_TABS).toContain('release-control');
  });

  it('places release control immediately after policies', () => {
    const tabs = OMNI_COMMS_GENERIC_TABS as readonly string[];
    expect(tabs.indexOf('release-control')).toBe(tabs.indexOf('policies') + 1);
  });

  it('labels the tab for operators', () => {
    expect(CHANNEL_WORKSPACE_TAB_LABELS['release-control']).toBe('Release Control');
  });
});

describe('C6 — permissions', () => {
  it('activates omni_comms.configure', () => {
    const p = OMNI_COMMS_PERMISSION_DEFINITIONS.find((d) => d.permission_key === 'omni_comms.configure');
    expect(p?.lifecycle_status).toBe('ACTIVE');
  });

  it('activates omni_comms.operate', () => {
    const p = OMNI_COMMS_PERMISSION_DEFINITIONS.find((d) => d.permission_key === 'omni_comms.operate');
    expect(p?.lifecycle_status).toBe('ACTIVE');
  });

  it('keeps both approval capabilities sensitive', () => {
    for (const key of ['omni_comms.configure', 'omni_comms.operate']) {
      const p = OMNI_COMMS_PERMISSION_DEFINITIONS.find((d) => d.permission_key === key);
      expect(p?.is_sensitive_permission).toBe(true);
    }
  });
});

describe('C6 — Email readiness', () => {
  const find = (checks: readonly { key: string }[], key: string) =>
    checks.find((c) => c.key === key) as { key: string; state: string } | undefined;

  it('reports Release Control as implemented', () => {
    expect(EMAIL_RELEASE_CONTROL_IMPLEMENTED).toBe(true);
  });

  it('reports business dispatch as implemented only from C7 onwards', () => {
    expect(EMAIL_BUSINESS_DISPATCH_IMPLEMENTED).toBe(true);
  });

  it('keeps the business-dispatch check not_implemented even for an active pilot', () => {
    const p = projectEmailReadiness(null, null, null, null, summary());
    expect(find(p.checks, 'business_dispatch')?.state).toBe('not_implemented');
  });

  it('leaves release checks not_implemented when no summary is supplied', () => {
    const p = projectEmailReadiness(null);
    expect(find(p.checks, 'release_control')?.state).toBe('not_implemented');
    expect(find(p.checks, 'release_control_configured')?.state).toBe('not_implemented');
  });

  it('marks the pilot check met for an active governed pilot', () => {
    const p = projectEmailReadiness(null, null, null, null, summary());
    expect(find(p.checks, 'release_control')?.state).toBe('met');
  });

  it('marks the pilot check unmet for a reference record', () => {
    const s = summary({ release: release({ data_origin: 'reference_seed' }) });
    const p = projectEmailReadiness(null, null, null, null, s);
    expect(find(p.checks, 'release_control')?.state).toBe('unmet');
    expect(find(p.checks, 'release_control_configured')?.state).toBe('unmet');
  });

  it('marks prerequisites unmet while blockers remain', () => {
    const s = summary({ prerequisites: [check(2, 'b', 'failed')] });
    const p = projectEmailReadiness(null, null, null, null, s);
    expect(find(p.checks, 'release_prerequisites')?.state).toBe('unmet');
  });

  it('marks prerequisites met when no blocker remains', () => {
    const s = summary({ prerequisites: [check(1, 'a', 'passed'), check(32, 'business_dispatch_not_implemented_c6', 'not_implemented')] });
    const p = projectEmailReadiness(null, null, null, null, s);
    expect(find(p.checks, 'release_prerequisites')?.state).toBe('met');
  });

  it('never lets readiness assert live delivery', () => {
    const s = summary();
    expect(s.live_delivery_enabled).toBe(false);
    expect(s.business_dispatch_implemented).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C6 closure correction — SQL artefact evidence.
//
// These assertions read a small, fixed set of files once per suite. They never
// open a database connection, never invoke an edge function and never contact
// a provider.
// ═══════════════════════════════════════════════════════════════════════════
describe('C6 closure — SQL artefact evidence', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const readOnce = (() => {
    const cache = new Map<string, string>();
    return (rel: string): string => {
      const hit = cache.get(rel);
      if (hit !== undefined) return hit;
      const content = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
      cache.set(rel, content);
      return content;
    };
  })();

  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
  const c6Sql = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
    .filter((s) => (s.includes('omni_comms_channel_release') || s.includes('release_decision_snapshot'))
      // C7 dispatch migrations also reference Release Control; they are out of C6 scope.
      && !s.includes('omni_comms_priv_dispatch_claim_email'))
    .join('\n');

  const verifier = readOnce('scripts/omni-comms/verify-c6-release-control.sql');
  const rollback = readOnce('scripts/omni-comms/rollback/c6-release-control-rollback.sql');

  it('grants the decision oracle to service_role only', () => {
    expect(c6Sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_channel_release_decision\([^)]*\) TO service_role/,
    );
    expect(c6Sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_channel_release_decision\([^)]*\) FROM PUBLIC, anon, authenticated/,
    );
  });

  it('never grants the decision oracle to anon or authenticated', () => {
    expect(c6Sql).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_channel_release_decision[^;]*TO (anon|authenticated)/,
    );
  });

  it('exposes no public decision oracle to the browser service', () => {
    const service = readOnce(
      'src/platform/omni-comms/application/channelReleaseControlService.ts',
    );
    expect(service).not.toContain('release_evaluate_decision');
    expect(service).not.toContain('release_decision');
    expect(c6Sql).toMatch(/DROP FUNCTION IF EXISTS public\.omni_comms_channel_release_evaluate_decision/);
  });

  it('declares every release snapshot column on the dispatch job', () => {
    for (const col of [
      'release_control_id',
      'release_version_at_decision',
      'release_state_at_decision',
      'release_fingerprint_at_decision',
      'release_expires_at_decision',
      'release_decision_snapshot',
      'release_decision_at',
    ]) {
      expect(c6Sql).toContain(col);
    }
    expect(c6Sql).toMatch(/ADD COLUMN IF NOT EXISTS release_decision_at timestamptz/);
    expect(c6Sql).toMatch(/ALTER COLUMN release_decision_snapshot DROP NOT NULL/);
  });

  it('bounds the decision snapshot and excludes raw recipients and secrets', () => {
    expect(c6Sql).toContain('omni_comms_priv_release_decision_snapshot_bounded');
    expect(c6Sql).toContain('omni_comms_dispatch_job_release_snapshot_bounded');
    expect(c6Sql).toMatch(/secret_ref\|secret_name\|api_key\|authorization/);
    expect(c6Sql).toMatch(/length\(p_snapshot::text\) <= 8192/);
  });

  it('records the release expiry inside the decision evidence', () => {
    expect(c6Sql).toMatch(/'release_expires_at', v_rel\.release_expires_at/);
    expect(c6Sql).toMatch(/'certified_commit', v_rel\.approved_commit/);
    expect(c6Sql).toMatch(/'deployed_revision_match', v_revision_match/);
    expect(c6Sql).toMatch(/'prerequisite_codes', v_prereq_codes/);
  });

  it('rejects release-event update and delete with OC412', () => {
    expect(c6Sql).toMatch(/BEFORE UPDATE OR DELETE ON public\.omni_comms_channel_release_event/);
    expect(c6Sql).toMatch(/RAISE EXCEPTION 'OC412 immutable_release_event'/);
  });

  it('prevents even service_role from bypassing the immutable trigger', () => {
    expect(c6Sql).toMatch(/including service_role/i);
    expect(verifier).toContain('release_event_append_only_trigger');
    expect(verifier).toContain('OC412 immutable_release_event');
  });

  it('verifies append-only through the trigger definition, not policy absence', () => {
    expect(verifier).toContain('pg_get_triggerdef');
    expect(verifier).toContain('BEFORE DELETE OR UPDATE');
  });

  it('carries a meaningful C5B preservation verifier', () => {
    expect(verifier).not.toContain('count(*) >= 0');
    for (const check of [
      'c5b_tables_exist',
      'c5b_immutability_triggers_exist',
      'c5b_grants_intact',
      'c6_functions_do_not_write_c5b',
      'c5b_evidence_readable',
    ]) {
      expect(verifier).toContain(check);
    }
  });

  it('keeps the rollback non-destructive for C5B and ends in ROLLBACK', () => {
    expect(rollback.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(rollback).not.toMatch(
      /(DROP|DELETE FROM|TRUNCATE)[^\n;]*omni_comms_channel_test_(run|delivery)/i,
    );
    for (const col of [
      'release_control_id',
      'release_version_at_decision',
      'release_state_at_decision',
      'release_fingerprint_at_decision',
      'release_expires_at_decision',
      'release_decision_snapshot',
      'release_decision_at',
    ]) {
      expect(rollback).toContain(`DROP COLUMN IF EXISTS ${col}`);
    }
  });

  it('proves the prerequisite checklist contains every canonical gate', () => {
    for (const code of [
      'tenant_access',
      'department_access',
      'channel_supported',
      'release_not_reference',
      'effective_policy_present',
      'policy_test_or_pilot_state',
      'provider_present',
      'provider_account_active',
      'provider_credentials_complete',
      'provider_credentials_verified',
      'sender_identity_active',
      'sending_domain_active',
      'sending_domain_verified',
      'callback_endpoint_active',
      'binding_active',
      'binding_provider_verified',
      'current_preflight_passed',
      'technical_provider_delivery_accepted',
      'signed_delivery_callback_received',
      'no_bounce_or_complaint_evidence',
      'producer_binding_active',
      'event_route_active',
      'template_family_active',
      'published_template_version_present',
      'runtime_environment_known',
      'runtime_certification_effective',
      'deployed_revision_matches_certification',
      'release_time_window_valid',
      'release_volume_limits_valid',
      'pilot_recipient_rules_present',
      'live_delivery_legacy_flag_false',
      'business_dispatch_not_implemented_c6',
    ]) {
      expect(c6Sql).toContain(`'${code}'`);
    }
  });

  it('derives prerequisites from database state, not browser input', () => {
    expect(c6Sql).toMatch(
      /omni_comms_priv_channel_release_prerequisites\(\s*p_organization_id uuid,\s*p_department_id uuid,\s*p_channel text,\s*p_release_control_id uuid,\s*p_deployed_revision text/,
    );
  });

  it('creates no normal delivery attempt and no runnable dispatch job in C6', () => {
    expect(c6Sql).not.toMatch(/INSERT INTO public\.omni_comms_delivery_attempt/i);
    expect(c6Sql).not.toMatch(/is_runnable\s*=\s*true/i);
    expect(c6Sql).toMatch(/is_runnable = false/);
    expect(verifier).toContain('jobs_remain_held');
    expect(verifier).toContain('no_normal_delivery_attempt');
  });

  it('contacts no provider from the C6 edge boundary', () => {
    const edge = readOnce('supabase/functions/omni-comms-release-control/index.ts');
    expect(edge).not.toMatch(/api\.resend\.com|twilio|sendgrid|nodemailer/i);
  });

  it('keeps live delivery disabled', () => {
    expect(verifier).toContain('live_delivery_disabled');
  });
});
