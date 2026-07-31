# Omni-Comms Build 3 — Privileged Certification Readiness

**Status: NOT CERTIFIED.** No privileged certification run has been executed or
accepted. Nothing in this document may be read as evidence of live delivery
readiness. No provider is contacted anywhere in this build.

## 1. What this correction round changed

| # | Defect | Correction |
|---|--------|-----------|
| 1 | Certification workflow contained a stray `done`, which would abort the sanitize step | Removed; a new **Validate embedded shell syntax** step runs `bash -n` over every `run:` block before the harness executes |
| 2 | Harness had 16 scenarios; three required semantics were unproven | Added `department_access_rejection`, `registered_but_unauthorised_module_rejection`, `concurrent_idempotency_semantics`, plus `edge_revision_binding` |
| 3 | Assertions accepted weak evidence | Every scenario now asserts HTTP status, `contractVersion`, exact bounded blocker arrays, and persisted counts |
| 4 | Resolution assertions read a non-existent column and checked only presence | Reads `omni_comms_recipient.resolution_snapshot`; asserts pinned route, template family/version/number, layout + layout version, sender identity, provider binding, provider account, sha-256 template/layout/asset checksums and `live_delivery_ready !== true` |
| 5 | Rendering assertions tolerated unrendered messages | Asserts every message is `rendered`, carries a 64-hex checksum, has no unresolved required slots or blockers, and that response checksums equal persisted checksums |
| 6 | `no_message` was misleading; provider/email counts were hardcoded `0` | Fields renamed to `no_message_remaining` / `no_runnable_dispatch_job`; provider calls and emails are now **measured** from `omni_comms_delivery_attempt` |
| 7 | Cleanup was unchecked and referenced a non-existent table | Every delete result is checked; post-cleanup counts verified for request, recipient, message, message_event and dispatch_job |
| 8 | Certification was not bound to a source revision | The harness refuses to run without a full 40-character `COMMIT_SHA`/`GITHUB_SHA`; the workflow injects `git rev-parse HEAD` and re-asserts equality in the log |
| 9 | Deployed Edge build was unidentifiable | `/health` now returns `revision` (`OMNI_COMMS_EDGE_REVISION`) and `revisionVerified`; the harness fails when it does not equal the certified commit |
| 10 | Caller-module authorisation was registry-membership only | New `omni_comms_caller_module_registry` maps every caller module to a required capability; `omni_comms_priv_authorize_runtime_actor` now refuses `permission_denied` for a registered module the actor may not act for |
| 11 | Browser result contract coerced malformed payloads | `parseSendCommunicationResult` now enforces the contract version, rejects a payload with any malformed element, requires a valid `createdAt`, a boolean `replayed`, a valid mode, and a `requestId` on non-blocked results |
| 12 | Slice 2c-iii rendering verifier was not part of certification | Added as a required workflow step with its own marker |

## 2. Scenario inventory (18 executed, enforced)

`missing_jwt_rejection`, `permission_rejection`, `cross_tenant_rejection`,
`spoofed_caller_module_rejection`, `department_access_rejection`,
`registered_but_unauthorised_module_rejection`, `valid_first_request`,
`recipient_persistence`, `deterministic_resolution`, `deterministic_rendering`,
`identical_replay`, `mismatched_replay_rejection`,
`concurrent_idempotency_semantics`, `dry_run_creates_no_jobs`,
`shadow_creates_held_jobs_only`, `queued_creates_held_jobs_only`,
`atomic_failure_no_partial_records`, `safety_invariants`, `cleanup_verified`
— 19 named scenarios in total, of which `shadow_` and `queued_` are generated
by one loop.

`EXPECTED_SCENARIO_COUNT` is asserted against the number actually executed and
duplicate names are rejected, so the reported figure can never overstate or
understate coverage. Edge-revision binding is **no longer a scenario**: it is a
precondition evaluated before any fixture is created, and a mismatch refuses
the run (exit 2) rather than being counted as a pass.

## 3. Safety evidence model

