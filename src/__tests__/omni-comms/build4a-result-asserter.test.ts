/**
 * Build 4A — independent validation of the structured-result asserter.
 *
 * A structured result is only acceptable when every certification invariant
 * holds. These tests prove the asserter rejects each individual defect rather
 * than passing on a well-shaped but untruthful result.
 */
import { describe, it, expect } from 'vitest';
import { assertResult } from '../../../scripts/omni-comms/integration/assert-build4a-result';
import {
  RESULT_SCHEMA,
  RESULT_VERSION,
  SUCCESS_VERDICT,
  AUTHORIZATION_MARKER,
  ATOMICITY_MARKER,
  REQUIRED_SCENARIOS,
  DENIAL_MATRIX,
  ZERO_SIDE_EFFECTS,
  PREFLIGHT_FIELDS,
  OUTBOUND_PROVIDER_CALLS_SENTINEL,
  REQUIRED_HEALTH_POSTURE,
} from '../../../scripts/omni-comms/integration/certificationContract';

const SHA = 'a'.repeat(40);
const ORG = '11111111-1111-4111-8111-111111111111';
const FOREIGN_ORG = '22222222-2222-4222-8222-222222222222';

function validResult(): Record<string, unknown> {
  return {
    schema: RESULT_SCHEMA,
    version: RESULT_VERSION,
    refused: false,
    refusal_reason: null,
    commit_sha: SHA,
    environment: 'non_production',
    verdict: SUCCESS_VERDICT,
    deployed_health: { revision: SHA, ...REQUIRED_HEALTH_POSTURE },
    identities_validated: 3,
    identities: [
      { identity: 'configure', is_admin: false, has_configure_capability: true, organization_id: ORG },
      { identity: 'unprivileged', is_admin: false, has_configure_capability: false, organization_id: ORG },
      { identity: 'foreign', is_admin: false, has_configure_capability: true, organization_id: FOREIGN_ORG },
    ],
    namespaced_organizations_verified: 2,
    scenarios: REQUIRED_SCENARIOS.map((name) => ({
      name,
      ok: true,
      measured: DENIAL_MATRIX[name] ? { ...DENIAL_MATRIX[name] } : { status: 200, code: null },
    })),
    scenarios_total: REQUIRED_SCENARIOS.length,
    passed: REQUIRED_SCENARIOS.length,
    failed: 0,
    preflight_cleanup: Object.fromEntries(PREFLIGHT_FIELDS.map((f) => [f, 0])),
    side_effects: {
      ...Object.fromEntries(ZERO_SIDE_EFFECTS.map((k) => [k, 0])),
      provider_adapter_present: false,
      outbound_provider_calls: OUTBOUND_PROVIDER_CALLS_SENTINEL,
    },
    safety_breached: false,
    cleanup_ok: true,
    cleanup: 'verified',
    cleanup_failures: [],
    residual_rows: {
      fault_objects: 0,
      core_staff_assignments: 0,
      temporary_role_grants: 0,
      omni_comms_request: 0,
    },
    authorization_marker: AUTHORIZATION_MARKER,
    atomicity_marker: ATOMICITY_MARKER,
  };
}

function reject(mutate: (r: Record<string, unknown>) => void, match: RegExp): void {
  const r = validResult();
  mutate(r);
  const failures = assertResult(r, SHA);
  expect(failures.length, 'expected at least one failure').toBeGreaterThan(0);
  expect(failures.join(' | ')).toMatch(match);
}

