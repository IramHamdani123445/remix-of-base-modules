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

## 2. Scenario inventory (19)

`edge_revision_binding`, `missing_jwt_rejection`, `permission_rejection`,
`cross_tenant_rejection`, `spoofed_caller_module_rejection`,
`department_access_rejection`, `registered_but_unauthorised_module_rejection`,
`valid_first_request`, `recipient_persistence`, `deterministic_resolution`,
`deterministic_rendering`, `identical_replay`, `mismatched_replay_rejection`,
`concurrent_idempotency_semantics`, `dry_run_creates_no_jobs`,
`shadow_creates_held_jobs_only`, `queued_creates_held_jobs_only`,
`atomic_failure_no_partial_records`, `safety_invariants`, `cleanup_verified`.

## 3. Safety evidence model

All four safety statements are measured, never asserted by convention:

- `no_runnable_dispatch_job` — every job row must be `status='held'` and `is_runnable=false`, with `attempt_count=0`, no lock and no lease.
- `no_delivery_attempt` — global count of `omni_comms_delivery_attempt` must be `0`.
- `no_provider_call` — derived from delivery-attempt rows (a provider call cannot exist without one).
- `no_email` — delivery attempts against email-channel messages.

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

## 5. Remaining prerequisites before a certification run

1. Publish `OMNI_COMMS_EDGE_REVISION` on the staging deployment.
2. Provision the `omni-comms-staging` environment secrets, including a
   genuinely unprivileged JWT and an `OMNI_COMMS_TEST_UNAUTHORISED_MODULE`
   value the test actor is not entitled to (the default `FINANCE` fails for a
   platform-admin test actor — use a non-admin operator).
3. Run the workflow manually and archive the sanitized artifact.

No provider dispatch, live delivery, retry, webhook or legacy cutover work is
introduced by this round.
