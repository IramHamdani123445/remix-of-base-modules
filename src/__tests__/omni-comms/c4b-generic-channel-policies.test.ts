/**
 * Omni-Comms Channels C4B — generic channel policies and department overrides.
 *
 * Pure unit + static coverage. No database connection, no provider API, no
 * SDK, no network call, no send. Policy values are administration records
 * only and nothing in C4B enforces them.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ACKNOWLEDGEMENT_MODES,
  CHANNEL_POLICY_BOUNDS,
  CHANNEL_POLICY_KEYS,
  COUNTRY_MODES,
  EFFECTIVE_SOURCE_LABEL,
  NO_BASELINE_NOTICE,
  OPERATIONAL_STATES,
  OPERATIONAL_STATE_LABEL,
  POLICY_CHANNELS,
  POLICY_PLANNED_CHANNELS,
  POLICY_STATE_NOTICE,
  REFERENCE_POLICY_NOTICE,
  RETRY_PROFILES,
  RETRY_PROFILE_LABEL,
  effectiveSourceLabel,
  isPolicyChannel,
  isReferencePolicy,
  operationalStateAllowsConfiguration,
  policyScopeLabel,
  validateCommonPolicy,
  type ChannelPolicyRow,
  type ChannelPolicySummary,
  type CommonPolicyInput,
} from '@/platform/omni-comms/application/channelPolicyTypes';
import {
  getChannelPolicySummary,
  upsertChannelPolicy,
} from '@/platform/omni-comms/application/channelPolicyService';
import { projectEmailReadiness } from '@/platform/omni-comms/admin/views/channels/emailReadiness';
import { OMNI_COMMS_OBJECT_REGISTRY } from '@/platform/omni-comms/registry/objectRegistry';

const ROOT = process.cwd();
const CH_DIR = join(ROOT, 'src/platform/omni-comms/admin/views/channels');
const APP_DIR = join(ROOT, 'src/platform/omni-comms/application');
const read = (p: string) => readFileSync(p, 'utf8');
/** Executable source with comments removed — prose must not fail a rule. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** The single C4B migration (most recent migration containing the marker). */
const MIGRATION = (() => {
  const dir = join(ROOT, 'supabase/migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const match = files
    .map((f) => read(join(dir, f)))
    .filter((sql) => sql.includes('omni_comms_priv_normalize_channel_policy'));
  return match.join('\n');
})();

const POLICIES_TAB = read(join(CH_DIR, 'ChannelPoliciesTab.tsx'));
const POLICY_FORMS = read(join(CH_DIR, 'channelPolicyForms.tsx'));
const POLICY_SERVICE = read(join(APP_DIR, 'channelPolicyService.ts'));
const POLICY_TYPES = read(join(APP_DIR, 'channelPolicyTypes.ts'));
const READINESS = read(join(CH_DIR, 'emailReadiness.ts'));

function policyRow(over: Partial<ChannelPolicyRow> = {}): ChannelPolicyRow {
  return {
    id: 'p1',
    organization_id: 'org1',
    department_id: null,
    department_name: null,
    channel: 'email',
    operational_state: 'configuration',
    department_override_enabled: true,
    enabled: true,
    live_delivery_enabled: false,
    per_minute_limit: null,
    per_day_limit: null,
    max_recipients_per_request: null,
    quiet_hours_start: null,
    quiet_hours_end: null,
    quiet_hours_timezone: null,
    retry_profile: 'none',
    request_timeout_seconds: null,
    retention_days: null,
    cost_currency: null,
    daily_cost_limit_minor: null,
    per_message_cost_limit_minor: null,
    channel_policy_config: {},
    data_origin: 'user',
    created_at: '2026-08-01T00:00:00Z',
    created_by: null,
    updated_at: '2026-08-01T00:00:00Z',
    updated_by: null,
    ...over,
  };
}

function summary(over: Partial<ChannelPolicySummary> = {}): ChannelPolicySummary {
  return {
    organization_id: 'org1',
    department_id: null,
    department_name: null,
    channel: 'email',
    organization_policy: null,
    department_policy: null,
    effective_policy: null,
    effective_source: 'none',
    department_override_count: 0,
    reference_policies: [],
    hidden_reference_count: 0,
    can_configure: true,
    generated_at: '2026-08-02T00:00:00Z',
    ...over,
  };
}

const common = (over: Partial<CommonPolicyInput> = {}): CommonPolicyInput => ({
  operational_state: 'configuration',
  ...over,
});

function mockClient(data: unknown = 'p1') {
  const rpc = vi.fn(
    async (_fn: string, _args?: Record<string, unknown>) => ({ data, error: null }),
  );
  return { client: { rpc }, rpc };
}

// ── Schema and migration ─────────────────────────────────────────────
describe('C4B schema and migration', () => {
  it('adds every C4B column additively without dropping compatibility columns', () => {
    for (const col of [
      'data_origin', 'operational_state', 'department_override_enabled', 'per_day_limit',
      'max_recipients_per_request', 'retry_profile', 'request_timeout_seconds',
      'retention_days', 'cost_currency', 'daily_cost_limit_minor',
      'per_message_cost_limit_minor', 'channel_policy_config',
    ]) {
      expect(MIGRATION).toContain(col);
    }
    expect(MIGRATION).not.toMatch(/DROP COLUMN IF EXISTS enabled/);
    expect(MIGRATION).not.toMatch(/DROP COLUMN IF EXISTS live_delivery_enabled/);
  });

  it('preserves existing policy IDs (no delete, no recreate)', () => {
    expect(MIGRATION).not.toMatch(/DELETE FROM public\.omni_comms_channel_setting/);
    expect(MIGRATION).not.toMatch(/TRUNCATE/i);
    expect(MIGRATION).not.toMatch(/DROP TABLE/i);
  });

  it('backfills disabled records to disabled and enabled records to configuration', () => {
    expect(MIGRATION).toMatch(
      /operational_state = CASE WHEN enabled THEN 'configuration' ELSE 'disabled' END/,
    );
  });

  it('resets the legacy live flag and audits the reset', () => {
    expect(MIGRATION).toContain('SET live_delivery_enabled = false WHERE live_delivery_enabled');
    expect(MIGRATION).toContain('c4b_legacy_live_flag_reset');
  });

  it('mirrors enabled from operational state with a constraint and the guard', () => {
    expect(MIGRATION).toContain("CHECK (enabled = (operational_state <> 'disabled'))");
    expect(MIGRATION).toContain("NEW.enabled := (NEW.operational_state <> 'disabled')");
  });

  it('allows a reference policy and a genuine policy to coexist', () => {
    expect(MIGRATION).toContain("WHERE department_id IS NULL AND data_origin <> 'reference_seed'");
    expect(MIGRATION).toContain("WHERE department_id IS NULL AND data_origin = 'reference_seed'");
  });

  it('rejects a duplicate genuine organisation policy', () => {
    expect(MIGRATION).toContain('omni_comms_channel_setting_org_genuine_uk');
    expect(MIGRATION).toContain('genuine_policy_scope_exists');
  });

  it('rejects a duplicate genuine department policy', () => {
    expect(MIGRATION).toContain('omni_comms_channel_setting_dept_genuine_uk');
  });

  it('creates no new logical database object (registry count unchanged)', () => {
    expect(MIGRATION).not.toMatch(/CREATE TABLE/i);
    expect(
      OMNI_COMMS_OBJECT_REGISTRY.filter((o) => o.name === 'omni_comms_channel_setting'),
    ).toHaveLength(1);
    expect(OMNI_COMMS_OBJECT_REGISTRY.length).toBe(30);
  });

  it('ships a rollback and a verifier script', () => {
    const rollback = read(join(ROOT, 'scripts/omni-comms/rollback/c4b-generic-channel-policies-rollback.sql'));
    expect(rollback.trimEnd().endsWith('-- change to COMMIT deliberately')).toBe(true);
    expect(rollback).toContain('ROLLBACK;');
    expect(rollback).toContain('omni_comms_channel_setting_org_scope_uk');
    expect(rollback).toContain('CREATE OR REPLACE FUNCTION public.omni_comms_channel_setting_upsert');
    expect(rollback).not.toMatch(/live_delivery_enabled\s*=\s*true/);
    const verifier = read(join(ROOT, 'scripts/omni-comms/verify-c4b-generic-channel-policies.sql'));
    for (const c of ['no_live_delivery', 'enabled_mirror', 'unique_indexes',
      'private_workers_locked', 'public_rpc_grants', 'no_runtime_rows']) {
      expect(verifier).toContain(c);
    }
  });
});

// ── Common validation ────────────────────────────────────────────────
describe('C4B common policy validation', () => {
  const fields = (input: CommonPolicyInput) => validateCommonPolicy(input).map((i) => i.field);

  it('rejects a per-minute limit below the lower bound', () => {
    expect(fields(common({ per_minute_limit: 0 }))).toContain('per_minute_limit');
  });
  it('rejects a per-minute limit above the upper bound', () => {
    expect(fields(common({ per_minute_limit: 100001 }))).toContain('per_minute_limit');
  });
  it('rejects a per-day limit below the lower bound', () => {
    expect(fields(common({ per_day_limit: 0 }))).toContain('per_day_limit');
  });
  it('rejects a per-day limit below the per-minute limit', () => {
    expect(fields(common({ per_minute_limit: 100, per_day_limit: 50 }))).toContain('per_day_limit');
  });
  it('accepts a per-day limit equal to the per-minute limit', () => {
    expect(validateCommonPolicy(common({ per_minute_limit: 50, per_day_limit: 50 }))).toEqual([]);
  });
  it('validates the recipient limit', () => {
    expect(fields(common({ max_recipients_per_request: 100001 }))).toContain('max_recipients_per_request');
    expect(validateCommonPolicy(common({ max_recipients_per_request: 25 }))).toEqual([]);
  });
  it('requires quiet-hours start and end together', () => {
    expect(fields(common({ quiet_hours_start: '22:00' }))).toContain('quiet_hours');
  });
  it('requires a quiet-hours timezone', () => {
    expect(fields(common({ quiet_hours_start: '22:00', quiet_hours_end: '06:00' })))
      .toContain('quiet_hours_timezone');
  });
  it('rejects equal quiet-hours boundaries', () => {
    expect(fields(common({
      quiet_hours_start: '22:00', quiet_hours_end: '22:00', quiet_hours_timezone: 'UTC',
    }))).toContain('quiet_hours');
  });
  it('rejects a malformed quiet-hours time', () => {
    expect(fields(common({
      quiet_hours_start: '25:00', quiet_hours_end: '06:00', quiet_hours_timezone: 'UTC',
    }))).toContain('quiet_hours');
  });
  it('accepts overnight quiet hours', () => {
    expect(validateCommonPolicy(common({
      quiet_hours_start: '22:00', quiet_hours_end: '06:00', quiet_hours_timezone: 'America/St_Kitts',
    }))).toEqual([]);
  });
  it('validates the timezone against the database catalogue server-side', () => {
    expect(MIGRATION).toContain('pg_timezone_names');
    expect(MIGRATION).toContain('quiet_hours_timezone_unknown');
  });
  it('enforces the retry-profile allowlist', () => {
    expect(RETRY_PROFILES).toEqual(['none', 'conservative', 'standard']);
    expect(fields(common({ retry_profile: 'aggressive' as never }))).toContain('retry_profile');
  });
  it('enforces timeout bounds', () => {
    expect(fields(common({ request_timeout_seconds: 301 }))).toContain('request_timeout_seconds');
    expect(fields(common({ request_timeout_seconds: 0 }))).toContain('request_timeout_seconds');
  });
  it('enforces retention bounds', () => {
    expect(fields(common({ retention_days: 3651 }))).toContain('retention_days');
    expect(validateCommonPolicy(common({ retention_days: 365 }))).toEqual([]);
  });
  it('validates the currency shape', () => {
    expect(fields(common({ cost_currency: 'xc' }))).toContain('cost_currency');
    expect(validateCommonPolicy(common({ cost_currency: 'XCD' }))).toEqual([]);
  });
  it('requires a currency when a cost ceiling exists', () => {
    expect(fields(common({ daily_cost_limit_minor: 100 }))).toContain('cost_currency');
  });
  it('rejects a per-message ceiling above the daily ceiling', () => {
    expect(fields(common({
      cost_currency: 'XCD', daily_cost_limit_minor: 100, per_message_cost_limit_minor: 200,
    }))).toContain('per_message_cost_limit_minor');
  });
  it('rejects an unknown common input server-side', () => {
    expect(MIGRATION).toContain("DETAIL='unknown_common_field:'||v_key");
  });
});

// ── Channel-specific policy configuration ────────────────────────────
describe('C4B channel-specific policy configuration', () => {
  it('exposes exactly the allowed keys per channel', () => {
    expect(CHANNEL_POLICY_KEYS.email).toEqual(['max_attachment_bytes', 'allowed_attachment_extensions']);
    expect(CHANNEL_POLICY_KEYS.sms).toEqual(['country_mode', 'country_codes', 'max_segments', 'unicode_allowed']);
    expect(CHANNEL_POLICY_KEYS.whatsapp).toEqual(['country_mode', 'country_codes', 'max_media_bytes', 'inbound_enabled']);
    expect(CHANNEL_POLICY_KEYS.push).toEqual(['max_ttl_seconds', 'max_data_payload_bytes']);
    expect(CHANNEL_POLICY_KEYS.in_app).toEqual(['expiry_hours', 'acknowledgement_mode', 'max_visible_per_user']);
    expect(CHANNEL_POLICY_KEYS.print).toEqual(['max_document_bytes', 'batch_size_limit', 'archive_retention_days']);
  });

  it('rejects an unknown channel key and oversized JSON server-side', () => {
    expect(MIGRATION).toContain("DETAIL='unknown_channel_policy_key:'||v_key");
    expect(MIGRATION).toContain('channel_policy_config_too_large');
    expect(MIGRATION).toContain('length(channel_policy_config::text) <= 4000');
  });

  // Email
  it('validates attachment bytes', () => {
    expect(CHANNEL_POLICY_BOUNDS.max_attachment_bytes).toEqual([0, 26214400]);
    expect(MIGRATION).toContain('max_attachment_bytes_out_of_range');
  });
  it('normalises attachment extensions (lowercase, dotless, deduplicated, capped)', () => {
    expect(MIGRATION).toContain("lower(btrim(ltrim(x,'.')))");
    expect(MIGRATION).toContain('allowed_attachment_extensions_too_many');
    expect(MIGRATION).toContain("v_e !~ '^[a-z0-9]{1,10}$'");
  });
  it('rejects an invalid attachment extension', () => {
    expect(MIGRATION).toContain('allowed_attachment_extension_invalid');
  });

  // SMS / WhatsApp
  it('enforces the country-mode allowlist and code normalisation', () => {
    expect(COUNTRY_MODES).toEqual(['unrestricted', 'allowlist', 'denylist']);
    expect(MIGRATION).toContain('invalid_country_mode');
    expect(MIGRATION).toContain('upper(btrim(x))');
    expect(MIGRATION).toContain("v_e !~ '^[A-Z]{2}$'");
    expect(MIGRATION).toContain('country_codes_too_many');
  });
  it('requires an empty list for unrestricted and codes for allow/deny lists', () => {
    expect(MIGRATION).toContain('unrestricted_requires_empty_country_codes');
    expect(MIGRATION).toContain('country_codes_required');
  });
  it('validates SMS segments and the unicode boolean', () => {
    expect(CHANNEL_POLICY_BOUNDS.max_segments).toEqual([1, 10]);
    expect(MIGRATION).toContain('max_segments_out_of_range');
    expect(MIGRATION).toContain('unicode_allowed_not_boolean');
  });
  it('validates WhatsApp media bytes and treats inbound as a declaration only', () => {
    expect(CHANNEL_POLICY_BOUNDS.max_media_bytes).toEqual([0, 16777216]);
    expect(MIGRATION).toContain('max_media_bytes_out_of_range');
    expect(MIGRATION).toContain('inbound_enabled_not_boolean');
    expect(POLICY_FORMS).toContain('inbound_enabled');
    expect(code(POLICY_FORMS)).not.toMatch(/webhook|conversation|service window/i);
  });

  // Push / In-App / Print
  it('validates push TTL and payload bytes', () => {
    expect(CHANNEL_POLICY_BOUNDS.max_ttl_seconds).toEqual([0, 2419200]);
    expect(CHANNEL_POLICY_BOUNDS.max_data_payload_bytes).toEqual([0, 4096]);
    expect(MIGRATION).toContain('max_ttl_seconds_out_of_range');
    expect(MIGRATION).toContain('max_data_payload_bytes_out_of_range');
  });
  it('validates in-app expiry, acknowledgement mode and visibility limit', () => {
    expect(ACKNOWLEDGEMENT_MODES).toEqual(['none', 'read', 'explicit']);
    expect(CHANNEL_POLICY_BOUNDS.expiry_hours).toEqual([1, 8760]);
    expect(CHANNEL_POLICY_BOUNDS.max_visible_per_user).toEqual([1, 500]);
    expect(MIGRATION).toContain('invalid_acknowledgement_mode');
  });
  it('validates print document size, batch size and archive retention', () => {
    expect(CHANNEL_POLICY_BOUNDS.max_document_bytes).toEqual([1, 52428800]);
    expect(CHANNEL_POLICY_BOUNDS.batch_size_limit).toEqual([1, 10000]);
    expect(CHANNEL_POLICY_BOUNDS.archive_retention_days).toEqual([1, 3650]);
    expect(MIGRATION).toContain('archive_retention_days_out_of_range');
  });
});

// ── Scope and inheritance ────────────────────────────────────────────
describe('C4B scope and inheritance', () => {
  it('resolves the organisation policy as the baseline', () => {
    const s = summary({
      organization_policy: policyRow(),
      effective_policy: policyRow(),
      effective_source: 'organisation_baseline',
    });
    expect(effectiveSourceLabel(s.effective_source)).toBe('Organisation baseline');
    expect(policyScopeLabel(s.effective_policy)).toBe('Organisation');
  });

  it('resolves an enabled department override', () => {
    const dept = policyRow({ id: 'p2', department_id: 'd1', department_name: 'Benefits' });
    const s = summary({
      department_id: 'd1',
      department_name: 'Benefits',
      organization_policy: policyRow(),
      department_policy: dept,
      effective_policy: dept,
      effective_source: 'department_override',
    });
    expect(s.effective_policy?.id).toBe('p2');
    expect(policyScopeLabel(s.effective_policy)).toBe('Department — Benefits');
    expect(s.department_name).toBe('Benefits');
  });

  it('inherits the organisation policy when the override is disabled (row retained)', () => {
    expect(MIGRATION).toContain('v_dept_found AND v_dept.department_override_enabled');
    const dept = policyRow({ id: 'p2', department_id: 'd1', department_override_enabled: false });
    const s = summary({
      department_id: 'd1',
      organization_policy: policyRow(),
      department_policy: dept,
      effective_policy: policyRow(),
      effective_source: 'organisation_baseline',
    });
    expect(s.department_policy).not.toBeNull();
    expect(s.effective_source).toBe('organisation_baseline');
  });

  it('scopes the summary query to one department only', () => {
    expect(MIGRATION).toContain('AND department_id = p_department_id');
  });

  it('returns the organisation policy when no department is selected', () => {
    const s = summary({ organization_policy: policyRow(), effective_source: 'organisation_baseline' });
    expect(s.department_id).toBeNull();
    expect(s.department_policy).toBeNull();
  });

  it('returns no effective policy when the baseline is missing and the override is off', () => {
    const s = summary({ effective_source: 'none' });
    expect(s.effective_policy).toBeNull();
    expect(EFFECTIVE_SOURCE_LABEL[s.effective_source]).toBe('No policy configured');
    expect(NO_BASELINE_NOTICE).toBe('No organisation baseline is configured.');
    expect(POLICIES_TAB).toContain('NO_BASELINE_NOTICE');
  });

  it('denies cross-organisation reads and writes and mismatched department pairs', () => {
    expect(MIGRATION).toContain('omni_comms_priv_require_tenant_access');
    expect(MIGRATION).toContain('department_organization_mismatch');
    expect(MIGRATION).toContain('policy_scope_immutable');
  });

  it('does not implement field-by-field inheritance', () => {
    expect(code(POLICIES_TAB)).not.toMatch(/coalesce\(/i);
    expect(MIGRATION).not.toMatch(/merge_policy|inherit_field/i);
  });
});

// ── Mutation and reference data ──────────────────────────────────────
describe('C4B mutation and reference-policy handling', () => {
  it('requires the configure capability to mutate and view to read', () => {
    expect(MIGRATION).toContain("omni_comms_priv_require_capability('configure')");
    expect(MIGRATION).toContain("omni_comms_priv_require_capability('view')");
  });

  it('requires expected_updated_at and rejects concurrent updates', () => {
    expect(MIGRATION).toContain('expected_updated_at_required');
    expect(MIGRATION).toContain('OC413 concurrent_update');
  });

  it('rejects reference-policy mutation', () => {
    expect(MIGRATION).toContain('reference_policy_read_only');
    expect(isReferencePolicy(policyRow({ data_origin: 'reference_seed' }))).toBe(true);
    expect(isReferencePolicy(policyRow())).toBe(false);
  });

  it('creates policies with data_origin user only', () => {
    expect(MIGRATION).toContain("'user',");
    expect(POLICY_SERVICE).not.toContain('p_data_origin');
  });

  it('hides reference rows by default and requires configure to reveal them', () => {
    const { client, rpc } = mockClient(summary());
    void getChannelPolicySummary(client, { organizationId: 'org1', channel: 'email' });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_include_reference: false });
    expect(MIGRATION).toContain('COALESCE(p_include_reference,false) AND v_can_configure');
  });

  it('never lets the production UI request reference policies', () => {
    expect(POLICIES_TAB).toContain('includeReference: false');
    expect(POLICIES_TAB).not.toContain('includeReference: true');
  });

  it('excludes reference policies from effective resolution and marks them read-only', () => {
    expect(MIGRATION).toContain("data_origin <> 'reference_seed'");
    expect(REFERENCE_POLICY_NOTICE).toContain('read-only');
    expect(POLICIES_TAB).toContain('REFERENCE_POLICY_NOTICE');
  });

  it('sends the documented generic upsert argument shape', () => {
    const { client, rpc } = mockClient();
    void upsertChannelPolicy(client, {
      id: 'p1',
      expectedUpdatedAt: '2026-08-01T00:00:00Z',
      organizationId: 'org1',
      departmentId: 'd1',
      channel: 'sms',
      common: common({ operational_state: 'test_only', per_minute_limit: 10 }),
      channelPolicyConfig: { country_mode: 'unrestricted' },
    });
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe('omni_comms_channel_policy_upsert');
    expect(args).toMatchObject({
      p_id: 'p1',
      p_expected_updated_at: '2026-08-01T00:00:00Z',
      p_organization_id: 'org1',
      p_department_id: 'd1',
      p_channel: 'sms',
    });
    expect(Object.keys(args as object)).not.toContain('p_enabled');
    expect(Object.keys(args as object)).not.toContain('p_live_delivery_enabled');
  });
});

