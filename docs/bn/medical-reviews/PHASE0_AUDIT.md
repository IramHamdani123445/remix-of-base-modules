# Benefits — Medical Reviews Controlled Vertical Slice

## Phase 0 Audit (read-only). No implementation performed.

**Gate status:** UNBLOCKED — locally reproducible, pending the GitHub Actions run.

The gate was previously blocked because
`.github/workflows/bn-life-certificate-integration.yml` could not build a
schema: 827 of 1298 migrations fail when replayed from an empty database,
because much of the schema predates migrations and no migration creates it.

That baseline defect is now fixed. Both clean-database workflows build their
schema through `scripts/ci/bootstrap-supabase-test-db.sh`
(Supabase substrate -> `supabase/baseline/schema.sql` -> every migration after
the cutoff). On a database built that way from scratch:

- `supabase/verify/bn_life_certificate_effective_grants.sql` — passed
- `supabase/tests/bn/life_certificate_integration.sql` —
  `BN_LC_HARNESS_RESULT: PASS`, no scenario skipped

Rationale and regeneration procedure: `supabase/baseline/README.md`.

Medical Review implementation still may not begin until the
`bn-life-certificate-integration` workflow is observed green on GitHub
Actions, which is outside this environment. No Medical Review code,
migration, route, permission or seed has been created.

---

## 1. Existing surface inventory

### 1.1 Medical tables present in the database (`public`)

| Table | Role today | Relevance to this slice |
|---|---|---|
| `bn_medical_procedure` | Procedure master | Reuse (clinical catalogue) |
| `bn_medical_facility` | Facility master (16 cols: `facility_code`, `provider_type`, `is_approved`, `country_code`, `jurisdiction_level`, effective dates) | **Nearest existing thing to a provider registry — facility-grained only.** No individual doctor, licence, specialty, panel/contract, portal identity, conflict or fee columns |
| `bn_medical_facility_procedure` | Availability matrix | Reuse |
| `bn_medical_provider_type` | Provider-type lookup | Reuse as the seed of the provider-type dimension |
| `bn_medical_referral_rule` | Referral rules by jurisdiction (reimbursement domain, not review referral) | Distinct concern — do **not** overload |
| `bn_medical_authorization_rule` | Pre-authorisation rules | Distinct (reimbursement) |
| `bn_medical_expense_type`, `bn_medical_reimbursement_limit`, `bn_medical_reimbursement_calc`, `bn_medical_claim_expense` | Reimbursement / Medical Policy Library | Distinct — provider **fees** for reviews must not be merged into claimant reimbursement |
| `bn_medical_recommendation` | Referrals out | Overlaps conceptually with medical opinion; needs disambiguation before reuse |
| `bn_medical_review_schedule` (14 cols: `bn_award_id`, `review_type`, `scheduled_date`, `completed_date`, `outcome`, `examining_provider` (free text), `next_review_date`, `status`, `remarks`, audit cols) | The **only** existing Medical Review object | Single overloaded `status` column; free-text provider; no policy snapshot, referral, appointment, assessment, board or administrative-decision dimension. Cannot satisfy §8 as-is |
| `bn_medical_tariff_table`, `bn_medical_tariff_row` | **Deprecated** (see `docs/bn/medical-engine-audit.md`) | Do not extend |

### 1.2 Absent entirely

No `bn_medical_review_policy*`, `bn_medical_review_obligation`,
`bn_medical_review_referral`, `bn_medical_provider*`,
`bn_medical_review_appointment`, `bn_medical_assessment*`,
`bn_medical_board*`, `bn_medical_review_administrative_decision`,
`bn_medical_review_communication_intent`,
`bn_medical_review_scheduler_attempt`, or
`bn_medical_review_case_evidence_link`. **There is no Medical Board object of
any kind in the database** — board composition, membership, quorum, sessions,
participation, votes and decisions are all greenfield.

### 1.3 Reusable command/authority boundaries (already hardened)

- **Award Suspension** — `bn_award_suspension_event`,
  `bn_award_suspension_payment_impact`, `bn_award_suspension_execute_v1`,
  reinstatement lifecycle RPCs. Authoritative for suspension, reinstatement,
  payment holds and arrears. Medical Reviews must only *propose*.