describe('Build 4A structured-result asserter', () => {
  it('accepts a fully truthful certification result', () => {
    expect(assertResult(validResult(), SHA)).toEqual([]);
  });

  it('rejects a shortened or mismatched expected SHA', () => {
    expect(assertResult(validResult(), SHA.slice(0, 8)).join(' | ')).toMatch(/40-character/);
    expect(assertResult(validResult(), 'b'.repeat(40)).join(' | ')).toMatch(/commit SHA/);
  });

  it('rejects an unrecognised schema or version', () => {
    reject((r) => { r.schema = 'something.else'; }, /schema is not recognised/);
    reject((r) => { r.version = 1; }, /version is not supported/);
  });

  it('rejects a refused or absent refusal flag', () => {
    reject((r) => { r.refused = true; }, /harness refused/);
    reject((r) => { delete r.refused; }, /harness refused/);
  });

  it('rejects the incomplete or overstated verdict', () => {
    reject((r) => { r.verdict = 'BUILD 4A VERIFIED'; }, /bootstrap authorization and atomicity verdict/);
  });

  it('rejects a deployed revision that does not equal the certified commit', () => {
    reject((r) => {
      (r.deployed_health as Record<string, unknown>).revision = 'c'.repeat(40);
    }, /deployed Edge revision/);
  });

  it('rejects a production or already-certified deployed runtime posture', () => {
    reject((r) => {
      (r.deployed_health as Record<string, unknown>).environment = 'production';
    }, /posture mismatch: environment/);
    reject((r) => {
      (r.deployed_health as Record<string, unknown>).liveDeliveryEnabled = true;
    }, /posture mismatch: liveDeliveryEnabled/);
    reject((r) => { r.environment = 'production'; }, /environment is not non_production/);
  });

  it('rejects administrator or wrongly-capable certification identities', () => {
    reject((r) => {
      (r.identities as Array<Record<string, unknown>>)[0].is_admin = true;
    }, /global administrator/);
    reject((r) => {
      (r.identities as Array<Record<string, unknown>>)[1].has_configure_capability = true;
    }, /unprivileged identity must not hold/);
    reject((r) => {
      (r.identities as Array<Record<string, unknown>>)[2].organization_id = ORG;
    }, /separate certification tenant/);
    reject((r) => { r.identities_validated = 2; }, /three certification identities/);
  });

  it('rejects a missing, failed or duplicated scenario', () => {
    reject((r) => {
      r.scenarios = (r.scenarios as unknown[]).slice(1);
      r.scenarios_total = (r.scenarios as unknown[]).length;
      r.passed = r.scenarios_total;
    }, /required scenario missing/);
    reject((r) => {
      (r.scenarios as Array<Record<string, unknown>>)[0].ok = false;
    }, /scenario did not pass/);
    reject((r) => {
      const list = r.scenarios as Array<Record<string, unknown>>;
      list.push({ ...list[0] });
      r.scenarios_total = list.length;
      r.passed = list.length;
    }, /duplicate scenario name/);
  });

  it('rejects a denial with the wrong status or the wrong bounded code', () => {
    reject((r) => {
      const s = (r.scenarios as Array<Record<string, unknown>>).find(
        (x) => x.name === 'missing_capability_denied',
      )!;
      (s.measured as Record<string, unknown>).status = 400;
    }, /missing_capability_denied: measured HTTP status/);
    reject((r) => {
      const s = (r.scenarios as Array<Record<string, unknown>>).find(
        (x) => x.name === 'unauthenticated_denied',
      )!;
      (s.measured as Record<string, unknown>).code = 'permission_denied';
    }, /unauthenticated_denied: measured error code/);
  });

  it('rejects inconsistent scenario totals', () => {
    reject((r) => { r.scenarios_total = 99; }, /scenario total does not match/);
    reject((r) => { r.failed = 1; }, /failed scenario/);
    reject((r) => { r.passed = 0; }, /pass count/);
  });

  it('rejects unmeasured preflight cleanup fields', () => {
    reject((r) => {
      delete (r.preflight_cleanup as Record<string, unknown>).stale_fault_triggers;
    }, /preflight cleanup field is not numeric/);
  });

  it('rejects any non-zero side effect', () => {
    for (const key of ZERO_SIDE_EFFECTS) {
      reject((r) => {
        (r.side_effects as Record<string, unknown>)[key] = 1;
      }, new RegExp(`side-effect counter is not zero: ${key}`));
    }
  });

  it('rejects a fabricated provider-call count and a present provider adapter', () => {
    reject((r) => {
      (r.side_effects as Record<string, unknown>).outbound_provider_calls = 0;
    }, /not-applicable sentinel/);
    reject((r) => {
      (r.side_effects as Record<string, unknown>).provider_calls = 0;
    }, /must not be inferred/);
    reject((r) => {
      (r.side_effects as Record<string, unknown>).provider_adapter_present = true;
    }, /provider adapter capable of dispatch/);
    reject((r) => { r.safety_breached = true; }, /safety breach/);
  });

  it('rejects incomplete cleanup or residual fixtures', () => {
    reject((r) => { r.cleanup_ok = false; }, /fixture cleanup did not succeed/);
    reject((r) => { r.cleanup_failures = ['delete failed']; }, /cleanup reported failures/);
    reject((r) => {
      (r.residual_rows as Record<string, unknown>).core_staff_assignments = 2;
    }, /residual rows remain/);
    reject((r) => {
      delete (r.residual_rows as Record<string, unknown>).fault_objects;
    }, /residual measurement missing: fault_objects/);
    reject((r) => { r.residual_rows = {}; }, /residual row measurement is missing/);
  });

  it('rejects missing certification markers', () => {
    reject((r) => { r.authorization_marker = 'OK'; }, /authorization integration marker/);
    reject((r) => { delete r.atomicity_marker; }, /atomicity integration marker/);
  });

  it('rejects an empty result outright', () => {
    expect(assertResult({}, SHA).length).toBeGreaterThan(5);
  });
});