All four safety statements are measured against **this run's fixtures only**,
never globally — a shared staging project must not be able to pass or fail a
certification for rows the harness did not create:

- `no_runnable_dispatch_job` — every fixture job row must be `status='held'`
  and `is_runnable=false`, with `attempt_count=0`, no lock and no lease.
- `no_delivery_attempt` — count of `omni_comms_delivery_attempt` rows scoped to
  fixture message ids must be `0`.
- `no_provider_call` — derived from those delivery-attempt rows.
- `no_email` — fixture delivery attempts against email-channel messages.

Terminal message status is mode-derived and asserted as such:
`dry_run → dry_run_completed`, `shadow → shadow_completed`, `queued → held`.
The transient `rendered` state is never accepted as terminal evidence.

Recipients on both the fresh and replay responses are read back through
`omni_comms_priv_load_persisted_recipients`, and the harness asserts the
projected ids equal the persisted ids and that no destination (email/phone)
leaks onto the contract.

The harness exits non-zero if any of these is breached, even when every
scenario otherwise passes.


## 4. Deployment binding

Deploy the runtime function with the source revision published as a function
secret:

```
OMNI_COMMS_EDGE_REVISION=<git rev-parse HEAD>
```

Until that secret is present, `/health` reports `revisionVerified: false` and
the privileged workflow (which sets `OMNI_COMMS_REQUIRE_EDGE_REVISION=1`)
refuses to certify.

Artifacts are named after the **actual checked-out revision**
(`git rev-parse HEAD`), not `github.sha`, so a run launched against a specific
`ref` cannot produce an artifact labelled with a different commit.

## 5. Prerequisites an administrator must configure before the first privileged run

1. **Publish the Edge revision.** Deploy `omni-comms-runtime` to staging with
   the function secret `OMNI_COMMS_EDGE_REVISION` set to the exact
   40-character commit being certified. Without it `/health` reports
   `revisionVerified: false` and the run is refused before any fixture exists.
2. **Create the `omni-comms-staging` GitHub environment** (with whatever
   reviewers/protection rules your governance requires) and populate its
   secrets:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` for the staging project
     (never a production project).
   - `OMNI_COMMS_TEST_USER_JWT` — a real, authorised staging operator holding
     the capability for the caller module under test, scoped to the test
     organisation and department.
   - `OMNI_COMMS_TEST_UNPRIVILEGED_JWT` — a genuinely unprivileged staging
     user, used by `permission_rejection`. A second admin will make the
     scenario fail.
   - `OMNI_COMMS_TEST_ORG_ID`, `OMNI_COMMS_TEST_DEPARTMENT_ID`,
     `OMNI_COMMS_TEST_EVENT_CODE`, `OMNI_COMMS_TEST_CALLER_MODULE`.
   - `OMNI_COMMS_TEST_FOREIGN_ORG_ID` — a second staging organisation the test
     actor has no access to, for `cross_tenant_rejection`.
   - `OMNI_COMMS_TEST_FOREIGN_DEPARTMENT_ID` — a department inside the test
     organisation the actor is not entitled to, for
     `department_access_rejection`.
   - `OMNI_COMMS_TEST_UNAUTHORISED_MODULE` — a module registered in
     `omni_comms_caller_module_registry` whose required capability the test
     actor does **not** hold. The default `FINANCE` fails for a
     platform-admin test actor; use a non-admin operator or pick a module
     outside their capability set.
3. **Seed a fully configured send path** in the test organisation for the
   chosen event, channel and locale: active event route, published template
   version pinned to a published layout, verified sender identity, and an
   active verified sender→provider-account binding. `valid_first_request`
   fails if any step of the Setup Wizard is incomplete.
4. **Register the caller module** used by the test in
   `omni_comms_caller_module_registry` with its required capability.
5. **Run the workflow manually** (`workflow_dispatch`), selecting the ref whose
   commit matches `OMNI_COMMS_EDGE_REVISION`, then archive the sanitized
   artifact.

No provider dispatch, live delivery, retry, webhook or legacy cutover work is
introduced by this round.