- **Communication adapter** — `bn_communication_dispatch`,
  `bn_communication_adapter_source`, `bn_communication_adapter_dispatch_v1` /
  `_record_failure_v1` / `_sync_v1`, `_bn_comm_transition_allowed`, edge
  function `bn-communication-adapter`. Terminal-state hardened. Reuse directly.
- **Life Certificates** — the structural template to follow: policy table
  (`bn_life_certificate_policy`, 32 cols), obligation, event log,
  scheduler-attempt, case-evidence-link, communication-intent, plus
  `_bn_lc_can_access` / `_bn_lc_can_access_award` record-level guards and a
  seeded transaction/rollback SQL harness.
- **Product versioning** — `bn_product`, `bn_product_version`,
  `bn_product_parameter`, `bn_product_amendment_policy`. Policy versions must
  hang off `bn_product_version` and be snapshotted onto each obligation.
- **Gating** — `src/lib/bn/featureToggles.ts` already declares
  `bn.servicing.medicalReview: false` and maps `/bn/medical-reviews` to it, and
  `app_modules.actions_enabled` drives the authoritative dark-launch banner.
  Both stay off.
- **Provider-facing surface** — `src/portals/doctor/DoctorPortal.tsx` exists as
  a doctor-registration portal. It is **not** a referral workspace and grants no
  case-scoped access; a Medical Provider Portal would build on the external-task
  portal pattern, not on the ordinary authenticated role.

---

## 2. Answers to the §21 audit questions

Confirmed answers are grounded in code/DB. Everything else is recorded as an
**unresolved business-policy decision** and must be configurable, per §21.

| # | Question | Finding |
|---|---|---|
| 1 | Which products require periodic Medical Review | **Unresolved.** No product-level linkage exists; `bn_medical_review_schedule` is award-level and ad hoc |
| 2 | Which products use treating doctors | **Unresolved.** Not modelled |
| 3 | Which products use external assigned doctors | **Unresolved.** Not modelled |
| 4 | Which products use internal doctors | **Unresolved.** No internal-doctor actor exists as a provider |
| 5 | Which injury cases require the Medical Board | **Unresolved.** No board object exists |
| 6 | Board decision advisory or binding | **Unresolved** |
| 7 | Board quorum and membership rules | **Unresolved** |
| 8 | Who maintains the approved doctor list | Partially: `bn_medical_facility.is_approved` is facility-level and admin-maintained. Individual-doctor approval **unresolved** |
| 9 | May the claimant choose a doctor | **Unresolved** |
| 10 | Who schedules appointments | **Unresolved.** No appointment object |
| 11 | Who pays doctor fees | **Unresolved.** Only claimant-reimbursement fee logic exists; no provider-fee arrangement |
| 12 | How Board cases are submitted today | Not supported in the system; presumed off-system |
| 13 | Who records the final Benefits decision | Generic `workflow_tasks` maker-checker exists; no medical-specific decision record |
| 14 | Are second opinions permitted | **Unresolved** |
| 15 | How impairment percentage is determined | **Unresolved.** No impairment field anywhere |
| 16 | How appeals/reconsiderations are handled | `bn_appeal*` family exists (out of scope for this slice); linkage to medical determinations **unresolved** |

---

## 3. Conclusions carried into implementation (when unblocked)

1. `bn_medical_review_schedule` must be treated as legacy: retained, read-only,
   and superseded by the multi-dimensional obligation model of §8. It cannot be
   widened, since it has one overloaded `status`.
2. A genuine `bn_medical_provider` registry is required. `bn_medical_facility`
   is retained as the facility dimension and referenced, not extended, so
   internal doctors are first-class clinical actors rather than employee-role
   inferences.
3. The Medical Board domain is entirely greenfield and must be effective-dated
   at both board and membership level, with historical participation preserved.
4. Provider fees must be a separate ledger from
   `bn_medical_claim_expense` / reimbursement, and must never create claimant
   benefit payments.
5. Every authority in §5 becomes a distinct permission and a distinct record-
   level guard, mirroring `_bn_lc_can_access_award`, with no generic
   "medical reviewer" role.
6. Board and administrative decisions produce **proposals only**; Award
   Suspension remains the sole executor.

---

## 4. Required to unblock

A green run of `bn-life-certificate-integration` on GitHub Actions (run URL or
status), or explicit instruction to proceed without it.
