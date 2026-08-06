/**
 * BN Medical Reviews — backend boundary source assertions.
 *
 * These are static guarantees over the applied forward-only migrations and the
 * SQL harness. Runtime RPC behaviour is proven by
 * `supabase/tests/bn/medical_review_integration.sql` in CI (trusted DB role).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * The legacy compatibility hardening migration is certified separately: the
 * Award 360 surfaces read `bn_medical_review_schedule` and
 * `bn_medical_provider_type` directly, so those two tables keep scoped
 * `authenticated` grants behind RLS instead of the RPC-only rule that governs
 * every canonical Medical Review object.
 */
const LEGACY_HARDENING_PATTERN =
  /ALTER TABLE public\.bn_medical_review_schedule ENABLE ROW LEVEL SECURITY/i;

const allMedicalReviewMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && f >= '20260805')
  .filter((f) =>
    readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes('bn_medical_review'),
  );

const legacyHardeningFiles = allMedicalReviewMigrations.filter((f) =>
  LEGACY_HARDENING_PATTERN.test(readFileSync(join(MIGRATIONS_DIR, f), 'utf8')),
);


const migrationFiles = allMedicalReviewMigrations.filter(
  (f) => !legacyHardeningFiles.includes(f),
);

const sql = migrationFiles
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

const legacyHardeningSql = legacyHardeningFiles
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');



const harness = readFileSync(
  join(process.cwd(), 'supabase', 'tests', 'bn', 'medical_review_integration.sql'),
  'utf8',
);

describe('BN Medical Reviews — migration set', () => {
  it('includes the hardening, command, read and registry migrations', () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(5);
    for (const marker of [
      '_bn_mr_validate_policy',
      'bn_medical_review_generate_obligation_v1',
      'bn_medical_review_approve_decision_v1',
      'bn_medical_review_worklist_v1',
      'core_permission_registry',
    ]) {
      expect(sql).toContain(marker);
    }
  });


  it('separates medical from administrative authority', () => {
    expect(sql).toContain('medical_determination_authority');
    expect(sql).toContain('administrative_decision_authority');
    expect(sql).toContain('maker_checker_required');
  });

  it('never executes award or suspension mutations from a Medical Review command', () => {
    expect(sql).not.toMatch(/bn_award_suspension_execute/i);
    expect(sql).not.toMatch(/UPDATE\s+public\.bn_award\s/i);
  });

  it('models Board sessions separately from case assignment', () => {
    expect(sql).toContain('bn_medical_board_session_participation');
    expect(sql).toMatch(/session_id,\s*member_id/);
  });

  it('uses NULLS NOT DISTINCT for wildcard provider approvals', () => {
    expect(sql).toMatch(/bn_medical_provider_approval[\s\S]{0,400}NULLS NOT DISTINCT/i);
  });

  it('enforces active-record uniqueness for the core aggregates', () => {
    for (const idx of [
      'bn_mr_active_referral_uq',
      'bn_mr_active_appointment_uq',
      'bn_mr_active_assessment_uq',
      'bn_mr_active_decision_uq',
      'bn_mr_open_board_case_uq',
      'bn_mr_proposal_uq',
    ]) {
      expect(sql).toContain(idx);
    }
  });

  it('does not hard-code Board or jurisdiction defaults in the resolver', () => {
    const resolver = sql.slice(sql.indexOf('bn_medical_review_board_requirement_v1'));
    expect(resolver).not.toMatch(/America\/St_Kitts/);
    expect(resolver).not.toMatch(/COALESCE\([^)]*,\s*3\s*\)\s*(?:AS|as)\s+quorum/);
  });

  it('keeps the module dark-launched', () => {
    expect(sql).toMatch(/actions_enabled\s*=?\s*(?:=>)?\s*false|actions_enabled[^,]*,\s*false/i);
    expect(sql).not.toMatch(/actions_enabled\s*=\s*true/i);
  });

  it('registers with the shared communication adapter rather than a new one', () => {
    expect(sql).toContain('bn_communication_adapter_source');
    expect(sql).toContain('bn_medical_review_communication_intent');
  });

  it('revokes browser access to every canonical Medical Review object', () => {
    expect(sql).toMatch(/REVOKE ALL[\s\S]{0,200}FROM\s+(PUBLIC|anon|authenticated)/i);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE)[^;]*TO\s+(anon|authenticated)/i);
  });

  it('never alters the legacy schedule table from a canonical migration', () => {
    expect(sql).not.toMatch(/(ALTER|DROP)\s+TABLE\s+(public\.)?bn_medical_review_schedule/i);
  });
});

describe('BN Medical Reviews — legacy compatibility hardening', () => {
  it('is applied in exactly one dedicated migration', () => {
    expect(legacyHardeningFiles).toHaveLength(1);
  });

  it('removes anonymous access to both legacy tables', () => {
    for (const table of ['bn_medical_provider_type', 'bn_medical_review_schedule']) {
      expect(legacyHardeningSql).toMatch(
        new RegExp(`REVOKE ALL ON public\\.${table} FROM [^;]*anon`, 'i'),
      );
    }
    expect(legacyHardeningSql).not.toMatch(/GRANT[^;]*TO\s+[^;]*\banon\b/i);
  });

  it('keeps reference data read-only and never grants DELETE to browsers', () => {
    expect(legacyHardeningSql).toMatch(
      /GRANT SELECT ON public\.bn_medical_provider_type TO authenticated/i,
    );
    expect(legacyHardeningSql).toMatch(
      /GRANT SELECT, INSERT, UPDATE ON public\.bn_medical_review_schedule TO authenticated/i,
    );
    expect(legacyHardeningSql).not.toMatch(/GRANT[^;]*DELETE[^;]*TO\s+authenticated/i);
  });

  it('places both legacy tables behind row level security with policies', () => {
    for (const table of ['bn_medical_provider_type', 'bn_medical_review_schedule']) {
      expect(legacyHardeningSql).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'),
      );
      expect(legacyHardeningSql).toMatch(
        new RegExp(`CREATE POLICY[\\s\\S]{0,200}ON public\\.${table}`, 'i'),
      );
    }
  });
});


describe('BN Medical Reviews — SQL harness', () => {
  it('runs inside a rolled-back transaction', () => {
    expect(harness).toMatch(/^BEGIN;/m);
    expect(harness.trimEnd().endsWith('ROLLBACK;')).toBe(true);
  });

  it('covers the mandated verification scenarios', () => {
    for (const check of [
      'board_direct_without_board_rejected',
      'quorum_below_one_rejected',
      'second_opinion_conflict_rejected',
      'snapshot_stable_after_live_amendment',
      'product_timezone_used',
      'snapshot_contains_board',
      'wildcard_approval_uniqueness',
      'provider_conflict_detected',
      'assigning_provider_a_has_no_conflict',
      'comm_allowlist_drops_clinical_fields',
      'obligation_terminal_not_reopenable',
      'no_direct_award_mutation_in_mr_commands',
      'private_helpers_not_executable_by_browser',
      'module_dark_launched',
      'legacy_schedule_untouched',
    ]) {
      expect(harness).toContain(check);
    }
  });
});