// ── Live / release boundary ──────────────────────────────────────────
describe('C4B live and release boundary', () => {
  it('accepts no live flag in the generic RPC or the service', () => {
    expect(code(POLICY_SERVICE)).not.toContain('live_delivery');
    expect(POLICY_TYPES).toContain('live_delivery_enabled');
    expect(MIGRATION).toContain('CREATE OR REPLACE FUNCTION public.omni_comms_channel_policy_upsert');
  });

  it('rejects live delivery in the legacy Email wrapper and the guard', () => {
    expect(MIGRATION).toContain('live_delivery_governed_by_release_control');
    expect(MIGRATION).toContain('CHECK (live_delivery_enabled = false)');
  });

  it('has no live switch or pilot activation action in the Policies UI', () => {
    expect(code(POLICIES_TAB)).not.toMatch(/Live delivery enabled/i);
    expect(POLICIES_TAB).not.toMatch(/Enable live|Go live|Start pilot|Send test|Apply now|Delete policy/i);
    expect(POLICY_STATE_NOTICE).toContain('governed by Release Control');
    expect(POLICIES_TAB).toContain('POLICY_STATE_NOTICE');
  });

  it('never uses live_delivery_enabled or email_send_ready in readiness', () => {
    expect(code(READINESS)).not.toMatch(/summary\?\.channel_setting/);
    expect(code(READINESS)).not.toMatch(/live_delivery_enabled/);
    expect(code(READINESS)).not.toMatch(/[^_]email_send_ready/);
  });

  it('reports Release Control readiness as not implemented', () => {
    const projection = projectEmailReadiness(null, null);
    const rc = projection.checks.find((c) => c.key === 'release_control');
    expect(rc?.state).toBe('not_implemented');
    expect(rc?.detail).toContain('Release Control');
  });

  it('offers no policy state named live, production or operational', () => {
    expect(OPERATIONAL_STATES).toEqual(['disabled', 'configuration', 'test_only', 'pilot_ready']);
    for (const banned of ['live', 'production', 'operational', 'enabled_live']) {
      expect(OPERATIONAL_STATES as readonly string[]).not.toContain(banned);
    }
  });
});

