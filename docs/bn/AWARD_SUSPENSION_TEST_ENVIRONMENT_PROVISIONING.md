# Award Suspension — Isolated Test Database Provisioning

Wave 1 controlled UAT requires an isolated **non-production** database. This
runbook provisions it. It never activates the module: activation stays with
`scripts/bn/activate-award-suspension-test.sh`.

Certified source HEAD: `bdf18e1520a8a64506e12d6c6f640a9a35e4760f`
Forbidden target: project `xynceskeiiisiefqlgxo` (Lovable Cloud Test/Live).

## Artefacts

| File | Purpose |
| --- | --- |
| `scripts/bn/provision-award-suspension-test-db.sh` | Guarded wrapper: identity checks, optional schema build, seed, postflight |
| `supabase/test-support/award_suspension_test_environment_seed.sql` | Idempotent seed: environment marker, UAT actors, exact role matrix, synthetic fixtures |
| `scripts/bn/__tests__/provision-award-suspension-test-db.spec.sh` | 29-case guard suite (disposable PostgreSQL 15) |
| `scripts/ci/bootstrap-supabase-test-db.sh` | Reviewed baseline + forward migrations (reused, unchanged) |

## Protected environment variables

Store these in the **protected UAT environment** (GitHub Environment
`bn-award-suspension-uat` or the operator's secret store). They must never be
committed and must never point at `xynceskeiiisiefqlgxo`.

| Name | Value |
| --- | --- |
| `BN_SUSP_DB_URL` | connection string of the isolated Test database |
| `BN_SUSP_EXPECTED_DATABASE` | exact database name, asserted before any write |
| `BN_SUSP_TEST_PROJECT_REF` | isolated Test project reference stamped into the marker |
| `BN_SUSP_CONFIRM_NONPROD` | `YES` |

## Run

```bash
export BN_SUSP_CONFIRM_NONPROD=YES
export BN_SUSP_DB_URL='postgresql://…'          # isolated Test only
export BN_SUSP_EXPECTED_DATABASE='skn_bn_susp_uat'
export BN_SUSP_TEST_PROJECT_REF='<isolated-test-project-ref>'
export BN_SUSP_BOOTSTRAP=YES                    # first run only (empty database)

bash scripts/bn/provision-award-suspension-test-db.sh
```

Success marker: `BN_SUSP_PROVISION_RESULT: PASS`.

## Guards (all fail closed)

* live project ref `xynceskeiiisiefqlgxo` denylisted in URL, ref and db name;
* `prod|production|live|prd|release` tokens rejected;
* `current_database()` must equal `BN_SUSP_EXPECTED_DATABASE`;
* the canonical marker is a **singleton**: a `PRODUCTION` marker, a marker for a
  different project ref, or more than one row aborts the run — the seed never
  overrides an existing marker automatically;
* an already-activated module (`actions_enabled = true`) aborts the run;
* postflight re-asserts exactly one `TEST` marker, `actions_enabled = false`
  and `rollout_state = internal_pilot`.

## Rollout state and posture

`public.app_modules.rollout_state` is governed by the shared enterprise
constraint `hidden | internal_pilot | public`. Module-specific labels are
therefore **derived, never stored**:

| Stored | Derived posture |
| --- | --- |
| `rollout_state = internal_pilot`, `actions_enabled = false` | `READ_ONLY` |
| `rollout_state = internal_pilot`, `actions_enabled = true` | `TEST_ACTIVE` |

`scripts/bn/activate-award-suspension-test.sh status` prints
`effective_posture=…` computed from `actions_enabled`, which is the flag every
suspension RPC gate reads (`E_FEATURE_DISABLED`).

## What is provisioned

* **Environment marker** — exactly one row in `public.platform_environment_marker`:
  `environment_kind = TEST`, `allows_controlled_test_activation = true`,
  `project_ref = <isolated Test project reference>`.
* **Actors** (synthetic, least privilege). These are **database fixtures for
  RPC-level UAT only**. Browser UAT accounts must be provisioned separately
  through hosted Auth on the isolated Test project — the seed never creates
  sign-in credentials.

  | Role | Actor id | Email | Granted Award Suspension actions |
  | --- | --- | --- | --- |
  | `BN_CLAIMS_OFFICER` | `a7a7a7a7-…-0001` | `bn-uat-claims-officer@test.local` | `view`, `propose`, `resume_propose`, `withdraw` |
  | `BN_SUPERVISOR` | `a7a7a7a7-…-0002` | `bn-uat-supervisor@test.local` | `view`, `approve`, `resume_approve` |
  | `BN_MANAGER` | `a7a7a7a7-…-0003` | `bn-uat-manager@test.local` | `view`, `execute`, `resume_execute`, `view_payment_impact`, `resolve_payment_exception` |
  | `BN_AUDITOR` | `a7a7a7a7-…-0004` | `bn-uat-auditor@test.local` | `view`, `audit`, `view_payment_impact` (read-only) |

  Every other `bn_award_suspension` action is explicitly revoked
  (`is_granted = false`) for these four roles, including grants that already
  existed before provisioning. Supervisors hold no proposal rights and managers
  hold no approval rights, so maker/checker/executor separation is enforced by
  data, not convention.

* **Configuration** — synthetic product `UATSP` + version, one enabled level-1
  approval policy routed to workbasket `BN_SUSP_UAT_L1` (`BN_SUPERVISOR`,
  self-approval forbidden), reason codes `SUSP_UAT_NONCOMPLIANCE`,
  `SUSP_UAT_REVIEW`, `RESUME_UAT_COMPLIANT`.
* **Data** — three synthetic claims `UAT-CLM-0001..3` mapped one-to-one to three
  synthetic awards `UAT-AWD-0001..3` on reserved SSNs `900000001..3`, plus 18
  pending monthly payment schedule rows. No real claimant, award or payment data
  is used.

## Automated verification

```bash
# local: builds its own throwaway cluster (PostgreSQL 15 preferred)
bash scripts/bn/__tests__/provision-award-suspension-test-db.spec.sh

# against a disposable server (CI)
BN_SUSP_TEST_ADMIN_URL='postgres://postgres:postgres@localhost:5433/postgres' \
  bash scripts/bn/__tests__/provision-award-suspension-test-db.spec.sh
```

The suite covers argument guards, the denylist, marker fail-closed behaviour,
the exact permission matrix (including revocation of unexpected pre-existing
grants), fixture ownership coherence, idempotency of a second run, and the
absence of credentials in output. It runs in CI as the
`Test-environment provisioner guard suite` job of
`.github/workflows/bn-suspension-integration.yml`, on its own disposable
`postgres:15` service, and never touches the lifecycle harness database.

