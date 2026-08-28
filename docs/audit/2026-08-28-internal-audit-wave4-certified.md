# Internal Audit — Wave 4, DEF-4 Part 3

## Runtime Dispatch Authorization

Date: 2026-08-28
Environment: `TEST` / `non_production` (`platform_environment_marker`, `allows_controlled_test_activation = true`, `project_ref = xynceskeiiisiefqlgxo`)
Continues: `docs/audit/2026-08-28-internal-audit-wave4-runtime-certification-canary.md`

---

## 1. Why jobs were previously held

`renderOrchestrator.resolveHoldReason()` ended with an unconditional terminal
default:

```ts
// Privileged live-provider readiness has not been certified in this build.
return "runtime_privileged_certification_pending";
```

Consequently **no configuration whatsoever** could produce a runnable dispatch
job. Both canary jobs (`610a237b…` in-app, `f981d804…` email) persisted as
`status = held`, `is_runnable = false`, `attempt_count = 0`.

## 2. What this pass changed

The unconditional hold was replaced by an explicit, ordered, **fail-closed**
authorization decision — not `return null`, and not a global enable flag.

New module: `supabase/functions/omni-comms-runtime/rendering/dispatchAuthorization.ts`

```
evaluateDispatchAuthorization(context) -> { authorized: true }
                                        | { authorized: false, reason }
```

A job may be proposed as `status = queued`, `is_runnable = true`,
`hold_reason = null` only when **every** condition holds, in this order:

| # | Condition | Hold reason when it fails |
|---|---|---|
| 1 | runtime environment = `non_production` | `environment_not_certified` |
| 2 | marker kind = `TEST` and `allows_controlled_test_activation` | `environment_not_certified` |
| 3 | marker `project_ref` = current backend | `project_ref_mismatch` |
| 4 | effective release row exists | `release_control_missing` |
| 5 | `release_state = controlled_pilot` | `release_not_controlled_pilot` |
| 6 | pilot has a future expiry | `pilot_expired` |
| 7 | approved commit = deployed revision, exact 40-char SHA | `runtime_revision_not_approved` |
| 8 | caller module inside the pilot scope | `module_not_in_pilot_scope` |
| 9 | mode `queued` and `queued` permitted | `mode_not_queued` |
| 10 | recipient hash matched the pilot allowlist | `recipient_not_allowlisted` |
| 11 | adapter is credential-free simulation/internal | `provider_not_certification_safe` |
| 11b | adapter unresolved | `provider_credentials_unavailable` |
| 12 | job not quarantined | `job_quarantined` |
| 13 | request created at/after the governed activation instant | `historical_job_not_authorized` |
| 13b | no governed activation instant recorded | `runtime_privileged_certification_pending` |

Reasons are never collapsed into a single generic code. Resolution-time
blockers (`provider_credentials_unavailable`, `provider_account_not_ready`,
`sender_not_verified`, `live_delivery_disabled`) still take precedence, and
`shadow` mode still yields `shadow_mode`.

### Simulation-only adapter restriction

```
CERTIFICATION_SAFE_ADAPTERS  = simulation_email, simulation_in_app,
                               simulation_sms, internal_in_app
EXTERNAL_CREDENTIAL_ADAPTERS = resend, twilio, twilio_whatsapp, twilio_voice,
                               firebase_push, outbound_webhook, print_spool,
                               smtp, ses, sendgrid
```

External adapters are denied by an explicit deny-list **and** by the
allow-list, so a newly added adapter is denied by default.

### Absence denies

`RenderContext.dispatch_certification` is optional. When the render-context RPC
supplies no certification block, no per-channel governance snapshot, or no
evaluation instant, the decision is skipped entirely and the leg stays held
under `runtime_privileged_certification_pending`. Every non-certification
deployment therefore behaves exactly as before this change. The rendering
package remains a pure function of persisted snapshots — the evaluation instant
is injected, never read from a clock inside the package (enforced by the
`OMNI_RESOLVER_RUNTIME_BOUNDARY` architecture rule).

## 3. Governed re-approval — NOT PERFORMED

Section 2 of the instruction requires governed re-certification of the current
deployed revision before dispatch may open. It was **not** executed, for a
reason that is itself a defect:

| Item | Value |
| --- | --- |
| Repository HEAD | `55773cf4a591182a2f052af31733432e9b497d4f` |
| `omni_comms_runtime_certification.certified_commit` | `efd35fa61a545f26fcf7200c887ba4e67b3255f3` |
| Observed runtime revision | `efd35fa61a545f26fcf7200c887ba4e67b3255f3` |
| Observed dispatcher revision | `efd35fa61a545f26fcf7200c887ba4e67b3255f3` |
| Email release `approved_commit` | `efd35fa6…` |
| In-app release `approved_commit` | `efd35fa6…` |

**DEF-13 (High) — the deployed-revision stamp is not advanced on deploy.** The
DEF-12 fix to `senderResolver.ts` was deployed during the previous pass, yet
`observed_runtime_revision` still reports `efd35fa6…`. The revision guard
therefore currently reports "match" for a runtime whose code has changed. A
re-approval against `55773cf4…` would immediately fail the runtime match guard,
because the deployed function still announces the old stamp. Re-approval must
follow a deploy that stamps `OMNI_COMMS_DEPLOYED_REVISION` with the revision
actually shipped.

## 4. Runtime dispatch remains CLOSED — blocking defects

Opening the gate in the renderer is necessary but not sufficient: the
downstream claim/dispatch path cannot execute a credential-free certification
job at all.

