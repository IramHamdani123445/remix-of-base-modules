/**
 * Omni-Comms — production Release Control closure.
 *
 * Source-level proof for the environment/certification separation, the
 * single-message pilot preset, the atomic held-job authorization and the
 * write-once release snapshot. These tests read source only: they send
 * nothing, invoke no dispatcher and contact no provider.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

const MIGRATION = read(
  'supabase/migrations/20260812121420_a9c7a006-8845-4e3d-aedf-0e858b8452f1.sql',
);
const EDGE = read('supabase/functions/omni-comms-release-control/index.ts');
const DISPATCH = read('supabase/functions/omni-comms-dispatch/index.ts');
const POSTURE = read('src/platform/omni-comms/admin/posture/omniCommsPosture.ts');

describe('runtime environment authority', () => {
  it('confirmation is service-role only and never reachable from the browser', () => {
    expect(MIGRATION).toMatch(
      /REVOKE ALL ON FUNCTION public\.omni_comms_priv_confirm_runtime_environment[\s\S]*FROM anon, authenticated/,
    );
    expect(MIGRATION).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.omni_comms_priv_confirm_runtime_environment[\s\S]*TO service_role/,
    );
  });

  it('only production or non_production may be confirmed', () => {
    expect(MIGRATION).toContain(
      "IF v_env NOT IN ('production', 'non_production') THEN",
    );
  });

  it('confirmation requires privileged capability and records an audit event', () => {
    expect(MIGRATION).toContain("has_permission(p_actor_id, 'omni_comms', 'operate')");
    expect(MIGRATION).toContain("has_permission(p_actor_id, 'omni_comms', 'configure')");
    expect(MIGRATION).toContain('INSERT INTO public.omni_comms_runtime_environment_event');
  });

  it('the browser cannot classify itself as non-production', () => {
    // Host inspection may only ever escalate to production.
    expect(POSTURE).not.toMatch(/return 'non_production';/);
    expect(POSTURE).toMatch(/if \(OMNI_COMMS_PRODUCTION_HOSTS\.includes\(host\)\) return 'production';\s*\n\s*return 'unknown';/);
  });

  it('the Edge boundary refuses an unverified non-production claim', () => {
    expect(EDGE).toContain('non_production_classification_unverified');
    expect(EDGE).toContain('OMNI_COMMS_ENVIRONMENT_HINT');
  });

  it('environment confirmation never enables delivery', () => {
    expect(EDGE).toContain('live_delivery_enabled: false');
  });
});

describe('deployment certification', () => {
  it('production certification is no longer blocked', () => {
    expect(MIGRATION).not.toContain(
      'certification may only be recorded in a non_production environment',
    );
    expect(MIGRATION).toContain(
      "IF v_env NOT IN ('production', 'non_production') THEN\n      RAISE EXCEPTION 'omni_comms: runtime environment must be resolved before certification'",
    );
  });

  it('an unknown environment fails closed', () => {
    expect(MIGRATION).toContain('runtime environment must be resolved before certification');
  });

  it('an exact full 40-character SHA is required and must equal the deployed revision', () => {
    expect(MIGRATION).toContain("v_commit !~ '^[0-9a-f]{40}$'");
    expect(MIGRATION).toContain("v_deployed !~ '^[0-9a-f]{40}$' OR v_deployed <> v_commit");
  });

  it('the revision is never accepted from the browser', () => {
    expect(EDGE).toContain('OMNI_COMMS_DEPLOYED_REVISION');
    expect(EDGE).not.toMatch(/body\.(deployedRevision|revision)\b/);
  });

  it('a runtime/dispatcher revision divergence is reported, not certified', () => {
    expect(EDGE).toContain('deployment_revision_mismatch');
    expect(DISPATCH).toMatch(/endsWith\("\/health"\)/);
  });

  it('the release prerequisite fails when the environment is unknown', () => {
    expect(MIGRATION).toContain(
      "'code','runtime_environment_known','state',CASE WHEN coalesce(v_env,'unknown') IN ('production','non_production')",
    );
  });
});

describe('safe test remains non-production only', () => {
  it('safe test availability is still gated on non_production', () => {
    expect(POSTURE).toContain("input.environment === 'non_production' &&");
    expect(POSTURE).toContain(
      'The safe dry test is not offered in production.',
    );
  });
});

describe('single-message pilot preset', () => {
  it('sets 1 / 1 / 1 / 1', async () => {
    const mod = await import('@/platform/omni-comms/application/releasePilotPresets');
    expect(mod.SINGLE_MESSAGE_PILOT_PRESET).toEqual({
      perRequest: '1', perHour: '1', perDay: '1', total: '1',
    });
    expect(
      mod.applySingleMessagePilotPreset({
        perRequest: '9', perHour: '9', perDay: '9', total: '9',
      }),
    ).toEqual({ perRequest: '1', perHour: '1', perDay: '1', total: '1' });
    expect(
      mod.isSingleMessagePilot({
        maxRecipientsPerRequest: 1,
        maxMessagesPerHour: 1,
        maxMessagesPerDay: 2,
        maxMessagesTotal: 2,
      }),
    ).toBe(false);
  });
});

describe('atomic approval and held-job authorization', () => {
  it('exactly one matching held job is required', () => {
    expect(MIGRATION).toContain("RAISE EXCEPTION 'controlled_pilot_job_missing'");
    expect(MIGRATION).toContain("RAISE EXCEPTION 'controlled_pilot_job_ambiguous'");
    expect(MIGRATION).toMatch(/IF v_match_count = 0 THEN[\s\S]*ELSIF v_match_count > 1 THEN/);
  });

  it('the match is scoped by event, caller, mode, recipient hash and job safety', () => {
    for (const clause of [
      "j.channel = 'email'",
      "j.mode = 'queued'",
      "j.status = 'held'",
      'j.attempt_count = 0',
      'ed.code = ANY (coalesce(v_rel.permitted_event_codes',
      'r.caller_module_code = ANY (coalesce(v_rel.permitted_caller_modules',
      'r.mode = ANY (coalesce(v_rel.permitted_modes',
      "rr->>'target_hash'",
      'omni_comms_delivery_attempt a WHERE a.dispatch_job_id = j.id',
      'm.sender_identity_id IS NOT NULL',
      "coalesce(m.rendered_checksum,'') <> ''",
    ]) {
      expect(MIGRATION).toContain(clause);
    }
  });

  it('the snapshot is stamped with the POST-activation release identity', () => {
    const stampIndex = MIGRATION.indexOf('release_version_at_decision = v_rel.release_version');
    const activationIndex = MIGRATION.indexOf(
      "release_state = 'controlled_pilot',\n    release_version = release_version + 1",
    );
    expect(activationIndex).toBeGreaterThan(-1);
    expect(stampIndex).toBeGreaterThan(activationIndex);
    expect(MIGRATION).toContain("release_state_at_decision = v_rel.release_state");
    expect(MIGRATION).toContain('release_fingerprint_at_decision = v_rel.release_fingerprint');
  });

  it('the bounded snapshot carries no recipient, body or credential', () => {
    const snapshot = MIGRATION.slice(
      MIGRATION.indexOf('release_decision_snapshot = jsonb_build_object'),
      MIGRATION.indexOf("'authorized_at', now())"),
    );
    expect(snapshot).not.toMatch(/recipient_email|rendered_body|api_key|secret|credential/i);
    expect(snapshot).toContain("'recipient_rule_matched'");
    expect(snapshot).toContain("'max_messages_total'");
  });

  it('the snapshot is write-once', () => {
    expect(MIGRATION).toContain("RAISE EXCEPTION 'release_snapshot_immutable'");
    expect(MIGRATION).toMatch(
      /CREATE TRIGGER omni_comms_dispatch_job_release_snapshot_write_once\s+BEFORE UPDATE ON public\.omni_comms_dispatch_job/,
    );
  });

  it('two-person governance is preserved', () => {
    expect(MIGRATION).toContain("RAISE EXCEPTION 'segregation_of_duties_violation'");
    expect(MIGRATION).toContain('IF v_rel.proposed_by = p_actor_id THEN');
  });

  it('approval sends nothing, creates no attempt and never invokes the dispatcher', () => {
    const approve = MIGRATION.slice(
      MIGRATION.indexOf('omni_comms_priv_channel_release_approve_activate'),
    );
    expect(approve).not.toMatch(/INSERT INTO public\.omni_comms_delivery_attempt/);
    expect(approve).not.toMatch(/is_runnable\s*=\s*true/);
    expect(approve).not.toMatch(/status\s*=\s*'ready'/);
    expect(approve).not.toMatch(/resend|net\.http|pg_net/i);
    expect(EDGE).not.toMatch(/omni-comms-dispatch['"]/);
  });
});