// ── Email readiness integration ──────────────────────────────────────
describe('C4B Email readiness integration', () => {
  const keys = (p: ReturnType<typeof projectEmailReadiness>) => p.checks.map((c) => c.key);

  it('replaces the old channel_setting checks with policy checks', () => {
    const p = projectEmailReadiness(null, null);
    expect(keys(p)).toContain('policy');
    expect(keys(p)).toContain('policy_state');
    expect(keys(p)).toContain('release_control');
    expect(keys(p)).not.toContain('enabled');
  });

  it('meets the policy checks for a genuine effective configuration policy', () => {
    const p = projectEmailReadiness(null, summary({
      effective_policy: policyRow(),
      effective_source: 'organisation_baseline',
    }));
    expect(p.checks.find((c) => c.key === 'policy')?.state).toBe('met');
    expect(p.checks.find((c) => c.key === 'policy_state')?.state).toBe('met');
  });

  it.each(['test_only', 'pilot_ready'] as const)('allows configuration for %s', (state) => {
    const p = projectEmailReadiness(null, summary({
      effective_policy: policyRow({ operational_state: state }),
      effective_source: 'organisation_baseline',
    }));
    expect(p.checks.find((c) => c.key === 'policy_state')?.state).toBe('met');
    expect(operationalStateAllowsConfiguration(state)).toBe(true);
  });

  it('is unmet when the effective policy is disabled', () => {
    const p = projectEmailReadiness(null, summary({
      effective_policy: policyRow({ operational_state: 'disabled', enabled: false }),
      effective_source: 'organisation_baseline',
    }));
    expect(p.checks.find((c) => c.key === 'policy_state')?.state).toBe('unmet');
    expect(operationalStateAllowsConfiguration('disabled')).toBe(false);
  });

  it('never lets a reference policy contribute', () => {
    const p = projectEmailReadiness(null, summary({
      effective_policy: policyRow({ data_origin: 'reference_seed' }),
      effective_source: 'organisation_baseline',
    }));
    expect(p.checks.find((c) => c.key === 'policy')?.state).toBe('unmet');
  });

  it('never displays "Configuration complete"', () => {
    const p = projectEmailReadiness(null, summary({
      effective_policy: policyRow(), effective_source: 'organisation_baseline',
    }));
    expect(p.label).not.toBe('Configuration complete');
  });

  it('keeps one shared projection for catalogue, header and overview', () => {
    const page = read(join(ROOT, 'src/platform/omni-comms/admin/views/OmniCommsChannelsPage.tsx'));
    expect(page).toContain('projectEmailReadiness(summary, emailPolicy, testCentre)');
    expect(read(join(CH_DIR, 'ChannelOverviewTab.tsx'))).toContain('projectEmailReadiness');
  });
});

