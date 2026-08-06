/**
 * BN Medical Reviews — database certification artefact assertions.
 *
 * These are static guarantees over the harness, the effective-grant
 * verifier, the runner and the trusted CI workflow. Runtime behaviour is
 * proven by executing the harness through
 * `scripts/bn/run-medical-review-db-tests.sh` against the approved Test
 * database (see the `bn-medical-review-integration` workflow).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const harness = read('supabase/tests/bn/medical_review_integration.sql');
const verifier = read('supabase/verify/bn_medical_review_effective_grants.sql');
const runner = read('scripts/bn/run-medical-review-db-tests.sh');
const workflow = read('.github/workflows/bn-medical-review-integration.yml');

const migrations = readdirSync(join(root, 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .map((f) => read(join('supabase', 'migrations', f)))
  .join('\n');

describe('Medical Review harness — transaction safety', () => {
  it('runs inside a rolled-back transaction', () => {
    expect(harness).toMatch(/^BEGIN;/m);
    expect(harness.trimEnd().endsWith('ROLLBACK;')).toBe(true);
    expect(harness).not.toMatch(/^\s*COMMIT;/m);
  });

  it('activates the module only transactionally and restores dark launch', () => {
    expect(harness).toContain("UPDATE public.app_modules SET actions_enabled = true");
    expect(harness).toContain("UPDATE public.app_modules SET actions_enabled = false");
    expect(harness).toContain('module_dark_launched_before_run');
    expect(harness).toContain('module_dark_launched');
  });
});

describe('Medical Review harness — dual execution contexts', () => {
  it('drives business steps as the browser role with JWT claims', () => {
    expect(harness).toContain('SET LOCAL ROLE authenticated');
    expect(harness).toContain("set_config('request.jwt.claims'");
    expect(harness).toContain('RESET ROLE;');
  });

  it('never calls a private helper from an actor context block', () => {
    const actorBlocks = harness
      .split('SET LOCAL ROLE authenticated;')
      .slice(1)
      .map((chunk) => chunk.split('RESET ROLE;')[0]);
    expect(actorBlocks.length).toBeGreaterThan(5);
    for (const block of actorBlocks) {
      expect(block).not.toMatch(/public\._bn_mr_/);
    }
  });

  it('asserts private helpers are unreachable from browser roles', () => {
    expect(harness).toContain('private_helpers_not_executable_by_browser');
  });
});

describe('Medical Review harness — seeded fixtures', () => {
  it('seeds deterministic actors for every persona', () => {
    for (const key of [
      'USER_OFFICER',
      'USER_PREPARER',
      'USER_APPROVER',
      'USER_PROVIDER',
      'USER_SECRETARY',
      'USER_CHAIR',
      'USER_MEMBER',
      'USER_RECUSED',
      'USER_OUTSIDER',
    ]) {
      expect(harness).toContain(key);
    }
  });

  it('seeds its own product, claim, award, policy, board and providers', () => {
    for (const table of [
      'public.bn_product(',
      'public.bn_product_version(',
      'public.bn_claim(',
      'public.bn_award(',
      'public.bn_medical_review_policy(',
      'public.bn_medical_board(',
      'public.bn_medical_provider(',
    ]) {
      expect(harness).toContain(table);
    }
  });

  it('uses the MEETING review mode for the seeded board', () => {
    expect(harness).toMatch(/'MEETING'/);
    expect(harness).not.toMatch(/review_mode[^,\n]*'SESSION'/);
  });
});

describe('Medical Review harness — mandated scenarios', () => {
  const scenarios = [
    'board_direct_without_board_rejected',
    'quorum_below_one_rejected',
    'second_opinion_conflict_rejected',
    'product_timezone_used',
    'officer_generates_obligation',
    'idempotent_replay_returns_original',
    'idempotency_payload_mismatch_rejected',
    'idempotency_key_reuse_rejected',
    'stale_version_rejected',
    'officer_assigns_provider',
    'officer_issues_referral',
    'officer_schedules_appointment',
    'unrelated_officer_denied_detail',
    'unrelated_officer_worklist_empty',
    'unrelated_officer_denied_confidential',
    'provider_worklist_scoped_to_own_referrals',
    'provider_accepts_referral',
    'provider_cannot_reschedule',
    'incomplete_assessment_rejected',
    'provider_saves_typed_draft',
    'provider_submits_assessment',
    'provider_cannot_validate_own_report',
    'officer_validates_report',
    'officer_refers_to_board',
    'secretary_assigns_board_members',
    'secretary_schedules_meeting_session',
    'member_declares_conflict',
    'secretary_records_recusal',
    'recused_member_cannot_vote',
    'recused_member_loses_confidential_access',
    'board_determines_with_quorum',
    'snapshot_stable_after_live_amendment',
    'snapshot_contains_board',
    'binding_determination_departure_rejected',
    'self_approval_blocked',
    'approver_approves_decision',
    'decision_completed',
    'suspension_proposal_created',
    'award_status_unchanged_by_medical_review',
    'no_suspension_event_created',
    'no_payment_impact_created',
    'comm_allowlist_drops_clinical_fields',
    'obligation_terminal_not_reopenable',
    'no_direct_award_mutation_in_mr_commands',
    'legacy_schedule_untouched',
    'audit_trail_written',
  ];

  it.each(scenarios)('covers %s', (scenario) => {
    expect(harness).toContain(scenario);
  });

  it('fails loudly when assertions are missing or failing', () => {
    expect(harness).toContain('BN_MR_HARNESS_RESULT: FAIL');
    expect(harness).toContain('BN_MR_HARNESS_RESULT: PASS');
    expect(harness).toMatch(/v_total < 40/);
  });
});

describe('Medical Review idempotency hardening', () => {
  it('compares semantic payloads and rejects key reuse', () => {
    expect(migrations).toContain('_bn_mr_semantic_payload');
    expect(migrations).toContain('E_IDEMPOTENCY_PAYLOAD_MISMATCH');
    expect(migrations).toContain('E_IDEMPOTENCY_KEY_REUSED');
  });

  it('excludes optimistic-concurrency tokens from the fingerprint', () => {
    expect(migrations).toMatch(/-\s*'version'\s*-\s*'expected_row_version'/);
  });

  it('inserts with conflict detection so concurrent duplicates cannot both apply', () => {
    expect(migrations).toContain('ON CONFLICT (idempotency_key) DO NOTHING');
  });
});

describe('Medical Review effective-grant verifier', () => {
  it('checks tables, private helpers and effective privileges', () => {
    expect(verifier).toContain('has_table_privilege');
    expect(verifier).toContain('has_function_privilege');
    expect(verifier).toContain('UNSAFE EFFECTIVE PRIVILEGES');
  });

  it('requires every command to route through the command actor guard', () => {
    expect(verifier).toContain('_bn_mr_cmd_actor');
  });

  it('asserts the module stays dark-launched', () => {
    expect(verifier).toContain('must stay dark-launched');
  });
});

describe('Medical Review runner and CI workflow', () => {
  it('requires an explicit connection URL and confirmation', () => {
    expect(runner).toContain('BN_TEST_DATABASE_URL');
    expect(runner).toContain('I_UNDERSTAND_THIS_IS_A_TEST_DATABASE');
    expect(runner).toMatch(/set -euo pipefail/);
  });

  it('denies production-looking targets', () => {
    expect(runner).toContain('DENY_PATTERNS');
    expect(runner).toMatch(/prod/);
    expect(runner).toContain('production denylist');
  });

  it('verifies dark launch before and after, and checks for residue', () => {
    expect(runner).toContain('dark-launched before the run');
    expect(runner).toContain('dark-launched after the run');
    expect(runner).toContain('fixture residue');
  });

  it('never echoes the connection URL', () => {
    expect(runner).not.toMatch(/echo[^\n]*\$BN_TEST_DATABASE_URL/);
  });

  /**
   * The workflow was migrated from the dispatch-only hosted-target design to
   * the certified clean-database pattern: a disposable `postgres:15` service
   * container, never a hosted project. It therefore runs on push and pull
   * request, and carries the live-project denylist instead of a protected
   * GitHub environment.
   */
  it('builds a disposable clean database and never targets a hosted project', () => {
    expect(workflow).toContain('workflow_dispatch');
    expect(workflow).toContain('image: postgres:15');
    expect(workflow).toContain('scripts/ci/bootstrap-supabase-test-db.sh');
    expect(workflow).toContain('BN_TEST_LIVE_PROJECT_REF_DENYLIST');
  });

  it('gates on exact PASS markers and both dark-launch postflights', () => {
    expect(workflow).toContain("grep -c 'BN_MR_GRANTS_RESULT: PASS'");
    expect(workflow).toContain("grep -c 'BN_MR_HARNESS_RESULT: PASS'");
    expect(workflow).toContain("grep -c 'BN_MR_ADAPTER_RESULT: PASS'");
    expect(workflow).toContain("actions_enabled FROM public.app_modules WHERE name = 'bn_medical_review'");
    expect(workflow).toContain('bn_medical_review_adapter_postflight.sql');
    expect(workflow).toContain('fixture residue');
  });

  it('runs the expanded focused suites and the typecheck', () => {
    for (const suite of [
      'src/__tests__/bn/medical_reviews_backend.test.ts',
      'src/__tests__/bn/medical_reviews_no_direct_mutation.test.ts',
      'src/__tests__/bn/medical_reviews_db_certification.test.ts',
      'src/__tests__/bn/medical_reviews_service_architecture.test.ts',
      'src/__tests__/bn/servicing/medicalReviewContractParity.test.ts',
      'src/__tests__/bn/servicing/medicalReviewInteractions.test.tsx',
      'src/__tests__/bn/servicing/medicalReviewRouteRender.test.tsx',
      'src/__tests__/bn/award360/medicalReviewWorkspace.test.ts',
    ]) {
      expect(workflow).toContain(suite);
    }
    expect(workflow).toContain('tsc --noEmit -p tsconfig.app.json');
  });
});
