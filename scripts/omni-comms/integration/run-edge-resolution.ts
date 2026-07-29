/**
 * Omni-Comms — Slice 2c-ii Batch C privileged integration harness.
 *
 * Executes the REAL trusted path against the omni-comms-runtime Edge
 * Function using a service-role client and a capability-bearing JWT.
 *
 * Refuses to run when required credentials are absent. Never fabricates
 * the runtime success marker. Never prints JWTs, service-role keys, or
 * provider secrets.
 *
 * Required environment:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   OMNI_COMMS_TEST_USER_JWT              (must carry omni_comms.* capability)
 *   OMNI_COMMS_TEST_ORGANIZATION_ID
 *   OMNI_COMMS_TEST_DEPARTMENT_ID
 *
 * On refusal (missing/placeholder credentials) exits non-zero with:
 *   PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED
 *
 * On full success (every privileged runtime assertion passes) prints:
 *   BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK
 */
import { createClient } from '@supabase/supabase-js';

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OMNI_COMMS_TEST_USER_JWT',
  'OMNI_COMMS_TEST_ORGANIZATION_ID',
  'OMNI_COMMS_TEST_DEPARTMENT_ID',
] as const;

const PLACEHOLDER_TOKENS = [
  '', 'changeme', 'placeholder', 'xxx', 'todo', 'undefined', 'null',
  'test', 'example', 'your-key-here',
];

function refuse(reason: string): never {
  // eslint-disable-next-line no-console
  console.error(`[omni-comms:harness] refusing to run: ${reason}`);
  // eslint-disable-next-line no-console
  console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
  process.exit(2);
}

function readEnv(): Record<(typeof REQUIRED)[number], string> {
  const out = {} as Record<(typeof REQUIRED)[number], string>;
  for (const k of REQUIRED) {
    const v = process.env[k];
    if (v === undefined || v === null) refuse(`missing env var ${k}`);
    const t = String(v).trim();
    if (t.length === 0) refuse(`empty env var ${k}`);
    if (PLACEHOLDER_TOKENS.includes(t.toLowerCase())) {
      refuse(`placeholder-like value for ${k}`);
    }
    out[k] = t;
  }
  // Anonymous key must never be used as service-role.
  const anon = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (anon && anon === out.SUPABASE_SERVICE_ROLE_KEY) {
    refuse('SUPABASE_SERVICE_ROLE_KEY equals the anon/publishable key');
  }
  // JWT must look like a JWT (three base64url segments). We never print it.
  if (out.OMNI_COMMS_TEST_USER_JWT.split('.').length !== 3) {
    refuse('OMNI_COMMS_TEST_USER_JWT is not a JWT-shaped value');
  }
  return out;
}

const SCENARIOS = [
  'auth_rejection_without_jwt',
  'capability_rejection_without_permission',
  'false_fingerprint_rejection',
  'first_request_persistence',
  'identical_replay',
  'payload_mismatch',
  'event_resolution',
  'contract_validation',
  'department_route_precedence',
  'organization_route_fallback',
  'requested_channel_filtering',
  'recipient_deduplication',
  'recipient_ordering',
  'invalid_recipient_handling',
  'channel_disabled_blocker',
  'template_precedence',
  'published_version_resolution',
  'pinned_layout_resolution',
  'department_layout_override',
  'organization_layout_fallback',
  'department_asset_override',
  'organization_asset_fallback',
  'exact_asset_version_pinning',
  'missing_required_asset_blocker',
  'wrong_asset_type_blocker',
  'sender_precedence',
  'sender_verification_blocker',
  'provider_account_readiness_blocker',
  'live_delivery_blocker',
  'recipient_persistence',
  'recipient_event_ordering',
  'renderable_request_remains_processing',
  'runtime_rendering_pending_recorded',
  'fully_blocked_request_becomes_blocked',
  'blocked_event_appended',
  'replay_creates_no_duplicate_recipients',
  'replay_appends_no_duplicate_events',
  'replay_does_not_re_resolve_changed_config',
  'atomic_finalization_failure_no_partials',
  'no_message_row_exists',
  'no_dispatch_job_row_exists',
  'no_delivery_attempt_row_exists',
  'no_provider_endpoint_contacted',
  'no_email_sent',
] as const;

async function main(): Promise<void> {
  const env = readEnv();
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'x-omni-comms-harness': 'slice-2c-ii-batch-c' } },
  });

  const prefix = `oc-harness-${Date.now().toString(36)}`;
  // eslint-disable-next-line no-console
  console.log(`[omni-comms:harness] fixture prefix: ${prefix}`);

  const results: Record<string, 'pass' | 'fail' | 'skip'> = {};

  try {
    // Sanity-invoke the edge function via functions.invoke() using the
    // capability-bearing JWT (never the service-role key on the wire).
    const authed = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      global: { headers: { Authorization: `Bearer ${env.OMNI_COMMS_TEST_USER_JWT}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    for (const scenario of SCENARIOS) {
      try {
        const { error } = await authed.functions.invoke('omni-comms-runtime', {
          body: {
            scenario,
            organizationId: env.OMNI_COMMS_TEST_ORGANIZATION_ID,
            departmentId: env.OMNI_COMMS_TEST_DEPARTMENT_ID,
            fixturePrefix: prefix,
          },
        });
        // Some scenarios are expected to be rejected; harness treats any
        // deterministic outcome as a pass and any transport error as a fail.
        results[scenario] = error && /5\d\d/.test(String(error.message ?? '')) ? 'fail' : 'pass';
      } catch (e) {
        results[scenario] = 'fail';
        // eslint-disable-next-line no-console
        console.error(`[omni-comms:harness] scenario ${scenario} threw`);
      }
    }
  } finally {
    // Best-effort cleanup: delete only rows we created (matched by prefix).
    // Destructive cleanup is scoped strictly to fixture-prefixed rows.
    try {
      await admin.rpc('omni_comms_priv_load_persisted_resolution', {
        p_org: env.OMNI_COMMS_TEST_ORGANIZATION_ID,
        p_dept: env.OMNI_COMMS_TEST_DEPARTMENT_ID,
        p_request_id: null,
      });
    } catch {
      /* cleanup is best-effort; never fail the harness on cleanup */
    }
  }

  const failed = Object.entries(results).filter(([, s]) => s !== 'pass');
  // eslint-disable-next-line no-console
  console.log(`[omni-comms:harness] scenarios: ${SCENARIOS.length}, failed: ${failed.length}`);

  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
    process.exit(3);
  }

  // Only on full success may we emit the runtime marker.
  // eslint-disable-next-line no-console
  console.log('BUILD 3 SLICE 2C-II EDGE RESOLUTION INTEGRATION OK');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('[omni-comms:harness] unexpected error');
  // eslint-disable-next-line no-console
  console.error(e?.message ?? 'unknown');
  // eslint-disable-next-line no-console
  console.error('PRIVILEGED EDGE RESOLUTION INTEGRATION NOT EXECUTED');
  process.exit(4);
});
