# BN Uprating — Controlled Existing-Data Validation Environment

Status: **BLOCKED — authorised non-production project not available inside Lovable**

## Position

| Item | State |
| --- | --- |
| Epic 0–3 | COMPLETE — CERTIFIED |
| Epic 4 | COMPLETE — TECHNICALLY CERTIFIED (65 green, 289/289 Uprating) |
| Epic 5 / `BN_UPRATING_CLOSE_RUN` | NOT_STARTED (not implemented in this continuation) |
| Canonical catalogue | 16 / 17 implemented |
| Controlled existing-data operational walkthrough | NOT PERFORMED |

## Environment finding

- The only backend reachable from this workspace is the connected Lovable Cloud project
  `xynceskeiiisiefqlgxo`, which is the repository's explicitly denylisted live project.
- `public.platform_environment_marker` on that project contains **no row**; the fail-closed
  model therefore refuses controlled activation. No marker was seeded, no policy or run was
  created, and no Award, payment schedule or communication was mutated.
- No separate authorised non-production project containing pre-existing Benefits data is
  reachable from this environment, and Lovable cannot provision an isolated Postgres project
  with an authorised existing-data refresh.

## Delivered in this continuation

`scripts/bn/provision-uprating-validation-db.sh` — a reusable, architecture-consistent guarded
provisioner that mirrors the defensive pattern of
`scripts/bn/provision-award-suspension-test-db.sh` **without** its synthetic fixture seeding.

Guards, all fail-closed before any write:

1. `BN_UPR_CONFIRM_NONPROD=YES` explicit non-production confirmation
2. live project-ref denylist (`xynceskeiiisiefqlgxo`)
3. production-token rejection (`prod`, `production`, `live`, `prd`, `release`) across URL,
   database name and project ref
4. `SELECT current_database()` must equal `BN_UPR_EXPECTED_DATABASE`
5. application-schema presence check (optional `BN_UPR_BOOTSTRAP=YES` builds schema only)
6. existing-marker conflict validation — PRODUCTION marker, mismatched `project_ref`,
   `allows_controlled_test_activation = false`, or multiple rows all STOP; markers are never
   silently overwritten
7. marker creation only after positive non-production identity, with real values
   (`environment_kind = TEST`, meaningful label, actual project ref, activation = true)
8. postflight proof: exactly one non-production marker, matching project ref, activation true
9. existing-data gate: zero Awards returns
   `CONTROLLED WORKFLOW VALIDATION BLOCKED — NON-PRODUCTION PROJECT HAS NO AUTHORISED EXISTING BENEFITS DATA`
10. governance provenance label (`BN_UPR_DATA_PROVENANCE`) is mandatory and recorded

No credentials or connection strings are hard-coded or committed. The script never activates a
module, never mutates an Award, and never inserts business/master data.

## Source-data attestation

```
SOURCE DATA USED FOR WALKTHROUGH = NONE (walkthrough not performed)
NO SYNTHETIC PERSON/AWARD/PRODUCT/PAYMENT/INDEX/REFERENCE SOURCE DATA CREATED
```

## Required infrastructure inputs to unblock

- an isolated non-production Postgres/Supabase project with a **distinct project ref**
  (must not be `xynceskeiiisiefqlgxo`) and a non-production database name
- connection / bootstrap authority (`BN_UPR_DB_URL`, `BN_UPR_EXPECTED_DATABASE`,
  `BN_UPR_TEST_PROJECT_REF`) supplied as operator secrets
- authority to record `public.platform_environment_marker` in that project
- pre-existing authorised Benefits data in that project (Product/version, Award with current
  rate/amount, person linkage, payment profile and schedule context, and the governed
  reference/index configuration the policy will derive from), sourced via an already-authorised
  data-governance refresh outside the Uprating workflow
- browser sign-in-capable maker and independent checker users with policy maker, policy
  approver, run preparer/submitter, run approver, executor and rollback-checker authority
