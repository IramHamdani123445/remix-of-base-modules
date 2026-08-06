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
| `supabase/test-support/award_suspension_test_environment_seed.sql` | Idempotent seed: environment marker, UAT actors, synthetic fixtures |
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
* an existing `PRODUCTION` environment marker aborts the run;
* an already-activated module (`actions_enabled = true`) aborts the run;
* postflight re-asserts exactly one `TEST` marker and `actions_enabled = false`.

## What is provisioned

* **Environment marker** — exactly one row in `public.platform_environment_marker`:
  `environment_kind = TEST`, `allows_controlled_test_activation = true`,
  `project_ref = <isolated Test project reference>`.
* **Actors** (synthetic, least privilege):

  | Role | Actor id | Email | Actions |
  | --- | --- | --- | --- |
  | `BN_CLAIMS_OFFICER` | `a7a7a7a7-…-0001` | `bn-uat-claims-officer@test.local` | view, propose, resume_propose, withdraw |
  | `BN_SUPERVISOR` | `a7a7a7a7-…-0002` | `bn-uat-supervisor@test.local` | view, approve, resume_approve |
  | `BN_MANAGER` | `a7a7a7a7-…-0003` | `bn-uat-manager@test.local` | view, execute, resume_execute, view_payment_impact |
  | `BN_AUDITOR` | `a7a7a7a7-…-0004` | `bn-uat-auditor@test.local` | view, view_payment_impact (read-only) |

* **Configuration** — synthetic product `UATSP` + version, one enabled level-1
  approval policy routed to workbasket `BN_SUSP_UAT_L1` (`BN_SUPERVISOR`,
  self-approval forbidden), reason codes `SUSP_UAT_NONCOMPLIANCE`,
  `SUSP_UAT_REVIEW`, `RESUME_UAT_COMPLIANT`.
* **Data** — one synthetic claim `UAT-CLM-0001`, three synthetic awards
  (`UAT-AWD-0001..0003`, SSNs `900000001..3`) and 18 pending monthly payment
  schedule rows. No real claimant, award or payment data is used.

## Known environment finding

Databases built from the current reviewed baseline still carry the legacy
constraint `app_modules_rollout_state_check` allowing only
`hidden | internal_pilot | public`, so the literal `READ_ONLY` value cannot be
stored. The seed detects this and leaves `rollout_state` untouched; the
read-only posture is enforced by `actions_enabled = false`, which is what every
suspension RPC gate reads (`E_FEATURE_DISABLED`). The same constraint would
make the `disable` path of `activate-award-suspension-test.sh` fail on such a
database — widen the constraint to include `READ_ONLY` before Wave 1
activation.