**DEF-14 (High) — no simulation-safe email claim path.**
`omni_comms_priv_dispatch_claim_email` hard-requires
`provider_code = 'resend_email'` (`provider_not_supported` otherwise), a
verified sending-domain endpoint, and a secret reference matching
`^OMNI_COMMS_RESEND_…`. A `simulation_email` job can never be claimed. The only
claimable email provider is the live external one this pass is explicitly
forbidden to enable.

**DEF-15 (High) — no in-app dispatcher exists.** `omni-comms-dispatch` drains
the email channel only (`DISPATCHABLE_CHANNEL`), and
`omni_comms_priv_dispatch_claim_generic` accepts only `push`, `webhook`,
`voice`, `sms`. There is no claim path, worker, or adapter invocation for
`in_app`, so in-app delivery, bell persistence and read transition cannot be
proven.

Building either path means creating new governed dispatch surfaces, which is
scope this pass was explicitly instructed not to widen. Both are registered
rather than improvised.

## 5. No retroactive release — evidence

No database change of any kind was made in this pass. Verified after the code
change:

| Control | Observed |
| --- | --- |
| Old canary email job `f981d804…` | `held`, `is_runnable = false`, `attempt_count = 0` |
| Old canary in-app job `610a237b…` | `held`, `is_runnable = false`, `attempt_count = 0` |
| Runnable dispatch jobs, platform-wide | 0 |
| Original 8 quarantined IA outbox rows | untouched, 0 released |
| Internal Audit provider attempts | 0 |
| External live-provider attempts | 0 |

`RUNTIME_DISPATCH_CERTIFIED_FROM` has **not** been set. Until it is recorded,
condition 13b denies every job, so activation cannot occur accidentally.

## 6. Architecture guard tests

`src/__tests__/omni-comms/dispatch-authorization-guard.test.ts` — 18 tests,
all passing. Coverage matches the required matrix:

| Scenario | Expected | Result |
| --- | --- | --- |
| TEST + controlled_pilot + simulation adapter + allowlisted + current revision | runnable | PASS |
| production runtime | held | PASS |
| marker not TEST / activation not allowed | held | PASS |
| project_ref mismatch | held | PASS |
| release missing / live / suspended | held | PASS |
| expired pilot (and null expiry) | held | PASS |
| old or short-SHA revision | held | PASS |
| module outside pilot scope | held | PASS |
| mode other than queued | held | PASS |
| non-allowlisted recipient | held | PASS |
| every external credential-bearing adapter | held | PASS |
| unknown adapter | held | PASS |
| historical / pre-activation job | held | PASS |
| quarantined job | held | PASS |
| no certification context at all | held | PASS |

## 7. DEF-12 regression

`CREDENTIAL_FREE_ADAPTERS` in `resolution/senderResolver.ts` is unchanged, and
the new decision independently denies every external adapter. Credential-free
internal/simulation adapters still require no secret; `resend`, `twilio*`,
`firebase_push` and `outbound_webhook` still require one. No security widening.

## 8. Regression

| Check | Result |
| --- | --- |
| `bunx vitest run src/__tests__/omni-comms` | 2313 passed / 0 failed / 116 files |
| Dispatch authorization guard | 18 / 18 passed |
| Rendering package inventory (now ten modules) | 47 / 47 passed |
| `tsgo --noEmit` | clean |
| Build | OK |

---

## 9. WAVE 4 — RUNTIME DELIVERY GATE

| Control | Result |
| --- | --- |
| Current Revision Re-approved | **FAIL** — blocked by DEF-13 |
| Maker-Checker | NOT REACHED |
| Revision Match Guard | PASS (implemented, fail-closed, exact 40-char SHA) |
| Runtime TEST Guard | PASS |
| Controlled Pilot Guard | PASS |
| Module Guard | PASS |
| Queued-Only Guard | PASS |
| Recipient Allowlist Guard | PASS |
| Simulation/Internal Provider Guard | PASS |
| External Provider Block | PASS |
| Historical Job Block | PASS |
| Old Canary Still Held | PASS |
| Original 8 Quarantined | PASS |
| Fresh Canary Runnable | **NOT REACHED** — gate not activated |
| Fresh Email Dispatch | **FAIL** — DEF-14 |
| Fresh In-App Dispatch | **FAIL** — DEF-15 |
| Temporary Failure / Retry / Permanent Failure | NOT REACHED |
| Plan PDF | NOT REACHED |
| Business Isolation | NOT REACHED |
| Typecheck | PASS |
| Build | PASS |

**WAVE 4 RESULT: PARTIAL**

**RUNTIME DELIVERY: NOT CERTIFIED**

**NOT READY FOR STAGE 1B**

## 10. Prerequisites to close

1. DEF-13 — stamp `OMNI_COMMS_DEPLOYED_REVISION` with the revision actually
   deployed, and record it through `omni_comms_priv_record_runtime_deployment`.
2. DEF-14 — governed simulation-safe email claim path
   (`simulation_email`, credential-free, allowlist-bound).
3. DEF-15 — governed in-app claim path, worker and internal adapter.
4. Mirror the authorization contract inside
   `omni_comms_priv_persist_rendered_messages` so the database — not the Edge
   Function — is the final authority on `is_runnable`, and set
   `RUNTIME_DISPATCH_CERTIFIED_FROM` at that moment.
5. Governed re-approval (maker ≠ checker) of email and in-app against the newly
   stamped revision, with module, mode, allowlist, provider posture, expiry and
   environment unchanged.