// ── UI and architecture ──────────────────────────────────────────────
describe('C4B UI and architecture boundaries', () => {
  it('renders typed policy forms for all six database-supported channels', () => {
    expect(POLICY_CHANNELS).toEqual(['email', 'sms', 'whatsapp', 'push', 'in_app', 'print']);
    for (const ch of POLICY_CHANNELS) {
      expect(POLICY_FORMS).toContain(`omni-comms-policy-config-${ch}`);
      expect(isPolicyChannel(ch)).toBe(true);
    }
  });

  it('offers no policy mutation for Webhook or Voice', () => {
    expect(POLICY_PLANNED_CHANNELS).toEqual(['webhook', 'voice']);
    expect(isPolicyChannel('webhook')).toBe(false);
    expect(isPolicyChannel('voice')).toBe(false);
    expect(POLICIES_TAB).toContain('omni-comms-policies-planned-state');
  });

  it('exposes no raw JSON editor', () => {
    expect(code(POLICIES_TAB)).not.toMatch(/JSON\.parse|Textarea|raw json/i);
    expect(code(POLICY_FORMS)).not.toMatch(/JSON\.parse|Textarea/i);
  });

  it('uses the bound RPC client only — no Supabase singleton, SDK, fetch or send', () => {
    for (const raw of [POLICY_SERVICE, POLICY_TYPES, POLICIES_TAB, POLICY_FORMS]) {
      const src = code(raw);
      expect(src).not.toContain('@/integrations/supabase/client');
      expect(src).not.toMatch(/from ['"](resend|twilio|nodemailer|firebase|@sendgrid)/);
      expect(src).not.toMatch(/\bfetch\(/);
      expect(src).not.toContain('sendCommunication');
      expect(src).not.toMatch(/\.from\(['"]omni_comms_/);
    }
  });

  it('creates no runtime request, message, job or attempt record', () => {
    expect(MIGRATION).not.toMatch(/INSERT INTO public\.omni_comms_(request|message|dispatch_job|delivery_attempt)/);
    for (const raw of [POLICY_SERVICE, POLICIES_TAB]) {
      const src = code(raw);
      expect(src).not.toMatch(/dispatch|delivery_attempt|omni_comms_message/i);
    }
  });

  it('enforces nothing at runtime — limits, retries, quiet hours and cost are declarations', () => {
    expect(code(POLICY_SERVICE)).not.toMatch(/setTimeout|setInterval|retry\(|rateLimit|enforce/i);
    expect(POLICIES_TAB).toMatch(/No retry or provider timeout is|RELIABILITY_NOTICE/);
    expect(POLICIES_TAB).toContain('RETENTION_NOTICE');
    expect(POLICIES_TAB).toContain('COST_NOTICE');
  });

  it('keeps the legacy Email wrapper delegating to the generic worker', () => {
    expect(MIGRATION).toContain('omni_comms_priv_channel_policy_upsert(\n    v_uid, p_id');
    expect(MIGRATION).toContain('email_channel_only_in_build2');
  });

  it('labels operational states and retry profiles for operators', () => {
    expect(OPERATIONAL_STATE_LABEL.pilot_ready).toBe('Pilot ready');
    expect(RETRY_PROFILE_LABEL.conservative).toBe('Conservative');
  });
});
